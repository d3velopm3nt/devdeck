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
use super::provider::{AnthropicConfig, OpenAICompatibleConfig, ProviderRegistry};
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
    /// Whether the project has a `.devdeck` folder yet.
    pub has_deck: bool,
}

/// How long an agent waits for a human before giving up and being refused.
///
/// Someone at the keyboard answers in seconds. The only thing a longer window
/// buys is a longer stall when nobody is there, so this is the shortest span
/// that still covers reading the prompt and thinking about it.
const APPROVAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

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
        Self::with_approval_timeout(APPROVAL_TIMEOUT)
    }

    /// A workspace whose approval prompts expire after .
    ///
    /// Tests use a few hundred milliseconds. Without this they wait out the
    /// real window on every gated call, which turned a 26-second suite into a
    /// six-minute one — and a slow suite is one people stop running.
    pub fn with_approval_timeout(timeout: std::time::Duration) -> Self {
        Self {
            bus: Arc::new(EventBus::new()),
            conflicts: ConflictService::new(),
            approvals: Arc::new(ApprovalBroker::new(timeout)),
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
                reg.register_anthropic(AnthropicConfig {
                    key_target: target,
                    model: cfg.model,
                });
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
    /// What a provider offers, asked of the provider itself.
    ///
    /// Falls back to the built-in list when the lookup fails, and says so: an
    /// empty dropdown is useless, and a stale one presented as fresh is worse
    /// than useless. The lock is released before the request, for the same
    /// reason every other call here does.
    pub fn model_catalog(&self, id: &str) -> super::provider::ModelCatalog {
        let p = { self.providers.lock().unwrap().get(id) };
        let Some(p) = p else {
            return super::provider::ModelCatalog::fallback(
                Vec::new(),
                format!("'{id}' is not configured"),
            );
        };
        match p.fetch_models() {
            Ok(models) if !models.is_empty() => super::provider::ModelCatalog::live(models),
            Ok(_) => super::provider::ModelCatalog::fallback(
                p.list_models(),
                "the provider returned an empty list",
            ),
            Err(e) => super::provider::ModelCatalog::fallback(p.list_models(), e),
        }
    }

    /// Make a real request against a configured provider, for the Test button.
    ///
    /// The lock is taken once, only to clone the concrete provider out, and is
    /// released before anything touches the network. Two reasons, and the first
    /// one bit: probing while still holding it re-locks the same non-reentrant
    /// mutex and deadlocks forever. Even without that, a network call under the
    /// registry lock would stall every agent for its duration.
    pub fn test_provider(&self, id: &str) -> Result<String, String> {
        enum Probe {
            Openai(super::provider::OpenAICompatibleProvider),
            Anthropic(super::provider::AnthropicProvider),
            /// Nothing to call; report what is known.
            Health(super::provider::ProviderHealth),
        }

        let probe = {
            let reg = self.providers.lock().unwrap();
            let p = reg
                .get(id)
                .ok_or_else(|| format!("'{id}' is not configured"))?;
            if id == super::provider::OpenAICompatibleProvider::ID {
                match reg.openai_compatible() {
                    Some(p) => Probe::Openai(p),
                    None => return Err("no OpenAI-compatible provider is configured".into()),
                }
            } else if id == super::provider::AnthropicProvider::ID {
                match reg.anthropic() {
                    Some(p) => Probe::Anthropic(p),
                    None => return Err("no Anthropic provider is configured".into()),
                }
            } else {
                Probe::Health(p.health())
            }
        };

        match probe {
            Probe::Openai(p) => p.probe(),
            Probe::Anthropic(p) => p.probe(),
            Probe::Health(h) => {
                if h.ok {
                    Ok(h.detail)
                } else {
                    Err(h.detail)
                }
            }
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

    /// Make the registry match `wanted` exactly: register what is new, keep
    /// what is unchanged, drop what has gone.
    ///
    /// Wholesale rather than additive, because the tree is the truth now. A
    /// project deleted from the Explorer that lingered here would keep showing
    /// up in the AI Workspace — two lists disagreeing, which is the thing this
    /// merge exists to end.
    ///
    /// Handles are kept for projects whose id and root are unchanged: a
    /// `ProjectHandle` owns the running-app state, and rebuilding it on every
    /// sync would forget which apps an agent has started.
    pub fn sync_projects(&self, wanted: &[(String, String, PathBuf)]) -> usize {
        let mut changed = 0usize;
        {
            let mut projects = self.projects.lock().unwrap();
            let keep: std::collections::HashSet<&str> =
                wanted.iter().map(|(id, _, _)| id.as_str()).collect();
            let before = projects.len();
            projects.retain(|id, _| keep.contains(id.as_str()));
            changed += before - projects.len();
        }
        for (id, name, root) in wanted {
            let same = self
                .project(id)
                .is_some_and(|p| &p.root == root && &p.name == name);
            if same {
                continue;
            }
            self.register_project(id, name, root.clone());
            changed += 1;
        }
        changed
    }

    pub fn project(&self, id: &str) -> Option<Arc<ProjectHandle>> {
        self.projects.lock().unwrap().get(id).cloned()
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
                    // Adopted, but nothing has written to it yet. Worth
                    // distinguishing: every project is AI-capable now, so
                    // "no features" and "never used by an agent" look the
                    // same until something says otherwise.
                    has_deck: deck.exists(),
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

    /// Every grant, flattened, for persistence.
    pub fn permission_grants(&self) -> Vec<(String, String, String)> {
        let mut out = Vec::new();
        for a in self.agents.lock().unwrap().iter() {
            for (tool, perm) in &a.permissions {
                out.push((a.id.clone(), tool.clone(), perm.clone()));
            }
        }
        out.sort();
        out
    }

    /// Re-apply saved grants over the defaults.
    ///
    /// Overlaid rather than replacing, so a tool or agent added in a later
    /// version arrives with its intended default instead of nothing — and a
    /// grant for something that no longer exists is skipped rather than
    /// resurrecting it.
    pub fn restore_permissions(&self, saved: &[(String, String, String)]) {
        let known: std::collections::HashSet<String> =
            super::tools::registry().into_iter().map(|t| t.id).collect();
        let mut agents = self.agents.lock().unwrap();
        for (agent_id, tool, perm) in saved {
            if !known.contains(tool) {
                continue;
            }
            if let Some(a) = agents.iter_mut().find(|a| &a.id == agent_id) {
                a.permissions.insert(tool.clone(), perm.clone());
            }
        }
        drop(agents);
        self.rebuild_tool_services();
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

    /// Load the team from disk, seeding the built-ins the first time.
    ///
    /// Agents were a hardcoded list, which meant the answer to "add another
    /// developer" was "edit the source". They are files now — frontmatter the
    /// runtime needs, body you actually write — and the built-ins are seeded
    /// once so there is something to copy rather than a blank page.
    ///
    /// Seeded, not owned: once written they are yours to edit or delete, and
    /// nothing rewrites them on a later launch.
    pub fn load_agents(&self) -> Result<usize, String> {
        let convs = self.convs()?;
        let store = convs.store();

        let on_disk = store.agents();
        if on_disk.is_empty() {
            for a in default_agents() {
                let doc = super::deck::Doc {
                    meta: super::personal::AgentMeta {
                        id: a.id.clone(),
                        name: a.name.clone(),
                        role: a.role.clone(),
                        provider: a.provider.clone(),
                        model: a.model.clone(),
                        permissions: a.permissions.clone(),
                        skills: Vec::new(),
                        builtin: true,
                    },
                    body: a.system.clone(),
                };
                store.save_agent(&doc)?;
            }
        }

        let docs = store.agents();
        if docs.is_empty() {
            // Never leave the workspace with no agents at all: an empty team
            // makes every other screen look broken for a reason you cannot see.
            return Ok(0);
        }

        let skills: std::collections::HashMap<String, String> = store
            .skills()
            .into_iter()
            .map(|d| (d.meta.name, d.body))
            .collect();

        let agents: Vec<AgentDef> = docs
            .into_iter()
            .map(|d| {
                let mut system = d.body.trim().to_string();
                // Skills append to the instructions rather than replacing them,
                // so one shared block can be reused across agents without each
                // of them restating it.
                for name in &d.meta.skills {
                    if let Some(body) = skills.get(name) {
                        system.push_str(&format!("\n\n# {name}\n\n{}", body.trim()));
                    }
                }
                AgentDef {
                    id: d.meta.id,
                    name: d.meta.name,
                    role: d.meta.role,
                    provider: d.meta.provider,
                    model: d.meta.model,
                    system,
                    permissions: d.meta.permissions,
                }
            })
            .collect();

        let n = agents.len();
        *self.agents.lock().unwrap() = agents;
        self.rebuild_tool_services();
        Ok(n)
    }

    /// Write one agent and reload, so the change reaches the runtime rather
    /// than only the file.
    pub fn save_agent(
        &self,
        doc: &super::deck::Doc<super::personal::AgentMeta>,
    ) -> Result<(), String> {
        self.convs()?.store().save_agent(doc)?;
        self.load_agents()?;
        Ok(())
    }

    pub fn delete_agent(&self, id: &str) -> Result<bool, String> {
        if id == super::assistant::ASSISTANT_ID {
            return Err(
                "the assistant is how you talk to the workspace — it cannot be deleted".into(),
            );
        }
        let gone = self.convs()?.store().forget_agent(id);
        self.load_agents()?;
        Ok(gone)
    }

    /// One agent as it is on disk, for editing.
    pub fn agent_doc(
        &self,
        id: &str,
    ) -> Result<super::deck::Doc<super::personal::AgentMeta>, String> {
        self.convs()?
            .store()
            .agents()
            .into_iter()
            .find(|d| d.meta.id == id)
            .ok_or_else(|| format!("no agent '{id}'"))
    }

    pub fn skills(&self) -> Result<Vec<super::deck::Doc<super::personal::SkillMeta>>, String> {
        Ok(self.convs()?.store().skills())
    }

    pub fn save_skill(
        &self,
        doc: &super::deck::Doc<super::personal::SkillMeta>,
    ) -> Result<(), String> {
        self.convs()?.store().save_skill(doc)?;
        // Agents embed skill bodies at load time, so a skill edit only reaches
        // them on a reload.
        self.load_agents()?;
        Ok(())
    }

    pub fn delete_skill(&self, name: &str) -> Result<bool, String> {
        let gone = self.convs()?.store().forget_skill(name);
        self.load_agents()?;
        Ok(gone)
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
                // Approval, not full. Writing code and committing it stays
                // inside the project; running a command does not. This was
                // harmless when a deterministic mock was behind it and is not
                // once a real model is choosing the command, so the default is
                // the one you would pick if you thought about it — which is the
                // only default worth shipping.
                ("terminal", "approval"),
                ("process", "approval"),
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
                // Approval, not full. Writing code and committing it stays
                // inside the project; running a command does not. This was
                // harmless when a deterministic mock was behind it and is not
                // once a real model is choosing the command, so the default is
                // the one you would pick if you thought about it — which is the
                // only default worth shipping.
                ("terminal", "approval"),
                ("process", "approval"),
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
                // QA's job is to run things, so these are the tools it exists
                // for — which is exactly why they are worth being asked about.
                ("terminal", "approval"),
                ("process", "approval"),
                // Running the suite is the one it does constantly; prompting
                // for every test run would train you to click Allow without
                // reading, which is worse than not asking.
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
