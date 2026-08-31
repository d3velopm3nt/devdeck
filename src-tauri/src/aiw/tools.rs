//! Tools: the only way an agent reaches the machine.
//!
//! Providers never touch the filesystem, git or a terminal directly. They ask
//! for a tool by name, `ToolService` checks the permission, runs it, and emits
//! `tool.requested` → `tool.executed` / `tool.failed`. That single choke point
//! is what makes "Denied means denied" testable, and what lets a real LLM be
//! dropped in later without widening its reach by accident.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use std::sync::Arc;

use super::approval::{request_for, ApprovalBroker, Outcome};
use super::grants::GrantStore;
use super::events::{DomainEvent, EventBus, EventScope, EventType};

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// What an agent is allowed to do with a tool.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    /// Everything the tool offers.
    Full,
    /// Read-side operations only.
    Read,
    /// Allowed, but a human must say yes first.
    Approval,
    #[default]
    None,
}

impl Permission {
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "full" => Permission::Full,
            "read" | "readonly" | "read-only" => Permission::Read,
            "approval" => Permission::Approval,
            _ => Permission::None,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Permission::Full => "Full",
            Permission::Read => "Read",
            Permission::Approval => "Approval",
            Permission::None => "None",
        }
    }
}

/// Whether a given call is a read or a write, so `Read` permission can allow
/// the former and refuse the latter.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Read,
    Write,
}

/// One callable action on a tool, with the schema a model needs to call it.
///
/// The schema is not decoration: a real provider must be handed a parameter
/// schema per callable or it cannot emit a valid call at all. Declaring it here
/// means both wire formats and the permission filter read from one place.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolAction {
    pub name: String,
    pub description: String,
    /// Whether this action reads or writes. Previously a separate hand-written
    /// match; an action added there and forgotten here silently defaulted to
    /// "write", so the two are now the same source of truth.
    pub access: Access,
    /// JSON Schema (object) for the arguments.
    pub params: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub actions: Vec<ToolAction>,
}

/// One function as a model sees it: a flat name, a description, and a schema.
///
/// Models take a flat list of callables, so `files` + `read` becomes
/// `files_read`. The tool/action split is DevDeck's; the flattening is the
/// wire's, and `parse_tool_call` reverses it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// A tool call.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCall {
    pub tool: String,
    pub action: String,
    #[serde(default)]
    pub args: serde_json::Value,
    /// The provider's own id for this call, when it has one.
    ///
    /// Carried rather than dropped because a result has to be sent back
    /// *referencing* the call it answers. OpenAI tolerates a narrated result;
    /// Anthropic rejects a `tool_result` whose `tool_use_id` does not match a
    /// block it actually sent, so losing this makes multi-turn tool use
    /// impossible there. Empty for the mock, which has no wire protocol.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub call_id: String,
}

