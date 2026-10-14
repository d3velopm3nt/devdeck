//! Opt-in automatic GitHub intake. No worker/session is started by this service.
use crate::{
    db::Db,
    issue_monitor_model::{due, normalize, Config, Source},
};
use serde::Serialize;
use std::{fs, io::Write, path::Path, sync::Mutex, time::Duration};
use tauri::Manager;
static POLL: Mutex<()> = Mutex::new(());
static CONFIG: Mutex<()> = Mutex::new(());
#[derive(Serialize)]
pub struct View {
    pub raw: String,
    pub enabled: bool,
    pub sources: Vec<Source>,
    pub warnings: Vec<String>,
}
fn optional(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn write(path: &Path, raw: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid monitor path")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
fn config(db: &Db) -> Result<(String, Config), String> {
    let raw = optional(&crate::visibility::root(db)?.join(".devdeck/issue-monitor.json"))?;
    let value = if raw.is_empty() {
        Config::default()
    } else {
        serde_json::from_str(&raw).map_err(|e| format!("Issue monitor configuration: {e}"))?
    };
    Ok((raw, value))
}
fn cache_path(db: &Db, repository: &str) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(repository.as_bytes()));
    Ok(crate::visibility::root(db)?
        .join(".devdeck/issues")
        .join(format!("{digest}.json")))
}
fn source(db: &Db, repo: &str) -> Result<Source, String> {
    let raw = optional(&cache_path(db, repo)?)?;
    if raw.is_empty() {
        return Ok(Source {
            repository: repo.into(),
            ..Default::default()
        });
    }
    let saved: Source = serde_json::from_str(&raw)
        .map_err(|e| format!("Saved issues for {repo} could not be read: {e}"))?;
    if saved.repository != repo {
        return Err("Saved repository mismatch.".into());
    }
    Ok(saved)
}
pub fn view(db: &Db) -> Result<View, String> {
    let (raw, cfg) = config(db)?;
    let mut sources = vec![];
    let mut warnings = vec![];
    let mut repos: Vec<_> = crate::visibility::connected_products(db)?
        .into_iter()
        .map(|p| p.repository)
        .collect();
    repos.sort();
    repos.dedup();
    for repo in repos {
        match source(db, &repo) {
            Ok(s) => sources.push(s),
            Err(e) => warnings.push(e),
        }
    }
    Ok(View {
        raw,
        enabled: cfg.enabled,
        sources,
        warnings,
    })
}
fn poll(app: &tauri::AppHandle, db: &Db, force: bool) -> Result<(), String> {
    let Ok(_guard) = POLL.try_lock() else {
        return Err("Issue refresh already running.".into());
    };
    let snapshot = view(db)?;
    if !force && !snapshot.enabled {
        return Ok(());
    }
    for mut s in snapshot.sources {
        if !force && !config(db)?.1.enabled {
            break;
        }
        if !force && !due(&s.last_attempt, chrono::Utc::now().timestamp()) {
            continue;
        }
        s.last_attempt = chrono::Utc::now().to_rfc3339();
        match crate::visibility::github_issues_blocking(&s.repository) {
            Ok(result) => {
                s.items = normalize(result.items);
                s.fetched_at = result.fetched_at;
                s.warnings = result.warnings;
                s.truncated = result.truncated;
                s.error.clear();
            }
            Err(e) => {
                s.error = e;
            } // Keep last successfully read issues.
        }
        write(
            &cache_path(db, &s.repository)?,
            &serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?,
        )?;
        crate::aiw::events::say(
            app,
            crate::aiw::events::EventType::FileChanged,
            Default::default(),
            serde_json::json!({"source":"issue_monitor","repository":s.repository,"summary":"Issue intake refreshed","ok":s.error.is_empty()}),
        );
    }
    Ok(())
}
#[tauri::command(async)]
pub fn issue_monitor_get(db: tauri::State<Db>) -> Result<View, String> {
    view(&db)
}
#[tauri::command(async)]
pub fn issue_monitor_save(
    db: tauri::State<Db>,
    expected: String,
    enabled: bool,
) -> Result<View, String> {
    let _guard = CONFIG.lock().map_err(|e| e.to_string())?;
    if config(&db)?.0 != expected {
        return Err("Issue monitor settings changed. Reload before saving.".into());
    }
    write(
        &crate::visibility::root(&db)?.join(".devdeck/issue-monitor.json"),
        &serde_json::to_string_pretty(&Config { enabled }).map_err(|e| e.to_string())?,
    )?;
    view(&db)
}
#[tauri::command(async)]
pub fn issue_monitor_refresh(app: tauri::AppHandle, db: tauri::State<Db>) -> Result<View, String> {
    poll(&app, &db, true)?;
    view(&db)
}
pub fn install(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        let db = app.state::<Db>();
        // An unconfigured vault is normal at first launch. UI reads expose errors.
        let _ = poll(&app, &db, false);
        std::thread::sleep(Duration::from_secs(5));
    });
}
