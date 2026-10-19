//! Opt-in GitHub intake and explicitly assigned workflow dispatch.
use crate::{
    db::Db,
    issue_monitor_model::{
        dispatchable, due, may_select, normalize, Binding, Config, Dispatch, Source,
    },
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
    pub briefings: bool,
    pub dispatch_enabled: bool,
    pub sources: Vec<Source>,
    pub warnings: Vec<String>,
    pub bindings: Vec<Binding>,
    pub dispatches: Vec<Dispatch>,
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

pub(crate) fn ticket_context(db: &Db, repository: &str, number: u64) -> Result<String, String> {
    let saved = source(db, repository)?;
    let issue = saved.items.iter().find(|issue| issue["number"].as_u64() == Some(number))
        .ok_or("Refresh issue intake before planning: the originating issue is not cached.")?;
    crate::issue_monitor_model::ticket_brief(repository, number, issue)
}

pub(crate) fn ticket_title(db: &Db, repository: &str, number: u64) -> Option<String> {
    source(db, repository).ok()?.items.iter().find(|issue| issue["number"].as_u64() == Some(number))?
        .get("title")?.as_str().map(str::to_owned)
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
    // Manual routing and human review must remain visible even while automatic
    // monitoring is paused. Workflow receipts are authoritative for linked work.
    let mut dispatches = dispatches(db)?;
    let workflows = crate::folder_workflows::snapshot(db);
    if let Some(items) = workflows["items"].as_array() {
        for item in items {
            let Some(ticket) = item["definition"]["ticket_url"].as_str() else { continue };
            let Some(path) = ticket.strip_prefix("https://github.com/") else { continue };
            let Some((repository, number)) = path.split_once("/issues/") else { continue };
            let Ok(number) = number.parse::<u64>() else { continue };
            if !sources.iter().any(|s| s.repository == repository) { continue; }
            let steps: Vec<serde_json::Value> = items.iter()
                .filter(|other| other["definition"]["ticket_url"].as_str() == Some(ticket))
                .filter_map(|other| other["definition"]["steps"].as_array())
                .flatten().cloned().collect();
            let Some(node) = item["node"].as_i64() else { continue };
            let Some(workflow) = item["id"].as_str() else { continue };
            let status = linked_status(&steps);
            let message = steps.iter().filter(|s| s["status"] == "blocked" || s["status"] == "review")
                .filter_map(|s| s["evidence"].as_str()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n");
            if let Some(row) = dispatches.iter_mut().find(|d| d.repository == repository && d.number == number) {
                // A work item may own several runs. Keep its original dispatch
                // assignment while aggregating attention across all linked runs.
                if row.workflow.is_empty() { row.workflow = workflow.into(); }
                row.status = status.into(); row.message = message;
            } else {
                dispatches.push(Dispatch { repository: repository.into(), number, node, workflow: workflow.into(), status: status.into(), message });
            }
        }
    }
    if let Some(rows) = workflows["warnings"].as_array() {
        warnings.extend(rows.iter().filter_map(|w| w.as_str().map(str::to_string)));
    }
    Ok(View {
        raw,
        enabled: cfg.enabled,
        briefings: cfg.briefings,
        dispatch_enabled: cfg.dispatch_enabled,
        sources,
        warnings,
        bindings: cfg.bindings,
        dispatches,
    })
}
pub(crate) fn update_work_attention(db: &Db) -> Result<(), String> {
    let current = view(db)?;
    crate::inbox::dispatch_requests(db, &current.dispatches)
}
fn linked_status(steps: &[serde_json::Value]) -> &'static str {
    if !steps.is_empty() && steps.iter().all(|s| s["status"] == "done") { "done" }
    else if steps.iter().any(|s| s["status"] == "blocked") { "blocked" }
    else if steps.iter().any(|s| s["status"] == "review") { "review" }
    else if steps.iter().any(|s| s["status"] == "running" || s["status"] == "starting") { "running" }
    else { "pending" }
}
#[cfg(test)]
mod linked_work_tests {
    use super::linked_status;
    use serde_json::json;
    #[test]
    fn manual_work_retains_review_and_dependency_gates_when_monitoring_is_paused() {
        assert_eq!(linked_status(&[]), "pending");
        assert_eq!(linked_status(&[json!({"status":"pending"})]), "pending");
        assert_eq!(linked_status(&[json!({"status":"running"}), json!({"status":"pending"})]), "running");
        assert_eq!(linked_status(&[json!({"status":"review"}), json!({"status":"pending"})]), "review");
        assert_eq!(linked_status(&[json!({"status":"done"}), json!({"status":"pending"})]), "pending");
        assert_eq!(linked_status(&[json!({"status":"blocked"})]), "blocked");
        assert_eq!(linked_status(&[json!({"status":"done"})]), "done");
        assert_eq!(linked_status(&[json!({"status":"running"}),json!({"status":"blocked"})]), "blocked");
        assert_eq!(linked_status(&[json!({"status":"running"}),json!({"status":"review"})]), "review");
    }
}
fn poll(app: &tauri::AppHandle, db: &Db, force: bool) -> Result<(), String> {
    let Ok(_guard) = POLL.try_lock() else {
        return Err("Issue refresh already running.".into());
    };
    let root = crate::visibility::root(db)?;
    let snapshot = view(db)?;
    if !force && !snapshot.enabled {
        return Ok(());
    }
    for mut s in snapshot.sources {
        if crate::visibility::root(db)? != root { return Err("Vault changed during refresh".into()); }
        let saved_path = cache_path(db, &s.repository)?;
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
        let activity_due = chrono::DateTime::parse_from_rfc3339(&s.activity.last_attempt)
            .map(|at| chrono::Utc::now().timestamp() - at.timestamp() >= 300).unwrap_or(true);
        if force || activity_due { crate::repository_monitor::refresh(&s.repository, &mut s.activity); }
        if crate::visibility::root(db)? != root { return Err("Vault changed during refresh".into()); }
        write(
            &saved_path,
            &serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?,
        )?;
        if config(db)?.1.briefings && (force || config(db)?.1.enabled) && crate::repository_monitor::should_assess(&s, false) {
            s.briefing.attempted = crate::repository_monitor::fingerprint(&s);
            s.briefing.attempted_at = chrono::Utc::now().to_rfc3339();
            s.briefing.error = "Briefing in progress; if interrupted, refresh with Retry briefing.".into();
            write(&saved_path, &serde_json::to_string_pretty(&s).map_err(|e|e.to_string())?)?;
            match crate::repository_monitor::assess(app, &s) {
                Ok(text) => {
                    s.briefing.text = text;
                    s.briefing.generated_at = chrono::Utc::now().to_rfc3339();
                    s.briefing.fingerprint = s.briefing.attempted.clone();
                    s.briefing.error.clear();
                    s.briefing.unread = true;
                }
                Err(error) => s.briefing.error = error,
            }
            if s.briefing.error.is_empty() {
                crate::aiw::events::say(app, crate::aiw::events::EventType::FileChanged, Default::default(),
                    serde_json::json!({"source":"repository_briefing","repository":s.repository,"summary":s.briefing.text}));
            }
            // Save only to the vault captured before the network/model request.
            write(&saved_path, &serde_json::to_string_pretty(&s).map_err(|e|e.to_string())?)?;
        }
        if crate::visibility::root(db)? != root { return Err("Vault changed during refresh".into()); }
        if s.error.is_empty() && config(db)?.1.enabled && config(db)?.1.dispatch_enabled {
            dispatch_source(app, db, &s)?;
        }
        crate::aiw::events::say(
            app,
            crate::aiw::events::EventType::FileChanged,
            Default::default(),
            serde_json::json!({"source":"issue_monitor","repository":s.repository,"summary":"Repository activity refreshed","ok":s.error.is_empty() && s.activity.error.is_empty()}),
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
    bindings: Option<Vec<Binding>>,
    briefings: Option<bool>,
    dispatch_enabled: Option<bool>,
) -> Result<View, String> {
    let _guard = CONFIG.lock().map_err(|e| e.to_string())?;
    if config(&db)?.0 != expected {
        return Err("Issue monitor settings changed. Reload before saving.".into());
    }
    let previous_cfg = config(&db)?.1;
    let ai_briefings = briefings.unwrap_or(previous_cfg.briefings);
    let dispatch_enabled = dispatch_enabled.unwrap_or(previous_cfg.dispatch_enabled);
    let previous = previous_cfg.bindings;
    let bindings = bindings.unwrap_or_else(|| previous.clone());
    let connected = crate::visibility::connected_products(&db)?;
    let mut seen = std::collections::HashSet::new();
    for binding in &bindings {
        if binding.issues.iter().any(|n| *n == 0) || binding.issues.len() > 100 {
            return Err("Choose up to 100 positive issue numbers".into());
        }
        // Retained assignments must never prevent pausing when a folder/repo
        // was removed. Validate only newly assigned targets.
        if previous
            .iter()
            .any(|old| old.repository == binding.repository && old.node == binding.node)
        {
            if !seen.insert(binding.repository.clone()) {
                return Err("Assign each connected repository at most once".into());
            }
            continue;
        }
        if !connected.iter().any(|p| p.repository == binding.repository)
            || !seen.insert(binding.repository.clone())
        {
            return Err("Assign each connected repository at most once".into());
        }
        crate::folder_workflows::folder_workflow_list(db.clone(), binding.node)?;
    }
    write(
        &crate::visibility::root(&db)?.join(".devdeck/issue-monitor.json"),
        &serde_json::to_string_pretty(&Config { enabled, bindings, briefings: ai_briefings, dispatch_enabled }).map_err(|e| e.to_string())?,
    )?;
    view(&db)
}
/// Read acknowledgement or explicit retry never starts workflow dispatch.
#[tauri::command(async)]
pub async fn repository_briefing_read(app: tauri::AppHandle, repository: String, retry: bool, expected: String) -> Result<View, String> {
    tauri::async_runtime::spawn_blocking(move || {
        repository_briefing_read_blocking(app.clone(), app.state::<Db>(), repository, retry, expected)
    }).await.map_err(|e| format!("Repository briefing stopped: {e}"))?
}
fn repository_briefing_read_blocking(app: tauri::AppHandle, db: tauri::State<Db>, repository: String, retry: bool, expected: String) -> Result<View, String> {
    let _guard = POLL.try_lock().map_err(|_| "Repository refresh running; try again shortly")?;
    if !crate::visibility::connected_products(&db)?.iter().any(|p| p.repository == repository) { return Err("Repository is no longer connected".into()); }
    let path = cache_path(&db, &repository)?;
    let mut s = source(&db, &repository)?;
    if s.briefing.generated_at != expected { return Err("A newer briefing arrived. Read it before marking it read or retrying.".into()); }
    if retry {
        if !config(&db)?.1.briefings { return Err("Enable Dev briefings first".into()); }
        if !crate::repository_monitor::should_assess(&s, true) { return Err("Refresh repository activity successfully before retrying".into()); }
        s.briefing.attempted = crate::repository_monitor::fingerprint(&s);
        s.briefing.attempted_at = chrono::Utc::now().to_rfc3339();
        s.briefing.error = "Briefing in progress; retry if interrupted.".into();
        write(&path,&serde_json::to_string_pretty(&s).map_err(|e|e.to_string())?)?;
        match crate::repository_monitor::assess(&app,&s) {
            Ok(text) => { s.briefing.text=text; s.briefing.generated_at=chrono::Utc::now().to_rfc3339(); s.briefing.fingerprint=s.briefing.attempted.clone(); s.briefing.error.clear(); s.briefing.unread=true; }
            Err(error) => s.briefing.error=error,
        }
    } else { s.briefing.unread=false; }
    write(&path,&serde_json::to_string_pretty(&s).map_err(|e|e.to_string())?)?;
    view(&db)
}
#[tauri::command(async)]
pub async fn issue_monitor_refresh(app: tauri::AppHandle) -> Result<View, String> {
    // GitHub and model clients are blocking. Running them on a Tokio worker
    // panics when their private runtime is dropped and poisons the poll lock.
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Db>();
        poll(&app, &db, true)?;
        view(&db)
    }).await.map_err(|e| format!("Repository refresh stopped: {e}"))?
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

fn dispatches(db: &Db) -> Result<Vec<Dispatch>, String> {
    let raw = optional(&crate::visibility::root(db)?.join(".devdeck/issue-dispatches.json"))?;
    if raw.is_empty() {
        Ok(Vec::new())
    } else {
        serde_json::from_str(&raw).map_err(|e| format!("Issue dispatch records: {e}"))
    }
}
fn save_dispatches(db: &Db, rows: &[Dispatch]) -> Result<(), String> {
    write(
        &crate::visibility::root(db)?.join(".devdeck/issue-dispatches.json"),
        &serde_json::to_string_pretty(rows).map_err(|e| e.to_string())?,
    )?;
    crate::inbox::dispatch_requests(db, rows)
}
pub fn dispatch_allowed(app: &tauri::AppHandle, node: i64, repository: &str, number: u64) -> Result<(), String> {
    use crate::aiw::{assistant::ASSISTANT_ID, state::Workspace, tools::Permission};
    use std::sync::Arc;
    let cfg = config(&app.state::<Db>())?.1;
    if !cfg.enabled || !cfg.dispatch_enabled
        || !cfg
            .bindings
            .iter()
            .any(|b| b.node == node && b.repository == repository && b.includes(number))
    {
        return Err("Automatic dispatch is paused or this folder is no longer assigned".into());
    }
    let ws = app.state::<Arc<Workspace>>();
    if ws.permission_matrix().get(ASSISTANT_ID, "workflow") != Permission::Full {
        return Err("Dev needs Full workflow permission for unattended dispatch; approval-only waits for a person".into());
    }
    Ok(())
}
fn dispatch_source(app: &tauri::AppHandle, db: &Db, source: &Source) -> Result<(), String> {
    let Some(binding) = config(db)?
        .1
        .bindings
        .into_iter()
        .find(|b| b.repository == source.repository)
    else {
        return Ok(());
    };
    let mut rows = dispatches(db)?;
    for issue in source.items.iter().filter(|i| dispatchable(i)) {
        let number = issue["number"].as_u64().ok_or("Invalid issue number")?;
        if !binding.includes(number) { continue; }
        let index = rows
            .iter()
            .position(|d| d.repository == source.repository && d.number == number)
            .unwrap_or_else(|| {
                rows.push(Dispatch {
                    repository: source.repository.clone(),
                    number,
                    node: binding.node,
                    status: "pending".into(),
                    ..Default::default()
                });
                rows.len() - 1
            });
        if rows[index].node != binding.node {
            rows[index].message = "Already routed to another folder; existing work is retained and will not be duplicated".into();
            save_dispatches(db, &rows)?;
            continue;
        }
        if rows[index].status == "done" {
            continue;
        }
        if let Err(error) = dispatch_allowed(app, binding.node, &source.repository, number) {
            rows[index].message = error;
            save_dispatches(db, &rows)?;
            continue;
        }
        if rows[index].workflow.is_empty() {
            if rows[index].status == "selecting" {
                rows[index].status = "blocked".into();
                rows[index].message =
                    "Selection was interrupted. Retry explicitly to avoid duplicate model calls."
                        .into();
                save_dispatches(db, &rows)?;
                continue;
            }
            if !may_select(&rows[index]) {
                continue;
            }
            rows[index].status = "selecting".into();
            save_dispatches(db, &rows)?; // durable claim before inference
            let result = (|| -> Result<String, String> {
                let selected = crate::folder_workflows::select_for_issue(app, binding.node, issue)?;
                dispatch_allowed(app, binding.node, &source.repository, number)?;
                let template = crate::folder_workflows::folder_workflow_get(
                    app.clone(),
                    app.state::<Db>(),
                    binding.node,
                    Some(selected.clone()),
                )?;
                let routed = crate::folder_workflows::folder_workflow_route(
                    app.clone(),
                    app.state::<Db>(),
                    binding.node,
                    selected,
                    template.raw,
                    source.repository.clone(),
                    number,
                    issue["title"].as_str().unwrap_or("GitHub issue").into(),
                )?;
                Ok(routed.id)
            })();
            match result {
                Ok(id) => {
                    rows[index].workflow = id;
                    rows[index].status = "pending".into();
                    rows[index].message.clear();
                }
                Err(error) => {
                    rows[index].status = "blocked".into();
                    rows[index].message = error;
                }
            }
            save_dispatches(db, &rows)?;
        }
        if rows[index].workflow.is_empty() {
            continue;
        }
        match crate::folder_workflows::advance_issue(
            app,
            binding.node,
            &rows[index].workflow,
            &source.repository,
            number,
        ) {
            Ok(status) => {
                rows[index].status = status;
                rows[index].message.clear();
            }
            Err(error) => {
                rows[index].status = "blocked".into();
                rows[index].message = error;
            }
        }
        save_dispatches(db, &rows)?;
    }
    Ok(())
}
#[tauri::command(async)]
pub fn issue_monitor_retry(
    db: tauri::State<Db>,
    repository: String,
    number: u64,
) -> Result<View, String> {
    let _guard = POLL
        .try_lock()
        .map_err(|_| "Issue refresh running; retry shortly")?;
    let mut rows = dispatches(&db)?;
    let row = rows
        .iter_mut()
        .find(|d| d.repository == repository && d.number == number)
        .ok_or("Dispatch record not found")?;
    if !row.workflow.is_empty() {
        return Err("Review or retry the failed step in its workflow".into());
    }
    row.status = "pending".into();
    row.message.clear();
    save_dispatches(&db, &rows)?;
    view(&db)
}
