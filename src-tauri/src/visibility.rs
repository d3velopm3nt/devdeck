//! Shared visibility records supplement GitHub's product backlog.
//! External assistants checkpoint one JSON file per session in the Git vault.
use crate::db::{self, Db};
use serde::Serialize;
use std::{fs, path::PathBuf, time::Duration};

use crate::visibility_model::*;
fn root(db: &Db) -> Result<PathBuf, String> {
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
#[derive(Serialize)]
pub struct IssueSnapshot {
    pub items: Vec<serde_json::Value>,
    pub fetched_at: String,
    pub truncated: bool,
    pub sessions: Vec<SessionRecord>,
    pub warnings: Vec<String>,
}
#[tauri::command(async)]
pub fn visibility_github_issues(repository: String) -> Result<IssueSnapshot, String> {
    if !repository_valid(&repository) {
        return Err("Use owner/repository.".into());
    }
    let token = crate::github::stored_token();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("DevDeck")
        .build()
        .map_err(|e| e.to_string())?;
    let mut items = vec![];
    let mut truncated = false;
    for page in 1..=5 {
        let endpoint =
            format!("repos/{repository}/issues?state=all&sort=updated&per_page=100&page={page}");
        let rows: Vec<serde_json::Value> = if let Some(token) = &token {
            let response = client
                .get(format!("https://api.github.com/{endpoint}"))
                .bearer_auth(token)
                .header("Accept", "application/vnd.github+json")
                .send()
                .map_err(|_| "Could not reach GitHub.".to_string())?;
            if !response.status().is_success() {
                return Err(format!("GitHub returned {} for {repository}. Check repository access and account permissions.", response.status().as_u16()));
            }
            response
                .json()
                .map_err(|_| "GitHub returned unreadable issues.".to_string())?
        } else {
            // Reuse gh's authenticated API without extracting its credentials.
            let mut command = std::process::Command::new("gh");
            command
                .args(["api", "--hostname", "github.com", &endpoint])
                .stdin(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x0800_0000);
            }
            let response = command
                .output()
                .map_err(|_| "Connect GitHub in Settings or sign in with gh first.".to_string())?;
            if !response.status.success() {
                return Err(format!(
                    "GitHub CLI could not read {repository}. Check sign-in and repository access."
                ));
            }
            serde_json::from_slice(&response.stdout)
                .map_err(|_| "GitHub CLI returned unreadable issues.".to_string())?
        };
        let len = rows.len();
        // Retain only the fields used by the overview, not full issue bodies.
        items.extend(rows.into_iter().map(|v| serde_json::json!({"number":v["number"],"title":v["title"],"state":v["state"],"url":v["html_url"],"updated_at":v["updated_at"],"assignees":v["assignees"].as_array().map(|a| a.iter().filter_map(|a| a["login"].as_str()).collect::<Vec<_>>()).unwrap_or_default(),"pull_request":v.get("pull_request").is_some()})));
        if len < 100 {
            break;
        }
        if page == 5 {
            truncated = true;
        }
    }
    let mut comments = vec![];
    let mut warnings = vec![];
    for page in 1..=5 {
        let endpoint = format!("repos/{repository}/issues/comments?sort=created&direction=desc&per_page=100&page={page}");
        match github_get(&endpoint) {
            Ok(value) => {
                let rows = value
                    .as_array()
                    .ok_or("GitHub returned unreadable comments.")?;
                let count = rows.len();
                comments.extend(rows.clone());
                if count < 100 {
                    break;
                }
                if page == 5 {
                    warnings.push(
                        "Session history is limited to the 500 latest repository comments.".into(),
                    );
                }
            }
            Err(e) => {
                return Err(format!(
                    "Issues were read but session comments could not be read: {e}"
                ));
            }
        }
    }
    let (mut sessions, parse_warnings) = comment_sessions(&repository, &comments);
    for session in &mut sessions {
        let ticket_number = session
            .ticket_url
            .rsplit('/')
            .next()
            .and_then(|s| s.parse::<u64>().ok());
        if let Some(item) = items.iter().find(|i| {
            i["number"]
                .as_u64()
                .is_some_and(|number| Some(number) == ticket_number)
        }) {
            session.ticket_url = item["url"]
                .as_str()
                .unwrap_or(&session.ticket_url)
                .to_string();
        }
    }
    warnings.extend(parse_warnings);
    Ok(IssueSnapshot {
        items,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        truncated,
        sessions,
        warnings,
    })
}

/// GitHub reads and mutations keep tokens off command lines and reject redirects.
pub(crate) fn github_request(
    endpoint: &str,
    method: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let token = crate::github::stored_token();
    if let Some(token) = token {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("DevDeck")
            .build()
            .map_err(|e| e.to_string())?;
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut req = client
            .request(method, format!("https://api.github.com/{endpoint}"))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json");
        if let Some(body) = body {
            req = req.json(&body);
        }
        let response = req
            .send()
            .map_err(|_| "Could not reach GitHub.".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "GitHub returned {}. Check account access and required permissions.",
                response.status().as_u16()
            ));
        }
        response
            .json()
            .map_err(|_| "GitHub returned unreadable data.".into())
    } else {
        use std::io::Write;
        let mut cmd = std::process::Command::new("gh");
        cmd.args([
            "api",
            "--hostname",
            "github.com",
            "--method",
            method,
            endpoint,
        ]);
        if body.is_some() {
            cmd.args(["--input", "-"]);
        }
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd
            .spawn()
            .map_err(|_| "Connect GitHub in Settings or sign in with gh first.".to_string())?;
        if let Some(body) = body {
            let mut input = child.stdin.take().ok_or("GitHub input unavailable")?;
            input
                .write_all(body.to_string().as_bytes())
                .map_err(|e| e.to_string())?;
        } else {
            drop(child.stdin.take());
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(
                "GitHub request failed. Check account access and required permissions.".into(),
            );
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|_| "GitHub returned unreadable data.".into())
    }
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
