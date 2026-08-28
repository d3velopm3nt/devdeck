//! Workspace state: the live, in-memory view of everything the AI Workspace is
//! doing right now.
//!
//! The split that matters: **anything durable lives in `.devdeck`**, and what
//! is here is either a pointer to it or genuinely ephemeral (who is running,
//! which session is mid-flight, what the last test run printed). Delete this
//! and restart, and the projects, features, decisions and work items all come
//! back off disk. That is the property the whole design rests on.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};

use super::approval::{ApprovalBroker, ApprovalRequest, Decision};
use super::assistant::Conversations;
use super::conflict::{ClaimView, ConflictService, WorkView};
use super::context::{
    ActiveWorkEntry, ActiveWorkView, Checkpoint, ContextReconciler, DeterministicReconciler,
};
use super::deck::Deck;
use super::events::{new_id, EventBus, EventType, SharedBus};
use super::provider::{
    AnthropicConfig, AnthropicProvider, OpenAICompatibleConfig, ProviderRegistry,
};
use super::tools::{Permission, PermissionMatrix, ToolService};

/// An agent definition — who it is, what it may do. Durable ones live in
/// `.devdeck/agents/`; the built-in four are seeded here so the product works
/// out of the box.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentDef {
    pub id: String,
    pub name: String,
    /// architect | developer | qa | reviewer
    pub role: String,
    pub provider: String,
    pub model: String,
    pub system: String,
    /// tool id → permission
    pub permissions: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Planning,
    Working,
    Waiting,
    Reviewing,
    Blocked,
    Completed,
    Failed,
    Idle,
}

impl SessionStatus {
    pub fn label(self) -> &'static str {
        match self {
            SessionStatus::Planning => "Planning",
            SessionStatus::Working => "Working",
            SessionStatus::Waiting => "Waiting",
            SessionStatus::Reviewing => "Reviewing",
            SessionStatus::Blocked => "Blocked",
            SessionStatus::Completed => "Completed",
            SessionStatus::Failed => "Failed",
            SessionStatus::Idle => "Idle",
        }
    }
    pub fn active(self) -> bool {
        !matches!(
            self,
            SessionStatus::Completed | SessionStatus::Failed | SessionStatus::Idle
        )
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TranscriptEntry {
    pub at: String,
    pub kind: String,
    pub text: String,
}

/// One agent run.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Session {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub role: String,
    pub project_id: String,
    pub feature_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<String>,
    pub status: SessionStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<Checkpoint>,
    /// Set when the context moved past this session's checkpoint.
    pub stale: bool,
    pub turns: u32,
    pub context_tokens: usize,
    pub files_touched: Vec<String>,
    pub transcript: Vec<TranscriptEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Coordination, not a lock. Two agents *can* claim overlapping ground — the
/// point is that everyone can see it, and the conflict service gets to judge.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkClaim {
    pub id: String,
    pub agent_id: String,
    pub session_id: String,
    pub project_id: String,
    pub feature_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<String>,
    pub intent: String,
    pub areas: Vec<String>,
    pub depends_on: Vec<String>,
    /// active | released | completed
    pub status: String,
    pub started_at: String,
}

/// What the Settings screen sends to point DevDeck at a real model.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProviderConfig {
    /// "anthropic" | "openai-compatible"
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    /// Supplied once when configuring; moved straight into Credential Manager
    /// and never persisted. `skip_serializing` so it cannot be written back out
    /// by accident.
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TestRun {
    pub id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    pub agent_id: String,
    pub command: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    pub passed: bool,
    pub output: String,
}

/// A project the workspace knows about.
pub struct ProjectHandle {
    pub id: String,
    pub name: String,
    pub root: PathBuf,
    pub tools: ToolService,
}

impl ProjectHandle {
    pub fn deck(&self) -> Deck {
        Deck::new(self.root.clone())
    }
}

/// A registered project, as persisted. The `.devdeck` directories are the
/// durable truth about their *contents*; this records which of them this
/// install has been pointed at, so restarting DevDeck does not lose your
/// project list.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegisteredProject {
    pub id: String,
    pub name: String,
    pub root: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub root: String,
    pub features: usize,
    pub active_agents: usize,
    pub open_conflicts: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
}