impl ToolCall {
    pub fn new(tool: &str, action: &str, args: serde_json::Value) -> Self {
        Self {
            tool: tool.to_string(),
            action: action.to_string(),
            args,
            call_id: String::new(),
        }
    }
    fn arg_str(&self, key: &str) -> Option<String> {
        self.args.get(key)?.as_str().map(str::to_string)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolResult {
    pub ok: bool,
    pub tool: String,
    pub action: String,
    pub output: String,
    /// Repo-relative paths this call wrote. Drives `file.changed`, which is
    /// what starts the reconciliation chain.
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolResult {
    fn ok(call: &ToolCall, output: impl Into<String>) -> Self {
        Self {
            ok: true,
            tool: call.tool.clone(),
            action: call.action.clone(),
            output: output.into(),
            changed_files: vec![],
            error: None,
        }
    }
    fn failed(call: &ToolCall, error: impl Into<String>) -> Self {
        let e = error.into();
        Self {
            ok: false,
            tool: call.tool.clone(),
            action: call.action.clone(),
            output: String::new(),
            changed_files: vec![],
            error: Some(e),
        }
    }
    fn with_files(mut self, files: Vec<String>) -> Self {
        self.changed_files = files;
        self
    }
}

/// Per-agent, per-tool permissions. The matrix the Tool Permissions screen
/// renders and the thing `ToolService` actually consults.
#[derive(Clone, Debug, Default)]
pub struct PermissionMatrix {
    /// agent_id → tool_id → permission
    grants: HashMap<String, HashMap<String, Permission>>,
}

impl PermissionMatrix {
    pub fn set(&mut self, agent: &str, tool: &str, p: Permission) {
        self.grants
            .entry(agent.to_string())
            .or_default()
            .insert(tool.to_string(), p);
    }

    /// Unknown agent or unlisted tool is `None`, not `Full`. Defaulting open
    /// would mean a typo in an agent id silently grants everything.
    pub fn get(&self, agent: &str, tool: &str) -> Permission {
        self.grants
            .get(agent)
            .and_then(|m| m.get(tool))
            .copied()
            .unwrap_or(Permission::None)
    }

    /// The agents this matrix knows about. Used when rendering the
    /// permission grid and by tests.
    #[allow(dead_code)]
    pub fn agents(&self) -> Vec<String> {
        let mut v: Vec<String> = self.grants.keys().cloned().collect();
        v.sort();
        v
    }

    #[allow(dead_code)]
    pub fn for_agent(&self, agent: &str) -> HashMap<String, Permission> {
        self.grants.get(agent).cloned().unwrap_or_default()
    }
}

pub const TOOL_FILES: &str = "files";
pub const TOOL_GIT: &str = "git";
pub const TOOL_TERMINAL: &str = "terminal";
pub const TOOL_PROCESS: &str = "process";
pub const TOOL_TESTS: &str = "tests";
pub const TOOL_KNOWLEDGE: &str = "knowledge";
/// Orchestrator-only: hand a piece of work to a specialist agent.
pub const TOOL_DELEGATE: &str = "delegate";
/// Orchestrator-only: what the assistant remembers about you, across projects.
/// Backed by the personal store, never by a project's `.devdeck`.
pub const TOOL_MEMORY: &str = "memory";

/// Tools the assistant executes itself rather than handing to a project's
/// `ToolService`.
///
/// They are in the registry so they appear in the permission matrix like
/// everything else — you should be able to see and revoke the orchestrator's
/// right to spawn agents. They are not *dispatched* here because one needs the
/// whole workspace and the other writes to the personal store, and a
/// project-scoped tool service has no business reaching either.
pub fn is_assistant_tool(tool: &str) -> bool {
    tool == TOOL_DELEGATE || tool == TOOL_MEMORY
}

/// Shorthand for a JSON Schema object.
fn schema(props: serde_json::Value, required: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": false,
    })
}

fn act(name: &str, description: &str, access: Access, params: serde_json::Value) -> ToolAction {
    ToolAction {
        name: name.to_string(),
        description: description.to_string(),
        access,
        params,
    }
}

pub fn registry() -> Vec<ToolInfo> {
    let path = serde_json::json!({
        "path": { "type": "string", "description": "Project-relative path. Absolute paths and .. are refused." }
    });

    vec![
        ToolInfo {
            id: TOOL_FILES.into(),
            name: "Files".into(),
            description: "Read and write files inside the project".into(),
            actions: vec![
                act(
                    "read",
                    "Read a file's contents.",
                    Access::Read,
                    schema(path.clone(), &["path"]),
                ),
                act(
                    "list",
                    "List a directory.",
                    Access::Read,
                    schema(path.clone(), &["path"]),
                ),
                act(
                    "write",
                    "Write a file, creating parent directories as needed.",
                    Access::Write,
                    schema(
                        serde_json::json!({
                            "path": { "type": "string", "description": "Project-relative path." },
                            "content": { "type": "string", "description": "Full new contents of the file." }
                        }),
                        &["path", "content"],
                    ),
                ),
            ],
        },
        ToolInfo {
            id: TOOL_GIT.into(),
            name: "Git".into(),
            description: "Status, log, diff and DevDeck-attributed commits".into(),
            actions: vec![
                act(
                    "status",
                    "Paths with uncommitted changes.",
                    Access::Read,
                    schema(serde_json::json!({}), &[]),
                ),
                act(
                    "log",
                    "Recent commits, newest first.",
                    Access::Read,
                    schema(
                        serde_json::json!({ "limit": { "type": "integer", "minimum": 1, "maximum": 100 } }),
                        &[],
                    ),
                ),
                act(
                    "diff",
                    "Paths that differ between two commits.",
                    Access::Read,
                    schema(
                        serde_json::json!({
                            "from": { "type": "string", "description": "Base commit." },
                            "to": { "type": "string", "description": "Defaults to HEAD." }
                        }),
                        &["from"],
                    ),
                ),
                act(
                    "commit",
                    "Stage paths and commit, attributed to the calling agent.",
                    Access::Write,
                    schema(
                        serde_json::json!({
                            "message": { "type": "string" },
                            "paths": { "type": "array", "items": { "type": "string" } }
                        }),
                        &["message"],
                    ),
                ),
            ],
        },
        ToolInfo {
            id: TOOL_TERMINAL.into(),
            name: "Terminal".into(),
            description: "Run a command in the project directory".into(),
            actions: vec![act(
                "run",
                "Run a shell command in the project root and return its output.",
                Access::Write,
                schema(
                    serde_json::json!({ "command": { "type": "string", "description": "The command line to run." } }),
                    &["command"],
                ),
            )],
        },
        ToolInfo {
            id: TOOL_PROCESS.into(),
            name: "Process".into(),
            description: "Start, stop and inspect the project's application".into(),
            actions: vec![
                act(
                    "start",
                    "Start the app, defaulting to the dev command in .devdeck/config/app.yaml.",
                    Access::Write,
                    schema(serde_json::json!({ "command": { "type": "string" } }), &[]),
                ),
                act(
                    "status",
                    "Whether the app is running.",
                    Access::Read,
                    schema(serde_json::json!({}), &[]),
                ),
                act(
                    "logs",
                    "Output captured from the app.",
                    Access::Read,
                    schema(serde_json::json!({}), &[]),
                ),
                act(
                    "stop",
                    "Stop the app.",
                    Access::Write,
                    schema(serde_json::json!({}), &[]),
                ),
            ],
        },
        ToolInfo {
            id: TOOL_TESTS.into(),
            name: "Tests".into(),
            description: "Run the project's configured test command".into(),
            actions: vec![act(
                "run",
                "Run the test command from .devdeck/config/app.yaml.",
                Access::Write,
                schema(serde_json::json!({ "command": { "type": "string" } }), &[]),
            )],
        },
        ToolInfo {
            id: TOOL_KNOWLEDGE.into(),
            name: "Knowledge".into(),
            description: "Search .devdeck knowledge and decisions".into(),
            actions: vec![act(
                "search",
                "Find .devdeck documents containing a phrase.",
                Access::Read,
                schema(serde_json::json!({ "query": { "type": "string" } }), &[]),
            )],
        },
        ToolInfo {
            id: TOOL_DELEGATE.into(),
            name: "Delegate".into(),
            description: "Hand work to a specialist agent and check on it".into(),
            actions: vec![
                act(
                    "start",
                    "Start a specialist agent on a feature. Returns immediately                      with a session id; the agent keeps working in the background.",
                    Access::Write,
                    schema(
                        serde_json::json!({
                            "agent_id": { "type": "string", "description": "Which agent, e.g. dev-a, qa, architect." },
                            "feature_id": { "type": "string", "description": "Feature slug the work belongs to." },
                            "work_item_id": { "type": "string", "description": "Optional work item within the feature." },
                            "intent": { "type": "string", "description": "One line describing what it should achieve." }
                        }),
                        &["agent_id", "feature_id"],
                    ),
                ),
                act(
                    "status",
                    "Sessions that are running or have recently finished.",
                    Access::Read,
                    schema(serde_json::json!({}), &[]),
                ),
            ],
        },
        ToolInfo {
            id: TOOL_MEMORY.into(),
            name: "Memory".into(),
            description: "Durable notes about you, kept outside any repository".into(),
            actions: vec![
                act(
                    "list",
                    "Everything currently remembered.",
                    Access::Read,
                    schema(serde_json::json!({}), &[]),
                ),
                act(
                    "save",
                    "Remember something for later. Goes to the personal store,                      never into a project's committed .devdeck.",
                    Access::Write,
                    schema(
                        serde_json::json!({
                            "title": { "type": "string", "description": "One line naming the note." },
                            "body": { "type": "string", "description": "What to remember." },
                            "project_id": { "type": "string", "description": "Optional project this is about." },
                            "tags": { "type": "array", "items": { "type": "string" } }
                        }),
                        &["title", "body"],
                    ),
                ),
                act(
                    "forget",
                    "Delete a note by id.",
                    Access::Write,
                    schema(
                        serde_json::json!({ "id": { "type": "string" } }),
                        &["id"],
                    ),
                ),
            ],
        },

    ]
}

/// The wire name for a tool action: `files` + `read` -> `files_read`.
pub fn wire_name(tool: &str, action: &str) -> String {
    format!("{tool}_{action}")
}

/// The callables one agent may actually use.
///
/// Actions the agent's permission would refuse are **left out entirely** rather
/// than offered and then refused. Handing a read-only agent a `files_write` it
/// can never call wastes a turn and teaches it to expect failures.
pub fn definitions_for(agent: &str, permissions: &PermissionMatrix) -> Vec<ToolDefinition> {
    let mut out = Vec::new();
    for tool in registry() {
        let permission = permissions.get(agent, &tool.id);
        for action in tool.actions {
            let allowed = match (permission, action.access) {
                (Permission::Full, _) => true,
                (Permission::Read, Access::Read) => true,
                // Advertised now that approval is a real prompt rather than a
                // refusal. An action a person can say yes to is genuinely
                // callable, so hiding it would only deny the model a tool it is
                // allowed to ask for. Permissions that can never be satisfied
                // are still left out entirely.
                (Permission::Approval, _) => true,
                _ => false,
            };
            if !allowed {
                continue;
            }
            // Say so in the description. A model told a call may pause for a
            // human asks once and waits, rather than reading the delay as a
            // failure and retrying around it.
            let description = if matches!(permission, Permission::Approval) {
                format!(
                    "{} — {} (requires human approval; the call waits for an answer)",
                    tool.name, action.description
                )
            } else {
                format!("{} — {}", tool.name, action.description)
            };
            out.push(ToolDefinition {
                name: wire_name(&tool.id, &action.name),
                description,
                input_schema: action.params,
            });
        }
    }
    out
}

/// Turn a model's function call back into a `ToolCall`.
///
/// Validates against the declared schema before anything runs: a model will get
/// this wrong sometimes, and a precise error it can act on beats a confusing
/// failure from deep inside a tool.
#[allow(dead_code)] // called by the wire translation and its tests
pub fn parse_tool_call(name: &str, input: &serde_json::Value) -> Result<ToolCall, String> {
    let reg = registry();
    let Some((tool, action)) = reg.iter().find_map(|t| {
        name.strip_prefix(&format!("{}_", t.id))
            .and_then(|rest| t.actions.iter().find(|a| a.name == rest).map(|a| (t, a)))
    }) else {
        let known: Vec<String> = reg
            .iter()
            .flat_map(|t| t.actions.iter().map(move |a| wire_name(&t.id, &a.name)))
            .collect();
        return Err(format!(
            "unknown tool '{name}'. Available: {}",
            known.join(", ")
        ));
    };

    if !input.is_object() {
        return Err(format!("'{name}' expects an object of arguments"));
    }
    if let Some(required) = action.params.get("required").and_then(|r| r.as_array()) {
        for key in required.iter().filter_map(|k| k.as_str()) {
            if input.get(key).is_none() {
                return Err(format!("'{name}' is missing required argument '{key}'"));
            }
        }
    }

    Ok(ToolCall::new(&tool.id, &action.name, input.clone()))
}

/// Which permission level a call needs.
fn required_access(call: &ToolCall) -> Access {
    registry()
        .iter()
        .find(|t| t.id == call.tool)
        .and_then(|t| t.actions.iter().find(|a| a.name == call.action))
        .map(|a| a.access)
        // An action nobody declared is treated as a write. Unknown means
        // unknown, and the safe reading of unknown is "this might change
        // something".
        .unwrap_or(Access::Write)
}

/// A running application started through the process tool.
#[derive(Clone, Debug, Default)]
pub struct RunningApp {
    pub project_id: String,
    pub command: String,
    pub pid: Option<u32>,
    pub status: String,
    pub logs: Vec<String>,
    pub started_at: String,
}

/// What the Tools screen shows about a started application.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppStatus {
    pub project_id: String,
    pub command: String,
    pub pid: Option<u32>,
    pub status: String,
    pub started_at: String,
    pub log_lines: usize,
}

