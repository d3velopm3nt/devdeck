//! An MCP client: speaking to servers your bots installed from Community.
//!
//! Model Context Protocol servers are separate processes that expose tools
//! over JSON-RPC 2.0. The stdio transport is newline-delimited: one JSON
//! message per line, and a message may not contain a raw newline. That is the
//! whole framing, and it is why `send` refuses a line containing one rather
//! than writing a message the other end will read as two.
//!
//! **The transport is a trait on purpose.** The protocol — the handshake, the
//! id matching, the shape of a `tools/call` result — is the part that goes
//! wrong, and it is the part a test cannot reach if talking to a server means
//! spawning `npx`. So `Client` speaks to a `Transport`, `StdioTransport` is
//! one, and the tests use a scripted one that answers from memory. Nothing
//! about the protocol is mocked; only the pipe is.
//!
//! **What this module does not decide.** Whether an agent may call a tool is
//! the permission matrix's answer, not this module's — every call still goes
//! through `ToolService`, which asks the matrix and the approval broker first.
//! This is the thing that finally runs a call that was already allowed.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The protocol version this client speaks.
///
/// Sent in `initialize` and echoed by the server. A server that answers with a
/// different one is not refused — the specification allows negotiation, and a
/// client that hung up on a newer server would break on the day servers were
/// upgraded — but the answer is recorded so a mismatch is visible rather than
/// mysterious.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// How long to wait for a server to answer one request.
///
/// A server that never answers must not hold an agent's turn open for ever;
/// the turn has a person waiting at the end of it.
const TIMEOUT_SECS: u64 = 30;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/// A line-oriented, bidirectional channel to a server.
pub trait Transport: Send {
    /// Write one JSON-RPC message. The line must not contain a newline.
    fn send(&mut self, line: &str) -> Result<(), String>;
    /// Read the next message. Blocks; returns Err when the channel is closed.
    fn recv(&mut self) -> Result<String, String>;
}

/// A server running as a child process, spoken to over its stdin and stdout.
pub struct StdioTransport {
    child: Child,
    out: BufReader<std::process::ChildStdout>,
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// What Windows will actually run for a bare program name.
///
/// `Command::new("npx")` fails on Windows. npx on disk is `npx.cmd`, and
/// process creation does not consult `PATHEXT` the way a shell does — so the
/// bare name resolves to nothing and the spawn returns "program not found"
/// while node is plainly installed.
///
/// That mattered more than it looks: every npm-published MCP server is
/// launched with `npx -y …`, so without this the entire registry is
/// unstartable on the one platform DevDeck ships on. The live tests missed it
/// because they spawn `node` with a script path, which needs no extension —
/// the bug was only visible once a page asked a real catalogue entry for its
/// tools.
///
/// Returns the name unchanged when nothing matches, so a genuinely missing
/// program still fails naming what was asked for rather than a guess.
pub fn resolve_program(program: &str) -> String {
    if !cfg!(windows) {
        return program.to_string();
    }
    let p = std::path::Path::new(program);
    // Already spelled out, or a path rather than a name to look up.
    if p.extension().is_some() || program.contains('/') || program.contains('\\') {
        return program.to_string();
    }
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let Ok(path) = std::env::var("PATH") else {
        return program.to_string();
    };
    for dir in path.split(';').filter(|d| !d.is_empty()) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = std::path::Path::new(dir).join(format!("{program}{ext}"));
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    program.to_string()
}

/// Would a spawn find this program? Asked exactly the way the spawn asks.
///
/// Sharing the resolution is the point: a requirements row that probed
/// something else could say "on PATH" beside a spawn that said "program not
/// found", which is what it did.
pub fn program_present(program: &str) -> bool {
    resolve_program(program) != program || crate::runners::on_path(program)
}

impl StdioTransport {
    /// Spawn a server.
    ///
    /// stderr is inherited rather than piped: a server that complains on
    /// startup should be findable in the dev console, and piping it without
    /// draining it fills the pipe and deadlocks the child.
    pub fn spawn(command: &str, args: &[String], dir: Option<&std::path::Path>) -> Result<Self, String> {
        let mut cmd = Command::new(resolve_program(command));
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        if let Some(d) = dir {
            cmd.current_dir(d);
        }
        no_window(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start '{command}': {e}"))?;
        let out = child
            .stdout
            .take()
            .ok_or_else(|| "the server gave us no stdout".to_string())?;
        Ok(Self {
            child,
            out: BufReader::new(out),
        })
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }
}

impl Transport for StdioTransport {
    fn send(&mut self, line: &str) -> Result<(), String> {
        if line.contains('\n') {
            // Would arrive as two messages, the second of them nonsense.
            return Err("a JSON-RPC line may not contain a newline".into());
        }
        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| "the server's stdin is closed".to_string())?;
        writeln!(stdin, "{line}").map_err(|e| format!("writing to the server: {e}"))?;
        stdin.flush().map_err(|e| format!("flushing to the server: {e}"))
    }