/// How long an agent waits for a human before giving up and being refused.
/// Long enough to walk to the kettle, short enough that a forgotten prompt does
/// not leave an agent wedged.
const APPROVAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// The whole AI Workspace.
pub struct Workspace {
    pub bus: SharedBus,
    pub conflicts: ConflictService,
    /// Shared by every project's tool service, so one queue holds every
    /// pending request no matter which agent raised it.
    pub approvals: Arc<ApprovalBroker>,
    /// The assistant's conversations and memory.
    ///
    /// Machine-scoped, not project-scoped: you talk to one assistant about
    /// everything, and what it remembers about you must not be duplicated into
    /// — or committed with — any repository.
    ///
    /// Opened on first use rather than at construction. Constructing a
    /// workspace should not touch the user's home directory — the test suite
    /// builds hundreds of them, and none of those has any business creating
    /// folders in `%APPDATA%`.
    conversations: std::sync::OnceLock<Result<Conversations, String>>,
    pub providers: Mutex<ProviderRegistry>,
    pub reconciler: Box<dyn ContextReconciler>,
    projects: Mutex<HashMap<String, Arc<ProjectHandle>>>,
    agents: Mutex<Vec<AgentDef>>,
    sessions: Mutex<Vec<Session>>,
    claims: Mutex<Vec<WorkClaim>>,
    tests: Mutex<Vec<TestRun>>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self::new()
    }
}

impl Workspace {
    pub fn new() -> Self {
        Self {
            bus: Arc::new(EventBus::new()),
            conflicts: ConflictService::new(),
            approvals: Arc::new(ApprovalBroker::new(APPROVAL_TIMEOUT)),
            conversations: std::sync::OnceLock::new(),
            providers: Mutex::new(ProviderRegistry::new()),
            reconciler: Box::new(DeterministicReconciler),
            projects: Mutex::new(HashMap::new()),
            agents: Mutex::new(default_agents()),
            sessions: Mutex::new(Vec::new()),
            claims: Mutex::new(Vec::new()),
            tests: Mutex::new(Vec::new()),
        }
    }

    /// Subscribe the services that react to events.
    ///
    /// Called once, after the workspace is in an `Arc`, because a handler needs
    /// to reach back into the workspace it belongs to. It holds a `Weak` so the
    /// bus never keeps the workspace alive.
    ///
    /// This is what makes conflict detection genuinely event-driven: nothing
    /// calls the conflict service to tell it a file changed — it hears about it.
    pub fn install_handlers(ws: &Arc<Self>) {
        let weak: Weak<Workspace> = Arc::downgrade(ws);
        ws.bus.subscribe(
            "conflicts:file",
            &[EventType::FileChanged],
            move |ev, bus| {
                let Some(ws) = weak.upgrade() else { return };
                let Some(project_id) = ev.scope.project_id.as_deref() else {
                    return;
                };
                let work = ws.work_view(project_id, ev.scope.feature_id.as_deref());
                ws.conflicts.on_file_changed(bus, ev, &work);
            },
        );
    }

    /// Point the workspace at a real LLM. Everything above this line is
    /// unchanged by it — that is the claim the provider seam exists to make.
    ///
    /// The key, if one was supplied, goes to Windows Credential Manager and is
    /// dropped here. It is never written to SQLite, never returned over IPC and
    /// never kept in the provider's config — only the target to look it up by.
    pub fn configure_provider(&self, cfg: ProviderConfig) -> Result<(), String> {
        let target = super::provider::key_target(&cfg.kind);
        // An empty key means "leave whatever is saved alone", so someone can
        // change the model without retyping their key.
        if let Some(k) = cfg.api_key.as_deref().filter(|k| !k.is_empty()) {
            crate::creds::set(&target, &cfg.kind, k)?;
        }

        let mut reg = self.providers.lock().unwrap();
        match cfg.kind.as_str() {
            "anthropic" => {
                reg.register(Box::new(AnthropicProvider::new(AnthropicConfig {
                    key_target: target,
                    model: cfg.model,
                })));
                Ok(())
            }
            "openai-compatible" => {
                if cfg.base_url.trim().is_empty() {
                    return Err("an OpenAI-compatible provider needs a base URL".into());
                }
                reg.register_openai(OpenAICompatibleConfig {
                    name: cfg.name,
                    base_url: cfg.base_url,
                    key_target: target,
                    model: cfg.model,
                    headers: cfg.headers,
                    timeout_secs: cfg.timeout_secs,
                });
                Ok(())
            }
            other => Err(format!("unknown provider kind '{other}'")),
        }
    }