/// Whether an action reads or writes, from the registry rather than a second
/// hand-written list. A grant's safety rule hangs off this answer, so it must
/// be the same answer the permission filter uses.
///
/// An unknown tool or action is a *write*. Guessing "read" for something we do
/// not recognise would let an unlisted action be granted against any arguments.
pub fn access_for(tool: &str, action: &str) -> Access {
    registry()
        .iter()
        .find(|t| t.id == tool)
        .and_then(|t| t.actions.iter().find(|a| a.name == action))
        .map(|a| a.access)
        .unwrap_or(Access::Write)
}

/// Executes tool calls, enforces permissions, emits the events.
pub struct ToolService {
    pub root: PathBuf,
    pub project_id: String,
    pub permissions: PermissionMatrix,
    /// Where `Approval` goes to ask a person. The default refuses immediately,
    /// so a service built without an approval surface behaves exactly as it did
    /// before rather than blocking against a queue nobody reads.
    pub approvals: Arc<ApprovalBroker>,
    /// Permission you gave in advance, narrowly. Consulted only for
    /// `Approval` — a grant can answer a question that was going to be asked,
    /// and can never widen a level that was not going to ask at all.
    pub grants: Arc<GrantStore>,
    /// Processes started by the process tool, keyed by project.
    pub apps: std::sync::Mutex<HashMap<String, RunningApp>>,
}

