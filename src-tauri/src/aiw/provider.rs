//! LLM providers.
//!
//! The whole point of this file is that nothing outside it knows which model is
//! answering. A provider receives an `AgentRequest` — assembled context, a
//! goal, the tools it is allowed to ask for — and returns an `AgentResponse`
//! containing *requests to act*, never actions themselves. The runtime decides
//! whether to honour them and `ToolService` decides whether they are permitted.
//!
//! That asymmetry is deliberate: a provider is untrusted. It proposes; DevDeck
//! disposes. Swapping `MockProvider` for a real model therefore cannot widen
//! what an agent is able to do.

use serde::{Deserialize, Serialize};

use super::tools::{ToolCall, ToolDefinition};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProviderHealth {
    pub ok: bool,
    pub detail: String,
    /// False when the provider needs a key it hasn't got. Reported honestly —
    /// an unconfigured provider must never look like a working one.
    pub configured: bool,
}

/// What the runtime asks a provider to do.
/// The result of one tool call, as the next turn sees it.
#[derive(Clone, Debug, Default)]
pub struct Observation {
    /// The provider's id for the call this answers. Empty for the mock, which
    /// has no wire protocol to correlate with.
    pub call_id: String,
    pub tool: String,
    pub action: String,
    pub ok: bool,
    pub output: String,
}

impl Observation {
    pub fn text(&self) -> String {
        if self.ok {
            self.output.clone()
        } else {
            format!("ERROR: {}", self.output)
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct AgentRequest {
    pub agent_id: String,
    pub role: String,
    pub model: String,
    pub system: String,
    /// The assembled, already-narrowed context.
    pub context: String,
    /// The immediate objective (usually the work item title).
    pub goal: String,
    /// The callables this agent may use, with their schemas.
    ///
    /// A list of names was enough for a scripted mock and is useless to a real
    /// model, which cannot emit a valid call without a parameter schema. These
    /// are already filtered by permission, so a read-only agent is never
    /// offered a write it would be refused.
    pub tools: Vec<ToolDefinition>,
    /// Results of the tool calls made so far, fed back in.
    ///
    /// These carry the call they answer. A bare list of strings was enough for
    /// a scripted mock and loses the link a real model needs: without the id it
    /// cannot tell which result belongs to which call, and a turn with several
    /// tool calls becomes guesswork.
    pub observations: Vec<Observation>,
    /// Which turn of the loop this is, from 0.
    pub turn: u32,
}

/// A step the provider wants taken.
#[derive(Clone, Debug)]
pub enum AgentAction {
    /// Run a tool.
    Tool(ToolCall),
    /// Record a decision in `.devdeck`.
    Decision {
        id: String,
        title: String,
        body: String,
        impacts: Vec<String>,
        supersedes: Option<String>,
    },
    /// Rewrite the feature's context body.
    UpdateContext { body: String },
    /// Declare that a named interface/symbol changed — what makes other agents
    /// stale. Separate from a file write because the semantic fact is what
    /// matters, not the bytes.
    SymbolChanged { symbol: String },
    /// Nothing further; the turn is done.
    Done { summary: String },
}

#[derive(Clone, Debug, Default)]
pub struct AgentResponse {
    /// Free-text reasoning, surfaced in the session transcript.
    pub message: String,
    pub actions: Vec<AgentAction>,
    /// True when the provider considers the work finished.
    pub complete: bool,
}

/// Everything a model provider must offer.
///
/// `run` is one turn, not one session: the runtime owns the loop so that tool
/// results, context changes and checkpoints are handled identically no matter
/// who is answering.
pub trait LLMProvider: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn list_models(&self) -> Vec<ModelInfo>;
    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String>;
    fn health(&self) -> ProviderHealth;
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

/// Deterministic scripted agents.
///
/// This is not a shortcut around the architecture — it is a provider like any
/// other, and the mock agents reach the filesystem, git and processes through
/// exactly the same runtime, tool service and event bus a real model will. If
/// the mock can do something the real one couldn't, the seam is in the wrong
/// place.
pub struct MockProvider;

impl MockProvider {
    pub const ID: &'static str = "mock";

    /// The script for one role, turn by turn. Returning `Done` ends the loop.
    fn script(role: &str, req: &AgentRequest) -> AgentResponse {
        match role {
            "architect" => Self::architect(req),
            "developer" => Self::developer(req),
            "qa" => Self::qa(req),
            "reviewer" => Self::reviewer(req),
            _ => AgentResponse {
                message: format!("No script for role '{role}'."),
                actions: vec![AgentAction::Done {
                    summary: "nothing to do".into(),
                }],
                complete: true,
            },
        }
    }

    fn architect(req: &AgentRequest) -> AgentResponse {
        match req.turn {
            0 => AgentResponse {
                message: "Reading the feature context before deciding anything.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    super::tools::TOOL_KNOWLEDGE,
                    "search",
                    serde_json::json!({ "query": "sync" }),
                ))],
                complete: false,
            },
            1 => AgentResponse {
                message: "Offline sites have unreliable clocks, so the server must decide.".into(),
                actions: vec![AgentAction::Decision {
                    id: "adr-server-authoritative".into(),
                    title: "Server-authoritative conflict resolution".into(),
                    body: "Offline sites may have unreliable clocks, so the server decides the \
                           winner rather than trusting a client timestamp."
                        .into(),
                    impacts: vec![
                        "Sync engine".into(),
                        "API reconciliation".into(),
                        "Mobile UI".into(),
                    ],
                    supersedes: None,
                }],
                complete: false,
            },
            _ => AgentResponse {
                message: "Decision recorded and context updated.".into(),
                actions: vec![
                    AgentAction::UpdateContext {
                        body: "## Goal\n\nKeep each site working without connectivity.\n\n\
                               ## Current state\n\n- Local queue implemented.\n\
                               - Push sync implemented.\n- Pull sync incomplete.\n\
                               - Conflict resolution in progress.\n\n\
                               ## Rules\n\n- The server is authoritative on conflict.\n\
                               - Never trust a client timestamp for ordering.\n"
                            .into(),
                    },
                    AgentAction::Done {
                        summary: "Defined the sync architecture; recorded ADR.".into(),
                    },
                ],
                complete: true,
            },
        }
    }

