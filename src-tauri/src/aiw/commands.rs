//! Tauri commands — the only surface the UI can reach.
//!
//! Every one of these is thin: validate, call a service, return. Business logic
//! that leaks up into a command is logic the tests can't reach without a
//! window, so it stays below this line.
//!
//! **Threading.** A plain `#[tauri::command] fn` runs on the *main* thread in
//! Tauri v2 — only `async fn` or `#[tauri::command(async)]` is dispatched to a
//! worker. Anything here that talks to a network, runs an agent, or waits on a
//! human is therefore marked `(async)`, or it freezes the window while it works.
//!
//! For the approval flow this is not cosmetic: `aiw_send_message` blocks while
//! a tool call waits for a person, and `aiw_resolve_approval` is what unblocks
//! it. On the main thread the second could never run while the first was
//! waiting, so every approval would deadlock and then time out.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::Emitter;

use super::approval::{ApprovalRequest, Decision};
use super::assistant::{
    Assistant, AssistantReply, ChatEvent, ConversationMeta, ConversationSummary,
};
use super::conflict::Conflict;
use super::context::{AssembledContext, ContextService};
use super::deck::{Deck, Requirement, RequirementsMeta, WorkItem, WorkMeta};
use super::events::DomainEvent;
use super::provider::ProviderHealth;
use super::runtime::{AgentRuntime, SessionOutcome, StartAgentCommand};
use super::state::{
    AgentDef, ProjectSummary, ProviderConfig, RegisteredProject, Session, TestRun, WorkClaim,
    Workspace,
};
use super::tools::{registry, Permission, ToolInfo};
use crate::git;

type Ws<'a> = tauri::State<'a, Arc<Workspace>>;

// ---------------------------------------------------------------------------
// Projects & features
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn aiw_projects(ws: Ws) -> Vec<ProjectSummary> {
    ws.summaries()
}

#[tauri::command]
pub fn aiw_register_project(
    ws: Ws,
    db: tauri::State<crate::db::Db>,
    id: String,
    name: String,
    root: String,
) -> Result<ProjectSummary, String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let deck = Deck::new(path.clone());
    if !deck.exists() {
        deck.init(&id, &name)?;
    }
    ws.register_project(&id, &name, path);
    persist_projects(&ws, &db);
    ws.summaries()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "project registered but not readable".to_string())
}

/// Where the registered-project list lives. Only the list — the projects
/// themselves are their `.devdeck` directories.
pub const PROJECTS_KEY: &str = "aiw.projects";

fn persist_projects(ws: &Arc<Workspace>, db: &tauri::State<crate::db::Db>) {
    let list = ws.registered();
    let Ok(json) = serde_json::to_string(&list) else {
        return;
    };
    let conn = db.0.lock().unwrap();
    if let Err(e) = crate::db::setting_set_conn(&conn, PROJECTS_KEY, &json) {
        // Honest: losing the list means the projects vanish on restart, so say
        // so rather than failing silently.
        eprintln!("[aiw] could not save the project list: {e}");
    }
}

/// Read the saved list. Returns empty when nothing has been registered yet,
/// which is a normal first-run state rather than an error.
pub fn saved_projects(conn: &rusqlite::Connection) -> Vec<RegisteredProject> {
    crate::db::setting_get_conn(conn, PROJECTS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[derive(Serialize, Clone, Debug)]
pub struct FeatureRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub goal: Option<String>,
    pub areas: Vec<String>,
    pub agents: Vec<String>,
    pub context_health: String,
    pub conflicts: usize,
    pub last_activity: Option<String>,
    pub work_items: usize,
}

#[tauri::command]
pub fn aiw_features(ws: Ws, project_id: String) -> Result<Vec<FeatureRow>, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    let deck = p.deck();
    let sessions = ws.sessions_for(Some(&project_id));
    let conflicts = ws.conflicts.open(Some(&project_id));

    Ok(deck
        .feature_slugs()
        .into_iter()
        .filter_map(|slug| {
            let f = deck.feature(&slug).ok()?;
            let agents: Vec<String> = sessions
                .iter()
                .filter(|s| s.feature_id == slug && s.status.active())
                .map(|s| s.agent_name.clone())
                .collect();
            let stale = sessions.iter().any(|s| s.feature_id == slug && s.stale);
            Some(FeatureRow {
                id: slug.clone(),
                name: f.meta.name,
                status: f.meta.status,
                goal: f.meta.goal,
                areas: f.meta.areas,
                agents,
                context_health: if stale { "stale" } else { "fresh" }.into(),
                conflicts: conflicts
                    .iter()
                    .filter(|c| c.feature_id.as_deref() == Some(&slug))
                    .count(),
                last_activity: sessions
                    .iter()
                    .filter(|s| s.feature_id == slug)
                    .map(|s| s.started_at.clone())
                    .max(),
                work_items: deck.work(&slug).map(|w| w.meta.items.len()).unwrap_or(0),
            })
        })
        .collect())
}