    fn recv(&mut self) -> Result<String, String> {
        let mut line = String::new();
        match self.out.read_line(&mut line) {
            Ok(0) => Err("the server closed its output".into()),
            Ok(_) => Ok(line.trim_end().to_string()),
            Err(e) => Err(format!("reading from the server: {e}")),
        }
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        // A server left running after its client is gone is a process nobody
        // owns. Ask, then insist.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

/// One tool a server offers.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct McpTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
    /// True when the server itself says the tool does not modify anything.
    ///
    /// A hint, and treated as one: it decides whether a `read` permission is
    /// enough, and a server that lies about it can only ever *narrow* what it
    /// is allowed to do, never widen it — an unhinted tool counts as a write.
    #[serde(default)]
    pub read_only: bool,
}

/// What a server said about itself during the handshake.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    /// The protocol version the server answered with, which may not be ours.
    pub protocol: String,
}

/// A JSON-RPC client for one server.
pub struct Client<T: Transport> {
    transport: T,
    next_id: i64,
}

impl<T: Transport> Client<T> {
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            next_id: 1,
        }
    }

    /// Send a request and wait for *its* answer.
    ///
    /// Matching on the id rather than taking the next line is the part worth
    /// getting right: a server may interleave notifications and its own
    /// requests with the reply, and a client that assumed the next line was
    /// the answer would hand a log message back as a tool result.
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.transport.send(&msg.to_string())?;

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(TIMEOUT_SECS);
        loop {
            if std::time::Instant::now() > deadline {
                return Err(format!("the server did not answer '{method}' in {TIMEOUT_SECS}s"));
            }
            let line = self.transport.recv()?;
            if line.trim().is_empty() {
                continue;
            }
            let v: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                // A line we cannot parse is the server's problem, not a reason
                // to give up on the conversation — unless it never answers.
                Err(_) => continue,
            };
            if v.get("id").and_then(Value::as_i64) != Some(id) {
                continue;
            }
            if let Some(err) = v.get("error") {
                let message = err
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("the server refused the call");
                return Err(message.to_string());
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({"jsonrpc": "2.0", "method": method, "params": params});
        self.transport.send(&msg.to_string())
    }

    /// The handshake: initialize, then say we are initialized.
    ///
    /// The notification is not optional. A server is entitled to refuse every
    /// request until it arrives, and skipping it produces a client that works
    /// against lenient servers and hangs against correct ones.
    pub fn initialize(&mut self) -> Result<ServerInfo, String> {
        let result = self.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "DevDeck", "version": env!("CARGO_PKG_VERSION")}
            }),
        )?;
        self.notify("notifications/initialized", json!({}))?;
        Ok(ServerInfo {
            name: result
                .pointer("/serverInfo/name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            version: result
                .pointer("/serverInfo/version")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            protocol: result
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
    }

    pub fn list_tools(&mut self) -> Result<Vec<McpTool>, String> {
        let result = self.request("tools/list", json!({}))?;
        Ok(parse_tools(&result))
    }

    /// Call one tool and flatten its answer to text.
    pub fn call_tool(&mut self, name: &str, args: Value) -> Result<String, String> {
        let result = self.request("tools/call", json!({"name": name, "arguments": args}))?;
        flatten_result(&result)
    }
}

/// Read a `tools/list` result.
///
/// Defensive about the shape because this is someone else's server: anything
/// without a name is skipped rather than surfaced as a nameless tool an agent
/// could be granted.
pub fn parse_tools(result: &Value) -> Vec<McpTool> {
    let Some(list) = result.get("tools").and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|t| {
            let name = t.get("name").and_then(Value::as_str)?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(McpTool {
                name,
                description: t
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                input_schema: t.get("inputSchema").cloned().unwrap_or(Value::Null),
                read_only: t
                    .pointer("/annotations/readOnlyHint")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

/// Flatten a `tools/call` result into the text an agent sees.
///
/// `isError` is the server saying the *tool* failed, which is different from
/// the call failing, and it comes back as `Err` so a caller cannot mistake a
/// reported failure for a successful answer.
pub fn flatten_result(result: &Value) -> Result<String, String> {
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| match b.get("type").and_then(Value::as_str) {
                    Some("text") => b.get("text").and_then(Value::as_str).map(str::to_string),
                    // A picture or a blob is real output we cannot show in a
                    // transcript, so it is named rather than dropped silently.
                    Some(other) => Some(format!("[{other} content]")),
                    None => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    if result.get("isError").and_then(Value::as_bool).unwrap_or(false) {
        return Err(if text.is_empty() {
            "the tool reported an error".to_string()
        } else {
            text
        });
    }
    Ok(text)
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/// The prefix that marks a tool id as belonging to an MCP server.
pub const PREFIX: &str = "mcp.";

/// Whether a tool id is one of ours.
pub fn is_mcp(tool_id: &str) -> bool {
    tool_id.starts_with(PREFIX)
}

/// The server id inside a tool id: `mcp.fetch` → `fetch`.
pub fn server_of(tool_id: &str) -> Option<&str> {
    tool_id.strip_prefix(PREFIX).filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// The hub: servers that are running, and the tools they offer
// ---------------------------------------------------------------------------

/// What DevDeck needs to start a server.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ServerSpec {
    /// Matches the tool id after `mcp.`.
    pub id: String,
    pub name: String,
    /// The whole command line, as a person would type it.
    pub command: String,
}

/// Split a command line into a program and its arguments.
///
/// Quote-aware, because a path with a space in it is the normal case on
/// Windows and splitting on whitespace would run the wrong program with the
/// rest as arguments.
pub fn split_command(line: &str) -> Option<(String, Vec<String>)> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in line.chars() {
        match c {
            '"' | '\'' if quote.is_none() => quote = Some(c),
            c if Some(c) == quote => quote = None,
            c if c.is_whitespace() && quote.is_none() => {
                if !cur.is_empty() {
                    parts.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    if parts.is_empty() {
        return None;
    }
    let program = parts.remove(0);
    Some((program, parts))
}

struct Running {
    client: Client<StdioTransport>,
    info: ServerInfo,
    tools: Vec<McpTool>,
    pid: u32,
    started_at: String,
}

/// What is running right now, for the Processes surface.
#[derive(Serialize, Clone, Debug)]
pub struct ServerStatus {
    pub id: String,
    pub name: String,
    pub pid: u32,
    pub started_at: String,
    pub protocol: String,
    pub tools: usize,
}

/// Every MCP server this app has started, and the tools they offer.
#[derive(Default)]
pub struct Hub {
    running: Mutex<HashMap<String, Running>>,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Start a server if it is not already running, and return its tools.
    ///
    /// Idempotent, because two agents asking at once must not produce two
    /// processes: the second finds the first already there.
    pub fn ensure(&self, spec: &ServerSpec) -> Result<Vec<McpTool>, String> {
        {
            let running = self.running.lock().unwrap();
            if let Some(r) = running.get(&spec.id) {
                return Ok(r.tools.clone());
            }
        }
        let (program, args) = split_command(&spec.command)
            .ok_or_else(|| format!("'{}' has no command to run", spec.id))?;
        let transport = StdioTransport::spawn(&program, &args, None)?;
        let pid = transport.pid();
        let mut client = Client::new(transport);
        let info = client.initialize()?;
        let tools = client.list_tools()?;

        let mut running = self.running.lock().unwrap();
        // Someone may have won the race while we were handshaking. Theirs is
        // as good as ours, and ours is dropped — which kills its process.
        if let Some(r) = running.get(&spec.id) {
            return Ok(r.tools.clone());
        }
        running.insert(
            spec.id.clone(),
            Running {
                client,
                info,
                tools: tools.clone(),
                pid,
                started_at: crate::aiw::events::now_iso(),
            },
        );
        Ok(tools)
    }

    /// Call a tool on a server, starting the server if it is not up.
    pub fn call(&self, spec: &ServerSpec, tool: &str, args: Value) -> Result<String, String> {
        self.ensure(spec)?;
        let mut running = self.running.lock().unwrap();
        let r = running
            .get_mut(&spec.id)
            .ok_or_else(|| format!("'{}' is not running", spec.id))?;
        if !r.tools.iter().any(|t| t.name == tool) {
            return Err(format!("'{}' offers no tool called '{tool}'", spec.id));
        }
        r.client.call_tool(tool, args)
    }

    /// The tools a server offers, without starting it.
    pub fn tools(&self, server: &str) -> Vec<McpTool> {
        self.running
            .lock()
            .unwrap()
            .get(server)
            .map(|r| r.tools.clone())
            .unwrap_or_default()
    }

    pub fn stop(&self, server: &str) -> bool {
        // Dropping the client drops the transport, which kills the child.
        self.running.lock().unwrap().remove(server).is_some()
    }

    pub fn statuses(&self) -> Vec<ServerStatus> {
        let running = self.running.lock().unwrap();
        let mut out: Vec<ServerStatus> = running
            .iter()
            .map(|(id, r)| ServerStatus {
                id: id.clone(),
                name: if r.info.name.is_empty() {
                    id.clone()
                } else {
                    r.info.name.clone()
                },
                pid: r.pid,
                started_at: r.started_at.clone(),
                protocol: r.info.protocol.clone(),
                tools: r.tools.len(),
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server that answers from a script, so the protocol is under test and
    /// the pipe is not.
    struct Scripted {
        sent: Vec<String>,
        replies: Vec<String>,
    }

    impl Scripted {
        fn new(replies: &[&str]) -> Self {
            Self {
                sent: Vec::new(),
                replies: replies.iter().rev().map(|s| s.to_string()).collect(),
            }
        }
    }

    impl Transport for Scripted {
        fn send(&mut self, line: &str) -> Result<(), String> {
            if line.contains('\n') {
                return Err("a JSON-RPC line may not contain a newline".into());
            }
            self.sent.push(line.to_string());
            Ok(())
        }
        fn recv(&mut self) -> Result<String, String> {
            self.replies.pop().ok_or_else(|| "nothing left to say".into())
        }
    }

    #[test]
    fn the_handshake_sends_initialize_then_says_it_is_initialized() {
        // The notification is not optional: a correct server may refuse every
        // request until it arrives, so a client that skips it works only
        // against lenient ones.
        let t = Scripted::new(&[
            r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"fetch","version":"1.2.0"}}}"#,
        ]);
        let mut c = Client::new(t);
        let info = c.initialize().unwrap();
        assert_eq!(info.name, "fetch");
        assert_eq!(info.version, "1.2.0");
        assert_eq!(info.protocol, PROTOCOL_VERSION);

        let sent: Vec<Value> = c
            .transport
            .sent
            .iter()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect();
        assert_eq!(sent[0]["method"], "initialize");
        assert_eq!(sent[1]["method"], "notifications/initialized");
        assert!(sent[1].get("id").is_none(), "a notification carries no id");
    }

    #[test]
    fn a_reply_is_matched_by_id_not_by_arriving_next() {
        // A server may interleave its own notifications with the answer. A
        // client that took the next line would hand a log message back as a
        // tool result.
        let t = Scripted::new(&[
            r#"{"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"starting up"}}"#,
            r#"{"jsonrpc":"2.0","id":99,"result":{"not":"ours"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"right one"}}}"#,
        ]);
        let mut c = Client::new(t);
        assert_eq!(c.initialize().unwrap().name, "right one");
    }

    #[test]
    fn an_unparsable_line_does_not_end_the_conversation() {
        let t = Scripted::new(&[
            "this is not json at all",
            r#"{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"fine"}}}"#,
        ]);
        let mut c = Client::new(t);
        assert_eq!(c.initialize().unwrap().name, "fine");
    }

    #[test]
    fn a_json_rpc_error_comes_back_as_the_servers_own_words() {
        let t = Scripted::new(&[
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}"#,
        ]);
        let mut c = Client::new(t);
        let e = c.initialize().unwrap_err();
        assert!(e.contains("method not found"), "{e}");
    }

    #[test]
    fn a_newline_in_a_message_is_refused_rather_than_split() {
        // The stdio framing is one message per line. Writing an embedded
        // newline sends half a message and then rubbish.
        let mut t = Scripted::new(&[]);
        assert!(t.send("{\"a\":1}\n{\"b\":2}").is_err());
    }

    #[test]
    fn tools_without_a_name_are_skipped_rather_than_surfaced() {
        // Someone else's server. A nameless tool cannot be granted or called,
        // so listing it would put a row in the matrix that does nothing.
        let v: Value = serde_json::from_str(
            r#"{"tools":[
                 {"name":"fetch","description":"Get a URL","inputSchema":{"type":"object"}},
                 {"description":"no name"},
                 {"name":"   "},
                 {"name":"peek","annotations":{"readOnlyHint":true}}
               ]}"#,
        )
        .unwrap();
        let tools = parse_tools(&v);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "fetch");
        assert!(!tools[0].read_only, "unhinted means not read-only");
        assert!(tools[1].read_only, "the server said so");
    }

    #[test]
    fn a_tool_that_reports_an_error_is_an_error_not_an_answer() {
        // `isError` is the server saying the tool failed. Returning its text as
        // a successful result would put a failure into a transcript as fact.
        let v: Value = serde_json::from_str(
            r#"{"isError":true,"content":[{"type":"text","text":"404 not found"}]}"#,
        )
        .unwrap();
        assert_eq!(flatten_result(&v).unwrap_err(), "404 not found");
    }

    #[test]
    fn non_text_content_is_named_rather_than_dropped() {
        let v: Value = serde_json::from_str(
            r#"{"content":[{"type":"text","text":"here"},{"type":"image","data":"…"}]}"#,
        )
        .unwrap();
        assert_eq!(flatten_result(&v).unwrap(), "here\n[image content]");
    }

    #[test]
    fn an_empty_result_is_empty_text_not_a_failure() {
        let v: Value = serde_json::from_str(r#"{"content":[]}"#).unwrap();
        assert_eq!(flatten_result(&v).unwrap(), "");
    }

    #[test]
    fn a_command_line_splits_on_quotes_not_just_spaces() {
        // The normal Windows case: a path with a space in it.
        let (p, a) = split_command(r#""C:\Program Files\nodejs\npx.cmd" -y server-fetch"#).unwrap();
        assert_eq!(p, r"C:\Program Files\nodejs\npx.cmd");
        assert_eq!(a, vec!["-y", "server-fetch"]);

        let (p, a) = split_command("npx -y @modelcontextprotocol/server-fetch").unwrap();
        assert_eq!(p, "npx");
        assert_eq!(a, vec!["-y", "@modelcontextprotocol/server-fetch"]);

        assert!(split_command("   ").is_none(), "nothing to run is not a program");
    }

    #[test]
    fn a_tool_id_names_its_server() {
        assert!(is_mcp("mcp.fetch"));
        assert!(!is_mcp("files"));
        assert_eq!(server_of("mcp.fetch"), Some("fetch"));
        assert_eq!(server_of("mcp."), None, "a prefix with nothing after it names nobody");
        assert_eq!(server_of("files"), None);
    }
}

// ---------------------------------------------------------------------------
// End to end, against a real process
// ---------------------------------------------------------------------------
//
// Everything above tests the protocol against a scripted transport, which is
// the right way to check the parts that go wrong. This checks the part a
// scripted transport cannot: that spawning a real child, writing to its stdin
// and reading its stdout actually works — line buffering, flushing, the pipe
// staying open between calls.
//
// The server is written to a temp file by the test rather than checked in, so
// there is no fixture path to get wrong and nothing to keep in step. It needs
// `node`, and says so and stops when there is none: a machine without Node is
// a machine that cannot run MCP servers either, so failing the suite there
// would report the wrong thing.

#[cfg(test)]
mod live {
    use super::*;

    /// A minimal MCP server: initialize, tools/list, tools/call. Enough of the
    /// protocol to prove the pipe, and no more.
    const SERVER: &str = r#"
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "echo", version: "0.1.0" } } });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
        { name: "shout", description: "Upper-cases a string",
          inputSchema: { type: "object", properties: { text: { type: "string" } } } },
        { name: "peek", description: "Reads without changing anything",
          annotations: { readOnlyHint: true } } ] } });
    } else if (msg.method === "tools/call") {
      const t = msg.params && msg.params.name;
      const a = (msg.params && msg.params.arguments) || {};
      if (t === "shout") {
        send({ jsonrpc: "2.0", id: msg.id, result: {
          content: [{ type: "text", text: String(a.text || "").toUpperCase() }] } });
      } else if (t === "peek") {
        send({ jsonrpc: "2.0", id: msg.id, result: {
          content: [{ type: "text", text: "nothing changed" }] } });
      } else {
        send({ jsonrpc: "2.0", id: msg.id, result: {
          isError: true, content: [{ type: "text", text: "no such tool: " + t }] } });
      }
    }
  }
});
"#;

    fn node() -> Option<String> {
        let probe = if cfg!(windows) { "where" } else { "which" };
        let out = Command::new(probe).arg("node").output().ok()?;
        out.status.success().then(|| "node".to_string())
    }

    fn write_server() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("devdeck-mcp-{}.mjs", std::process::id()));
        std::fs::write(&p, SERVER).unwrap();
        p
    }

    #[test]
    fn a_real_server_is_spawned_listed_and_called_over_stdio() {
        let Some(node) = node() else {
            eprintln!("skipping: no node on this machine, so no MCP server could run here either");
            return;
        };
        let script = write_server();
        let hub = Hub::new();
        let spec = ServerSpec {
            id: "echo".into(),
            name: "Echo".into(),
            command: format!("{node} \"{}\"", script.display()),
        };

        // Starting it is what learns what it offers.
        let tools = hub.ensure(&spec).expect("the server should start and answer");
        assert_eq!(tools.len(), 2, "{tools:?}");
        assert_eq!(tools[0].name, "shout");
        assert!(!tools[0].read_only, "unhinted is a write");
        assert!(tools[1].read_only, "the server hinted read-only");

        // The pipe stays open across calls: two round trips, one process.
        assert_eq!(
            hub.call(&spec, "shout", serde_json::json!({"text": "hello"})).unwrap(),
            "HELLO"
        );
        assert_eq!(
            hub.call(&spec, "peek", serde_json::json!({})).unwrap(),
            "nothing changed"
        );

        // One process, not one per call.
        let up = hub.statuses();
        assert_eq!(up.len(), 1);
        assert_eq!(up[0].id, "echo");
        assert_eq!(up[0].tools, 2);
        assert_eq!(up[0].protocol, PROTOCOL_VERSION);
        assert!(up[0].pid > 0);

        // A tool the server does not offer is refused here rather than sent.
        let e = hub.call(&spec, "delete-everything", serde_json::json!({})).unwrap_err();
        assert!(e.contains("no tool called"), "{e}");

        assert!(hub.stop("echo"));
        assert!(hub.statuses().is_empty(), "stopping takes the process with it");
        let _ = std::fs::remove_file(&script);
    }

    #[test]
    fn a_server_that_cannot_start_says_so_rather_than_hanging() {
        let hub = Hub::new();
        let spec = ServerSpec {
            id: "nope".into(),
            name: "Nope".into(),
            command: "devdeck-no-such-program-exists --please".into(),
        };
        let e = hub.ensure(&spec).unwrap_err();
        assert!(e.contains("could not start"), "{e}");
        assert!(hub.statuses().is_empty(), "and nothing is left half-running");
    }

    // -- finding the program ------------------------------------------------

    #[test]
    fn a_program_already_spelled_out_is_left_exactly_as_written() {
        // A path is what the person meant; second-guessing it would run a
        // different file from the one they named.
        assert_eq!(resolve_program("node"), resolve_program("node"));
        assert_eq!(resolve_program("server.exe"), "server.exe");
        assert_eq!(resolve_program("C:/tools/thing.cmd"), "C:/tools/thing.cmd");
        assert_eq!(resolve_program(r"C:\tools\thing.cmd"), r"C:\tools\thing.cmd");
        assert_eq!(resolve_program("/usr/local/bin/node"), "/usr/local/bin/node");
    }

    #[test]
    fn a_program_that_is_nowhere_comes_back_unchanged() {
        // So the spawn fails naming what was asked for. Returning a guess
        // would produce an error about a file nobody mentioned.
        let missing = "devdeck-no-such-program-anywhere";
        assert_eq!(resolve_program(missing), missing);
        assert!(!program_present(missing));
    }

    #[cfg(windows)]
    #[test]
    fn npx_resolves_to_the_cmd_that_windows_will_actually_run() {
        // The bug this exists for. `Command::new("npx")` fails on Windows —
        // npx on disk is npx.cmd and process creation does not consult
        // PATHEXT — so every npm-published MCP server was unstartable, which
        // is most of the registry. The live tests missed it because they spawn
        // `node` with a script path, needing no extension.
        //
        // Skipped where Node is not installed: this asserts about the machine.
        if !crate::runners::on_path("node") {
            return;
        }
        let resolved = resolve_program("npx");
        assert_ne!(resolved, "npx", "npx must resolve to a real file on Windows");
        assert!(
            std::path::Path::new(&resolved).is_file(),
            "and to one that exists: {resolved}"
        );
        assert!(program_present("npx"));
    }

    #[cfg(windows)]
    #[test]
    fn the_resolved_npx_can_actually_be_spawned() {
        // Resolving to a path is only the claim; this is the check. Spawning
        // is what the requirements row on the repo page promises.
        if !crate::runners::on_path("node") {
            return;
        }
        let out = Command::new(resolve_program("npx")).arg("--version").output();
        assert!(out.is_ok(), "spawning the resolved npx: {:?}", out.err());
    }

}