    fn developer(req: &AgentRequest) -> AgentResponse {
        // Developer A owns the shared interface; Developer B owns the UI. The
        // agent id decides which, so the two run the same code path.
        let owns_interface = req.agent_id.contains("-a") || req.agent_id == "claude";
        match (req.turn, owns_interface) {
            (0, _) => AgentResponse {
                message: "Checking what is already here.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    super::tools::TOOL_GIT,
                    "status",
                    serde_json::json!({}),
                ))],
                complete: false,
            },
            (1, true) => AgentResponse {
                message: "Changing SyncResult so a conflict can be represented.".into(),
                actions: vec![
                    AgentAction::Tool(ToolCall::new(
                        super::tools::TOOL_FILES,
                        "write",
                        serde_json::json!({
                            "path": "packages/sync/types.ts",
                            "content": "// Server-authoritative outcome, per ADR.\n\
                                        export type SyncResult = {\n\
                                        \x20 outcome: 'applied' | 'rejected' | 'deferred'\n\
                                        }\n"
                        }),
                    )),
                    AgentAction::SymbolChanged {
                        symbol: "SyncResult".into(),
                    },
                ],
                complete: false,
            },
            (1, false) => AgentResponse {
                message: "Building the sync status badge against SyncResult.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    super::tools::TOOL_FILES,
                    "write",
                    serde_json::json!({
                        "path": "apps/mobile/SyncBadge.tsx",
                        "content": "// Reads SyncResult.ok — assumes the old shape.\n\
                                    export const SyncBadge = () => null\n"
                    }),
                ))],
                complete: false,
            },
            _ => AgentResponse {
                message: "Work complete for this turn.".into(),
                actions: vec![AgentAction::Done {
                    summary: if owns_interface {
                        "Implemented conflict resolution; SyncResult now carries an outcome.".into()
                    } else {
                        "Built the sync status UI.".into()
                    },
                }],
                complete: true,
            },
        }
    }

    fn qa(req: &AgentRequest) -> AgentResponse {
        match req.turn {
            0 => AgentResponse {
                message: "Starting the application before testing it.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    super::tools::TOOL_PROCESS,
                    "start",
                    serde_json::json!({}),
                ))],
                complete: false,
            },
            1 => AgentResponse {
                message: "Running the configured test command.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    super::tools::TOOL_TESTS,
                    "run",
                    serde_json::json!({}),
                ))],
                complete: false,
            },
            _ => AgentResponse {
                message: "Recording the result.".into(),
                actions: vec![AgentAction::Done {
                    summary: format!(
                        "Ran the suite. {}",
                        req.observations
                            .last()
                            .map(|o| o.text())
                            .unwrap_or_default()
                    ),
                }],
                complete: true,
            },
        }
    }

    fn reviewer(req: &AgentRequest) -> AgentResponse {
        match req.turn {
            0 => AgentResponse {
                message: "Comparing the implementation against the recorded decisions.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    super::tools::TOOL_FILES,
                    "read",
                    serde_json::json!({ "path": "packages/sync/types.ts" }),
                ))],
                complete: false,
            },
            _ => {
                let saw_outcome = req
                    .observations
                    .iter()
                    .any(|o| o.text().contains("outcome"));
                AgentResponse {
                    message: if saw_outcome {
                        "Implementation matches the server-authoritative decision.".into()
                    } else {
                        "Implementation does not yet reflect the recorded decision.".into()
                    },
                    actions: vec![AgentAction::Done {
                        summary: if saw_outcome {
                            "Reviewed: consistent with ADR.".into()
                        } else {
                            "Reviewed: inconsistent with ADR.".into()
                        },
                    }],
                    complete: true,
                }
            }
        }
    }
}