#[tauri::command]
pub fn aiw_create_feature(
    ws: Ws,
    project_id: String,
    name: String,
    goal: String,
    areas: Vec<String>,
) -> Result<String, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    let slug = p.deck().create_feature(&name, &goal, &areas)?;
    ws.bus.publish(
        super::events::EventType::FeatureCreated,
        super::events::EventScope::feature(&project_id, &slug),
        serde_json::json!({ "name": name, "goal": goal }),
    );
    Ok(slug)
}

#[tauri::command]
pub fn aiw_work_items(
    ws: Ws,
    project_id: String,
    feature_id: String,
) -> Result<Vec<WorkItem>, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    Ok(p.deck().work(&feature_id)?.meta.items)
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn aiw_context(
    ws: Ws,
    project_id: String,
    feature_id: String,
    work_item_id: Option<String>,
) -> Result<AssembledContext, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    let active = ws.active_work_lines(&project_id, &feature_id);
    ContextService::assemble(
        &p.deck(),
        &project_id,
        &feature_id,
        work_item_id.as_deref(),
        &active,
    )
}

#[derive(Serialize, Clone, Debug)]
pub struct RawContext {
    pub path: String,
    pub frontmatter: String,
    pub body: String,
}

#[tauri::command]
pub fn aiw_context_raw(
    ws: Ws,
    project_id: String,
    feature_id: String,
) -> Result<RawContext, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    let deck = p.deck();
    let doc = ContextService::raw(&deck, &feature_id)?;
    Ok(RawContext {
        path: format!(".devdeck/features/{feature_id}/context.md"),
        frontmatter: serde_yaml::to_string(&doc.meta).unwrap_or_default(),
        body: doc.body,
    })
}

#[derive(Serialize, Clone, Debug)]
pub struct ContextComparison {
    pub from: String,
    pub to: String,
    pub from_body: Option<String>,
    pub to_body: String,
    pub changes: Vec<super::context::ContextChange>,
    pub changed_files: Vec<String>,
}

/// Compare a feature's context now against an earlier commit. Real content on
/// both sides — a diff view built on a remembered "before" is a diff of
/// nothing.
#[tauri::command]
pub fn aiw_context_compare(
    ws: Ws,
    project_id: String,
    feature_id: String,
    from: String,
) -> Result<ContextComparison, String> {
    use super::context::{ChangeKind, ContextChange};
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    let deck = p.deck();
    let head = git::head_commit(&p.root).unwrap_or_else(|| "HEAD".into());
    let now = ContextService::raw(&deck, &feature_id)?;
    let before = ContextService::raw_at(&deck, &feature_id, &from);

    // A line-level comparison of the two bodies, labelled semantically. Crude,
    // but built from the two real documents rather than invented.
    let mut changes = Vec::new();
    if let Some(prev) = &before {
        let old_lines: Vec<&str> = prev
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        let new_lines: Vec<&str> = now
            .body
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        for l in &new_lines {
            if !old_lines.contains(l) {
                changes.push(ContextChange {
                    kind: ChangeKind::Added,
                    subject: "Context line".into(),
                    detail: (*l).to_string(),
                    source: None,
                });
            }
        }
        for l in &old_lines {
            if !new_lines.contains(l) {
                changes.push(ContextChange {
                    kind: ChangeKind::Removed,
                    subject: "Context line".into(),
                    detail: (*l).to_string(),
                    source: None,
                });
            }
        }
    }

    Ok(ContextComparison {
        from: from.clone(),
        to: git::short_sha(&head),
        from_body: before,
        to_body: now.body,
        changes,
        changed_files: git::changed_between(&p.root, &from, &head),
    })
}

