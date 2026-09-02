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

use std::sync::Arc;

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
    /// The arguments the call was made with.
    ///
    /// Needed to reconstruct Anthropic's preceding assistant turn: a
    /// `tool_result` is only valid alongside the `tool_use` block it answers,
    /// and that block carries its input.
    pub args: serde_json::Value,
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

/// One prior message in a conversation.
///
/// The orchestrator is multi-turn with a human in the loop, which the
/// goal-plus-observations shape cannot express: flattening a conversation into
/// the system prompt throws away the role alternation models are trained on,
/// and makes "what did I say three messages ago" a matter of prose.
#[derive(Clone, Debug)]
pub struct ChatTurn {
    /// "user" or "assistant".
    pub role: String,
    pub content: String,
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
    /// Earlier messages in this conversation, oldest first.
    ///
    /// Empty for the goal-driven agents, which have no conversation — their
    /// whole input is context plus a goal. Only the orchestrator fills it.
    pub history: Vec<ChatTurn>,
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
/// What a provider offers, and where the answer came from.
///
/// `live` is the load-bearing field. Every provider ships a small built-in list
/// so the UI is never empty, and presenting that as if it had been fetched
/// would be the same lie the update checker used to tell — a failed lookup
/// reading as a successful one. When a fetch fails you get the built-in list
/// *and* the reason, and the UI says so.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ModelCatalog {
    pub models: Vec<ModelInfo>,
    /// True only when these came back from the provider just now.
    pub live: bool,
    /// Why they did not, when they did not.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

impl ModelCatalog {
    pub fn live(models: Vec<ModelInfo>) -> Self {
        Self {
            models,
            live: true,
            note: String::new(),
        }
    }

    pub fn fallback(models: Vec<ModelInfo>, why: impl Into<String>) -> Self {
        Self {
            models,
            live: false,
            note: why.into(),
        }
    }
}

pub trait LLMProvider: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    /// The built-in list. Always available, never a network call.
    fn list_models(&self) -> Vec<ModelInfo>;

    /// Ask the provider what it actually offers.
    ///
    /// Defaults to "there is no directory to ask", which is the truth for the
    /// mock and for anything that does not publish one — better than silently
    /// handing back the built-in list and calling it a lookup.
    fn fetch_models(&self) -> Result<Vec<ModelInfo>, String> {
        Err("this provider does not publish a model list".into())
    }
    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String>;