impl LLMProvider for MockProvider {
    fn id(&self) -> &str {
        Self::ID
    }
    fn name(&self) -> &str {
        "Mock (deterministic)"
    }
    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock-1".into(),
            name: "Deterministic script".into(),
            context_window: Some(12_000),
        }]
    }
    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String> {
        // A provider that ignores the context it was handed is indistinguishable
        // from one that never received it. The mock reads the same fields a real
        // model would, so a bug in context assembly shows up here too.
        if request.context.is_empty() && request.turn == 0 {
            return Err(format!(
                "{} was started with no context for '{}'",
                request.agent_id, request.goal
            ));
        }
        let mut response = Self::script(&request.role, request);
        if request.turn == 0 {
            response.message = format!(
                "[{} · {}] {} ({} tools, {} chars of context)",
                request.model,
                request.system.split('.').next().unwrap_or("agent").trim(),
                response.message,
                request.tools.len(),
                request.context.len(),
            );
        }
        Ok(response)
    }
    fn health(&self) -> ProviderHealth {
        ProviderHealth {
            ok: true,
            detail: "Deterministic mock; no network, no key required.".into(),
            configured: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Wire translation
// ---------------------------------------------------------------------------
//
// The two shapes every provider needs: tool definitions going out, and tool
// calls coming back. Kept here, beside the providers, because it is the only
// place that should know what a model's JSON looks like — nothing below the
// provider layer has an opinion about wire formats.
//
// Neither adapter's transport is implemented yet, but these are: the mapping is
// the part with the design decisions in it, and it is testable without a
// network. They are therefore reachable only from tests until a transport
// calls them, which is what the allows below are for -- not dead code, code
// whose caller is the next commit.

/// Anthropic's `tools` array: `{name, description, input_schema}`.
#[allow(dead_code)]
pub fn to_anthropic_tools(tools: &[ToolDefinition]) -> serde_json::Value {
    serde_json::Value::Array(
        tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                })
            })
            .collect(),
    )
}

/// OpenAI's `tools` array: `{type: "function", function: {name, description, parameters}}`.
///
/// The same schema under a different key, which is exactly why this belongs in
/// one function rather than being written twice.
#[allow(dead_code)]
pub fn to_openai_tools(tools: &[ToolDefinition]) -> serde_json::Value {
    serde_json::Value::Array(
        tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect(),
    )
}

/// A tool call a model asked for, before it has been validated or permitted.
#[derive(Clone, Debug, PartialEq)]
#[allow(dead_code)]
pub struct RawToolCall {
    /// Provider's id for the call, echoed back with the result.
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Read tool calls out of an Anthropic `content` array.
///
/// Text blocks become the message; `tool_use` blocks become calls. A response
/// with neither is not an error — it is a model that had nothing to do.
#[allow(dead_code)]
pub fn from_anthropic_response(body: &serde_json::Value) -> (String, Vec<RawToolCall>) {
    let mut text = String::new();
    let mut calls = Vec::new();
    let Some(content) = body.get("content").and_then(|c| c.as_array()) else {
        return (text, calls);
    };
    for block in content {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(t);
                }
            }
            Some("tool_use") => calls.push(RawToolCall {
                id: block
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or_default()
                    .to_string(),
                name: block
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string(),
                input: block.get("input").cloned().unwrap_or(serde_json::json!({})),
            }),
            _ => {}
        }
    }
    (text, calls)
}

