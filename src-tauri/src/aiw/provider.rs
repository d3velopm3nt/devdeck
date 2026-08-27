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

use super::tools::ToolCall;

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
    /// Tool ids this agent may ask for. A provider that asks for anything else
    /// gets refused at the ToolService, but telling it up front avoids the
    /// pointless round trip.
    pub available_tools: Vec<String>,
    /// Results of the tool calls made so far this turn, fed back in.
    pub observations: Vec<String>,
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
                        req.observations.last().cloned().unwrap_or_default()
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
                let saw_outcome = req.observations.iter().any(|o| o.contains("outcome"));
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
                request.available_tools.len(),
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
// Real providers
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
pub struct AnthropicConfig {
    pub api_key: Option<String>,
    pub model: String,
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
        if self.config.api_key.is_none() {
            return Err("Anthropic provider has no API key configured".into());
        }
        // Deliberately not implemented in this slice. It returns an explicit
        // error rather than a plausible-looking empty response, so a
        // half-configured provider can never be mistaken for a working one.
        Err("Anthropic transport not implemented in this build — use the Mock provider".into())
    }
    fn health(&self) -> ProviderHealth {
        let configured = self.config.api_key.is_some();
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
    /// Read by the HTTP transport when one is implemented. Present now because
    /// the whole point of this struct is that adding a provider is
    /// configuration rather than code.
    #[allow(dead_code)]
    pub api_key: Option<String>,
    pub model: String,
    #[allow(dead_code)]
    pub headers: Vec<(String, String)>,
    #[allow(dead_code)]
    pub timeout_secs: Option<u64>,
}

pub struct OpenAICompatibleProvider {
    pub config: OpenAICompatibleConfig,
}

impl OpenAICompatibleProvider {
    pub const ID: &'static str = "openai-compatible";
    pub fn new(config: OpenAICompatibleConfig) -> Self {
        Self { config }
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
    fn run(&self, _request: &AgentRequest) -> Result<AgentResponse, String> {
        if self.config.base_url.is_empty() {
            return Err("OpenAI-compatible provider has no base URL configured".into());
        }
        Err(
            "OpenAI-compatible transport not implemented in this build — use the Mock provider"
                .into(),
        )
    }
    fn health(&self) -> ProviderHealth {
        let configured = !self.config.base_url.is_empty() && !self.config.model.is_empty();
        ProviderHealth {
            ok: false,
            configured,
            detail: if configured {
                format!(
                    "Configured for {} ({}); transport not implemented in this build.",
                    self.config.name, self.config.model
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
        }
    }

    pub fn register(&mut self, p: Box<dyn LLMProvider>) {
        self.providers.retain(|e| e.id() != p.id());
        self.providers.push(p);
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
            available_tools: vec!["files".into(), "git".into()],
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

        let o = OpenAICompatibleProvider::new(OpenAICompatibleConfig {
            name: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            model: "some/model".into(),
            ..Default::default()
        });
        // Configured but not implemented — and it says exactly that, rather
        // than pretending to be ok.
        assert!(o.health().configured);
        assert!(!o.health().ok);
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
