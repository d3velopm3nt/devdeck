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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    Read,
    Write,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// A tool call.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCall {
    pub tool: String,
    pub action: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

impl ToolCall {
    pub fn new(tool: &str, action: &str, args: serde_json::Value) -> Self {
        Self {
            tool: tool.to_string(),
            action: action.to_string(),
            args,
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

pub fn registry() -> Vec<ToolInfo> {
    vec![
        ToolInfo {
            id: TOOL_FILES.into(),
            name: "Files".into(),
            description: "Read and write files inside the project".into(),
        },
        ToolInfo {
            id: TOOL_GIT.into(),
            name: "Git".into(),
            description: "Status, log, diff and DevDeck-attributed commits".into(),
        },
        ToolInfo {
            id: TOOL_TERMINAL.into(),
            name: "Terminal".into(),
            description: "Run a command in the project directory".into(),
        },
        ToolInfo {
            id: TOOL_PROCESS.into(),
            name: "Process".into(),
            description: "Start, stop and inspect the project's application".into(),
        },
        ToolInfo {
            id: TOOL_TESTS.into(),
            name: "Tests".into(),
            description: "Run the project's configured test command".into(),
        },
        ToolInfo {
            id: TOOL_KNOWLEDGE.into(),
            name: "Knowledge".into(),
            description: "Search .devdeck knowledge and decisions".into(),
        },
    ]
}

/// Which permission level a call needs.
fn required_access(call: &ToolCall) -> Access {
    match (call.tool.as_str(), call.action.as_str()) {
        (TOOL_FILES, "read") | (TOOL_FILES, "list") => Access::Read,
        (TOOL_GIT, "status") | (TOOL_GIT, "log") | (TOOL_GIT, "diff") => Access::Read,
        (TOOL_PROCESS, "status") | (TOOL_PROCESS, "logs") => Access::Read,
        (TOOL_KNOWLEDGE, _) => Access::Read,
        _ => Access::Write,
    }
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

/// Executes tool calls, enforces permissions, emits the events.
pub struct ToolService {
    pub root: PathBuf,
    pub project_id: String,
    pub permissions: PermissionMatrix,
    /// Processes started by the process tool, keyed by project.
    pub apps: std::sync::Mutex<HashMap<String, RunningApp>>,
}

impl ToolService {
    pub fn new(root: impl Into<PathBuf>, project_id: &str, permissions: PermissionMatrix) -> Self {
        Self {
            root: root.into(),
            project_id: project_id.to_string(),
            permissions,
            apps: std::sync::Mutex::new(HashMap::new()),
        }
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
        let allowed = match (permission, needed) {
            (Permission::Full, _) => true,
            (Permission::Read, Access::Read) => true,
            (Permission::Read, Access::Write) => false,
            // Approval is not auto-granted: without a human decision recorded,
            // the safe answer is no. Treating "needs approval" as "yes" would
            // make the permission meaningless.
            (Permission::Approval, _) => false,
            (Permission::None, _) => false,
        };

        if !allowed {
            let reason = match permission {
                Permission::Approval => format!(
                    "'{}' requires human approval for {} — not granted",
                    call.tool, agent_id
                ),
                Permission::Read => format!(
                    "'{}' is read-only for {}; '{}' writes",
                    call.tool, agent_id, call.action
                ),
                _ => format!("'{}' is denied for {}", call.tool, agent_id),
            };
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

    fn dispatch(&self, call: &ToolCall) -> ToolResult {
        match call.tool.as_str() {
            TOOL_FILES => self.files(call),
            TOOL_GIT => self.git(call),
            TOOL_TERMINAL => self.terminal(call),
            TOOL_PROCESS => self.process(call),
            TOOL_TESTS => self.tests(call),
            TOOL_KNOWLEDGE => self.knowledge(call),
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
        assert!(
            r.error.unwrap().contains("approval"),
            "the refusal should say approval is what's missing"
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