/// Read tool calls out of an OpenAI chat completion.
///
/// `arguments` is a JSON *string*, not an object — a detail that silently
/// produces empty arguments if you treat it as one.
#[allow(dead_code)]
pub fn from_openai_response(body: &serde_json::Value) -> (String, Vec<RawToolCall>) {
    let mut calls = Vec::new();
    let Some(message) = body
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
    else {
        return (String::new(), calls);
    };
    let text = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();

    if let Some(list) = message.get("tool_calls").and_then(|t| t.as_array()) {
        for c in list {
            let f = c.get("function");
            let args = f
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .and_then(|a| serde_json::from_str::<serde_json::Value>(a).ok())
                .unwrap_or(serde_json::json!({}));
            calls.push(RawToolCall {
                id: c
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or_default()
                    .to_string(),
                name: f
                    .and_then(|f| f.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string(),
                input: args,
            });
        }
    }
    (text, calls)
}

/// Turn raw calls into actions the runtime can execute.
///
/// A call that does not parse becomes an `Err` carrying a message meant for the
/// model, not the log: it is fed back as the tool result so the model can
/// correct itself, which is the whole reason the error text is specific.
#[allow(dead_code)]
pub fn to_actions(calls: &[RawToolCall]) -> Vec<Result<AgentAction, (String, String)>> {
    calls
        .iter()
        .map(|c| match super::tools::parse_tool_call(&c.name, &c.input) {
            Ok(call) => Ok(AgentAction::Tool(call)),
            Err(e) => Err((c.id.clone(), e)),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Real providers
// ---------------------------------------------------------------------------

/// Cap a provider's error body so a huge HTML error page doesn't fill the UI.
fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

/// Where a provider's key lives in Windows Credential Manager.
///
/// `creds.rs` is the only place a secret exists in this codebase, so these
/// configs hold the *target* to look one up by rather than the key itself. No
/// struct that reaches SQLite, a log line or the frontend can then carry a key
/// even by accident; it is fetched at call time and dropped straight after.
pub fn key_target(provider_id: &str) -> String {
    format!("devdeck:aiw:{provider_id}")
}

#[derive(Clone, Debug, Default)]
pub struct AnthropicConfig {
    /// Credential Manager target, not the key.
    pub key_target: String,
    pub model: String,
}

impl AnthropicConfig {
    fn api_key(&self) -> Option<String> {
        crate::creds::get(&self.key_target)
    }
}

/// Anthropic adapter.
///
/// The request/response mapping is here and nowhere else. It reports itself as
/// unconfigured without a key rather than failing at the first call — an
/// unconfigured provider that looks healthy is the failure mode that wastes an
/// afternoon.
pub struct AnthropicProvider {
    pub config: AnthropicConfig,
}

impl AnthropicProvider {
    pub const ID: &'static str = "anthropic";
    pub fn new(config: AnthropicConfig) -> Self {
        Self { config }
    }
}

impl LLMProvider for AnthropicProvider {
    fn id(&self) -> &str {
        Self::ID
    }
    fn name(&self) -> &str {
        "Anthropic"
    }
    fn list_models(&self) -> Vec<ModelInfo> {
        vec![
            ModelInfo {
                id: "claude-opus-4-5".into(),
                name: "Claude Opus 4.5".into(),
                context_window: Some(200_000),
            },
            ModelInfo {
                id: "claude-sonnet-4-5".into(),
                name: "Claude Sonnet 4.5".into(),
                context_window: Some(200_000),
            },
        ]
    }
    fn run(&self, _request: &AgentRequest) -> Result<AgentResponse, String> {
        if self.config.api_key().is_none() {
            return Err("Anthropic provider has no API key configured".into());
        }
        // Deliberately not implemented in this slice. It returns an explicit
        // error rather than a plausible-looking empty response, so a
        // half-configured provider can never be mistaken for a working one.
        Err("Anthropic transport not implemented in this build — use the Mock provider".into())
    }
    fn health(&self) -> ProviderHealth {
        let configured = crate::creds::exists(&self.config.key_target);
        ProviderHealth {
            ok: false,
            configured,
            detail: if configured {
                format!(
                    "Key present for '{}'; transport not implemented in this build.",
                    if self.config.model.is_empty() {
                        "(no model set)"
                    } else {
                        &self.config.model
                    }
                )
            } else {
                "No API key configured.".into()
            },
        }
    }
}

/// Anything speaking the OpenAI chat-completions shape: OpenRouter, NVIDIA's
/// hosted endpoints, llama.cpp, vLLM, LM Studio, a corporate gateway.
///
/// Everything that differs between them is configuration, not code — which is
/// the property that makes "add a provider" a settings change.
#[derive(Clone, Debug, Default)]
pub struct OpenAICompatibleConfig {
    pub name: String,
    pub base_url: String,
    /// Credential Manager target, not the key. See `key_target`.
    pub key_target: String,
    pub model: String,
    pub headers: Vec<(String, String)>,
    pub timeout_secs: Option<u64>,
}

impl OpenAICompatibleConfig {
    fn api_key(&self) -> Option<String> {
        crate::creds::get(&self.key_target)
    }

    /// `{base_url}/chat/completions`, tolerating a trailing slash.
    pub fn endpoint(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }
}

pub struct OpenAICompatibleProvider {
    pub config: OpenAICompatibleConfig,
}

impl OpenAICompatibleProvider {
    pub const ID: &'static str = "openai-compatible";
    pub fn new(config: OpenAICompatibleConfig) -> Self {
        Self { config }
    }

    /// The chat messages for one turn.
    ///
    /// Assembled context is a *system* message, not a user one: it is standing
    /// instruction rather than a request, and models weight the two
    /// differently. Tool results come back as `tool` messages carrying the id
    /// of the call they answer — which is what the structured observations are
    /// for.
    pub fn messages(&self, request: &AgentRequest) -> serde_json::Value {
        let mut msgs = vec![
            serde_json::json!({
                "role": "system",
                "content": format!(
                    "{}\n\n# Context\n\n{}",
                    request.system.trim(),
                    request.context.trim()
                ),
            }),
            serde_json::json!({
                "role": "user",
                "content": format!("Your task: {}", request.goal),
            }),
        ];

        for o in &request.observations {
            if o.call_id.is_empty() {
                // No id to correlate with, so it can only be narration.
                msgs.push(serde_json::json!({
                    "role": "user",
                    "content": format!("Result of {}.{}: {}", o.tool, o.action, o.text()),
                }));
            } else {
                msgs.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": o.call_id,
                    "content": o.text(),
                }));
            }
        }

        serde_json::Value::Array(msgs)
    }

    /// POST a body and return the response text, or a message worth showing.
    fn post(&self, body: &serde_json::Value) -> Result<String, String> {
        let timeout = std::time::Duration::from_secs(self.config.timeout_secs.unwrap_or(120));
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| format!("could not build an HTTP client: {e}"))?;

        let mut req = client
            .post(self.config.endpoint())
            .header("content-type", "application/json");
        // Custom headers first: some gateways authenticate by header, and a
        // bearer token should only be added on top of whatever they need.
        for (k, v) in &self.config.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(key) = self.config.api_key() {
            req = req.bearer_auth(key);
        }

        let response = req
            .json(body)
            .send()
            .map_err(|e| format!("{}: {e}", self.config.endpoint()))?;

        let status = response.status();
        let text = response
            .text()
            .map_err(|e| format!("could not read the response body: {e}"))?;

        if !status.is_success() {
            // The provider's own message says far more than a status code
            // ("model not found", "insufficient quota"), so it is surfaced
            // rather than swallowed.
            return Err(format!(
                "{} returned {status}: {}",
                self.name(),
                truncate(&text, 400)
            ));
        }
        Ok(text)
    }

    /// A cheap round trip to prove the endpoint, key and model all work.
    /// This is what the Test button in the UI calls.
    pub fn probe(&self) -> Result<String, String> {
        let body = serde_json::json!({
            "model": self.config.model,
            "messages": [{ "role": "user", "content": "Reply with the single word: ready" }],
            "max_tokens": 16,
        });
        let text = self.post(&body)?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("{} returned invalid JSON: {e}", self.name()))?;
        let (reply, _) = from_openai_response(&json);
        Ok(if reply.trim().is_empty() {
            format!("{} answered.", self.config.model)
        } else {
            format!(
                "{} answered: {}",
                self.config.model,
                truncate(reply.trim(), 120)
            )
        })
    }
}