// ---------------------------------------------------------------------------
// Agents & sessions
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn aiw_agents(ws: Ws) -> Vec<AgentDef> {
    ws.agents()
}

#[tauri::command]
pub fn aiw_sessions(ws: Ws, project_id: Option<String>) -> Vec<Session> {
    ws.sessions_for(project_id.as_deref())
}

#[tauri::command]
pub fn aiw_session(ws: Ws, session_id: String) -> Option<Session> {
    ws.session(&session_id)
}

#[tauri::command]
pub fn aiw_claims(ws: Ws, project_id: Option<String>, active_only: bool) -> Vec<WorkClaim> {
    ws.claims_for(project_id.as_deref(), active_only)
}

#[tauri::command(async)]
pub fn aiw_start_agent(ws: Ws, cmd: StartAgentCommand) -> Result<SessionOutcome, String> {
    let ws: Arc<Workspace> = (*ws).clone();
    AgentRuntime::run(&ws, &cmd)
}

// ---------------------------------------------------------------------------
// Conflicts, decisions, activity
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn aiw_conflicts(ws: Ws, project_id: Option<String>, include_resolved: bool) -> Vec<Conflict> {
    ws.conflicts.list(project_id.as_deref(), include_resolved)
}

#[tauri::command]
pub fn aiw_resolve_conflict(
    ws: Ws,
    conflict_id: String,
    by: String,
    resolution: String,
) -> Result<Conflict, String> {
    ws.conflicts
        .resolve(&ws.bus, &conflict_id, &by, &resolution)
}

#[derive(Serialize, Clone, Debug)]
pub struct DecisionRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub feature: Option<String>,
    pub author: Option<String>,
    pub created: Option<String>,
    pub impacts: Vec<String>,
    pub body: String,
}

#[tauri::command]
pub fn aiw_decisions(
    ws: Ws,
    project_id: String,
    feature_id: Option<String>,
) -> Result<Vec<DecisionRow>, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    Ok(p.deck()
        .decisions(feature_id.as_deref())
        .into_iter()
        .map(|d| DecisionRow {
            id: d.meta.id,
            title: d.meta.title,
            status: d.meta.status,
            feature: d.meta.feature,
            author: d.meta.author,
            created: d.meta.created,
            impacts: d.meta.impacts,
            body: d.body,
        })
        .collect())
}

/// The Activity feed. Derived entirely from the event log — nothing here is
/// authored for display.
#[tauri::command]
pub fn aiw_activity(ws: Ws, project_id: Option<String>, limit: Option<usize>) -> Vec<DomainEvent> {
    let mut events = ws.bus.history(project_id.as_deref(), limit.unwrap_or(200));
    events.reverse(); // newest first for the UI
    events
}

#[tauri::command]
pub fn aiw_event_chain(ws: Ws, correlation_id: String) -> Vec<DomainEvent> {
    ws.bus.chain(&correlation_id)
}

// ---------------------------------------------------------------------------
// Git, tools, tests, knowledge
// ---------------------------------------------------------------------------

/// One commit, with the DevDeck trailers resolved back into who and what.
#[derive(Serialize, Clone, Debug)]
pub struct AttributedCommit {
    #[serde(flatten)]
    pub commit: git::GitCommit,
    /// From the `DevDeck-Agent` trailer, when the commit was made by an agent.
    pub agent: Option<String>,
    pub feature: Option<String>,
    pub work_item: Option<String>,
    pub session: Option<String>,
}

#[tauri::command(async)]
pub fn aiw_git_history(
    ws: Ws,
    project_id: String,
    limit: Option<usize>,
) -> Result<Vec<AttributedCommit>, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    Ok(git::log_entries(&p.root, limit.unwrap_or(20))
        .into_iter()
        .map(|c| {
            let t = git::commit_trailers(&p.root, &c.sha);
            AttributedCommit {
                agent: t.get("agent").cloned(),
                feature: t.get("feature").cloned(),
                work_item: t.get("work-item").cloned(),
                session: t.get("session").cloned(),
                commit: c,
            }
        })
        .collect())
}

#[tauri::command]
pub fn aiw_tools() -> Vec<ToolInfo> {
    registry()
}

