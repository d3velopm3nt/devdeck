//! Shared visibility records supplement GitHub's product backlog.
//! External assistants checkpoint one JSON file per session in the Git vault.
use crate::db::{self, Db};
use std::{fs, path::PathBuf, time::Duration};

use crate::visibility_model::*;
pub(crate) fn root(db: &Db) -> Result<PathBuf, String> {
    db::setting_get_conn(&db.conn(), crate::vault::ROOT_KEY)?
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "Choose a DevDeck vault in Settings first.".into())
}
fn read_optional(path: &std::path::Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command(async)]
pub fn visibility_snapshot(db: tauri::State<Db>) -> Result<Snapshot, String> {
    let dir = root(&db)?.join(".devdeck");
    let config_raw = read_optional(&dir.join("activity-products.json"))?;
    let products = if config_raw.is_empty() {
        vec![]
    } else {
        serde_json::from_str::<Vec<ProductLink>>(&config_raw)
            .map_err(|e| format!("Product links could not be read: {e}"))?
    };
    let mut sessions = vec![];
    let mut warnings = vec![];
    let session_dir = dir.join("sessions");
    match fs::read_dir(&session_dir) {
        Ok(entries) => {
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                    continue;
                }
                match fs::read_to_string(&path)
                    .map_err(|e| e.to_string())
                    .and_then(|s| {
                        serde_json::from_str::<SessionRecord>(&s).map_err(|e| e.to_string())
                    }) {
                    Ok(s)
                        if chrono::DateTime::parse_from_rfc3339(&s.updated_at).is_ok()
                            && chrono::DateTime::parse_from_rfc3339(&s.started_at).is_ok() =>
                    {
                        sessions.push(s)
                    }
                    Ok(_) => warnings.push(format!(
                        "{} has invalid session timestamps",
                        entry.file_name().to_string_lossy()
                    )),
                    Err(e) => {
                        warnings.push(format!("{}: {e}", entry.file_name().to_string_lossy()))
                    }
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Sessions could not be read: {e}")),
    }
    sessions.sort_by_key(|s| {
        std::cmp::Reverse(
            chrono::DateTime::parse_from_rfc3339(&s.updated_at)
                .map(|t| t.timestamp_millis())
                .unwrap_or(0),
        )
    });
    Ok(Snapshot {
        products,
        config_raw,
        sessions,
        warnings,
    })
}
// Database lock serializes local writers; the expected bytes guard edits from
// other clients. Git supplies the separate remote conflict guard.
#[tauri::command(async)]
pub fn visibility_products_save(
    db: tauri::State<Db>,
    expected: String,
    products: Vec<ProductLink>,
) -> Result<(), String> {
    let dir = root(&db)?.join(".devdeck");
    let _guard = db.conn();
    let mut ids = std::collections::HashSet::new();
    for p in &products {
        if p.id.trim().is_empty()
            || p.name.trim().is_empty()
            || !repository_valid(&p.repository)
            || !ids.insert(&p.id)
        {
            return Err("Each product needs a unique ID, name and owner/repository.".into());
        }
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("activity-products.json");
    if read_optional(&file)? != expected {
        return Err("Product links changed. Refresh before saving.".into());
    }
    fs::write(
        &file,
        serde_json::to_string_pretty(&products).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
pub use crate::github_issue_read::IssueSnapshot;
#[tauri::command(async)]
pub async fn visibility_github_issues(repository: String) -> Result<IssueSnapshot, String> {
    // Validate before touching credentials or constructing a request.
    if !repository_valid(&repository) {
        return Err("Use owner/repository.".into());
    }
    // reqwest's blocking client cannot be constructed on the async runtime.
    // Await the worker so a panic also becomes an IPC error instead of leaving
    // the Activity board waiting for its frontend deadline.
    tauri::async_runtime::spawn_blocking(move || github_issues_blocking(&repository))
        .await
        .map_err(|_| "GitHub issue reader stopped unexpectedly. Retry the refresh.".to_string())?
}

pub(crate) fn github_issues_blocking(repository: &str) -> Result<IssueSnapshot, String> {
    crate::github_issue_read::read(
        repository,
        crate::github_issue_read::READ_BUDGET,
        |endpoint, timeout| crate::github_transport::request(endpoint, "GET", None, timeout),
    )
}

/// GitHub reads and mutations keep tokens off command lines and reject redirects.
pub(crate) fn github_request(
    endpoint: &str,
    method: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    crate::github_transport::request(endpoint, method, body, Duration::from_secs(20))
}
pub(crate) fn github_get(endpoint: &str) -> Result<serde_json::Value, String> {
    github_request(endpoint, "GET", None)
}

/// Product setup owns Activity connections. One entry per linked repository.
pub(crate) fn register_product(
    db: &Db,
    business: i64,
    parent: i64,
    repository: &str,
) -> Result<(), String> {
    if !repository_valid(repository) {
        return Err("Invalid repository address.".into());
    }
    let dir = root(db)?.join(".devdeck");
    let conn = db.conn();
    let space = db::node_by_id(&conn, business)?;
    let product = db::node_by_id(&conn, parent)?;
    let file = dir.join("activity-products.json");
    let raw = read_optional(&file)?;
    let mut links: Vec<ProductLink> = if raw.is_empty() {
        vec![]
    } else {
        serde_json::from_str(&raw).map_err(|e| format!("Product links could not be read: {e}"))?
    };
    let id = format!("repo:{repository}");
    if let Some(p) = links
        .iter_mut()
        .find(|p| p.repository.eq_ignore_ascii_case(repository))
    {
        p.name = product.name;
        p.space = space.name;
        p.folder = product.rel_path;
    } else {
        links.push(ProductLink {
            id,
            name: product.name,
            space: space.name,
            folder: product.rel_path,
            repository: repository.into(),
            project_url: String::new(),
        });
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if read_optional(&file)? != raw {
        return Err("Product links changed. Retry linking after refreshing.".into());
    }
    fs::write(
        file,
        serde_json::to_string_pretty(&links).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn set_project_url(db: &Db, repository: &str, url: &str) -> Result<(), String> {
    let dir = root(db)?.join(".devdeck");
    let _conn = db.conn();
    let file = dir.join("activity-products.json");
    let raw = read_optional(&file)?;
    let mut links: Vec<ProductLink> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let p = links
        .iter_mut()
        .find(|p| p.repository.eq_ignore_ascii_case(repository))
        .ok_or("Activity connection not found")?;
    p.project_url = url.into();
    if read_optional(&file)? != raw {
        return Err("Product connections changed. Refresh and retry.".into());
    }
    fs::write(
        file,
        serde_json::to_string_pretty(&links).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Paired companion reads only repositories explicitly connected on the desktop.
pub(crate) fn companion_issues(db: &Db, product: &str) -> Result<IssueSnapshot, String> {
    let raw = read_optional(&root(db)?.join(".devdeck/activity-products.json"))?;
    let links: Vec<ProductLink> =
        serde_json::from_str(&raw).map_err(|_| "Connect a project on the desktop first.")?;
    let link = links
        .iter()
        .find(|p| p.id == product)
        .ok_or("Connected project not found.")?;
    if !repository_valid(&link.repository) {
        return Err("Invalid connected repository.".into());
    }
    github_issues_blocking(&link.repository)
}

pub(crate) fn connected_products(db: &Db) -> Result<Vec<ProductLink>, String> {
    let raw = read_optional(&root(db)?.join(".devdeck/activity-products.json"))?;
    if raw.is_empty() {
        return Ok(vec![]);
    }
    let products: Vec<ProductLink> =
        serde_json::from_str(&raw).map_err(|e| format!("Product links could not be read: {e}"))?;
    if products.iter().any(|p| !repository_valid(&p.repository)) {
        return Err("A connected repository is invalid.".into());
    }
    Ok(products)
}