impl LLMProvider for OpenAICompatibleProvider {
    fn id(&self) -> &str {
        Self::ID
    }
    fn name(&self) -> &str {
        if self.config.name.is_empty() {
            "OpenAI-compatible"
        } else {
            &self.config.name
        }
    }
    fn list_models(&self) -> Vec<ModelInfo> {
        if self.config.model.is_empty() {
            vec![]
        } else {
            vec![ModelInfo {
                id: self.config.model.clone(),
                name: self.config.model.clone(),
                context_window: None,
            }]
        }
    }
    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String> {
        if self.config.base_url.is_empty() {
            return Err("OpenAI-compatible provider has no base URL configured".into());
        }
        if self.config.model.is_empty() {
            return Err("OpenAI-compatible provider has no model configured".into());
        }

        let body = serde_json::json!({
            "model": self.config.model,
            "messages": self.messages(request),
            "tools": to_openai_tools(&request.tools),
            "tool_choice": "auto",
        });

        let text = self.post(&body)?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("{} returned invalid JSON: {e}", self.name()))?;

        let (message, calls) = from_openai_response(&json);
        let mut actions = Vec::new();
        let mut rejected = Vec::new();
        for outcome in to_actions(&calls) {
            match outcome {
                Ok(a) => actions.push(a),
                // A call that does not parse is fed back as text so the model
                // can correct itself, rather than failing the whole turn.
                Err((id, why)) => rejected.push(format!("tool call {id} was rejected: {why}")),
            }
        }

        // Nothing to run and nothing rejected means the model is finished.
        let complete = actions.is_empty() && rejected.is_empty();
        if complete && !message.trim().is_empty() {
            actions.push(AgentAction::Done {
                summary: message.clone(),
            });
        }

        Ok(AgentResponse {
            message: if rejected.is_empty() {
                message
            } else {
                format!("{message}\n{}", rejected.join("\n"))
            },
            actions,
            complete,
        })
    }
    fn health(&self) -> ProviderHealth {
        // A key is optional here: local servers and some gateways take none.
        let configured = !self.config.base_url.is_empty() && !self.config.model.is_empty();
        ProviderHealth {
            // Configured is as much as can be claimed without a round trip.
            // "Test" in the UI is what actually proves it.
            ok: configured,
            configured,
            detail: if configured {
                format!(
                    "{} at {} — {}",
                    self.config.model,
                    self.config.base_url,
                    if self.config.api_key().is_some() {
                        "key saved"
                    } else {
                        "no key (fine for a local server)"
                    }
                )
            } else {
                "Base URL and model are required.".into()
            },
        }
    }
}