impl ToolService {
    pub fn new(root: impl Into<PathBuf>, project_id: &str, permissions: PermissionMatrix) -> Self {
        Self {
            root: root.into(),
            project_id: project_id.to_string(),
            permissions,
            approvals: Arc::new(ApprovalBroker::immediate_denial()),
            grants: Arc::new(GrantStore::ephemeral()),
            apps: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Route `Approval` through a broker a human is actually watching.
    pub fn with_approvals(mut self, broker: Arc<ApprovalBroker>) -> Self {
        self.approvals = broker;
        self
    }

    /// Let standing grants answer approvals in advance. Without this the
    /// service has an ephemeral book, so nothing is ever pre-authorised.
    pub fn with_grants(mut self, grants: Arc<GrantStore>) -> Self {
        self.grants = grants;
        self
    }

    /// The application this project started, if the process tool ran one.
    pub fn app_status(&self) -> Option<AppStatus> {
        let apps = self.apps.lock().unwrap();
        apps.get(&self.project_id).map(|a| AppStatus {
            project_id: a.project_id.clone(),
            command: a.command.clone(),
            pid: a.pid,
            status: a.status.clone(),
            started_at: a.started_at.clone(),
            log_lines: a.logs.len(),
        })
    }

    /// The one entry point. Every agent action goes through here.
    ///
    /// `cause` lets the resulting events join the causal chain that started
    /// with the agent's request, so the whole operation is one correlation id.
    pub fn execute(
        &self,
        bus: &EventBus,
        agent_id: &str,
        scope: &EventScope,
        call: &ToolCall,
        cause: Option<&DomainEvent>,
    ) -> ToolResult {
        let requested = {
            let ev = DomainEvent::new(
                EventType::ToolRequested,
                scope.clone().with_agent(agent_id),
                serde_json::json!({
                    "tool": call.tool, "action": call.action, "args": call.args
                }),
            );
            let ev = match cause {
                Some(c) => ev.caused_by(c),
                None => ev,
            };
            bus.emit(ev)
        };

        let permission = self.permissions.get(agent_id, &call.tool);
        let needed = required_access(call);

        // `Approval` is the one level that asks rather than deciding on its
        // own. Everything else is settled here without blocking.
        let mut denial: Option<String> = None;
        let allowed = match (permission, needed) {
            (Permission::Full, _) => true,
            (Permission::Read, Access::Read) => true,
            (Permission::Read, Access::Write) => {
                denial = Some(format!(
                    "'{}' is read-only for {}; '{}' writes",
                    call.tool, agent_id, call.action
                ));
                false
            }
            (Permission::Approval, _) => {
                // A standing grant answers before a person is asked — which is
                // the only reason an agent can run while you are asleep. It is
                // claimed and spent in one step, so the bound on it is real,
                // and the event says which grant allowed it so the trail never
                // reads as though a human was there.
                let summary = super::approval::describe(&call.tool, &call.action, &call.args);
                match self.grants.claim(
                    agent_id,
                    &call.tool,
                    &call.action,
                    &call.args,
                    &self.project_id,
                    &summary,
                ) {
                    Some(g) => {
                        bus.emit(
                            DomainEvent::new(
                                EventType::ToolApprovalResolved,
                                scope.clone().with_agent(agent_id),
                                serde_json::json!({
                                    "tool": call.tool,
                                    "action": call.action,
                                    "summary": summary,
                                    "allowed": true,
                                    "standing": true,
                                    "grantId": g.id,
                                    "usesLeft": g.uses_left(),
                                    "expiresAt": g.expires_at,
                                }),
                            )
                            .caused_by(&requested),
                        );
                        true
                    }
                    // Nobody is there. Asking would block for the whole
                    // timeout and then deny anyway, so it denies now and says
                    // why — a bot's morning wake should not take a quarter of
                    // an hour to arrive at "no".
                    None if scope.unattended => {
                        denial = Some(format!(
                            "'{}' needed approval and this was started by a clock, so there was                              nobody to ask. Give it a standing grant if it should be allowed to                              do this unattended.",
                            call.tool
                        ));
                        false
                    }
                    None => {
                        let outcome =
                            self.ask_permission(bus, agent_id, scope, call, &requested);
                        if !outcome.allows() {
                            denial = Some(outcome.reason(&call.tool));
                        }
                        outcome.allows()
                    }
                }
            }
            (Permission::None, _) => {
                denial = Some(format!("'{}' is denied for {}", call.tool, agent_id));
                false
            }
        };

        if !allowed {
            let reason =
                denial.unwrap_or_else(|| format!("'{}' is denied for {}", call.tool, agent_id));
            let result = ToolResult::failed(call, reason.clone());
            bus.emit(
                DomainEvent::new(
                    EventType::ToolFailed,
                    scope.clone().with_agent(agent_id),
                    serde_json::json!({
                        "tool": call.tool, "action": call.action,
                        "error": reason, "denied": true
                    }),
                )
                .caused_by(&requested),
            );
            return result;
        }

        let result = self.dispatch(call);

        if result.ok {
            bus.emit(
                DomainEvent::new(
                    EventType::ToolExecuted,
                    scope.clone().with_agent(agent_id),
                    serde_json::json!({
                        "tool": call.tool, "action": call.action,
                        "output": truncate(&result.output, 400),
                        "changedFiles": result.changed_files,
                    }),
                )
                .caused_by(&requested),
            );
            // A write is what starts the reconciliation chain. Emitting it here
            // rather than inside each tool means no tool can change a file
            // without the rest of the system hearing about it.
            for path in &result.changed_files {
                bus.emit(
                    DomainEvent::new(
                        EventType::FileChanged,
                        scope.clone().with_agent(agent_id),
                        serde_json::json!({ "path": path, "by": agent_id }),
                    )
                    .caused_by(&requested),
                );
            }
        } else {
            bus.emit(
                DomainEvent::new(
                    EventType::ToolFailed,
                    scope.clone().with_agent(agent_id),
                    serde_json::json!({
                        "tool": call.tool, "action": call.action,
                        "error": result.error.clone().unwrap_or_default()
                    }),
                )
                .caused_by(&requested),
            );
        }

        result
    }

    /// Ask a person, announcing the request before the wait so the UI learns
    /// about it while there is still time to answer.
    fn ask_permission(
        &self,
        bus: &EventBus,
        agent_id: &str,
        scope: &EventScope,
        call: &ToolCall,
        cause: &DomainEvent,
    ) -> Outcome {
        let request = request_for(
            agent_id,
            &call.tool,
            &call.action,
            &call.args,
            scope.project_id.as_deref(),
            scope.feature_id.as_deref(),
            scope.session_id.as_deref(),
            self.approvals.timeout(),
        );

        let outcome = self.approvals.ask(request.clone(), |r| {
            bus.emit(
                DomainEvent::new(
                    EventType::ToolApprovalRequested,
                    scope.clone().with_agent(agent_id),
                    serde_json::json!({
                        "approvalId": r.id,
                        "tool": r.tool,
                        "action": r.action,
                        "summary": r.summary,
                        "detail": r.detail,
                        "expiresIn": r.expires_in,
                    }),
                )
                .caused_by(cause),
            );
        });

        bus.emit(
            DomainEvent::new(
                EventType::ToolApprovalResolved,
                scope.clone().with_agent(agent_id),
                serde_json::json!({
                    "approvalId": request.id,
                    "tool": request.tool,
                    "summary": request.summary,
                    "allowed": outcome.allows(),
                    "outcome": outcome,
                }),
            )
            .caused_by(cause),
        );

        outcome
    }

    fn dispatch(&self, call: &ToolCall) -> ToolResult {
        match call.tool.as_str() {
            TOOL_FILES => self.files(call),
            TOOL_GIT => self.git(call),
            TOOL_TERMINAL => self.terminal(call),
            TOOL_PROCESS => self.process(call),
            TOOL_TESTS => self.tests(call),
            TOOL_KNOWLEDGE => self.knowledge(call),
            // Reaching here means the assistant did not intercept a tool only
            // it can run. Failing loudly beats a project-scoped service quietly
            // doing something with the personal store or the whole workspace.
            t if is_assistant_tool(t) => ToolResult::failed(
                call,
                format!("'{t}' is handled by the assistant, not by a project's tools"),
            ),
            other => ToolResult::failed(call, format!("unknown tool '{other}'")),
        }
    }

    /// Resolve a caller-supplied relative path, refusing anything that escapes
    /// the project. An agent must not be able to read `../../.ssh/id_rsa` by
    /// asking nicely.
    fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err(format!("path must be project-relative: {rel}"));
        }
        if p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(format!("path escapes the project: {rel}"));
        }
        Ok(self.root.join(p))
    }

    fn files(&self, call: &ToolCall) -> ToolResult {
        let Some(path) = call.arg_str("path") else {
            return ToolResult::failed(call, "files: 'path' is required");
        };
        let full = match self.resolve(&path) {
            Ok(p) => p,
            Err(e) => return ToolResult::failed(call, e),
        };
        match call.action.as_str() {
            "read" => match std::fs::read_to_string(&full) {
                Ok(s) => ToolResult::ok(call, s),
                Err(e) => ToolResult::failed(call, format!("{path}: {e}")),
            },
            "write" => {
                let content = call.arg_str("content").unwrap_or_default();
                if let Some(parent) = full.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::write(&full, &content) {
                    Ok(_) => ToolResult::ok(call, format!("wrote {} bytes", content.len()))
                        .with_files(vec![path.replace('\\', "/")]),
                    Err(e) => ToolResult::failed(call, format!("{path}: {e}")),
                }
            }
            "list" => {
                let mut names: Vec<String> = std::fs::read_dir(&full)
                    .into_iter()
                    .flatten()
                    .flatten()
                    .filter_map(|e| e.file_name().to_str().map(str::to_string))
                    .collect();
                names.sort();
                ToolResult::ok(call, names.join("\n"))
            }
            other => ToolResult::failed(call, format!("files: unknown action '{other}'")),
        }
    }

    fn git(&self, call: &ToolCall) -> ToolResult {
        use crate::git;
        match call.action.as_str() {
            "status" => {
                let files = git::dirty_files(&self.root);
                ToolResult::ok(call, files.join("\n"))
            }
            "log" => {
                let n = call
                    .args
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;
                let out = git::log_entries(&self.root, n)
                    .iter()
                    .map(|c| format!("{} {}", c.short, c.subject))
                    .collect::<Vec<_>>()
                    .join("\n");
                ToolResult::ok(call, out)
            }
            "diff" => {
                let from = call.arg_str("from").unwrap_or_default();
                let to = call.arg_str("to").unwrap_or_else(|| "HEAD".into());
                if from.is_empty() {
                    return ToolResult::failed(call, "git diff: 'from' is required");
                }
                ToolResult::ok(
                    call,
                    git::changed_between(&self.root, &from, &to).join("\n"),
                )
            }
            "commit" => {
                let msg = call
                    .arg_str("message")
                    .unwrap_or_else(|| "DevDeck change".into());
                let paths: Vec<String> = call
                    .args
                    .get("paths")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_else(|| vec![".".to_string()]);
                match git::commit_with_metadata(
                    &self.root,
                    &msg,
                    &paths,
                    call.arg_str("agent").as_deref(),
                    call.arg_str("feature").as_deref(),
                    call.arg_str("workItem").as_deref(),
                    call.arg_str("session").as_deref(),
                ) {
                    Ok(sha) => ToolResult::ok(call, sha),
                    Err(e) => ToolResult::failed(call, e),
                }
            }
            other => ToolResult::failed(call, format!("git: unknown action '{other}'")),
        }
    }

    fn terminal(&self, call: &ToolCall) -> ToolResult {
        let Some(cmd) = call.arg_str("command") else {
            return ToolResult::failed(call, "terminal: 'command' is required");
        };
        run_shell(&self.root, &cmd)
            .map(|(code, out)| {
                if code == 0 {
                    ToolResult::ok(call, out)
                } else {
                    ToolResult::failed(call, format!("exit {code}\n{out}"))
                }
            })
            .unwrap_or_else(|e| ToolResult::failed(call, e))
    }

    fn process(&self, call: &ToolCall) -> ToolResult {
        let cfg = super::deck::Deck::new(self.root.clone()).app_cfg();
        match call.action.as_str() {
            "start" => {
                let Some(command) = call.arg_str("command").or(cfg.dev.clone()) else {
                    return ToolResult::failed(
                        call,
                        "process start: no command given and none configured in .devdeck/config/app.yaml",
                    );
                };
                // The runner executes the configured command and captures its
                // output; the app is treated as ready when it exits cleanly or
                // prints its configured ready line.
                match run_shell(&self.root, &command) {
                    Ok((code, out)) => {
                        let ready = cfg
                            .ready_log
                            .as_deref()
                            .map(|needle| out.contains(needle))
                            .unwrap_or(code == 0);
                        let mut apps = self.apps.lock().unwrap();
                        apps.insert(
                            self.project_id.clone(),
                            RunningApp {
                                project_id: self.project_id.clone(),
                                command: command.clone(),
                                pid: None,
                                status: if ready {
                                    "ready".into()
                                } else {
                                    "failed".into()
                                },
                                logs: out.lines().map(str::to_string).collect(),
                                started_at: super::events::now_iso(),
                            },
                        );
                        if ready {
                            ToolResult::ok(call, out)
                        } else {
                            ToolResult::failed(call, format!("app did not become ready\n{out}"))
                        }
                    }
                    Err(e) => ToolResult::failed(call, e),
                }
            }
            "status" => {
                let apps = self.apps.lock().unwrap();
                match apps.get(&self.project_id) {
                    Some(a) => ToolResult::ok(call, a.status.clone()),
                    None => ToolResult::ok(call, "stopped".to_string()),
                }
            }
            "logs" => {
                let apps = self.apps.lock().unwrap();
                match apps.get(&self.project_id) {
                    Some(a) => ToolResult::ok(call, a.logs.join("\n")),
                    None => ToolResult::ok(call, String::new()),
                }
            }
            "stop" => {
                let mut apps = self.apps.lock().unwrap();
                match apps.remove(&self.project_id) {
                    Some(_) => ToolResult::ok(call, "stopped"),
                    None => ToolResult::ok(call, "was not running"),
                }
            }
            other => ToolResult::failed(call, format!("process: unknown action '{other}'")),
        }
    }

    fn tests(&self, call: &ToolCall) -> ToolResult {
        let cfg = super::deck::Deck::new(self.root.clone()).app_cfg();
        let Some(command) = call.arg_str("command").or(cfg.test.clone()) else {
            return ToolResult::failed(
                call,
                "tests: no command given and none configured in .devdeck/config/app.yaml",
            );
        };
        match run_shell(&self.root, &command) {
            Ok((code, out)) => {
                if code == 0 {
                    ToolResult::ok(call, out)
                } else {
                    ToolResult::failed(call, out)
                }
            }
            Err(e) => ToolResult::failed(call, e),
        }
    }

    fn knowledge(&self, call: &ToolCall) -> ToolResult {
        let deck = super::deck::Deck::new(self.root.clone());
        let needle = call.arg_str("query").unwrap_or_default().to_lowercase();
        let mut hits = Vec::new();
        for rel in deck.tree() {
            let full = self.root.join(&rel);
            let Ok(text) = std::fs::read_to_string(&full) else {
                continue;
            };
            if needle.is_empty() || text.to_lowercase().contains(&needle) {
                hits.push(rel);
            }
        }
        ToolResult::ok(call, hits.join("\n"))
    }
}

