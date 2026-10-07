//! Workflows belong to existing vault folders. Commands own transitions;
//! the event bus announces them. A worker receipt is not human acceptance.
use crate::aiw::deck::{parse_doc, write_doc, Doc};
use crate::aiw::events::{in_space, say, EventType};
use crate::workflow_model::{ready, receipt_status, validate, Definition, Status};
use crate::{db, db::Db, workers};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

static TRANSITION: Mutex<()> = Mutex::new(());
const FILE: &str = "WORKFLOW.md";

#[derive(Serialize)]
pub struct View {
    pub raw: String,
    pub definition: Definition,
    pub body: String,
    pub path: String,
}

fn path(db: &Db, node: i64) -> Result<PathBuf, String> {
    let conn = db.conn();
    let n = db::node_by_id(&conn, node).map_err(|e| e.to_string())?;
    if !n
        .label
        .as_deref()
        .unwrap_or_default()
        .eq_ignore_ascii_case("workflow")
    {
        return Err("Add the Workflow label to this folder first.".into());
    }
    let dir = db::node_deck_dir(&conn, &n).ok_or("This folder is not in the vault.")?;
    if !dir.is_dir() {
        return Err("The workspace folder is missing.".into());
    }
    Ok(dir.join(FILE))
}
fn read(p: &Path) -> Result<String, String> {
    match fs::read_to_string(p) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn parse(raw: &str) -> Result<Doc<Definition>, String> {
    let doc = parse_doc::<Definition>(raw)?;
    validate(&doc.meta)?;
    Ok(doc)
}
fn save(p: &Path, doc: &Doc<Definition>) -> Result<String, String> {
    let raw = write_doc(doc)?;
    // Same-directory rename replaces the whole document, including on Windows.
    // Sync before replacement: a partial write must never look like an empty plan.
    let tmp = p.with_extension("md.tmp");
    let result = (|| {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        fs::rename(&tmp, p).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result?;
    Ok(raw)
}
fn changed(app: &tauri::AppHandle, node: i64) {
    say(
        app,
        EventType::FileChanged,
        in_space(node, None, None),
        serde_json::json!({"path": FILE, "source": "folder_workflow", "summary": "Workflow state updated"}),
    );
}
fn view(p: &Path, raw: String) -> Result<View, String> {
    let doc = if raw.is_empty() {
        Doc {
            meta: Definition::default(),
            body: String::new(),
        }
    } else {
        parse(&raw)?
    };
    Ok(View {
        raw,
        definition: doc.meta,
        body: doc.body,
        path: p.to_string_lossy().into(),
    })
}
fn reconcile(doc: &mut Doc<Definition>) -> Result<bool, String> {
    let mut dirty = false;
    for s in &mut doc.meta.steps {
        if !matches!(s.status, Status::Starting | Status::Running) {
            continue;
        }
        let r = if s.run.is_empty() {
            workers::all_runs()?.into_iter().find(|r| r.item == s.claim)
        } else {
            workers::read_run(&s.run)?
        };
        let (status, run, evidence) = match r {
            Some(r) => (receipt_status(&r.status, r.ok), r.id, r.verdict),
            None => (
                Status::Blocked,
                String::new(),
                "No worker receipt was found. Inspect the target before retrying.".into(),
            ),
        };
        if s.status != status || s.run != run || s.evidence != evidence {
            s.status = status;
            s.run = run;
            s.evidence = evidence;
            dirty = true;
        }
    }
    Ok(dirty)
}
fn get(app: &tauri::AppHandle, db: &Db, node: i64) -> Result<View, String> {
    let guard = TRANSITION.lock().map_err(|e| e.to_string())?;
    let p = path(db, node)?;
    let mut raw = read(&p)?;
    let mut dirty = false;
    if !raw.is_empty() {
        let mut doc = parse(&raw)?;
        dirty = reconcile(&mut doc)?;
        if dirty {
            raw = save(&p, &doc)?;
        }
    }
    let result = view(&p, raw);
    drop(guard);
    if dirty {
        changed(app, node);
    }
    result
}
#[tauri::command(async)]
pub fn folder_workflow_get(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node: i64,
) -> Result<View, String> {
    get(&app, &db, node)
}
#[tauri::command(async)]
pub fn folder_workflow_save(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node: i64,
    expected: String,
    raw: String,
) -> Result<View, String> {
    let guard = TRANSITION.lock().map_err(|e| e.to_string())?;
    let p = path(&db, node)?;
    let old = read(&p)?;
    if old != expected {
        return Err("This workflow changed. Reload before saving.".into());
    }
    if !old.is_empty()
        && parse(&old)?
            .meta
            .steps
            .iter()
            .any(|s| s.status != Status::Pending)
    {
        return Err("This workflow has started. Keep its receipt intact; use another folder for a new workflow.".into());
    }
    let doc = parse(&raw)?;
    if doc.meta.steps.iter().any(|s| {
        s.status != Status::Pending
            || !s.run.is_empty()
            || !s.claim.is_empty()
            || !s.evidence.is_empty()
            || !s.previous_runs.is_empty()
    }) {
        return Err("New definitions must contain pending steps without run receipts.".into());
    }
    let raw = save(&p, &doc)?;
    drop(guard);
    changed(&app, node);
    view(&p, raw)
}
#[tauri::command(async)]
pub fn folder_workflow_start(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node: i64,
    step: String,
    expected: String,
) -> Result<View, String> {
    let guard = TRANSITION.lock().map_err(|e| e.to_string())?;
    let p = path(&db, node)?;
    let raw = read(&p)?;
    if raw != expected {
        return Err("The workflow changed. Reload before starting.".into());
    }
    let mut doc = parse(&raw)?;
    let i = doc
        .meta
        .steps
        .iter()
        .position(|s| s.id == step)
        .ok_or("Step not found.")?;
    if !ready(&doc.meta, i) {
        return Err("This step is already claimed or its dependencies are not accepted.".into());
    }
    let s = &doc.meta.steps[i];
    let claim = format!(
        "workflow:{node}:{}:{}",
        s.id,
        chrono::Utc::now().timestamp_micros()
    );
    let dependencies = doc
        .meta
        .steps
        .iter()
        .filter(|d| s.needs.contains(&d.id))
        .map(|d| format!("{}: {} (run {})", d.title, d.evidence, d.run))
        .collect::<Vec<_>>()
        .join("\n");
    let intent = format!("Workflow source: {}\n\n{}\n\n{}\n\nPrevious review: {}\n\nAccepted dependencies:\n{}\n\nReport results and verification for human review. Do not change workflow state or publish.", p.display(), doc.body, s.instructions, s.evidence, dependencies);
    let mut plan = {
        let conn = db.conn();
        workers::plan(&conn, &s.worker, s.target, "", &claim, &s.title, &intent)?
    };
    if plan.is_repo {
        plan.branch = format!("devdeck/workflow-{node}-{}", s.id);
    }
    if !plan.ready {
        return Err(plan.note);
    }
    doc.meta.steps[i].status = Status::Starting;
    doc.meta.steps[i].claim = claim;
    if !doc.meta.steps[i].run.is_empty() {
        let previous = doc.meta.steps[i].run.clone();
        doc.meta.steps[i].previous_runs.push(previous);
    }
    doc.meta.steps[i].run.clear();
    doc.meta.steps[i].evidence.clear();
    save(&p, &doc)?; // Persist ownership before launching; recovery finds the claim in the receipt.
    match workers::start(&app, &db, plan) {
        Ok(run) => {
            doc.meta.steps[i].run = run.id;
            doc.meta.steps[i].status = Status::Running;
        }
        Err(e) => {
            doc.meta.steps[i].status = Status::Blocked;
            doc.meta.steps[i].evidence = e;
        }
    }
    let raw = save(&p, &doc)?;
    drop(guard);
    changed(&app, node);
    view(&p, raw)
}
#[tauri::command(async)]
pub fn folder_workflow_review(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node: i64,
    step: String,
    expected: String,
    accept: bool,
    evidence: String,
) -> Result<View, String> {
    if evidence.trim().is_empty() {
        return Err("Record what you reviewed and where the accepted output is available.".into());
    }
    let guard = TRANSITION.lock().map_err(|e| e.to_string())?;
    let p = path(&db, node)?;
    let raw = read(&p)?;
    if raw != expected {
        return Err("The workflow changed. Reload before reviewing.".into());
    }
    let mut doc = parse(&raw)?;
    let s = doc
        .meta
        .steps
        .iter_mut()
        .find(|s| s.id == step)
        .ok_or("Step not found.")?;
    if s.status != Status::Review {
        return Err("Only a successful run awaiting review can be accepted.".into());
    }
    let r = workers::read_run(&s.run)?.ok_or("The run receipt is missing.")?;
    if receipt_status(&r.status, r.ok) != Status::Review {
        return Err("The worker receipt no longer supports acceptance.".into());
    }
    s.status = if accept {
        Status::Done
    } else {
        Status::Blocked
    };
    s.evidence = evidence.trim().into();
    let raw = save(&p, &doc)?;
    drop(guard);
    changed(&app, node);
    view(&p, raw)
}

/// Subscribers never wait on the publisher's DB or transition locks.
pub fn install(app: &tauri::AppHandle) {
    let h = app.clone();
    let ws = app.state::<std::sync::Arc<crate::aiw::state::Workspace>>();
    ws.bus.subscribe(
        "folder-workflows",
        &[EventType::AgentCompleted, EventType::AgentFailed],
        move |ev, _| {
            let Some(id) = ev
                .payload
                .get("run")
                .and_then(|v| v.as_str())
                .map(str::to_owned)
            else {
                return;
            };
            let h = h.clone();
            std::thread::spawn(move || {
                let result = (|| {
                    let Some(r) = workers::read_run(&id)? else {
                        return Ok::<(), String>(());
                    };
                    let Some(node) = r
                        .item
                        .strip_prefix("workflow:")
                        .and_then(|s| s.split(':').next())
                        .and_then(|s| s.parse::<i64>().ok())
                    else {
                        return Ok(());
                    };
                    get(&h, &h.state::<Db>(), node)?;
                    Ok(())
                })();
                if let Err(e) = result {
                    eprintln!("Workflow reconciliation failed: {e}");
                }
            });
        },
    );
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    use crate::workflow_model::Step;
    #[test]
    fn atomic_replacement_roundtrips_markdown_and_receipts() {
        let dir = std::env::temp_dir().join(format!(
            "devdeck-workflow-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join(FILE);
        assert_eq!(read(&p).unwrap(), "");
        let mut doc = Doc {
            meta: Definition {
                title: "Campaign".into(),
                steps: vec![Step {
                    id: "draft".into(),
                    title: "Draft".into(),
                    worker: "writer".into(),
                    target: 7,
                    instructions: "Draft and verify claims.".into(),
                    ..Default::default()
                }],
            },
            body: "# Goal\nKeep the site accurate.\n".into(),
        };
        save(&p, &doc).unwrap();
        doc.meta.steps[0].status = Status::Review;
        doc.meta.steps[0].run = "run-1".into();
        doc.meta.steps[0].previous_runs = vec!["run-old".into()];
        let raw = save(&p, &doc).unwrap();
        assert_eq!(read(&p).unwrap(), raw);
        let restored = parse(&raw).unwrap();
        assert_eq!(restored.meta.steps[0].status, Status::Review);
        assert_eq!(restored.meta.steps[0].previous_runs, vec!["run-old"]);
        assert!(restored.body.contains("Keep the site accurate."));
        assert!(!p.with_extension("md.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_or_unknown_fields_are_not_silently_discarded() {
        assert!(parse("---\ntitle: Incomplete\nsteps: [\n---\n").is_err());
        assert!(parse("---\ntitle: Empty\nsteps: []\n---\n").is_err());
        assert!(parse("---\ntitle: Unknown\nsteps: []\nunsupported: true\n---\n").is_err());
    }
}