/// Holds the providers this install knows about.
pub struct ProviderRegistry {
    providers: Vec<Box<dyn LLMProvider>>,
    /// A typed copy of the OpenAI-compatible provider's config, so a probe can
    /// be run without downcasting a trait object.
    openai: Option<OpenAICompatibleConfig>,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderRegistry {
    /// Mock is always present — that is what makes the product work with no
    /// key at all.
    pub fn new() -> Self {
        Self {
            providers: vec![Box::new(MockProvider)],
            openai: None,
        }
    }

    pub fn register(&mut self, p: Box<dyn LLMProvider>) {
        self.providers.retain(|e| e.id() != p.id());
        self.providers.push(p);
    }

    /// Remember the OpenAI-compatible config alongside the trait object.
    pub fn register_openai(&mut self, config: OpenAICompatibleConfig) {
        self.openai = Some(config.clone());
        self.register(Box::new(OpenAICompatibleProvider::new(config)));
    }

    pub fn openai_compatible(&self) -> Option<OpenAICompatibleProvider> {
        self.openai.clone().map(OpenAICompatibleProvider::new)
    }

    pub fn get(&self, id: &str) -> Option<&dyn LLMProvider> {
        self.providers.iter().find(|p| p.id() == id).map(|b| &**b)
    }

    pub fn list(&self) -> Vec<(String, String, ProviderHealth)> {
        self.providers
            .iter()
            .map(|p| (p.id().to_string(), p.name().to_string(), p.health()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(role: &str, agent: &str, turn: u32) -> AgentRequest {
        AgentRequest {
            agent_id: agent.into(),
            role: role.into(),
            model: "mock-1".into(),
            // A real request always carries assembled context; the provider
            // refuses one that doesn't, so the fixture must be realistic.
            system: "You are a test agent.".into(),
            context: "## Feature context

Offline sync."
                .into(),
            goal: "do the thing".into(),
            tools: crate::aiw::tools::definitions_for("dev", &{
                let mut m = crate::aiw::tools::PermissionMatrix::default();
                m.set(
                    "dev",
                    crate::aiw::tools::TOOL_FILES,
                    crate::aiw::tools::Permission::Full,
                );
                m
            }),
            turn,
            ..Default::default()
        }
    }

    #[test]
    fn the_mock_needs_no_key_and_says_so() {
        let h = MockProvider.health();
        assert!(h.ok && h.configured);
    }

    #[test]
    fn the_architect_records_a_decision_then_finishes() {
        let a = MockProvider.run(&req("architect", "architect", 1)).unwrap();
        assert!(
            a.actions
                .iter()
                .any(|x| matches!(x, AgentAction::Decision { .. })),
            "turn 1 should record a decision"
        );
        let b = MockProvider.run(&req("architect", "architect", 2)).unwrap();
        assert!(b.complete, "the architect must terminate");
    }

    #[test]
    fn developer_a_changes_the_shared_symbol_and_developer_b_does_not() {
        let a = MockProvider.run(&req("developer", "dev-a", 1)).unwrap();
        assert!(
            a.actions
                .iter()
                .any(|x| matches!(x, AgentAction::SymbolChanged { .. })),
            "developer A owns the interface change"
        );

        let b = MockProvider.run(&req("developer", "dev-b", 1)).unwrap();
        assert!(
            !b.actions
                .iter()
                .any(|x| matches!(x, AgentAction::SymbolChanged { .. })),
            "developer B must not also claim the interface change"
        );
    }

    #[test]
    fn every_role_terminates_rather_than_looping_forever() {
        for role in ["architect", "developer", "qa", "reviewer", "unknown-role"] {
            let mut done = false;
            for turn in 0..8 {
                if MockProvider.run(&req(role, "a", turn)).unwrap().complete {
                    done = true;
                    break;
                }
            }
            assert!(done, "role '{role}' never completed");
        }
    }

    #[test]
    fn an_unconfigured_real_provider_reports_unhealthy_not_ready() {
        let a = AnthropicProvider::new(AnthropicConfig::default());
        let h = a.health();
        assert!(!h.ok && !h.configured, "no key must not look configured");
        assert!(a.run(&req("developer", "x", 0)).is_err());

        // Anthropic's transport is still unimplemented, so it reports not-ok
        // even with a key. OpenAI-compatible now has one, so a configured
        // instance reports ok — meaning "pointed somewhere plausible", which is
        // as much as can be claimed without a round trip. Proving it is what
        // the Test button does.
        let o = OpenAICompatibleProvider::new(OpenAICompatibleConfig {
            name: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            model: "some/model".into(),
            ..Default::default()
        });
        assert!(o.health().configured);
        assert!(o.health().ok);

        let unset = OpenAICompatibleProvider::new(OpenAICompatibleConfig::default());
        assert!(
            !unset.health().configured,
            "no base URL or model is not configured"
        );
        assert!(!unset.health().ok);
    }

    #[test]
    fn the_registry_always_has_mock_and_can_be_extended() {
        let mut r = ProviderRegistry::new();
        assert!(r.get(MockProvider::ID).is_some());
        r.register(Box::new(OpenAICompatibleProvider::new(
            OpenAICompatibleConfig {
                name: "NVIDIA".into(),
                base_url: "https://integrate.api.nvidia.com/v1".into(),
                model: "meta/llama-3.1-70b-instruct".into(),
                ..Default::default()
            },
        )));
        assert_eq!(r.list().len(), 2);
        assert_eq!(
            r.get(OpenAICompatibleProvider::ID).unwrap().name(),
            "NVIDIA"
        );
    }
}

#[cfg(test)]
mod wire_tests {
    use super::*;
    use crate::aiw::tools::{definitions_for, Permission, PermissionMatrix};

    fn full(agent: &str) -> PermissionMatrix {
        let mut m = PermissionMatrix::default();
        for t in crate::aiw::tools::registry() {
            m.set(agent, &t.id, Permission::Full);
        }
        m
    }

    #[test]
    fn anthropic_and_openai_carry_the_same_schema_under_different_keys() {
        let defs = definitions_for("dev", &full("dev"));
        assert!(!defs.is_empty());

        let a = to_anthropic_tools(&defs);
        let o = to_openai_tools(&defs);
        let (a, o) = (a.as_array().unwrap(), o.as_array().unwrap());
        assert_eq!(a.len(), defs.len());
        assert_eq!(o.len(), defs.len());

        for (i, d) in defs.iter().enumerate() {
            assert_eq!(a[i]["name"], d.name);
            assert_eq!(a[i]["input_schema"], d.input_schema);

            assert_eq!(o[i]["type"], "function");
            assert_eq!(o[i]["function"]["name"], d.name);
            // Same schema, different key — the reason this lives in one place.
            assert_eq!(o[i]["function"]["parameters"], d.input_schema);
        }
    }

    #[test]
    fn an_anthropic_response_yields_its_text_and_its_tool_calls() {
        let body = serde_json::json!({
            "content": [
                { "type": "text", "text": "I'll read the sync types first." },
                { "type": "tool_use", "id": "toolu_01",
                  "name": "files_read",
                  "input": { "path": "packages/sync/types.ts" } }
            ]
        });
        let (text, calls) = from_anthropic_response(&body);
        assert!(text.contains("sync types"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "toolu_01");
        assert_eq!(calls[0].name, "files_read");
        assert_eq!(calls[0].input["path"], "packages/sync/types.ts");
    }

    /// OpenAI sends `arguments` as a JSON *string*. Treating it as an object
    /// silently yields empty arguments and a tool call that does nothing.
    #[test]
    fn openai_arguments_are_a_json_string_and_are_parsed_as_one() {
        let body = serde_json::json!({
            "choices": [{
                "message": {
                    "content": "Reading the file.",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "files_read",
                            "arguments": "{\"path\":\"packages/sync/types.ts\"}"
                        }
                    }]
                }
            }]
        });
        let (text, calls) = from_openai_response(&body);
        assert_eq!(text, "Reading the file.");
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].input["path"], "packages/sync/types.ts",
            "arguments were not parsed out of the JSON string"
        );
    }