/// Run a shell command in `dir`, returning (exit code, combined output).
fn run_shell(dir: &Path, command: &str) -> Result<(i32, String), String> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };
    cmd.current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);

    let out = cmd.output().map_err(|e| format!("{command}: {e}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    let errs = String::from_utf8_lossy(&out.stderr);
    if !errs.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&errs);
    }
    Ok((out.status.code().unwrap_or(-1), text))
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("devdeck-tools-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn svc(root: &Path, matrix: PermissionMatrix) -> ToolService {
        ToolService::new(root, "p1", matrix)
    }

    fn full_for(agent: &str) -> PermissionMatrix {
        let mut m = PermissionMatrix::default();
        for t in registry() {
            m.set(agent, &t.id, Permission::Full);
        }
        m
    }

    #[test]
    fn a_denied_tool_does_not_execute() {
        let t = Tmp::new("denied");
        let bus = Arc::new(EventBus::new());
        // Matrix grants nothing at all.
        let s = svc(&t.0, PermissionMatrix::default());

        let target = t.0.join("should-not-exist.txt");
        let call = ToolCall::new(
            TOOL_FILES,
            "write",
            serde_json::json!({ "path": "should-not-exist.txt", "content": "nope" }),
        );
        let r = s.execute(&bus, "rogue", &EventScope::project("p1"), &call, None);

        assert!(!r.ok, "denied call reported success");
        assert!(!target.exists(), "denied write still touched the disk");
        assert!(
            bus.history(None, 50)
                .iter()
                .any(|e| e.is(EventType::ToolFailed)),
            "a denial must be observable as tool.failed"
        );
    }

    #[test]
    fn read_permission_allows_reads_and_refuses_writes() {
        let t = Tmp::new("readonly");
        std::fs::write(t.0.join("a.txt"), "hello").unwrap();
        let bus = Arc::new(EventBus::new());
        let mut m = PermissionMatrix::default();
        m.set("qa", TOOL_FILES, Permission::Read);
        let s = svc(&t.0, m);
        let scope = EventScope::project("p1");

        let read = s.execute(
            &bus,
            "qa",
            &scope,
            &ToolCall::new(TOOL_FILES, "read", serde_json::json!({ "path": "a.txt" })),
            None,
        );
        assert!(read.ok, "read should be allowed: {:?}", read.error);
        assert_eq!(read.output, "hello");

        let write = s.execute(
            &bus,
            "qa",
            &scope,
            &ToolCall::new(
                TOOL_FILES,
                "write",
                serde_json::json!({ "path": "a.txt", "content": "changed" }),
            ),
            None,
        );
        assert!(!write.ok, "read-only must refuse a write");
        assert_eq!(std::fs::read_to_string(t.0.join("a.txt")).unwrap(), "hello");
    }

    #[test]
    fn approval_is_not_silently_granted() {
        let t = Tmp::new("approval");
        let bus = Arc::new(EventBus::new());
        let mut m = PermissionMatrix::default();
        m.set("dev", TOOL_TERMINAL, Permission::Approval);
        let s = svc(&t.0, m);

        let r = s.execute(
            &bus,
            "dev",
            &EventScope::project("p1"),
            &ToolCall::new(
                TOOL_TERMINAL,
                "run",
                serde_json::json!({ "command": "echo hi" }),
            ),
            None,
        );
        assert!(!r.ok);
        // With no approval surface attached the default broker refuses at once,
        // and the message says an answer was what was missing rather than
        // implying the tool itself is off-limits.
        let why = r.error.unwrap();
        assert!(
            why.contains("nobody answered") || why.contains("refused"),
            "the refusal should say an answer was missing, got: {why}"
        );
    }

    #[test]
    fn an_unknown_agent_gets_nothing_rather_than_everything() {
        let t = Tmp::new("unknown");
        let bus = Arc::new(EventBus::new());
        let s = svc(&t.0, full_for("claude"));

        let r = s.execute(
            &bus,
            "typo-in-agent-id",
            &EventScope::project("p1"),
            &ToolCall::new(TOOL_FILES, "list", serde_json::json!({ "path": "." })),
            None,
        );
        assert!(!r.ok, "permissions must fail closed for an unknown agent");
    }

    #[test]
    fn a_write_emits_file_changed_so_reconciliation_can_start() {
        let t = Tmp::new("filechanged");
        let bus = Arc::new(EventBus::new());
        let s = svc(&t.0, full_for("claude"));

        let r = s.execute(
            &bus,
            "claude",
            &EventScope::feature("p1", "f1"),
            &ToolCall::new(
                TOOL_FILES,
                "write",
                serde_json::json!({ "path": "src/sync.ts", "content": "export type SyncResult = {}" }),
            ),
            None,
        );
        assert!(r.ok, "{:?}", r.error);
        assert_eq!(r.changed_files, vec!["src/sync.ts".to_string()]);

        let events = bus.history(None, 50);
        let fc = events
            .iter()
            .find(|e| e.is(EventType::FileChanged))
            .expect("a write must announce itself");
        assert_eq!(fc.payload["path"], "src/sync.ts");
        // And it must be part of the requesting chain, not orphaned.
        assert!(
            fc.correlation_id.is_some(),
            "file.changed lost its correlation"
        );
    }

    #[test]
    fn a_path_escaping_the_project_is_refused() {
        let t = Tmp::new("escape");
        let bus = Arc::new(EventBus::new());
        let s = svc(&t.0, full_for("claude"));

        for bad in ["../outside.txt", "a/../../outside.txt"] {
            let r = s.execute(
                &bus,
                "claude",
                &EventScope::project("p1"),
                &ToolCall::new(
                    TOOL_FILES,
                    "write",
                    serde_json::json!({ "path": bad, "content": "x" }),
                ),
                None,
            );
            assert!(!r.ok, "'{bad}' should be refused");
            assert!(r.error.unwrap().contains("escapes"));
        }
    }

    #[test]
    fn terminal_runs_and_reports_a_nonzero_exit_as_failure() {
        let t = Tmp::new("term");
        let bus = Arc::new(EventBus::new());
        let s = svc(&t.0, full_for("claude"));
        let scope = EventScope::project("p1");

        let ok = s.execute(
            &bus,
            "claude",
            &scope,
            &ToolCall::new(
                TOOL_TERMINAL,
                "run",
                serde_json::json!({ "command": "echo devdeck" }),
            ),
            None,
        );
        assert!(ok.ok, "{:?}", ok.error);
        assert!(ok.output.contains("devdeck"), "got: {}", ok.output);

        let bad = s.execute(
            &bus,
            "claude",
            &scope,
            &ToolCall::new(
                TOOL_TERMINAL,
                "run",
                serde_json::json!({ "command": "exit 3" }),
            ),
            None,
        );
        assert!(!bad.ok, "a non-zero exit must be a failure, not a success");
    }
}