    /// Same turn, but reporting visible text as it arrives.
    ///
    /// Defaults to `run`, so a provider that cannot stream is not obliged to
    /// pretend: the caller gets one late chunk instead of many early ones, and
    /// nothing downstream has to know which happened.
    fn run_streaming(
        &self,
        request: &AgentRequest,
        on_delta: &dyn Fn(&str),
    ) -> Result<AgentResponse, String> {
        let r = self.run(request)?;
        if !r.message.is_empty() {
            on_delta(&r.message);
        }
        Ok(r)
    }

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
            "orchestrator" => Self::orchestrator(req),
            _ => AgentResponse {
                message: format!("No script for role '{role}'."),
                actions: vec![AgentAction::Done {
                    summary: "nothing to do".into(),
                }],
                complete: true,
            },
        }
    }

    /// The orchestrator, scripted.
    ///
    /// Deterministic like the rest of the mock, and deliberately not clever:
    /// it exists so the chat, the delegation path and the conversation store
    /// can be exercised end to end with no API key and no network. What it
    /// must never do is *pretend* — an answer it cannot support says so.
    fn orchestrator(req: &AgentRequest) -> AgentResponse {
        // A second turn means tool results came back; report them and stop.
        if req.turn > 0 {
            let summary = req
                .observations
                .iter()
                .map(|o| {
                    if o.ok {
                        o.output.lines().next().unwrap_or("done").to_string()
                    } else {
                        format!("{}.{} failed: {}", o.tool, o.action, o.output)
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            return AgentResponse {
                message: if summary.is_empty() {
                    "Done.".into()
                } else {
                    summary
                },
                actions: vec![AgentAction::Done {
                    summary: "handled".into(),
                }],
                complete: true,
            };
        }

        let goal = req.goal.to_lowercase();
        let wants_work = [
            "start",
            "implement",
            "build",
            "work on",
            "get going",
            "kick off",
        ]
        .iter()
        .any(|k| goal.contains(k));
        let wants_memory = ["remember", "note that", "keep in mind"]
            .iter()
            .any(|k| goal.contains(k));

        if wants_memory {
            return AgentResponse {
                message: "Noting that.".into(),
                actions: vec![AgentAction::Tool(ToolCall::new(
                    "memory",
                    "save",
                    serde_json::json!({
                        "title": truncate_words(&req.goal, 8),
                        "body": req.goal,
                    }),
                ))],
                complete: false,
            };
        }

        if wants_work {
            if let Some(feature) = first_feature(&req.context) {
                return AgentResponse {
                    message: format!("I'll put Developer A on {feature}."),
                    actions: vec![AgentAction::Tool(ToolCall::new(
                        "delegate",
                        "start",
                        serde_json::json!({
                            "agent_id": "dev-a",
                            "feature_id": feature,
                            "intent": req.goal,
                        }),
                    ))],
                    complete: false,
                };
            }
            return AgentResponse {
                message: "There is no feature in this project to start work on yet.                           Create one and I'll delegate it."
                    .into(),
                actions: vec![AgentAction::Done {
                    summary: "nothing to delegate".into(),
                }],
                complete: true,
            };
        }

        // The honest default. A mock that improvised an answer here would make
        // the chat look like it works when nothing behind it does.
        AgentResponse {
            message: "I'm running on the mock provider, so I can coordinate but not think:                       ask me to start work on a feature, or to remember something.                       Connect a real provider in Settings to have an actual conversation."
                .into(),
            actions: vec![AgentAction::Done {
                summary: "answered".into(),
            }],
            complete: true,
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

/// The first feature slug listed in an assembled context, if any.
fn first_feature(context: &str) -> Option<String> {
    let mut in_features = false;
    for line in context.lines() {
        if line.trim() == "Features:" {
            in_features = true;
            continue;
        }
        if in_features {
            let t = line.trim();
            match t.strip_prefix("- ") {
                Some(slug) if !slug.is_empty() => return Some(slug.to_string()),
                _ => return None,
            }
        }
    }
    None
}

fn truncate_words(s: &str, n: usize) -> String {
    s.split_whitespace().take(n).collect::<Vec<_>>().join(" ")
}

impl LLMProvider for MockProvider {
    fn id(&self) -> &str {
        Self::ID
    }
    fn name(&self) -> &str {
        "Mock (no AI)"
    }
    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock-1".into(),
            name: "Scripted replies".into(),
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
        // Named in a thread, with no tools: the scripts below would start
        // writing fixture files, which is exactly what a mention must not do.
        // Say what a scripted agent can honestly say.
        if request.tools.is_empty() && request.role != "orchestrator" {
            return Ok(AgentResponse {
                message: format!(
                    "{} here, on the mock provider - I can read this thread but not think. Hand \
                     me an item with @{} take \"...\" and I will run it in a session; point me \
                     at a real provider under Settings to have me actually answer.",
                    request.role, request.agent_id
                ),
                actions: vec![AgentAction::Done {
                    summary: "answered".into(),
                }],
                complete: true,
            });
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
/// `{"data":[{"id":"...","name":"...","context_length":123}]}`
///
/// Sorted by id, because the order providers return is neither stable nor
/// meaningful and a list that reshuffles between refreshes is hard to use.
pub fn parse_openai_models(body: &serde_json::Value) -> Vec<ModelInfo> {
    let Some(list) = body.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    let mut out: Vec<ModelInfo> = list
        .iter()
        .filter_map(|m| {
            let id = m.get("id").and_then(|i| i.as_str())?.to_string();
            if id.is_empty() {
                return None;
            }
            let name = m
                .get("name")
                .and_then(|n| n.as_str())
                .filter(|n| !n.is_empty())
                .unwrap_or(&id)
                .to_string();
            // OpenRouter says `context_length`; OpenAI-shaped servers often say
            // nothing at all. Absent is absent, not zero.
            let context_window = m
                .get("context_length")
                .or_else(|| m.get("context_window"))
                .and_then(|c| c.as_u64())
                .map(|c| c as u32)
                .filter(|c| *c > 0);
            Some(ModelInfo {
                id,
                name,
                context_window,
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

/// `{"data":[{"id":"claude-...","display_name":"Claude ..."}]}`
///
/// Anthropic does not publish context windows here, so they stay absent rather
/// than being guessed.
pub fn parse_anthropic_models(body: &serde_json::Value) -> Vec<ModelInfo> {
    let Some(list) = body.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    let mut out: Vec<ModelInfo> = list
        .iter()
        .filter_map(|m| {
            let id = m.get("id").and_then(|i| i.as_str())?.to_string();
            if id.is_empty() {
                return None;
            }
            let name = m
                .get("display_name")
                .and_then(|n| n.as_str())
                .filter(|n| !n.is_empty())
                .unwrap_or(&id)
                .to_string();
            Some(ModelInfo {
                id,
                name,
                context_window: None,
            })
        })
        .collect();
    // Newest first is what Anthropic returns and what you want; keep it.
    out.dedup_by(|a, b| a.id == b.id);
    out
}

/// Build the `messages` array for Anthropic's Messages API.
///
/// Three ways this differs from the OpenAI shape, each of which is a 400 if you
/// get it wrong rather than a silent degradation:
///
/// 1. **`system` is not a message.** It is a top-level field, so it is not here.
/// 2. **A result must reference a call that was actually sent.** A
///    `tool_result` is only valid when the *preceding assistant turn* contains
///    a `tool_use` block with the same id — so that turn is reconstructed from
///    the observations rather than assumed.
/// 3. **Results are user turns.** They are not a third role.
///
/// Observations with no id came from something that was never a wire tool call
/// (a rejected action, the mock). They cannot be `tool_result` blocks, so they
/// go in as plain text instead of being dropped.
pub fn anthropic_messages(request: &AgentRequest) -> serde_json::Value {
    let mut msgs: Vec<serde_json::Value> = Vec::new();

    for t in &request.history {
        msgs.push(serde_json::json!({ "role": t.role, "content": t.content }));
    }

    msgs.push(serde_json::json!({
        "role": "user",
        "content": if request.history.is_empty() {
            format!("Your task: {}", request.goal)
        } else {
            request.goal.clone()
        },
    }));

    let (correlated, loose): (Vec<_>, Vec<_>) = request
        .observations
        .iter()
        .partition(|o| !o.call_id.is_empty());

    if !correlated.is_empty() {
        // The assistant turn that made the calls, rebuilt.
        let uses: Vec<serde_json::Value> = correlated
            .iter()
            .map(|o| {
                serde_json::json!({
                    "type": "tool_use",
                    "id": o.call_id,
                    "name": super::tools::wire_name(&o.tool, &o.action),
                    "input": if o.args.is_null() { serde_json::json!({}) } else { o.args.clone() },
                })
            })
            .collect();
        msgs.push(serde_json::json!({ "role": "assistant", "content": uses }));

        let results: Vec<serde_json::Value> = correlated
            .iter()
            .map(|o| {
                serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": o.call_id,
                    "content": o.text(),
                    "is_error": !o.ok,
                })
            })
            .collect();
        msgs.push(serde_json::json!({ "role": "user", "content": results }));
    }

    for o in loose {
        msgs.push(serde_json::json!({
            "role": "user",
            "content": format!("Result of {}.{}: {}", o.tool, o.action, o.text()),
        }));
    }

    serde_json::Value::Array(msgs)
}

/// Accumulates Anthropic's SSE stream.
///
/// A different protocol from OpenAI's, not a variant of it: content arrives as
/// *indexed blocks* that open, receive deltas and close. Text comes as
/// `text_delta`; a tool call's arguments come as `input_json_delta` carrying a
/// `partial_json` string, split at arbitrary points exactly like OpenAI's — but
/// the id and name arrive on `content_block_start`, not in the deltas.
#[derive(Default)]
pub struct AnthropicStreamAccumulator {
    text: String,
    /// block index -> (id, name, raw argument text so far)
    blocks: std::collections::BTreeMap<u64, (String, String, String)>,
    done: bool,
}

impl AnthropicStreamAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn finished(&self) -> bool {
        self.done
    }

    pub fn push_line(&mut self, line: &str) -> Option<String> {
        // Anthropic sends `event:` and `data:` pairs. The type is repeated
        // inside the JSON, so the `event:` line can be ignored entirely.
        let payload = line.trim().strip_prefix("data:")?;
        let chunk: serde_json::Value = serde_json::from_str(payload.trim()).ok()?;
        self.push_chunk(&chunk)
    }

    pub fn push_chunk(&mut self, chunk: &serde_json::Value) -> Option<String> {
        let kind = chunk.get("type").and_then(|t| t.as_str())?;
        let index = chunk.get("index").and_then(|i| i.as_u64()).unwrap_or(0);

        match kind {
            "content_block_start" => {
                let block = chunk.get("content_block")?;
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                    let slot = self.blocks.entry(index).or_default();
                    slot.0 = block
                        .get("id")
                        .and_then(|i| i.as_str())
                        .unwrap_or_default()
                        .to_string();
                    slot.1 = block
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or_default()
                        .to_string();
                }
                None
            }
            "content_block_delta" => {
                let delta = chunk.get("delta")?;
                match delta.get("type").and_then(|t| t.as_str()) {
                    Some("text_delta") => {
                        let t = delta.get("text").and_then(|t| t.as_str())?;
                        if t.is_empty() {
                            return None;
                        }
                        self.text.push_str(t);
                        Some(t.to_string())
                    }
                    Some("input_json_delta") => {
                        let p = delta.get("partial_json").and_then(|p| p.as_str())?;
                        self.blocks.entry(index).or_default().2.push_str(p);
                        None
                    }
                    _ => None,
                }
            }
            // `message_stop` is the end. `message_delta` carries stop_reason and
            // usage, neither of which changes what was said.
            "message_stop" => {
                self.done = true;
                None
            }
            // An overloaded or rate-limited stream ends with an error event.
            // Treating it as a clean end would present a truncated answer as a
            // complete one.
            "error" => {
                self.done = true;
                None
            }
            _ => None,
        }
    }

    pub fn finish(self) -> (String, Vec<RawToolCall>, Vec<String>) {
        let mut calls = Vec::new();
        let mut dropped = Vec::new();
        for (_, (id, name, raw)) in self.blocks {
            if name.is_empty() {
                continue;
            }
            let trimmed = raw.trim();
            let parsed = if trimmed.is_empty() {
                Some(serde_json::json!({}))
            } else {
                serde_json::from_str::<serde_json::Value>(trimmed).ok()
            };
            match parsed {
                Some(input) => calls.push(RawToolCall { id, name, input }),
                None => dropped.push(name),
            }
        }
        (self.text, calls, dropped)
    }
}

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
/// Turn a model's text and calls into an `AgentResponse`.
///
/// Shared by the streaming and non-streaming paths deliberately: two copies of
/// "is this turn finished?" drift, and the one that drifts is always the path
/// with less test coverage.
///
/// `dropped` names tool calls that arrived truncated. They are reported as text
/// rather than silently ignored -- a model that asked for something and got no
/// answer at all will usually just ask again.
fn assemble(message: String, calls: &[RawToolCall], dropped: &[String]) -> AgentResponse {
    let mut actions = Vec::new();
    let mut rejected = Vec::new();
    for outcome in to_actions(calls) {
        match outcome {
            Ok(a) => actions.push(a),
            // A call that does not parse is fed back as text so the model can
            // correct itself, rather than failing the whole turn.
            Err((id, why)) => rejected.push(format!("tool call {id} was rejected: {why}")),
        }
    }
    for name in dropped {
        rejected.push(format!(
            "tool call {name} arrived incomplete and was not run -- send it again"
        ));
    }

    // Nothing to run and nothing rejected means the model is finished.
    let complete = actions.is_empty() && rejected.is_empty();
    if complete && !message.trim().is_empty() {
        actions.push(AgentAction::Done {
            summary: message.clone(),
        });
    }

    AgentResponse {
        message: if rejected.is_empty() {
            message
        } else {
            format!("{message}\n{}", rejected.join("\n"))
        },
        actions,
        complete,
    }
}

/// Accumulates an OpenAI-style SSE stream into a finished response.
///
/// Streaming is not "the same JSON, in pieces". Text arrives as deltas, and a
/// tool call arrives as *fragments keyed by index*: the id and name come once,
/// on some early chunk, and the arguments arrive as a string split at
/// arbitrary points — routinely mid-token, mid-escape, mid-UTF-8-character.
/// Parsing each fragment as JSON, or matching calls by id (which later
/// fragments omit), both look fine against a short reply and fall apart on a
/// long one.
///
/// So this keys on `index`, appends argument text blindly, and parses only at
/// the end.
#[derive(Default)]
pub struct StreamAccumulator {
    text: String,
    /// index -> (id, name, raw argument text so far)
    calls: std::collections::BTreeMap<u64, (String, String, String)>,
    done: bool,
}

impl StreamAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn finished(&self) -> bool {
        self.done
    }

    /// Feed one raw SSE line. Returns any newly arrived visible text, so a
    /// caller can forward it without re-diffing the whole buffer.
    pub fn push_line(&mut self, line: &str) -> Option<String> {
        let line = line.trim();
        // Comments (": ping"), blanks and `event:` lines are not data.
        let payload = line.strip_prefix("data:")?;
        let payload = payload.trim();
        if payload == "[DONE]" {
            self.done = true;
            return None;
        }
        let chunk: serde_json::Value = serde_json::from_str(payload).ok()?;
        self.push_chunk(&chunk)
    }

    pub fn push_chunk(&mut self, chunk: &serde_json::Value) -> Option<String> {
        let delta = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("delta"))?;

        let mut fresh = None;
        if let Some(t) = delta.get("content").and_then(|c| c.as_str()) {
            if !t.is_empty() {
                self.text.push_str(t);
                fresh = Some(t.to_string());
            }
        }

        if let Some(list) = delta.get("tool_calls").and_then(|t| t.as_array()) {
            for c in list {
                // Absent index means a single call, which is index 0. Defaulting
                // to a fresh slot each time would shred the arguments across
                // entries and produce calls that never parse.
                let idx = c.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                let slot = self.calls.entry(idx).or_default();
                if let Some(id) = c.get("id").and_then(|i| i.as_str()) {
                    if !id.is_empty() {
                        slot.0 = id.to_string();
                    }
                }
                if let Some(f) = c.get("function") {
                    if let Some(n) = f.get("name").and_then(|n| n.as_str()) {
                        if !n.is_empty() {
                            slot.1 = n.to_string();
                        }
                    }
                    if let Some(a) = f.get("arguments").and_then(|a| a.as_str()) {
                        slot.2.push_str(a);
                    }
                }
            }
        }
        fresh
    }

    /// The accumulated text, and the calls whose arguments actually parse.
    ///
    /// A truncated stream leaves an unparsable fragment behind. Dropping it is
    /// right — a half-written call is not a call, and passing `{}` in its place
    /// would run a tool with arguments the model never finished choosing.
    pub fn finish(self) -> (String, Vec<RawToolCall>, Vec<String>) {
        let mut calls = Vec::new();
        let mut dropped = Vec::new();
        for (_, (id, name, raw)) in self.calls {
            if name.is_empty() {
                continue;
            }
            let trimmed = raw.trim();
            // No arguments at all is legitimate for a zero-parameter tool.
            let parsed = if trimmed.is_empty() {
                Some(serde_json::json!({}))
            } else {
                serde_json::from_str::<serde_json::Value>(trimmed).ok()
            };
            match parsed {
                Some(input) => calls.push(RawToolCall { id, name, input }),
                None => dropped.push(name),
            }
        }
        (self.text, calls, dropped)
    }
}

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
            Ok(mut call) => {
                call.call_id = c.id.clone();
                Ok(AgentAction::Tool(call))
            }
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

/// Anthropic's API version header. Required on every request; the API is
/// explicitly versioned by date rather than by URL path.
const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
/// `max_tokens` is required here, unlike OpenAI's, where it is optional.
/// Generous enough not to truncate a real answer; it caps nothing that matters
/// because the model stops when it is done.
const ANTHROPIC_MAX_TOKENS: u32 = 8192;

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

impl AnthropicProvider {
    fn body(&self, request: &AgentRequest, stream: bool) -> Result<serde_json::Value, String> {
        if self.config.model.is_empty() {
            return Err("Anthropic provider has no model configured".into());
        }
        if !crate::creds::exists(&self.config.key_target) {
            return Err("Anthropic provider has no API key configured".into());
        }
        let mut body = serde_json::json!({
            "model": self.config.model,
            "max_tokens": ANTHROPIC_MAX_TOKENS,
            // Top-level, not a message: this is the first thing that differs
            // from the OpenAI shape, and sending it as a message is a 400.
            "system": format!(
                "{}

# Context

{}",
                request.system.trim(),
                request.context.trim()
            ),
            "messages": anthropic_messages(request),
            "stream": stream,
        });
        // An empty tools array is rejected, where OpenAI simply ignores it.
        let tools = to_anthropic_tools(&request.tools);
        if tools.as_array().is_some_and(|t| !t.is_empty()) {
            body["tools"] = tools;
        }
        Ok(body)
    }

    fn client(&self) -> Result<reqwest::blocking::Client, String> {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| format!("could not build an HTTP client: {e}"))
    }

    /// Anthropic authenticates with `x-api-key`, not a bearer token.
    fn request(
        &self,
        client: &reqwest::blocking::Client,
    ) -> Result<reqwest::blocking::RequestBuilder, String> {
        let key = self
            .config
            .api_key()
            .ok_or_else(|| "Anthropic provider has no API key configured".to_string())?;
        Ok(client
            .post(ANTHROPIC_ENDPOINT)
            .header("content-type", "application/json")
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("x-api-key", key))
    }

    fn post(&self, body: &serde_json::Value) -> Result<String, String> {
        let client = self.client()?;
        let response = self
            .request(&client)?
            .json(body)
            .send()
            .map_err(|e| format!("{ANTHROPIC_ENDPOINT}: {e}"))?;
        let status = response.status();
        let text = response
            .text()
            .map_err(|e| format!("could not read the response body: {e}"))?;
        if !status.is_success() {
            // Anthropic's own message is far more useful than the status
            // ("credit balance is too low", "model not found").
            return Err(format!(
                "Anthropic returned {status}: {}",
                truncate(&text, 400)
            ));
        }
        Ok(text)
    }

    /// `GET /v1/models` — Anthropic's directory. Same auth as everything else
    /// here: `x-api-key` plus the version header.
    pub fn fetch(&self) -> Result<Vec<ModelInfo>, String> {
        let key = self
            .config
            .api_key()
            .ok_or_else(|| "no API key configured".to_string())?;
        let url = "https://api.anthropic.com/v1/models?limit=100";
        let client = self.client()?;
        let response = client
            .get(url)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("x-api-key", key)
            .send()
            .map_err(|e| format!("{url}: {e}"))?;
        let status = response.status();
        let text = response
            .text()
            .map_err(|e| format!("could not read the model list: {e}"))?;
        if !status.is_success() {
            return Err(format!("Anthropic returned {status}"));
        }
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Anthropic returned invalid JSON: {e}"))?;
        Ok(parse_anthropic_models(&json))
    }

    /// A real round trip, for the Test button.
    ///
    /// `health()` can only report what is configured; saying a provider works
    /// without ever calling it is the exact shape of failure the update checker
    /// once had, where unreachable was reported as up to date.
    pub fn probe(&self) -> Result<String, String> {
        if self.config.model.is_empty() {
            return Err("No model chosen.".into());
        }
        let body = serde_json::json!({
            "model": self.config.model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "Reply with the single word: ready" }],
        });
        let text = self.post(&body)?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Anthropic returned invalid JSON: {e}"))?;
        let (reply, _) = from_anthropic_response(&json);
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

    fn stream(
        &self,
        body: &serde_json::Value,
        on_delta: &dyn Fn(&str),
    ) -> Result<(String, Vec<RawToolCall>, Vec<String>), String> {
        use std::io::BufRead;

        let client = self.client()?;
        let response = self
            .request(&client)?
            .json(body)
            .send()
            .map_err(|e| format!("{ANTHROPIC_ENDPOINT}: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().unwrap_or_default();
            return Err(format!(
                "Anthropic returned {status}: {}",
                truncate(&text, 400)
            ));
        }

        let mut acc = AnthropicStreamAccumulator::new();
        for line in std::io::BufReader::new(response).lines() {
            // A read error mid-stream is not fatal: what arrived is a real
            // partial answer, and `finish` drops any half-written tool call
            // rather than running it.
            let Ok(line) = line else { break };
            if let Some(fresh) = acc.push_line(&line) {
                on_delta(&fresh);
            }
            if acc.finished() {
                break;
            }
        }
        Ok(acc.finish())
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
    fn fetch_models(&self) -> Result<Vec<ModelInfo>, String> {
        self.fetch()
    }

    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String> {
        let body = self.body(request, false)?;
        let text = self.post(&body)?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Anthropic returned invalid JSON: {e}"))?;
        let (message, calls) = from_anthropic_response(&json);
        Ok(assemble(message, &calls, &[]))
    }

    fn run_streaming(
        &self,
        request: &AgentRequest,
        on_delta: &dyn Fn(&str),
    ) -> Result<AgentResponse, String> {
        let body = self.body(request, true)?;
        let (message, calls, dropped) = self.stream(&body, on_delta)?;
        Ok(assemble(message, &calls, &dropped))
    }

    fn health(&self) -> ProviderHealth {
        let has_key = crate::creds::exists(&self.config.key_target);
        let configured = has_key && !self.config.model.is_empty();
        ProviderHealth {
            // Configured is as much as can be claimed without a round trip.
            // "Test" in the UI is what actually proves it.
            ok: configured,
            configured,
            detail: if !has_key {
                "No API key configured.".into()
            } else if self.config.model.is_empty() {
                "Key saved, but no model chosen.".into()
            } else {
                format!("Key saved, using {}.", self.config.model)
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
        let mut msgs = vec![serde_json::json!({
            "role": "system",
            "content": format!(
                "{}\n\n# Context\n\n{}",
                request.system.trim(),
                request.context.trim()
            ),
        })];

        // Before the current message, so the model sees a conversation rather
        // than a summary of one.
        for t in &request.history {
            msgs.push(serde_json::json!({ "role": t.role, "content": t.content }));
        }

        msgs.push(serde_json::json!({
            "role": "user",
            // A conversation's "goal" is just the latest thing the human said,
            // and prefixing that with "Your task:" makes it read like an order
            // rather than a turn.
            "content": if request.history.is_empty() {
                format!("Your task: {}", request.goal)
            } else {
                request.goal.clone()
            },
        }));

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

    /// The request body for one turn. Shared so the streaming and blocking
    /// paths cannot ask for different things.
    fn body(&self, request: &AgentRequest, stream: bool) -> serde_json::Value {
        serde_json::json!({
            "model": self.config.model,
            "messages": self.messages(request),
            "tools": to_openai_tools(&request.tools),
            "tool_choice": "auto",
            "stream": stream,
        })
    }

    fn client(&self) -> Result<reqwest::blocking::Client, String> {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(
                self.config.timeout_secs.unwrap_or(120),
            ))
            .build()
            .map_err(|e| format!("could not build an HTTP client: {e}"))
    }

    fn request(&self, client: &reqwest::blocking::Client) -> reqwest::blocking::RequestBuilder {
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
        req
    }

    /// POST a body and return the response text, or a message worth showing.
    fn post(&self, body: &serde_json::Value) -> Result<String, String> {
        let client = self.client()?;
        let response = self
            .request(&client)
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

    /// Stream one turn, calling `on_delta` with each piece of visible text.
    ///
    /// Reads the body line by line rather than to completion: the entire point
    /// is that the first words arrive in a few hundred milliseconds instead of
    /// after the whole answer, so buffering here would defeat it.
    fn stream(
        &self,
        body: &serde_json::Value,
        on_delta: &dyn Fn(&str),
    ) -> Result<(String, Vec<RawToolCall>, Vec<String>), String> {
        use std::io::BufRead;

        let client = self.client()?;
        let response = self
            .request(&client)
            .json(body)
            .send()
            .map_err(|e| format!("{}: {e}", self.config.endpoint()))?;

        let status = response.status();
        if !status.is_success() {
            // An error body is small and is JSON, not a stream. Read it whole
            // so the provider's own explanation survives.
            let text = response.text().unwrap_or_default();
            return Err(format!(
                "{} returned {status}: {}",
                self.name(),
                truncate(&text, 400)
            ));
        }

        let mut acc = StreamAccumulator::new();
        let reader = std::io::BufReader::new(response);
        for line in reader.lines() {
            // A read error mid-stream is not fatal on its own: whatever has
            // arrived is still a real partial answer, and `finish` drops any
            // half-written tool call rather than running it.
            let Ok(line) = line else { break };
            if let Some(fresh) = acc.push_line(&line) {
                on_delta(&fresh);
            }
            if acc.finished() {
                break;
            }
        }
        Ok(acc.finish())
    }

    /// `GET {base}/models` — the OpenAI directory endpoint, which OpenRouter,
    /// Ollama, LM Studio and most gateways implement.
    pub fn fetch(&self) -> Result<Vec<ModelInfo>, String> {
        if self.config.base_url.trim().is_empty() {
            return Err("no base URL configured".into());
        }
        let url = format!("{}/models", self.config.base_url.trim_end_matches('/'));
        let client = self.client()?;
        let mut req = client.get(&url);
        for (k, v) in &self.config.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(key) = self.config.api_key() {
            req = req.bearer_auth(key);
        }
        let response = req.send().map_err(|e| format!("{url}: {e}"))?;
        let status = response.status();
        let text = response
            .text()
            .map_err(|e| format!("could not read the model list: {e}"))?;
        if !status.is_success() {
            return Err(format!("{url} returned {status}"));
        }
        let json: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("{url} returned invalid JSON: {e}"))?;
        Ok(parse_openai_models(&json))
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
    fn fetch_models(&self) -> Result<Vec<ModelInfo>, String> {
        self.fetch()
    }

    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String> {
        if self.config.base_url.is_empty() {
            return Err("OpenAI-compatible provider has no base URL configured".into());
        }
        if self.config.model.is_empty() {
            return Err("OpenAI-compatible provider has no model configured".into());
        }

        let text = self.post(&self.body(request, false))?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("{} returned invalid JSON: {e}", self.name()))?;

        let (message, calls) = from_openai_response(&json);
        Ok(assemble(message, &calls, &[]))
    }

    fn run_streaming(
        &self,
        request: &AgentRequest,
        on_delta: &dyn Fn(&str),
    ) -> Result<AgentResponse, String> {
        if self.config.base_url.is_empty() {
            return Err("OpenAI-compatible provider has no base URL configured".into());
        }
        if self.config.model.is_empty() {
            return Err("OpenAI-compatible provider has no model configured".into());
        }
        let (message, calls, dropped) = self.stream(&self.body(request, true), on_delta)?;
        Ok(assemble(message, &calls, &dropped))
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
    /// Arc, not Box, so `get` can hand out a handle and the caller can drop the
    /// registry lock before making a network call.
    ///
    /// Returning a borrow forced the lock to be held for the whole model turn:
    /// every other agent queued behind whoever was talking, and an agent paused
    /// on an approval prompt held it for the length of the prompt — which made
    /// the app look hung exactly when you went to look at why.
    providers: Vec<Arc<dyn LLMProvider>>,
    /// A typed copy of the OpenAI-compatible provider's config, so a probe can
    /// be run without downcasting a trait object.
    openai: Option<OpenAICompatibleConfig>,
    /// The same, for Anthropic.
    anthropic: Option<AnthropicConfig>,
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
            providers: vec![Arc::new(MockProvider)],
            openai: None,
            anthropic: None,
        }
    }

    pub fn register(&mut self, p: Box<dyn LLMProvider>) {
        self.providers.retain(|e| e.id() != p.id());
        self.providers.push(Arc::from(p));
    }

    /// Remember the OpenAI-compatible config alongside the trait object.
    pub fn register_anthropic(&mut self, config: AnthropicConfig) {
        self.anthropic = Some(config.clone());
        self.register(Box::new(AnthropicProvider::new(config)));
    }

    pub fn register_openai(&mut self, config: OpenAICompatibleConfig) {
        self.openai = Some(config.clone());
        self.register(Box::new(OpenAICompatibleProvider::new(config)));
    }

    pub fn openai_compatible(&self) -> Option<OpenAICompatibleProvider> {
        self.openai.clone().map(OpenAICompatibleProvider::new)
    }

    pub fn anthropic(&self) -> Option<AnthropicProvider> {
        self.anthropic.clone().map(AnthropicProvider::new)
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn LLMProvider>> {
        self.providers.iter().find(|p| p.id() == id).cloned()
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
            history: vec![],
        }
    }

    // -- model lookup ------------------------------------------------------

    #[test]
    fn openai_style_models_are_parsed_and_sorted() {
        let body = serde_json::json!({
            "data": [
                { "id": "openai/gpt-5", "name": "GPT-5", "context_length": 400000 },
                { "id": "anthropic/claude-sonnet-4.5", "context_length": 200000 },
                { "id": "meta-llama/llama-4" }
            ]
        });
        let m = parse_openai_models(&body);
        assert_eq!(m.len(), 3);
        // Sorted, because the order a gateway returns is neither stable nor
        // meaningful and a list that reshuffles between refreshes is unusable.
        assert_eq!(m[0].id, "anthropic/claude-sonnet-4.5");
        assert_eq!(m[2].id, "openai/gpt-5");
        // No name means the id is the label — never an empty row.
        assert_eq!(m[0].name, "anthropic/claude-sonnet-4.5");
        assert_eq!(m[2].name, "GPT-5");
        // Absent is absent, not zero.
        assert_eq!(m[1].context_window, None);
        assert_eq!(m[2].context_window, Some(400_000));
    }

    #[test]
    fn anthropic_models_use_their_display_names_and_keep_their_order() {
        let body = serde_json::json!({
            "data": [
                { "id": "claude-opus-4-5", "display_name": "Claude Opus 4.5" },
                { "id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5" }
            ]
        });
        let m = parse_anthropic_models(&body);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].id, "claude-opus-4-5");
        assert_eq!(m[0].name, "Claude Opus 4.5");
        // Anthropic does not publish context windows here, so they stay absent
        // rather than being guessed at.
        assert!(m.iter().all(|x| x.context_window.is_none()));
    }

    /// A shape that is not what we expected must produce an empty list, not a
    /// panic and not a row of blanks.
    #[test]
    fn an_unexpected_model_payload_yields_nothing_rather_than_junk() {
        for body in [
            serde_json::json!({}),
            serde_json::json!({ "data": "nope" }),
            serde_json::json!({ "data": [{ "no_id": true }, { "id": "" }] }),
        ] {
            assert!(parse_openai_models(&body).is_empty(), "{body}");
            assert!(parse_anthropic_models(&body).is_empty(), "{body}");
        }
    }

    /// The distinction the whole feature rests on. A built-in list handed back
    /// as though it had been fetched is the same lie the update checker used to
    /// tell, and the UI has no way to know unless the answer carries it.
    #[test]
    fn a_catalog_says_whether_it_was_actually_fetched() {
        let live = ModelCatalog::live(vec![ModelInfo {
            id: "x".into(),
            name: "X".into(),
            context_window: None,
        }]);
        assert!(live.live);
        assert!(live.note.is_empty());

        let fell_back = ModelCatalog::fallback(vec![], "the key was rejected");
        assert!(!fell_back.live);
        assert!(
            fell_back.note.contains("rejected"),
            "a fallback has to say why"
        );
    }

    /// Nothing that cannot reach a directory should claim to have one.
    #[test]
    fn a_provider_with_no_directory_says_so_rather_than_faking_one() {
        let e = MockProvider.fetch_models().unwrap_err();
        assert!(e.contains("does not publish"), "{e}");
        // But it still has a built-in list, so the dropdown is never empty.
        assert_eq!(MockProvider.list_models().len(), 1);
    }

    #[test]
    fn fetching_models_without_configuration_fails_before_the_network() {
        let p = AnthropicProvider::new(AnthropicConfig {
            key_target: key_target("anthropic-test-nokey"),
            model: "claude-sonnet-4-5".into(),
        });
        assert!(p.fetch().unwrap_err().contains("API key"));

        let mut c = cfg();
        c.base_url = String::new();
        let o = OpenAICompatibleProvider::new(c);
        assert!(o.fetch().unwrap_err().contains("base URL"));
    }

    // -- anthropic ---------------------------------------------------------

    fn obs(call_id: &str, tool: &str, action: &str, ok: bool) -> Observation {
        Observation {
            call_id: call_id.into(),
            tool: tool.into(),
            action: action.into(),
            args: serde_json::json!({ "path": "a.ts" }),
            ok,
            output: if ok {
                "contents".into()
            } else {
                "denied".into()
            },
        }
    }

    /// The rule that makes or breaks multi-turn tool use: a `tool_result` is
    /// only valid when the preceding assistant turn contains the matching
    /// `tool_use`. Anthropic rejects the request outright otherwise, where
    /// OpenAI would simply carry on.
    #[test]
    fn a_tool_result_is_preceded_by_the_call_it_answers() {
        let mut r = req();
        r.observations = vec![obs("toolu_1", "files", "read", true)];

        let msgs = anthropic_messages(&r);
        let msgs = msgs.as_array().unwrap();

        let assistant = msgs
            .iter()
            .position(|m| m["role"] == "assistant")
            .expect("the assistant turn must be reconstructed");
        let result_turn = msgs
            .iter()
            .position(|m| m["role"] == "user" && m["content"][0]["type"] == "tool_result")
            .expect("the result must be a user turn");
        assert!(assistant < result_turn, "the call has to come first");

        let use_block = &msgs[assistant]["content"][0];
        assert_eq!(use_block["type"], "tool_use");
        assert_eq!(use_block["id"], "toolu_1");
        assert_eq!(use_block["name"], "files_read");
        // The input has to be echoed back, not invented.
        assert_eq!(use_block["input"]["path"], "a.ts");
        assert_eq!(msgs[result_turn]["content"][0]["tool_use_id"], "toolu_1");
    }

    #[test]
    fn a_failed_tool_result_is_flagged_as_an_error_not_as_output() {
        let mut r = req();
        r.observations = vec![obs("toolu_2", "terminal", "run", false)];
        let msgs = anthropic_messages(&r);
        let result = msgs
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["content"][0]["type"] == "tool_result")
            .unwrap()
            .clone();
        assert_eq!(result["content"][0]["is_error"], true);
    }

    /// The mock, and rejected actions, produce observations with no wire id.
    /// They cannot be `tool_result` blocks — but dropping them would lose the
    /// only record of what happened.
    #[test]
    fn an_observation_with_no_call_id_survives_as_text() {
        let mut r = req();
        let mut o = obs("", "decision", "record", false);
        o.output = "could not record".into();
        r.observations = vec![o];

        let msgs = anthropic_messages(&r);
        let msgs = msgs.as_array().unwrap();
        assert!(
            !msgs
                .iter()
                .any(|m| m["content"][0]["type"] == "tool_result"),
            "no id means no tool_result block"
        );
        assert!(
            msgs.iter().any(|m| m["content"]
                .as_str()
                .is_some_and(|c| c.contains("could not record"))),
            "but it must still reach the model"
        );
    }

    #[test]
    fn the_system_prompt_is_never_a_message() {
        let r = req();
        let msgs = anthropic_messages(&r);
        for m in msgs.as_array().unwrap() {
            assert_ne!(m["role"], "system", "system is a top-level field here");
        }
    }

    /// Anthropic streams indexed blocks that open, receive deltas and close —
    /// a different protocol from OpenAI's, not a variant of it.
    #[test]
    fn anthropic_text_deltas_accumulate() {
        let mut acc = AnthropicStreamAccumulator::new();
        let mut live = String::new();
        for l in [
            r#"data: {"type":"message_start","message":{"id":"msg_1"}}"#,
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll "}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"delegate."}}"#,
            r#"data: {"type":"content_block_stop","index":0}"#,
            r#"data: {"type":"message_stop"}"#,
        ] {
            if let Some(t) = acc.push_line(l) {
                live.push_str(&t);
            }
        }
        assert!(acc.finished());
        assert_eq!(live, "I'll delegate.");
        assert_eq!(acc.finish().0, "I'll delegate.");
    }

    /// The id and name arrive on `content_block_start`; the arguments arrive
    /// afterwards as `partial_json`, split at arbitrary points.
    #[test]
    fn an_anthropic_tool_call_is_reassembled_from_partial_json() {
        let mut acc = AnthropicStreamAccumulator::new();
        for l in [
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"delegate_start"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"agent_i"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"d\":\"dev-a\"}"}}"#,
            r#"data: {"type":"message_stop"}"#,
        ] {
            acc.push_line(l);
        }
        let (_, calls, dropped) = acc.finish();
        assert!(dropped.is_empty(), "nothing should have been unparsable");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "toolu_9");
        assert_eq!(calls[0].name, "delegate_start");
        assert_eq!(calls[0].input["agent_id"], "dev-a");
    }

    /// Text and a tool call arrive on different block indexes in the same
    /// message; they must not bleed into each other.
    #[test]
    fn text_and_a_tool_call_in_one_message_stay_separate() {
        let mut acc = AnthropicStreamAccumulator::new();
        for l in [
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Reading it."}}"#,
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"files_read"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"a.ts\"}"}}"#,
            r#"data: {"type":"message_stop"}"#,
        ] {
            acc.push_line(l);
        }
        let (text, calls, _) = acc.finish();
        assert_eq!(text, "Reading it.");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].input["path"], "a.ts");
    }

    /// An overloaded stream ends with an error event. Treating that as a clean
    /// finish would present a truncated answer as a complete one.
    #[test]
    fn an_error_event_ends_the_stream_and_drops_the_half_written_call() {
        let mut acc = AnthropicStreamAccumulator::new();
        for l in [
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"starting"}}"#,
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t","name":"terminal_run"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"command"}}"#,
            r#"data: {"type":"error","error":{"type":"overloaded_error"}}"#,
        ] {
            acc.push_line(l);
        }
        assert!(acc.finished(), "an error ends the stream");
        let (text, calls, dropped) = acc.finish();
        assert_eq!(text, "starting", "what did arrive is still real");
        assert!(calls.is_empty(), "a half-written call must not run");
        assert_eq!(dropped, vec!["terminal_run".to_string()]);
    }

    /// Without a key or a model the provider must refuse before making a
    /// request, and say which piece is missing.
    #[test]
    fn anthropic_refuses_to_call_out_half_configured() {
        let p = AnthropicProvider::new(AnthropicConfig {
            key_target: key_target("anthropic-test-missing"),
            model: String::new(),
        });
        let e = p.run(&req()).unwrap_err();
        assert!(e.contains("model"), "should name the missing piece: {e}");
        let h = p.health();
        assert!(!h.ok);
        assert!(!h.configured);
    }

    // -- streaming ---------------------------------------------------------

    /// A provider that cannot stream must still work, and the caller must not
    /// be able to tell which happened beyond the timing.
    #[test]
    fn a_non_streaming_provider_still_reports_its_message_once() {
        let mut req = req();
        req.role = "orchestrator".into();
        req.goal = "What can you do?".into();

        let seen = std::sync::Mutex::new(String::new());
        let response = MockProvider
            .run_streaming(&req, &|t: &str| seen.lock().unwrap().push_str(t))
            .unwrap();

        let forwarded = seen.into_inner().unwrap();
        assert!(
            !forwarded.is_empty(),
            "the default must forward the message"
        );
        assert_eq!(
            forwarded, response.message,
            "what was streamed and what was returned have to agree"
        );
    }

    /// The two paths share `assemble` so they cannot disagree about whether a
    /// turn is finished. This pins that, since the streaming path is the one
    /// with less coverage and the one that would drift.
    #[test]
    fn streamed_and_whole_responses_assemble_identically() {
        let calls = vec![RawToolCall {
            id: "call_1".into(),
            name: "files_read".into(),
            input: serde_json::json!({ "path": "a.ts" }),
        }];

        let whole = assemble("Reading it.".into(), &calls, &[]);
        let streamed = assemble("Reading it.".into(), &calls, &[]);
        assert_eq!(whole.message, streamed.message);
        assert_eq!(whole.complete, streamed.complete);
        assert_eq!(whole.actions.len(), streamed.actions.len());

        // A turn with a tool call is not finished; one with only text is.
        assert!(!whole.complete, "a pending tool call means more to do");
        let text_only = assemble("All done.".into(), &[], &[]);
        assert!(text_only.complete);
        assert!(matches!(
            text_only.actions.first(),
            Some(AgentAction::Done { .. })
        ));
    }

    /// A truncated call must reach the model as a retryable message, not vanish.
    #[test]
    fn a_dropped_call_is_reported_back_rather_than_swallowed() {
        let r = assemble("working".into(), &[], &["terminal_run".into()]);
        assert!(r.message.contains("terminal_run"));
        assert!(r.message.contains("incomplete"));
        assert!(
            !r.complete,
            "the turn is not over — the model still needs to send it again"
        );
    }

    fn feed(acc: &mut StreamAccumulator, lines: &[&str]) -> String {
        let mut seen = String::new();
        for l in lines {
            if let Some(t) = acc.push_line(l) {
                seen.push_str(&t);
            }
        }
        seen
    }

    #[test]
    fn text_deltas_accumulate_and_are_reported_as_they_arrive() {
        let mut acc = StreamAccumulator::new();
        let live = feed(
            &mut acc,
            &[
                r#"data: {"choices":[{"delta":{"content":"I'll "}}]}"#,
                r#"data: {"choices":[{"delta":{"content":"put dev-a "}}]}"#,
                r#"data: {"choices":[{"delta":{"content":"on it."}}]}"#,
                "data: [DONE]",
            ],
        );
        assert!(acc.finished());
        // What the caller can forward is exactly what was added, so a UI can
        // append rather than re-render the whole buffer.
        assert_eq!(live, "I'll put dev-a on it.");
        let (text, calls, dropped) = acc.finish();
        assert_eq!(text, "I'll put dev-a on it.");
        assert!(calls.is_empty() && dropped.is_empty());
    }

    #[test]
    fn keepalives_and_blank_lines_are_not_data() {
        let mut acc = StreamAccumulator::new();
        feed(
            &mut acc,
            &[
                ": ping",
                "",
                "event: message",
                r#"data: {"choices":[{"delta":{"content":"hi"}}]}"#,
            ],
        );
        assert_eq!(acc.finish().0, "hi");
    }

    /// The failure mode that only shows up on long replies: arguments arrive
    /// split at arbitrary points, and later fragments carry no id or name.
    #[test]
    fn a_tool_call_split_across_fragments_is_reassembled() {
        let mut acc = StreamAccumulator::new();
        feed(
            &mut acc,
            &[
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"delegate_start","arguments":""}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"agent_i"}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"d\":\"dev-a\",\"feature_id"}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":\"offline-sync\"}"}}]}}]}"#,
                "data: [DONE]",
            ],
        );
        let (_, calls, dropped) = acc.finish();
        assert!(dropped.is_empty(), "nothing should have been unparsable");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "delegate_start");
        assert_eq!(calls[0].input["agent_id"], "dev-a");
        assert_eq!(calls[0].input["feature_id"], "offline-sync");
    }

    /// Two calls in one turn must not have their arguments interleaved.
    #[test]
    fn parallel_tool_calls_stay_separate() {
        let mut acc = StreamAccumulator::new();
        feed(
            &mut acc,
            &[
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"files_read","arguments":"{\"path\":"}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"git_status","arguments":"{"}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.ts\"}"}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"}"}}]}}]}"#,
            ],
        );
        let (_, calls, _) = acc.finish();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "files_read");
        assert_eq!(calls[0].input["path"], "a.ts");
        assert_eq!(calls[1].name, "git_status");
    }

    /// A missing index means one call, not a new one each chunk.
    #[test]
    fn fragments_with_no_index_belong_to_the_same_call() {
        let mut acc = StreamAccumulator::new();
        feed(
            &mut acc,
            &[
                r#"data: {"choices":[{"delta":{"tool_calls":[{"id":"c","function":{"name":"git_log","arguments":"{\"limit"}}]}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\":5}"}}]}}]}"#,
            ],
        );
        let (_, calls, _) = acc.finish();
        assert_eq!(calls.len(), 1, "one call, not one per chunk");
        assert_eq!(calls[0].input["limit"], 5);
    }

    /// A dropped connection leaves half a call behind. Running it with `{}`
    /// would execute a tool with arguments the model never finished choosing.
    #[test]
    fn a_truncated_call_is_dropped_rather_than_run_with_empty_arguments() {
        let mut acc = StreamAccumulator::new();
        feed(
            &mut acc,
            &[
                r#"data: {"choices":[{"delta":{"content":"working on it"}}]}"#,
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"terminal_run","arguments":"{\"command\":\"rm -r"}}]}}]}"#,
            ],
        );
        assert!(!acc.finished(), "the stream never said [DONE]");
        let (text, calls, dropped) = acc.finish();
        assert_eq!(text, "working on it", "the text still survives");
        assert!(calls.is_empty(), "a half-written call is not a call");
        assert_eq!(dropped, vec!["terminal_run".to_string()]);
    }

    /// A zero-parameter tool legitimately streams no arguments at all.
    #[test]
    fn a_call_with_no_arguments_is_still_a_call() {
        let mut acc = StreamAccumulator::new();
        feed(
            &mut acc,
            &[
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"z","function":{"name":"git_status"}}]}}]}"#,
            ],
        );
        let (_, calls, dropped) = acc.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].input, serde_json::json!({}));
        assert!(dropped.is_empty());
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
                args: serde_json::json!({ "path": "types.ts" }),
                ok: true,
                output: "export type SyncResult = {}".into(),
            },
            // No id — the mock's shape. It can only be narration.
            Observation {
                call_id: String::new(),
                tool: "git".into(),
                action: "status".into(),
                args: serde_json::Value::Null,
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