    /// Run the OpenAI-compatible provider's round-trip probe, if one is
    /// configured. Kept here because the registry owns the concrete types;
    /// commands should not be downcasting trait objects.
    pub fn probe_openai_compatible(&self) -> Result<String, String> {
        let reg = self.providers.lock().unwrap();
        match reg.openai_compatible() {
            Some(p) => p.probe(),
            None => Err("no OpenAI-compatible provider is configured".into()),
        }
    }

    /// Forget a provider's saved key. The configuration stays, so the form
    /// still shows what was set up — only the secret goes.
    pub fn forget_provider_key(&self, kind: &str) -> bool {
        crate::creds::delete(&super::provider::key_target(kind))
    }

    // -- projects ---------------------------------------------------------

    /// Register a project directory. Builds its tool service with the
    /// permission matrix derived from the agent definitions, so permissions
    /// are enforced per project rather than globally.
    pub fn register_project(&self, id: &str, name: &str, root: PathBuf) -> Arc<ProjectHandle> {
        let matrix = self.permission_matrix();
        let handle = Arc::new(ProjectHandle {
            id: id.to_string(),
            name: name.to_string(),
            root: root.clone(),
            tools: ToolService::new(root, id, matrix).with_approvals(self.approvals.clone()),
        });
        self.projects
            .lock()
            .unwrap()
            .insert(id.to_string(), handle.clone());
        handle
    }

    pub fn project(&self, id: &str) -> Option<Arc<ProjectHandle>> {
        self.projects.lock().unwrap().get(id).cloned()
    }

    /// Everything needed to re-register these projects after a restart.
    pub fn registered(&self) -> Vec<RegisteredProject> {
        let projects = self.projects.lock().unwrap();
        let mut v: Vec<RegisteredProject> = projects
            .values()
            .map(|p| RegisteredProject {
                id: p.id.clone(),
                name: p.name.clone(),
                root: p.root.to_string_lossy().to_string(),
            })
            .collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    /// Re-register a saved list, skipping anything whose directory has gone.
    /// A project folder that was deleted or is on a disconnected drive should
    /// disappear quietly rather than failing the whole startup.
    pub fn restore(&self, saved: &[RegisteredProject]) -> usize {
        let mut n = 0;
        for p in saved {
            let path = PathBuf::from(&p.root);
            if path.is_dir() {
                self.register_project(&p.id, &p.name, path);
                n += 1;
            } else {
                eprintln!("[aiw] skipping '{}' — {} is gone", p.id, p.root);
            }
        }
        n
    }

    pub fn project_ids(&self) -> Vec<String> {
        let mut v: Vec<String> = self.projects.lock().unwrap().keys().cloned().collect();
        v.sort();
        v
    }

    pub fn summaries(&self) -> Vec<ProjectSummary> {
        self.project_ids()
            .into_iter()
            .filter_map(|id| {
                let p = self.project(&id)?;
                let deck = p.deck();
                let info = crate::git::git_info(p.root.to_string_lossy().to_string());
                Some(ProjectSummary {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    root: p.root.to_string_lossy().to_string(),
                    features: deck.feature_slugs().len(),
                    active_agents: self
                        .sessions_for(Some(&p.id))
                        .iter()
                        .filter(|s| s.status.active())
                        .count(),
                    open_conflicts: self.conflicts.open(Some(&p.id)).len(),
                    branch: info.branch,
                    commit: crate::git::head_commit(&p.root).map(|c| crate::git::short_sha(&c)),
                })
            })
            .collect()
    }

    // -- agents -----------------------------------------------------------

    pub fn agents(&self) -> Vec<AgentDef> {
        self.agents.lock().unwrap().clone()
    }

    pub fn agent(&self, id: &str) -> Option<AgentDef> {
        self.agents
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.id == id)
            .cloned()
    }

    /// Point one agent at a different provider and model.
    ///
    /// This is the switch that makes a configured provider actually do
    /// anything: registering OpenRouter changes nothing until an agent is told
    /// to use it. Validated against the registry, because an agent pointed at a
    /// provider that does not exist fails at the least useful moment — mid-run,
    /// after the session has already started.
    pub fn set_agent_provider(
        &self,
        agent_id: &str,
        provider: &str,
        model: &str,
    ) -> Result<AgentDef, String> {
        if self.providers.lock().unwrap().get(provider).is_none() {
            return Err(format!(
                "'{provider}' is not configured — set it up under Providers first"
            ));
        }
        let mut agents = self.agents.lock().unwrap();
        let Some(a) = agents.iter_mut().find(|a| a.id == agent_id) else {
            return Err(format!("no agent '{agent_id}'"));
        };
        a.provider = provider.to_string();
        if !model.is_empty() {
            a.model = model.to_string();
        }
        Ok(a.clone())
    }