#[cfg(test)]
mod schema_tests {
    use super::*;

    fn matrix(agent: &str, perm: Permission) -> PermissionMatrix {
        let mut m = PermissionMatrix::default();
        for t in registry() {
            m.set(agent, &t.id, perm);
        }
        m
    }

    #[test]
    fn every_action_declares_a_usable_schema() {
        for tool in registry() {
            assert!(!tool.actions.is_empty(), "{} has no actions", tool.id);
            for a in &tool.actions {
                assert!(
                    !a.description.is_empty(),
                    "{}.{} has no description",
                    tool.id,
                    a.name
                );
                assert_eq!(
                    a.params.get("type").and_then(|t| t.as_str()),
                    Some("object"),
                    "{}.{} schema must be an object",
                    tool.id,
                    a.name
                );
                assert!(
                    a.params.get("properties").is_some(),
                    "{}.{} schema has no properties",
                    tool.id,
                    a.name
                );
                // Every required key must actually exist in properties, or the
                // model is being asked for something undocumented.
                let props = a.params["properties"].as_object().unwrap();
                for k in a.params["required"].as_array().unwrap() {
                    let k = k.as_str().unwrap();
                    assert!(
                        props.contains_key(k),
                        "{}.{} requires undeclared '{k}'",
                        tool.id,
                        a.name
                    );
                }
            }
        }
    }