    #[test]
    fn a_response_with_no_tool_calls_is_not_an_error() {
        for body in [
            serde_json::json!({ "content": [{ "type": "text", "text": "Nothing to do." }] }),
            serde_json::json!({ "choices": [{ "message": { "content": "Nothing to do." } }] }),
        ] {
            let (_, a) = from_anthropic_response(&body);
            let (_, o) = from_openai_response(&body);
            assert!(a.is_empty() && o.is_empty());
        }
        // And a malformed body yields nothing rather than panicking.
        let junk = serde_json::json!({ "unexpected": true });
        assert!(from_anthropic_response(&junk).1.is_empty());
        assert!(from_openai_response(&junk).1.is_empty());
    }

    #[test]
    fn a_valid_call_becomes_an_action_and_a_bad_one_becomes_feedback() {
        let calls = vec![
            RawToolCall {
                id: "ok".into(),
                name: "files_read".into(),
                input: serde_json::json!({ "path": "a.ts" }),
            },
            RawToolCall {
                id: "bad-args".into(),
                name: "files_read".into(),
                input: serde_json::json!({}),
            },
            RawToolCall {
                id: "bad-name".into(),
                name: "files_delete".into(),
                input: serde_json::json!({}),
            },
        ];
        let out = to_actions(&calls);
        assert!(matches!(out[0], Ok(AgentAction::Tool(_))));

        // Failures carry the provider's call id, so the error can be returned
        // as that call's result and the model can correct itself.
        let (id, msg) = out[1].as_ref().unwrap_err();
        assert_eq!(id, "bad-args");
        assert!(
            msg.contains("missing required argument 'path'"),
            "got: {msg}"
        );

        let (id, msg) = out[2].as_ref().unwrap_err();
        assert_eq!(id, "bad-name");
        assert!(msg.contains("unknown tool"), "got: {msg}");
    }