#[derive(Serialize, Clone, Debug)]
pub struct PermissionRow {
    pub tool: String,
    /// agent id → permission label
    pub grants: Vec<(String, String)>,
}

#[tauri::command]
pub fn aiw_permissions(ws: Ws) -> Vec<PermissionRow> {
    let agents = ws.agents();
    registry()
        .into_iter()
        .map(|t| PermissionRow {
            tool: t.id.clone(),
            grants: agents
                .iter()
                .map(|a| {
                    (
                        a.id.clone(),
                        Permission::parse(
                            a.permissions
                                .get(&t.id)
                                .map(String::as_str)
                                .unwrap_or("none"),
                        )
                        .label()
                        .to_string(),
                    )
                })
                .collect(),
        })
        .collect()
}

#[tauri::command]
pub fn aiw_set_permission(
    ws: Ws,
    agent_id: String,
    tool: String,
    permission: String,
) -> Result<(), String> {
    ws.set_permission(&agent_id, &tool, &permission)
}

#[tauri::command]
pub fn aiw_providers(ws: Ws) -> Vec<(String, String, ProviderHealth)> {
    ws.providers.lock().unwrap().list()
}

#[tauri::command]
pub fn aiw_test_runs(ws: Ws, project_id: Option<String>) -> Vec<TestRun> {
    ws.test_runs(project_id.as_deref())
}

/// Write a feature's assembled context into an agent file at the project root
/// (CLAUDE.md, AGENTS.md, .cursorrules), so any tool working in this repo gets
/// the same narrowed view a DevDeck agent would.
///
/// Only the delimited DevDeck block is replaced — a hand-written file keeps
/// everything else.
#[tauri::command(async)]
pub fn aiw_export_context(
    ws: Ws,
    project_id: String,
    feature_id: String,
    filename: String,
) -> Result<String, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    let deck = p.deck();
    let active = ws.active_work_lines(&project_id, &feature_id);
    let ctx = ContextService::assemble(&deck, &project_id, &feature_id, None, &active)?;
    let name = deck
        .feature(&feature_id)
        .map(|f| f.meta.name)
        .unwrap_or_else(|_| feature_id.clone());
    ContextService::export_to_agent_file(&deck, &ctx, &name, &filename)
}

/// The agent files DevDeck knows how to write into.
#[tauri::command]
pub fn aiw_agent_files() -> Vec<String> {
    super::context::AGENT_FILES
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[tauri::command]
pub fn aiw_knowledge_tree(ws: Ws, project_id: String) -> Result<Vec<String>, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    Ok(p.deck().tree())
}

#[tauri::command]
pub fn aiw_read_file(ws: Ws, project_id: String, path: String) -> Result<String, String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    // Same containment rule as the files tool: the UI is not a way around it.
    if path.contains("..") || PathBuf::from(&path).is_absolute() {
        return Err(format!("path escapes the project: {path}"));
    }
    std::fs::read_to_string(p.root.join(&path)).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn aiw_write_file(
    ws: Ws,
    project_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let p = ws
        .project(&project_id)
        .ok_or_else(|| format!("unknown project '{project_id}'"))?;
    if path.contains("..") || PathBuf::from(&path).is_absolute() {
        return Err(format!("path escapes the project: {path}"));
    }
    let full = p.root.join(&path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, content).map_err(|e| format!("{path}: {e}"))
}

// ---------------------------------------------------------------------------
// Demo fixtures
// ---------------------------------------------------------------------------