    /// Which provider and model each agent is pointed at, for persistence.
    pub fn agent_providers(&self) -> Vec<(String, String, String)> {
        self.agents
            .lock()
            .unwrap()
            .iter()
            .map(|a| (a.id.clone(), a.provider.clone(), a.model.clone()))
            .collect()
    }

    /// Re-apply saved assignments, skipping any whose provider has gone.
    /// A provider that was removed should quietly leave its agents on Mock
    /// rather than failing startup or pointing them at nothing.
    pub fn restore_agent_providers(&self, saved: &[(String, String, String)]) {
        for (id, provider, model) in saved {
            if let Err(e) = self.set_agent_provider(id, provider, model) {
                eprintln!("[aiw] leaving '{id}' on its default provider: {e}");
            }
        }
    }

    pub fn set_permission(&self, agent_id: &str, tool: &str, perm: &str) -> Result<(), String> {
        {
            let mut agents = self.agents.lock().unwrap();
            let Some(a) = agents.iter_mut().find(|a| a.id == agent_id) else {
                return Err(format!("no agent '{agent_id}'"));
            };
            a.permissions.insert(tool.to_string(), perm.to_string());
        }
        // Tool services hold a snapshot of the matrix, so they must be rebuilt
        // or a permission change would appear to work and change nothing.
        self.rebuild_tool_services();
        Ok(())
    }

    pub fn permission_matrix(&self) -> PermissionMatrix {
        let mut m = PermissionMatrix::default();
        for a in self.agents.lock().unwrap().iter() {
            for (tool, perm) in &a.permissions {
                m.set(&a.id, tool, Permission::parse(perm));
            }
        }
        m
    }

    fn rebuild_tool_services(&self) {
        let matrix = self.permission_matrix();
        let mut projects = self.projects.lock().unwrap();
        let ids: Vec<String> = projects.keys().cloned().collect();
        for id in ids {
            if let Some(old) = projects.get(&id) {
                let handle = Arc::new(ProjectHandle {
                    id: old.id.clone(),
                    name: old.name.clone(),
                    root: old.root.clone(),
                    tools: ToolService::new(old.root.clone(), &old.id, matrix.clone())
                        .with_approvals(self.approvals.clone()),
                });
                projects.insert(id, handle);
            }
        }
    }

    // -- sessions ---------------------------------------------------------

    pub fn add_session(&self, s: Session) {
        self.sessions.lock().unwrap().push(s);
    }

    pub fn update_session<F: FnOnce(&mut Session)>(&self, id: &str, f: F) -> Option<Session> {
        let mut list = self.sessions.lock().unwrap();
        let s = list.iter_mut().find(|s| s.id == id)?;
        f(s);
        Some(s.clone())
    }