    #[test]
    fn a_read_only_agent_is_advertised_no_writes_on_either_wire() {
        let mut m = PermissionMatrix::default();
        for t in crate::aiw::tools::registry() {
            m.set("qa", &t.id, Permission::Read);
        }
        let defs = definitions_for("qa", &m);
        let json = to_anthropic_tools(&defs).to_string();
        assert!(
            !json.contains("files_write"),
            "a write reached the wire: {json}"
        );
        assert!(!json.contains("terminal_run"));
        assert!(json.contains("files_read"));
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;

    fn cfg() -> OpenAICompatibleConfig {
        OpenAICompatibleConfig {
            name: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            // A target that will not exist, so no key is found and nothing in
            // these tests can depend on a real credential.
            key_target: key_target("test-openai-none"),
            model: "anthropic/claude-sonnet-4.5".into(),
            headers: vec![("X-Team".into(), "platform".into())],
            timeout_secs: Some(30),
        }
    }

    fn req() -> AgentRequest {
        AgentRequest {
            agent_id: "dev-a".into(),
            role: "developer".into(),
            model: "anthropic/claude-sonnet-4.5".into(),
            system: "You implement work items.".into(),
            context: "## Feature context\n\nOffline sync.".into(),
            goal: "Implement conflict resolution".into(),
            tools: crate::aiw::tools::definitions_for("dev-a", &{
                let mut m = crate::aiw::tools::PermissionMatrix::default();
                for t in crate::aiw::tools::registry() {
                    m.set("dev-a", &t.id, crate::aiw::tools::Permission::Full);
                }
                m
            }),
            observations: vec![],
            turn: 0,
        }
    }

    #[test]
    fn the_endpoint_tolerates_a_trailing_slash() {
        let mut c = cfg();
        assert_eq!(
            c.endpoint(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
        c.base_url = "https://openrouter.ai/api/v1/".into();
        assert_eq!(
            c.endpoint(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
    }

    /// Assembled context belongs in the system message, not a user turn: it is
    /// standing instruction rather than a request, and models weight them
    /// differently.
    #[test]
    fn context_is_a_system_message_and_the_goal_is_the_user_turn() {
        let p = OpenAICompatibleProvider::new(cfg());
        let msgs = p.messages(&req());
        let msgs = msgs.as_array().unwrap();

        assert_eq!(msgs[0]["role"], "system");
        let system = msgs[0]["content"].as_str().unwrap();
        assert!(system.contains("You implement work items"));
        assert!(
            system.contains("Offline sync"),
            "context must be in the system message"
        );

        assert_eq!(msgs[1]["role"], "user");
        assert!(msgs[1]["content"]
            .as_str()
            .unwrap()
            .contains("Implement conflict resolution"));
    }

    /// The reason observations are structured: a result must be linked to the
    /// call it answers, or a turn with several tool calls is guesswork.
    #[test]
    fn a_tool_result_is_returned_against_the_call_it_answers() {
        let p = OpenAICompatibleProvider::new(cfg());
        let mut r = req();
        r.observations = vec![
            Observation {
                call_id: "call_abc".into(),
                tool: "files".into(),
                action: "read".into(),
                ok: true,
                output: "export type SyncResult = {}".into(),
            },
            // No id — the mock's shape. It can only be narration.
            Observation {
                call_id: String::new(),
                tool: "git".into(),
                action: "status".into(),
                ok: false,
                output: "not a repo".into(),
            },
        ];

        let msgs = p.messages(&r);
        let msgs = msgs.as_array().unwrap();
        let tool_msg = msgs.iter().find(|m| m["role"] == "tool").unwrap();
        assert_eq!(tool_msg["tool_call_id"], "call_abc");
        assert!(tool_msg["content"].as_str().unwrap().contains("SyncResult"));

        let narrated = msgs
            .iter()
            .filter(|m| m["role"] == "user")
            .find(|m| m["content"].as_str().unwrap().contains("git.status"))
            .expect("an un-correlated result is narrated instead");
        assert!(
            narrated["content"]
                .as_str()
                .unwrap()
                .contains("ERROR: not a repo"),
            "a failed result must read as a failure"
        );
    }

    #[test]
    fn an_unconfigured_transport_refuses_before_touching_the_network() {
        let mut c = cfg();
        c.base_url.clear();
        let e = OpenAICompatibleProvider::new(c).run(&req()).unwrap_err();
        assert!(e.contains("base URL"), "got: {e}");

        let mut c = cfg();
        c.model.clear();
        let e = OpenAICompatibleProvider::new(c).run(&req()).unwrap_err();
        assert!(e.contains("model"), "got: {e}");
    }

    #[test]
    fn a_configured_provider_reports_what_it_is_pointed_at() {
        let h = OpenAICompatibleProvider::new(cfg()).health();
        assert!(h.configured);
        assert!(h.detail.contains("claude-sonnet-4.5"));
        assert!(h.detail.contains("openrouter.ai"));
        // No key was stored for this target, and it says so rather than
        // implying one is present.
        assert!(h.detail.contains("no key"), "got: {}", h.detail);
    }

    #[test]
    fn the_key_lives_in_credential_manager_not_in_the_config() {
        // The only key-shaped thing on the config is a lookup target. This is
        // the property that keeps secrets out of SQLite, logs and IPC.
        let c = cfg();
        let debug = format!("{c:?}");
        assert!(debug.contains("key_target"));
        assert!(
            !debug.contains("sk-") && !debug.to_lowercase().contains("api_key"),
            "a config must not carry a secret: {debug}"
        );
        assert_eq!(
            key_target("openai-compatible"),
            "devdeck:aiw:openai-compatible"
        );
    }
}
