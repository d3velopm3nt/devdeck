//! Workflow adapter for saved model agents, including the main assistant.
//! Reuses AgentRuntime: provider, snapshots, live permissions and model logs.
//! Worker receipts remain the single source of workflow reconciliation/review.
use crate::{
    aiw::{
        deck::Doc,
        personal::{AgentMeta, PersonalStore},
        runtime::{AgentRuntime, StartAgentCommand},
        state::Workspace,
    },
    db::{self, Db},
    workers::{Plan, Run, WorkerMeta},
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

static STOPS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn stops() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    STOPS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn stop(id: &str) {
    if let Some(s) = stops().lock().unwrap_or_else(|p| p.into_inner()).get(id) {
        s.store(true, Ordering::Relaxed);
    }
}

pub fn definition(handle: &str) -> Result<Doc<AgentMeta>, String> {
    let id = handle
        .strip_prefix("agent:")
        .filter(|id| {
            !id.is_empty()
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
        .ok_or("Invalid native agent reference")?;
    let doc = PersonalStore::open()?
        .agents()
        .into_iter()
        .find(|a| a.meta.id == id)
        .ok_or("Saved model agent not found in Library")?;
    if doc.meta.provider.is_empty()
        || matches!(
            doc.meta.provider.as_str(),
            "mock" | "scripted" | "claude-code"
        )
    {
        return Err("Choose a real model connection for this agent in Library".into());
    }
    Ok(doc)
}
fn metadata(doc: &Doc<AgentMeta>) -> WorkerMeta {
    WorkerMeta {
        handle: format!("agent:{}", doc.meta.id),
        name: doc.meta.name.clone(),
        runner: "native-agent".into(),
        model: doc.meta.model.clone(),
        writes: "folder".into(),
        minutes: 5,
        ..Default::default()
    }
}
#[allow(clippy::too_many_arguments)]
pub fn plan(
    conn: &rusqlite::Connection,
    handle: &str,
    node_id: i64,
    feature: &str,
    item: &str,
    title: &str,
    intent: &str,
) -> Result<Plan, String> {
    let doc = definition(handle)?;
    let node = db::node_by_id(conn, node_id).map_err(|e| e.to_string())?;
    let root = db::node_dir(conn, &node).ok_or("Target has no working directory")?;
    Ok(Plan {
        worker: metadata(&doc), node_id, space: node.name, feature: feature.into(), item: item.into(), title: title.into(), intent: intent.into(),
        folder: root.to_string_lossy().into(), ready: root.is_dir(), model: doc.meta.model.clone(), minutes: 5,
        tools: vec!["Native tools permitted for this agent; execution and publishing commands are blocked".into()],
        never: crate::workers::NEVER.iter().map(|s| s.to_string()).collect(),
        note: format!("Uses {} through {}. Writes in the selected project folder, with live permissions. Stops at human review; no CLI runner. Stop takes effect after the current model request.", doc.meta.name, doc.meta.provider),
        ..Default::default()
    })
}

pub fn start(app: &tauri::AppHandle, db: &Db, p: Plan) -> Result<Run, String> {
    if !p.ready {
        return Err("The native agent target is unavailable".into());
    }
    let doc = definition(&p.worker.handle)?;
    if metadata(&doc) != p.worker {
        return Err("Agent settings changed after preview; review again".into());
    }
    let ws = app.state::<Arc<Workspace>>().inner().clone();
    let agent = ws.agent(&doc.meta.id).ok_or("Native agent is not loaded")?;
    if ws.providers.lock().map_err(|e| e.to_string())?.get(&agent.provider).is_none() {
        return Err("The agent's model provider is unavailable".into());
    }
    if agent.provider != doc.meta.provider || agent.model != doc.meta.model {
        return Err("Agent connection changed; reload the agent before starting".into());
    }
    let (node, root, deck_root) = {
        let conn = db.conn();
        let node = db::node_by_id(&conn, p.node_id).map_err(|e| e.to_string())?;
        let root = db::node_dir(&conn, &node).ok_or("Missing target directory")?;
        let deck = db::node_deck_dir(&conn, &node).ok_or("Missing vault folder")?;
        (node, root, deck)
    };
    if root.to_string_lossy() != p.folder {
        return Err("Target moved after preview".into());
    }
    let permit = crate::execution_policy::RunPermit::acquire(vec![
        format!(
            "write:{}:folder",
            root.canonicalize().map_err(|e| e.to_string())?.display()
        ),
        format!("native-task:{}:{}", p.node_id, p.item),
    ])?;
    let project = ws.project(&p.node_id.to_string()).unwrap_or_else(|| {
        ws.register_project(&p.node_id.to_string(), &node.name, root.clone(), deck_root)
    });
    if project.root != root {
        return Err("Registered project changed; reopen it before starting".into());
    }
    let id = crate::aiw::events::new_id("native");
    let deck = project.deck();
    let goal = format!("{}\n\n{}\n\nExecute this workflow step using your existing model connection and native DevDeck tools. Read the relevant source before writing. Preserve unrelated edits. Do not modify workflow state, install tools, execute shell commands, commit, push, merge, publish or deploy. Verify the resulting files by reading them and report evidence and limitations for human review.", p.title, p.intent);
    let feature = deck.create_feature(&id, &goal, &[])?;
    let live = AgentRuntime::begin(
        &ws,
        &StartAgentCommand {
            project_id: project.id.clone(),
            feature_id: feature.clone(),
            agent_id: agent.id.clone(),
            work_item_id: None,
            intent: Some(goal.clone()),
            areas: vec![],
            depends_on: vec![],
            unattended: true,
            stop_at: vec![
                "before any push".into(),
                "before any merge".into(),
                "before any commit".into(),
                "before any terminal".into(),
                "before any process".into(),
                "before any deploy".into(),
            ],
            on_behalf_of: Some(
                "Workflow execution. Complete only this step and return evidence for human review."
                    .into(),
            ),
        },
    )?;
    let run = Run {
        id: id.clone(),
        worker: p.worker.handle.clone(),
        worker_name: agent.name.clone(),
        node_id: p.node_id,
        space: p.space.clone(),
        feature,
        item: p.item.clone(),
        at: p.folder.clone(),
        folder: p.folder.clone(),
        title: p.title.clone(),
        intent: p.intent.clone(),
        starting_prompt: goal,
        runtime_session: live.session_id.clone(),
        status: "running".into(),
        started_at: crate::aiw::events::now_iso(),
        minutes_limit: p.minutes,
        ..Default::default()
    };
    if let Err(error) = crate::workers::write_run(&run) {
        // No execution without a durable receipt; release the session claim too.
        let _ = AgentRuntime::drive_cancellable(&ws, live, Arc::new(AtomicBool::new(true)));
        return Err(error);
    }
    let stop = Arc::new(AtomicBool::new(false));
    stops()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(id.clone(), stop.clone());
    let app = app.clone();
    let initial = run.clone();
    std::thread::spawn(move || {
        let _permit = permit;
        let began = Instant::now();
        let finished = Arc::new(AtomicBool::new(false));
        let watch_done = finished.clone();
        let watch_stop = stop.clone();
        let watch_ws = ws.clone();
        let mut progress = initial.clone();
        let ticker = std::thread::spawn(move || {
            while !watch_done.load(Ordering::Relaxed) {
                if began.elapsed() >= Duration::from_secs(300) {
                    watch_stop.store(true, Ordering::Relaxed);
                }
                if let Some(session) = watch_ws.session(&progress.runtime_session) {
                    progress.steps = session
                        .transcript
                        .iter()
                        .map(|t| crate::workers::Step {
                            at: t.at.clone(),
                            kind: t.kind.clone(),
                            text: t.text.clone(),
                        })
                        .collect();
                    let _ = crate::workers::write_run(&progress);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });
        let result = AgentRuntime::drive_cancellable(&ws, live, stop.clone());
        finished.store(true, Ordering::Relaxed);
        let _ = ticker.join();
        let mut receipt = initial;
        receipt.ended_at = crate::aiw::events::now_iso();
        receipt.seconds = began.elapsed().as_secs() as i64;
        if let Some(session) = ws.session(&receipt.runtime_session) {
            receipt.steps = session
                .transcript
                .iter()
                .map(|t| crate::workers::Step {
                    at: t.at.clone(),
                    kind: t.kind.clone(),
                    text: t.text.clone(),
                })
                .collect();
        }
        match result {
            Ok(outcome) => {
                receipt.ok = successful(
                    &outcome.status,
                    outcome.refused,
                    stop.load(Ordering::Relaxed),
                );
                receipt.status = if receipt.ok { "done" } else { "blocked" }.into();
                receipt.verdict = outcome.summary;
                receipt.files = outcome
                    .files_touched
                    .iter()
                    .map(|path| crate::workers::FileOut {
                        path: path.clone(),
                        bytes: std::fs::metadata(root.join(path))
                            .map(|m| m.len())
                            .unwrap_or(0),
                    })
                    .collect();
            }
            Err(error) => {
                receipt.status = "failed".into();
                receipt.verdict = error;
            }
        }
        if stop.load(Ordering::Relaxed) {
            receipt.ok = false;
            receipt.status = "stopped".into();
            receipt.verdict = format!(
                "Stopped or timed out. Partial files require review.\n{}",
                receipt.verdict
            );
        }
        let saved = crate::workers::write_run(&receipt);
        stops()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&id);
        crate::aiw::events::say(
            &app,
            crate::aiw::events::EventType::FileChanged,
            crate::aiw::events::in_space(p.node_id, None, None),
            serde_json::json!({"source":"folder_workflow","summary":if saved.is_ok() {"Native agent receipt saved"} else {"Native agent receipt could not be saved"}}),
        );
    });
    Ok(run)
}
fn successful(status: &str, refused: usize, stopped: bool) -> bool {
    status.eq_ignore_ascii_case("completed") && refused == 0 && !stopped
}

/// Older native receipts kept the final reply only in the transcript.
/// Recover those exact words without inventing evidence or changing status.
pub fn restore_summary(run: &mut Run) {
    if run.worker.starts_with("agent:") && run.ok && run.verdict == "Session ended with no summary." {
        if let Some(message) = run.steps.iter().rev().find(|s| s.kind == "message" && !s.text.trim().is_empty()) {
            run.verdict = message.text.clone();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_only_missing_successful_native_summary() {
        let mut run = Run { worker: "agent:assistant".into(), ok: true, verdict: "Session ended with no summary.".into(),
            steps: vec![crate::workers::Step {at: String::new(), kind: "message".into(), text: "Created and read back docs/check.md".into()}], ..Default::default() };
        restore_summary(&mut run);
        assert_eq!(run.verdict, "Created and read back docs/check.md");
        run.ok = false;
        run.verdict = "Permission denied".into();
        restore_summary(&mut run);
        assert_eq!(run.verdict, "Permission denied");
    }
    #[test]
    fn only_completed_unblocked_runs_support_review() {
        assert!(successful("Completed", 0, false));
        assert!(!successful("Completed", 1, false));
        assert!(!successful("Completed", 0, true));
        assert!(!successful("Failed", 0, false));
        assert!(!successful("Working", 0, false));
    }
}