/// Build a demo project on disk: a real `.devdeck`, a real git repo, real
/// commits. Used by the demo command and by the tests, so what the tests prove
/// is what the UI shows.
pub fn seed_project(root: &Path, id: &str, name: &str) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let deck = Deck::new(root.to_path_buf());
    deck.init(id, name)?;

    let mut project = deck.project()?;
    project.meta.rules = vec![
        "Every site runs offline-first; the network is a bonus.".into(),
        "No customer data leaves the depot unencrypted.".into(),
    ];
    deck.write_doc_at(&deck.project_md(), &project)?;

    // A test command that actually runs, so QA's result is real.
    std::fs::write(
        deck.app_config(),
        "dev: echo starting dev server\nbuild: echo build ok\ntest: echo 2 passed\nready_log: starting\n",
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// The TyreX / AssetX pair the demo runs on.
pub fn seed_demo(base: &Path) -> Result<(PathBuf, PathBuf), String> {
    let tyrex = base.join("tyrex");
    let assetx = base.join("assetx");

    seed_project(&tyrex, "tyrex", "TyreX")?;
    let deck = Deck::new(tyrex.clone());
    let slug = deck.create_feature(
        "Offline Synchronisation",
        "Allow each TyreX site to keep operating without connectivity, and \
         synchronise cleanly when the connection returns.",
        &[
            "packages/sync".into(),
            "api/sync".into(),
            "apps/mobile".into(),
        ],
    )?;
    deck.write_doc_at(
        &deck.feature_requirements(&slug),
        &super::deck::Doc {
            meta: RequirementsMeta {
                id: slug.clone(),
                requirements: vec![
                    Requirement {
                        id: "R1".into(),
                        text: "A site must function with no connectivity for 72 hours.".into(),
                        // A mandatory network call in this feature contradicts R1.
                        forbids: vec!["await fetch(".into()],
                    },
                    Requirement {
                        id: "R2".into(),
                        text: "No write may be lost on power failure.".into(),
                        forbids: vec![],
                    },
                ],
            },
            body: "## Requirements\n".into(),
        },
    )?;
    deck.save_work(
        &slug,
        &WorkMeta {
            feature: slug.clone(),
            items: vec![
                WorkItem {
                    id: "wi-conflict".into(),
                    title: "Conflict resolution".into(),
                    status: "unclaimed".into(),
                    assignee: None,
                    areas: vec!["packages/sync".into(), "api/sync".into()],
                },
                WorkItem {
                    id: "wi-ui".into(),
                    title: "Sync status UI".into(),
                    status: "unclaimed".into(),
                    assignee: None,
                    areas: vec!["apps/mobile".into()],
                },
                WorkItem {
                    id: "wi-tests".into(),
                    title: "Integration tests".into(),
                    status: "unclaimed".into(),
                    assignee: None,
                    areas: vec!["tests".into()],
                },
            ],
        },
    )?;
    deck.create_feature(
        "Gate Tracking",
        "Track tyres through depot gates.",
        &["services/gates".into()],
    )?;

    // AssetX exists to prove isolation: same shape, different content.
    seed_project(&assetx, "assetx", "AssetX")?;
    let adeck = Deck::new(assetx.clone());
    let aslug = adeck.create_feature(
        "Asset Register",
        "Track every asset from purchase to disposal.",
        &["packages/assets".into()],
    )?;
    adeck.save_feature_context(
        &aslug,
        "## Goal\n\nAssetX private context — must never appear in a TyreX prompt.\n",
        None,
    )?;

    for root in [&tyrex, &assetx] {
        git::ensure_repo(root)?;
        let _ = git::commit_with_metadata(
            root,
            "Seed .devdeck",
            &[".".to_string()],
            None,
            None,
            None,
            None,
        );
    }

    Ok((tyrex, assetx))
}

#[derive(Serialize, Clone, Debug)]
pub struct DemoResult {
    pub tyrex_root: String,
    pub assetx_root: String,
    pub outcomes: Vec<SessionOutcome>,
    pub conflicts: Vec<Conflict>,
    pub events: usize,
}

/// Run the full multi-agent scenario. This is the demo *and* the acceptance
/// path — the UI button and the E2E test call the same function.
pub fn run_demo(ws: &Arc<Workspace>, base: PathBuf) -> Result<DemoResult, String> {
    let (tyrex, assetx) = seed_demo(&base)?;
    ws.register_project("tyrex", "TyreX", tyrex.clone());
    ws.register_project("assetx", "AssetX", assetx.clone());

    let feature = "offline-synchronisation";
    let mut outcomes = Vec::new();

    // 1. Architect: reads context, records the decision.
    outcomes.push(AgentRuntime::run(
        ws,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: feature.into(),
            agent_id: "architect".into(),
            work_item_id: None,
            intent: Some("Define the sync architecture".into()),
            areas: vec![],
            depends_on: vec![],
        },
    )?);

    // 2. Developer B *begins* and stays live. This is the crux of the whole
    //    scenario: B must still be working, from its own checkpoint, at the
    //    moment A changes the interface underneath it. Running B to completion
    //    here would leave nothing for A's change to invalidate.
    let dev_b = AgentRuntime::begin(
        ws,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: feature.into(),
            agent_id: "dev-b".into(),
            work_item_id: Some("wi-ui".into()),
            intent: Some("Build the sync status UI".into()),
            areas: vec!["apps/mobile".into()],
            depends_on: vec!["SyncResult".into()],
        },
    )?;

    // 3. Developer A changes the shared interface, while B is still open.
    outcomes.push(AgentRuntime::run(
        ws,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: feature.into(),
            agent_id: "dev-a".into(),
            work_item_id: Some("wi-conflict".into()),
            intent: Some("Implement conflict resolution".into()),
            areas: vec!["packages/sync".into(), "api/sync".into()],
            depends_on: vec![],
        },
    )?);

    // 4. Now B finishes, on a context that moved under it.
    outcomes.push(AgentRuntime::drive(ws, dev_b)?);

    // 5. QA starts the app and runs the tests.
    outcomes.push(AgentRuntime::run(
        ws,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: feature.into(),
            agent_id: "qa".into(),
            work_item_id: Some("wi-tests".into()),
            intent: Some("Verify synchronisation behaviour".into()),
            areas: vec!["tests".into()],
            depends_on: vec![],
        },
    )?);

    // 6. AssetX runs too, to prove nothing crosses over.
    outcomes.push(AgentRuntime::run(
        ws,
        &StartAgentCommand {
            project_id: "assetx".into(),
            feature_id: "asset-register".into(),
            agent_id: "dev-a".into(),
            work_item_id: None,
            intent: Some("Scaffold the asset register".into()),
            areas: vec!["packages/assets".into()],
            depends_on: vec![],
        },
    )?);

    Ok(DemoResult {
        tyrex_root: tyrex.to_string_lossy().to_string(),
        assetx_root: assetx.to_string_lossy().to_string(),
        outcomes,
        conflicts: ws.conflicts.list(Some("tyrex"), true),
        events: ws.bus.count(),
    })
}