    pub fn session(&self, id: &str) -> Option<Session> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    /// Sessions, newest first, scoped to a project when asked.
    /// Part of the provider/service seam: reached through Tauri commands or
    /// by tests, neither of which the lib-only build can see.
    #[allow(dead_code)]
    pub fn sessions_for(&self, project_id: Option<&str>) -> Vec<Session> {
        let mut v: Vec<Session> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|s| project_id.map(|p| s.project_id == p).unwrap_or(true))
            .cloned()
            .collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }

    pub fn active_sessions(&self, project_id: Option<&str>) -> Vec<Session> {
        self.sessions_for(project_id)
            .into_iter()
            .filter(|s| s.status.active())
            .collect()
    }

    // -- claims -----------------------------------------------------------

    pub fn add_claim(&self, c: WorkClaim) {
        self.claims.lock().unwrap().push(c);
    }

    pub fn claims_for(&self, project_id: Option<&str>, only_active: bool) -> Vec<WorkClaim> {
        self.claims
            .lock()
            .unwrap()
            .iter()
            .filter(|c| project_id.map(|p| c.project_id == p).unwrap_or(true))
            .filter(|c| !only_active || c.status == "active")
            .cloned()
            .collect()
    }

    pub fn release_claim(&self, id: &str, status: &str) -> Option<WorkClaim> {
        let mut list = self.claims.lock().unwrap();
        let c = list.iter_mut().find(|c| c.id == id)?;
        c.status = status.to_string();
        Some(c.clone())
    }

    // -- tests ------------------------------------------------------------

    pub fn add_test_run(&self, r: TestRun) {
        self.tests.lock().unwrap().push(r);
    }

    pub fn test_runs(&self, project_id: Option<&str>) -> Vec<TestRun> {
        let mut v: Vec<TestRun> = self
            .tests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| project_id.map(|p| r.project_id == p).unwrap_or(true))
            .cloned()
            .collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }

    // -- views for the services ------------------------------------------

    /// What the conflict detector needs. Built fresh per call: a stale view is
    /// how you get a conflict raised against work that already finished.
    pub fn work_view(&self, project_id: &str, feature_id: Option<&str>) -> WorkView {
        let claims: Vec<ClaimView> = self
            .claims_for(Some(project_id), true)
            .into_iter()
            .filter(|c| feature_id.map(|f| c.feature_id == f).unwrap_or(true))
            .map(|c| ClaimView {
                claim_id: c.id,
                agent_id: c.agent_id,
                session_id: c.session_id,
                feature_id: c.feature_id,
                areas: c.areas,
                depends_on: c.depends_on,
            })
            .collect();

        let (requirements, decisions) = match (self.project(project_id), feature_id) {
            (Some(p), Some(f)) => {
                let deck = p.deck();
                let reqs = deck
                    .requirements(f)
                    .map(|d| {
                        d.meta
                            .requirements
                            .into_iter()
                            .map(|r| (r.id, r.text, r.forbids))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let decs = deck
                    .decisions(Some(f))
                    .into_iter()
                    .filter(|d| d.meta.status != "superseded")
                    .map(|d| (d.meta.id, d.meta.title))
                    .collect::<Vec<_>>();
                (reqs, decs)
            }
            _ => (vec![], vec![]),
        };

        WorkView {
            claims,
            requirements,
            decisions,
        }
    }

    /// What the reconciler needs to decide who went stale.
    pub fn active_work_view(&self, project_id: &str) -> ActiveWorkView {
        let claims = self.claims_for(Some(project_id), true);
        let entries = self
            .active_sessions(Some(project_id))
            .into_iter()
            .map(|s| {
                let claim = claims.iter().find(|c| c.session_id == s.id);
                ActiveWorkEntry {
                    session_id: s.id.clone(),
                    agent_id: s.agent_id.clone(),
                    feature_id: s.feature_id.clone(),
                    checkpoint_commit: s.checkpoint.as_ref().and_then(|c| c.commit.clone()),
                    areas: claim.map(|c| c.areas.clone()).unwrap_or_default(),
                    depends_on: claim.map(|c| c.depends_on.clone()).unwrap_or_default(),
                }
            })
            .collect();
        ActiveWorkView { entries }
    }

    /// Human-readable active work, for the "what everyone else is doing"
    /// context section.
    pub fn active_work_lines(&self, project_id: &str, feature_id: &str) -> Vec<String> {
        self.claims_for(Some(project_id), true)
            .into_iter()
            .filter(|c| c.feature_id == feature_id)
            .map(|c| format!("{} · {} · {}", c.agent_id, c.intent, c.areas.join(", ")))
            .collect()
    }

    /// The conversation store, or why there isn't one.
    ///
    /// An error rather than an empty stand-in: a chat that silently forgets
    /// everything at exit is worse than one that says it cannot start.
    pub fn convs(&self) -> Result<&Conversations, String> {
        self.conversations
            .get_or_init(|| {
                super::personal::PersonalStore::open()
                    .map(Conversations::new)
                    .map_err(|e| format!("the assistant has nowhere to keep conversations: {e}"))
            })
            .as_ref()
            .map_err(|e| e.clone())
    }

    /// Requests waiting on a person right now.
    pub fn pending_approvals(&self) -> Vec<ApprovalRequest> {
        self.approvals.pending()
    }

    /// Answer one. "Always" also moves the permission, which is the point of
    /// offering it — otherwise you answer the same question every turn.
    pub fn resolve_approval(&self, id: &str, decision: Decision) -> Result<(), String> {
        let agent_tool = self
            .approvals
            .pending()
            .into_iter()
            .find(|r| r.id == id)
            .map(|r| (r.agent_id, r.tool));

        // Move the permission *before* releasing the waiter, so the agent's
        // next call already sees the new level rather than asking again.
        if let Some((agent, tool)) = &agent_tool {
            match decision {
                Decision::AllowAlways => self.set_permission(agent, tool, "full")?,
                Decision::DenyAlways => self.set_permission(agent, tool, "none")?,
                _ => {}
            }
        }

        if self.approvals.resolve(id, decision) {
            Ok(())
        } else {
            // Already answered, or it timed out while the prompt was open.
            Err("that request is no longer waiting — it may have timed out".into())
        }
    }

    /// Wipe live state. Durable `.devdeck` content is untouched — which is the
    /// whole point, and what the reload test checks.
    pub fn reset_runtime_state(&self) {
        self.sessions.lock().unwrap().clear();
        self.claims.lock().unwrap().clear();
        self.tests.lock().unwrap().clear();
        self.conflicts.clear();
        // Waiters see Abandoned and therefore deny; clearing is never approval.
        self.approvals.clear();
        self.bus.clear();
    }
}

pub fn new_session_id() -> String {
    new_id("ses")
}
pub fn new_claim_id() -> String {
    new_id("clm")
}

/// The four built-in roles, with permissions chosen to be *interestingly*
/// different — QA cannot write code, Research cannot touch a terminal — so the
/// permission matrix is exercised rather than being uniformly Full.
pub fn default_agents() -> Vec<AgentDef> {
    let perms = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };
    vec![
        // The orchestrator. First in the list because it is the one you talk
        // to; the rest are who it talks to.
        //
        // Its permissions are the interesting part: it reads freely, delegates
        // freely, remembers freely — and anything that changes your machine is
        // `approval`, so it has to ask. That is the setting the approval prompt
        // was built for. An assistant that could silently run terminal commands
        // because it seemed convenient is the thing nobody wants.
        AgentDef {
            id: super::assistant::ASSISTANT_ID.into(),
            name: "Assistant".into(),
            role: "orchestrator".into(),
            provider: "mock".into(),
            model: "mock-1".into(),
            system: "You are the developer's assistant. You coordinate the team,                      answer questions about the work, and keep track of what matters."
                .into(),
            permissions: perms(&[
                ("delegate", "full"),
                ("memory", "full"),
                ("knowledge", "full"),
                ("files", "read"),
                ("git", "read"),
                ("terminal", "approval"),
                ("tests", "approval"),
                ("process", "approval"),
            ]),
        },
        AgentDef {
            id: "architect".into(),
            name: "Architect".into(),
            role: "architect".into(),
            provider: "mock".into(),
            model: "mock-1".into(),
            system: "You set direction and record decisions. You do not write application code."
                .into(),
            permissions: perms(&[
                ("files", "read"),
                ("git", "read"),
                ("knowledge", "full"),
                ("terminal", "none"),
                ("process", "none"),
                ("tests", "none"),
            ]),
        },
        AgentDef {
            id: "dev-a".into(),
            name: "Developer A".into(),
            role: "developer".into(),
            provider: "mock".into(),
            model: "mock-1".into(),
            system: "You implement work items and keep the shared interfaces coherent.".into(),
            permissions: perms(&[
                ("files", "full"),
                ("git", "full"),
                ("terminal", "full"),
                ("process", "full"),
                ("tests", "full"),
                ("knowledge", "full"),
            ]),
        },
        AgentDef {
            id: "dev-b".into(),
            name: "Developer B".into(),
            role: "developer".into(),
            provider: "mock".into(),
            model: "mock-1".into(),
            system: "You implement UI work items.".into(),
            permissions: perms(&[
                ("files", "full"),
                ("git", "full"),
                ("terminal", "full"),
                ("process", "full"),
                ("tests", "full"),
                ("knowledge", "full"),
            ]),
        },
        AgentDef {
            id: "qa".into(),
            name: "QA Agent".into(),
            role: "qa".into(),
            provider: "mock".into(),
            model: "mock-1".into(),
            system: "You verify behaviour. You run the app and the tests; you do not fix code."
                .into(),
            permissions: perms(&[
                // Deliberately read-only on files: QA reporting a defect is
                // useful, QA silently editing the code under test is not.
                ("files", "read"),
                ("git", "read"),
                ("terminal", "full"),
                ("process", "full"),
                ("tests", "full"),
                ("knowledge", "full"),
            ]),
        },
        AgentDef {
            id: "reviewer".into(),
            name: "Reviewer".into(),
            role: "reviewer".into(),
            provider: "mock".into(),
            model: "mock-1".into(),
            system: "You check the implementation against the requirements and decisions.".into(),
            permissions: perms(&[
                ("files", "read"),
                ("git", "read"),
                ("knowledge", "full"),
                ("terminal", "none"),
                ("process", "none"),
                ("tests", "none"),
            ]),
        },
    ]
}