    /// The bug this replaces: `required_access` was a separate match, so an
    /// action added to the registry and forgotten there was silently a write.
    #[test]
    fn access_comes_from_the_registry_not_a_parallel_list() {
        assert_eq!(
            required_access(&ToolCall::new(TOOL_FILES, "read", serde_json::json!({}))),
            Access::Read
        );
        assert_eq!(
            required_access(&ToolCall::new(TOOL_FILES, "write", serde_json::json!({}))),
            Access::Write
        );
        assert_eq!(
            required_access(&ToolCall::new(TOOL_GIT, "log", serde_json::json!({}))),
            Access::Read
        );
        // An action nobody declared is treated as a write: unknown means it
        // might change something.
        assert_eq!(
            required_access(&ToolCall::new(
                TOOL_FILES,
                "invented",
                serde_json::json!({})
            )),
            Access::Write
        );
    }

    #[test]
    fn a_read_only_agent_is_never_offered_a_write() {
        let defs = definitions_for("qa", &matrix("qa", Permission::Read));
        assert!(!defs.is_empty(), "read-only still gets the reads");
        for d in &defs {
            assert!(
                !d.name.ends_with("_write") && !d.name.ends_with("_commit"),
                "read-only agent was offered '{}'",
                d.name
            );
        }
        assert!(defs.iter().any(|d| d.name == "files_read"));
    }