#[tauri::command(async)]
pub fn aiw_run_demo(
    ws: Ws,
    db: tauri::State<crate::db::Db>,
    base_dir: Option<String>,
) -> Result<DemoResult, String> {
    let base = match base_dir {
        Some(d) => PathBuf::from(d),
        None => dirs::config_dir()
            .ok_or("no config dir")?
            .join("devdeck")
            .join("demo"),
    };
    // A re-run must start clean, or the second run inherits the first's
    // commits and the delta is meaningless.
    let _ = std::fs::remove_dir_all(&base);
    let ws: Arc<Workspace> = (*ws).clone();
    ws.reset_runtime_state();
    let result = run_demo(&ws, base)?;
    persist_projects(&ws, &db);
    Ok(result)
}

/// Models a provider offers. The Start AI Work screen needs this to let you
/// pick one, and it is the same call for the mock and for a real provider.
#[tauri::command(async)]
pub fn aiw_models(ws: Ws, provider_id: String) -> Vec<super::provider::ModelInfo> {
    ws.providers
        .lock()
        .unwrap()
        .get(&provider_id)
        .map(|p| p.list_models())
        .unwrap_or_default()
}

/// "What changed since this session's checkpoint?" — the question an agent asks
/// when it suspects the ground has moved.
#[tauri::command]
pub fn aiw_changed_since(ws: Ws, session_id: String) -> Result<Vec<String>, String> {
    let session = ws
        .session(&session_id)
        .ok_or_else(|| format!("no session '{session_id}'"))?;
    let project = ws
        .project(&session.project_id)
        .ok_or_else(|| format!("unknown project '{}'", session.project_id))?;
    let checkpoint = session
        .checkpoint
        .ok_or_else(|| "session has no checkpoint".to_string())?;
    Ok(ContextService::changed_since(&project.deck(), &checkpoint))
}

/// Where provider configuration (not keys) is remembered.
pub const PROVIDERS_KEY: &str = "aiw.providerConfigs";

/// Point DevDeck at a real provider. Nothing else in the workspace changes —
/// same runtime, same tools, same context, same events.
///
/// The key goes to Windows Credential Manager inside `configure_provider`; what
/// gets written here is only the non-secret configuration.
#[tauri::command]
pub fn aiw_configure_provider(
    ws: Ws,
    db: tauri::State<crate::db::Db>,
    config: ProviderConfig,
) -> Result<(), String> {
    ws.configure_provider(config.clone())?;

    // Replace this kind's entry, keeping the others.
    let mut saved = {
        let conn = db.0.lock().unwrap();
        saved_provider_configs(&conn)
    };
    saved.retain(|c| c.kind != config.kind);
    let mut stored = config;
    // Belt and braces: the field is skip_serializing, and it is cleared here
    // too. A key must not reach the database by any route.
    stored.api_key = None;
    saved.push(stored);

    let json = serde_json::to_string(&saved).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    crate::db::setting_set_conn(&conn, PROVIDERS_KEY, &json)
}

pub fn saved_provider_configs(conn: &rusqlite::Connection) -> Vec<ProviderConfig> {
    crate::db::setting_get_conn(conn, PROVIDERS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// The saved configuration, for the setup form. Never includes a key — the UI
/// is told *that* one is saved, never what it is.
#[derive(Serialize, Clone, Debug)]
pub struct ProviderSetup {
    pub kind: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub headers: Vec<(String, String)>,
    pub timeout_secs: Option<u64>,
    /// Whether a key is stored in Credential Manager for this provider.
    pub has_key: bool,
}

#[tauri::command]
pub fn aiw_provider_setups(db: tauri::State<crate::db::Db>) -> Vec<ProviderSetup> {
    let conn = db.0.lock().unwrap();
    saved_provider_configs(&conn)
        .into_iter()
        .map(|c| ProviderSetup {
            has_key: crate::creds::exists(&super::provider::key_target(&c.kind)),
            kind: c.kind,
            name: c.name,
            base_url: c.base_url,
            model: c.model,
            headers: c.headers,
            timeout_secs: c.timeout_secs,
        })
        .collect()
}

/// Actually call the provider. `health()` can only say "configured"; this is
/// the difference between believing it works and knowing.
#[tauri::command(async)]
pub fn aiw_provider_test(ws: Ws, provider_id: String) -> Result<String, String> {
    ws.test_provider(&provider_id)
}

/// Forget a provider's key. The configuration stays so the form still shows
/// what was set up.
#[tauri::command]
pub fn aiw_provider_forget_key(ws: Ws, provider_id: String) -> bool {
    ws.forget_provider_key(&provider_id)
}

/// Where agent→provider assignments are remembered.
pub const AGENT_PROVIDERS_KEY: &str = "aiw.agentProviders";

/// Point an agent at a provider. Registering a provider does nothing until an
/// agent is told to use it, so this is the switch that turns a configured
/// endpoint into a running agent.
#[tauri::command]
pub fn aiw_set_agent_provider(
    ws: Ws,
    db: tauri::State<crate::db::Db>,
    agent_id: String,
    provider: String,
    model: String,
) -> Result<AgentDef, String> {
    let updated = ws.set_agent_provider(&agent_id, &provider, &model)?;
    let json = serde_json::to_string(&ws.agent_providers()).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap();
    crate::db::setting_set_conn(&conn, AGENT_PROVIDERS_KEY, &json)?;
    Ok(updated)
}

pub fn saved_agent_providers(conn: &rusqlite::Connection) -> Vec<(String, String, String)> {
    crate::db::setting_get_conn(conn, AGENT_PROVIDERS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// The application the process tool started, if any.
#[tauri::command]
pub fn aiw_app_status(ws: Ws, project_id: String) -> Option<super::tools::AppStatus> {
    ws.project(&project_id).and_then(|p| p.tools.app_status())
}

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn aiw_conversations(ws: Ws) -> Result<Vec<ConversationSummary>, String> {
    Ok(ws.convs()?.list())
}

#[tauri::command]
pub fn aiw_conversation(ws: Ws, id: String) -> Result<ConversationMeta, String> {
    ws.convs()?.load(&id)
}

#[tauri::command]
pub fn aiw_new_conversation(
    ws: Ws,
    project_id: Option<String>,
) -> Result<ConversationMeta, String> {
    ws.convs()?.create(project_id.as_deref())
}

#[tauri::command]
pub fn aiw_delete_conversation(ws: Ws, id: String) -> Result<bool, String> {
    Ok(ws.convs()?.delete(&id))
}

/// Move which project a conversation is about. The assistant works across
/// projects, so this is a focus, not a boundary.
#[tauri::command]
pub fn aiw_focus_conversation(
    ws: Ws,
    id: String,
    project_id: Option<String>,
) -> Result<ConversationMeta, String> {
    let convs = ws.convs()?;
    let mut conv = convs.load(&id)?;
    conv.project_id = project_id;
    convs.save(&conv)?;
    Ok(conv)
}

/// Say something to the assistant, and get its answer.
///
/// Synchronous, and can take a while: a turn may involve several provider
/// round-trips and a tool call that stops to ask you for approval. Tauri runs
/// this on a worker thread, so the window stays live throughout.
#[tauri::command(async)]
pub fn aiw_send_message(
    app: tauri::AppHandle,
    ws: Ws,
    conversation_id: String,
    text: String,
) -> Result<AssistantReply, String> {
    let workspace = ws.inner().clone();
    // Progress goes out on its own channel rather than through the event bus:
    // token deltas are not facts about the project, and a few hundred of them
    // would bury the log that makes the workspace auditable.
    let sink = move |e: ChatEvent| {
        // A dropped progress event is not worth failing a reply over — the
        // conversation on disk is the record, and the UI re-reads it at the end.
        let _ = app.emit("aiw:chat", e);
    };
    Assistant::send(&workspace, ws.convs()?, &conversation_id, &text, &sink)
}

/// Where your conversations and notes actually live.
///
/// Surfaced rather than kept internal: the store split is only reassuring if
/// you can see it. "Never committed" is a claim; a path outside every repo is
/// evidence.
#[tauri::command]
pub fn aiw_personal_root(ws: Ws) -> Result<String, String> {
    Ok(ws.convs()?.store().root().display().to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct ProfileView {
    pub preferences: Vec<String>,
    pub body: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn aiw_profile(ws: Ws) -> Result<ProfileView, String> {
    let doc = ws.convs()?.store().profile();
    Ok(ProfileView {
        preferences: doc.meta.preferences,
        updated_at: doc.meta.updated_at,
        body: doc.body,
    })
}

#[tauri::command]
pub fn aiw_save_profile(
    ws: Ws,
    preferences: Vec<String>,
    body: String,
) -> Result<ProfileView, String> {
    let store = ws.convs()?.store();
    let doc = super::deck::Doc {
        meta: super::personal::ProfileMeta {
            updated_at: super::events::now_iso(),
            preferences: preferences
                .into_iter()
                .filter(|p| !p.trim().is_empty())
                .collect(),
        },
        body,
    };
    store.save_profile(&doc)?;
    Ok(ProfileView {
        preferences: doc.meta.preferences,
        updated_at: doc.meta.updated_at,
        body: doc.body,
    })
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct MemoryView {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub project_id: Option<String>,
    pub tags: Vec<String>,
}

#[tauri::command]
pub fn aiw_memories(ws: Ws) -> Result<Vec<MemoryView>, String> {
    Ok(ws
        .convs()?
        .store()
        .memories()
        .into_iter()
        .map(|d| MemoryView {
            id: d.meta.id,
            title: d.meta.title,
            created_at: d.meta.created_at,
            project_id: d.meta.project_id,
            tags: d.meta.tags,
            body: d.body,
        })
        .collect())
}

#[tauri::command]
pub fn aiw_forget_memory(ws: Ws, id: String) -> Result<bool, String> {
    Ok(ws.convs()?.store().forget_memory(&id))
}

/// Tool calls waiting on a human right now.
#[tauri::command(async)]
pub fn aiw_pending_approvals(ws: Ws) -> Vec<ApprovalRequest> {
    ws.pending_approvals()
}

/// Answer one. The agent is blocked on this, so it takes effect immediately.
#[tauri::command(async)]
pub fn aiw_resolve_approval(ws: Ws, id: String, decision: Decision) -> Result<(), String> {
    ws.resolve_approval(&id, decision)
}

#[tauri::command]
pub fn aiw_reset(ws: Ws) {
    ws.reset_runtime_state();
}