    #[test]
    fn none_advertises_nothing() {
        let defs = definitions_for("x", &matrix("x", Permission::None));
        assert!(
            defs.is_empty(),
            "a permission that can never be satisfied stays hidden, got {}",
            defs.len()
        );
    }

    /// Approval used to advertise nothing, back when it meant "refused".
    /// Now that it means "ask a person", the action is genuinely callable and
    /// hiding it would only deny the model a tool it is allowed to ask for.
    #[test]
    fn approval_advertises_and_says_it_will_pause() {
        let defs = definitions_for("x", &matrix("x", Permission::Approval));
        assert!(!defs.is_empty(), "an approvable action is callable");
        assert!(
            defs.iter().any(|d| d.name == "files_write"),
            "including the writes, which are the whole point of asking"
        );
        for d in &defs {
            assert!(
                d.description.contains("requires human approval"),
                "'{}' must warn that the call waits, or the model reads the                  pause as a failure and retries around it: {}",
                d.name,
                d.description
            );
        }
    }

    #[test]
    fn an_unknown_agent_is_offered_nothing() {
        let defs = definitions_for("typo", &matrix("claude", Permission::Full));
        assert!(defs.is_empty(), "permissions must fail closed here too");
    }

    #[test]
    fn a_wire_name_round_trips_back_to_its_tool_and_action() {
        let defs = definitions_for("dev", &matrix("dev", Permission::Full));
        assert!(
            defs.len() >= 12,
            "expected the full surface, got {}",
            defs.len()
        );

        for d in &defs {
            // Build a minimal valid argument object from the schema.
            let mut args = serde_json::Map::new();
            for k in d.input_schema["required"].as_array().unwrap() {
                args.insert(k.as_str().unwrap().to_string(), serde_json::json!("x"));
            }
            let call = parse_tool_call(&d.name, &serde_json::Value::Object(args))
                .unwrap_or_else(|e| panic!("'{}' did not parse: {e}", d.name));
            assert_eq!(wire_name(&call.tool, &call.action), d.name);
        }
    }

    #[test]
    fn a_missing_required_argument_is_refused_with_a_usable_message() {
        let e = parse_tool_call("files_read", &serde_json::json!({})).unwrap_err();
        assert!(e.contains("missing required argument 'path'"), "got: {e}");
    }

    #[test]
    fn an_invented_tool_is_refused_and_the_error_lists_the_real_ones() {
        let e = parse_tool_call("filesystem_delete", &serde_json::json!({})).unwrap_err();
        assert!(e.contains("unknown tool"), "got: {e}");
        // The message is fed back to the model, so it has to be actionable.
        assert!(
            e.contains("files_read"),
            "the error should name what does exist: {e}"
        );
    }

    #[test]
    fn a_non_object_argument_payload_is_refused() {
        let e = parse_tool_call("files_read", &serde_json::json!("just a string")).unwrap_err();
        assert!(e.contains("expects an object"), "got: {e}");
    }
}
