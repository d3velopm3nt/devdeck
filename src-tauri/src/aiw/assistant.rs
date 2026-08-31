//! The orchestrator — the one AI you actually talk to.
//!
//! Everything else in the AI Workspace is fire-and-watch: you point an agent at
//! a work item with a goal string and read the event feed. That is a good way
//! to run five agents and a bad way to *ask for something*.
//!
//! This is the other half. You talk to one assistant; it decides what needs
//! doing, and hands the parts that are somebody else's job to the specialists.
//! The distinction that makes it an orchestrator rather than a chat window is
//! [`TOOL_DELEGATE`]: it can put dev-a on a work item and tell you it did.
//!
//! Three things it does not do, deliberately:
//!
//! - **It does not bypass permissions.** It is an agent with an id, it appears
//!   in the permission matrix, and its tool calls go through the same gate as
//!   everyone else's — including the approval prompt.
//! - **It does not run a delegated agent inline.** Sessions take minutes;
//!   holding the chat open for one would make the assistant useless exactly
//!   when it is doing the most. Delegation starts a session and returns.
//! - **It does not write personal state into a project.** Conversations and
//!   memory go to [`PersonalStore`], which refuses to live inside a repo.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::deck::Doc;
use super::events::{new_id, now_iso, DomainEvent, EventScope, EventType};
use super::personal::{MemoryMeta, PersonalStore};
use super::provider::{AgentAction, AgentRequest, AgentResponse, ChatTurn, Observation};
use super::runtime::{AgentRuntime, StartAgentCommand};
use super::state::Workspace;
use super::tools::{is_assistant_tool, ToolCall, TOOL_BOTS, TOOL_DELEGATE, TOOL_MEMORY};

/// The built-in orchestrator's agent id. It is a real entry in the agent list
/// so it inherits provider selection and the permission matrix.
pub const ASSISTANT_ID: &str = "assistant";

/// How many provider turns one message may take before the assistant has to
/// say something. Lower than an agent's budget on purpose: a person is sitting
/// there waiting, and eight silent tool calls is not a conversation.
const MAX_TURNS: u32 = 6;

/// How many recent messages go to the model verbatim. Older ones survive as the
/// rolling summary, so a long conversation costs a bounded amount rather than
/// growing until it is refused.
const VERBATIM_MESSAGES: usize = 24;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Speaker {
    User,
    Assistant,
    /// A tool result, kept in the transcript so the conversation shows what was
    /// actually done rather than only what was claimed.
    Tool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub at: String,
    pub from: Speaker,
    pub text: String,
    /// `tool.action` for a tool message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
}

impl ChatMessage {
    fn said(from: Speaker, text: impl Into<String>) -> Self {
        Self {
            at: now_iso(),
            from,
            text: text.into(),
            tool: None,
            ok: None,
        }
    }
}

/// A conversation's frontmatter. The messages live here rather than in the
/// body: a transcript is structured data, and re-parsing it out of prose would
/// be lossy the first time someone's message contained a Markdown heading.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ConversationMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub updated_at: String,
    /// The project in focus, if any. The assistant works across projects, so
    /// this is a default rather than a boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

/// What the UI is told while a reply is still being produced.
///
/// Not a domain event: token deltas are not facts about the project, and
/// putting a few hundred of them through the bus would bury the log that makes
/// the workspace auditable. This is a side channel, and it is lossy by design
/// -- the conversation on disk is the record.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ChatEvent {
    /// More visible text arrived.
    Delta {
        conversation_id: String,
        text: String,
    },
    /// A tool ran. Sent as it happens so a long turn shows progress rather
    /// than a spinner that could mean anything.
    Step {
        conversation_id: String,
        message: ChatMessage,
    },
    /// The turn is over; the transcript on disk is now authoritative.
    Done { conversation_id: String },
}

/// Where progress goes. A no-op is a valid sink, and nothing about
/// correctness may depend on anyone listening: the conversation on disk is the
/// record, and progress is a courtesy.
pub type ChatSink<'a> = &'a (dyn Fn(ChatEvent) + Send + Sync);

/// What one `send` produced.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AssistantReply {
    pub conversation_id: String,
    pub reply: String,
    /// Messages appended by this exchange, so the UI can render the tool steps
    /// without re-fetching the whole conversation.
    pub appended: Vec<ChatMessage>,
    /// Sessions this exchange started, if any.
    pub delegated: Vec<String>,
    pub turns: u32,
}

/// A conversation as listed, without dragging every message along.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub started_at: String,
    pub updated_at: String,
    pub project_id: Option<String>,
    pub messages: usize,
    /// The last thing said, for the list.
    pub preview: String,
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

pub struct Conversations {
    store: PersonalStore,
}

impl Conversations {
    pub fn new(store: PersonalStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &PersonalStore {
        &self.store
    }

    pub fn create(&self, project_id: Option<&str>) -> Result<ConversationMeta, String> {
        let now = now_iso();
        let meta = ConversationMeta {
            id: new_id("conv"),
            title: "New conversation".into(),
            started_at: now.clone(),
            updated_at: now,
            project_id: project_id.map(str::to_string),
            messages: Vec::new(),
        };
        self.save(&meta)?;
        Ok(meta)
    }

    pub fn load(&self, id: &str) -> Result<ConversationMeta, String> {
        let p = self.store.conversation_md(id);
        let doc: Doc<ConversationMeta> = self
            .store
            .read_doc_opt(&p)?
            .ok_or_else(|| format!("no conversation '{id}'"))?;
        Ok(doc.meta)
    }

    pub fn save(&self, meta: &ConversationMeta) -> Result<(), String> {
        let p = self.store.conversation_md(&meta.id);
        // The body is a human-readable rendering. It is derived, never read
        // back — the frontmatter is the record. Writing it anyway is what makes
        // the directory browsable without DevDeck.
        let doc = Doc {
            meta: meta.clone(),
            body: render(meta),
        };
        self.store.write_doc_at(&p, &doc)
    }

    /// Newest first. An unreadable file is skipped rather than failing the
    /// list — one bad conversation should not hide the rest.
    pub fn list(&self) -> Vec<ConversationSummary> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(self.store.conversations_dir()) else {
            return out;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Ok(Some(doc)) = self.store.read_doc_opt::<ConversationMeta>(&p) else {
                continue;
            };
            let m = doc.meta;
            out.push(ConversationSummary {
                preview: m
                    .messages
                    .iter()
                    .rev()
                    .find(|x| x.from != Speaker::Tool)
                    .map(|x| truncate(&x.text, 120))
                    .unwrap_or_default(),
                messages: m.messages.len(),
                id: m.id,
                title: m.title,
                started_at: m.started_at,
                updated_at: m.updated_at,
                project_id: m.project_id,
            });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }

    pub fn delete(&self, id: &str) -> bool {
        std::fs::remove_file(self.store.conversation_md(id)).is_ok()
    }
}

/// The browsable rendering that goes in the document body.
fn render(m: &ConversationMeta) -> String {
    let mut out = format!("# {}\n", m.title);
    for msg in &m.messages {
        let who = match msg.from {
            Speaker::User => "You".to_string(),
            Speaker::Assistant => "Assistant".to_string(),
            Speaker::Tool => format!(
                "{} {}",
                msg.tool.clone().unwrap_or_else(|| "tool".into()),
                if msg.ok == Some(false) {
                    "(failed)"
                } else {
                    ""
                }
            )
            .trim()
            .to_string(),
        };
        out.push_str(&format!("\n## {} · {}\n\n{}\n", who, msg.at, msg.text));
    }
    out
}

fn truncate(s: &str, n: usize) -> String {
    let one_line = s.replace(['\n', '\r'], " ");
    if one_line.chars().count() <= n {
        return one_line;
    }
    let cut: String = one_line.chars().take(n).collect();
    format!("{cut}…")
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

pub struct Assistant;

impl Assistant {
    /// One exchange: the person says something, the assistant answers, having
    /// possibly used tools and started agents along the way.
    pub fn send(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conversation_id: &str,
        text: &str,
        sink: ChatSink,
    ) -> Result<AssistantReply, String> {
        if text.trim().is_empty() {
            return Err("nothing to send".into());
        }
        let mut conv = convs.load(conversation_id)?;
        let agent = ws
            .agent(ASSISTANT_ID)
            .ok_or_else(|| format!("no '{ASSISTANT_ID}' agent"))?;

        // The first thing said names the conversation. Better than "New
        // conversation" forever, and cheaper than asking a model for a title.
        if conv.messages.is_empty() {
            conv.title = truncate(text.trim(), 60);
        }
        let mut appended = vec![ChatMessage::said(Speaker::User, text.trim())];
        conv.messages.push(appended[0].clone());

        let scope = match &conv.project_id {
            Some(p) => EventScope::project(p).with_agent(ASSISTANT_ID),
            None => EventScope::default().with_agent(ASSISTANT_ID),
        };
        let started = ws.bus.emit(DomainEvent::new(
            EventType::AgentStarted,
            scope.clone(),
            serde_json::json!({ "name": agent.name, "conversation": conv.id }),
        ));

        let mut tools = super::tools::definitions_for(ASSISTANT_ID, &ws.permission_matrix());
        // The project tools are only meaningful with a project in focus. Saying
        // so beats offering a model a `files_read` that cannot resolve a root.
        if conv.project_id.is_none() {
            tools.retain(|t| {
                let name = t.name.as_str();
                name.starts_with("delegate_") || name.starts_with("memory_")
            });
        }

        let conv_id = conv.id.clone();
        let mut observations: Vec<Observation> = Vec::new();
        let mut delegated: Vec<String> = Vec::new();
        let mut reply = String::new();
        let mut turn = 0u32;

        while turn < MAX_TURNS {
            let request = AgentRequest {
                agent_id: ASSISTANT_ID.into(),
                role: agent.role.clone(),
                model: agent.model.clone(),
                system: Self::system_prompt(ws, convs, &conv, &agent.system),
                context: Self::context(ws, convs, &conv),
                goal: text.trim().to_string(),
                tools: tools.clone(),
                observations: observations.clone(),
                turn,
                history: Self::history(&conv),
            };

            let response: AgentResponse = {
                // Cloned out and the lock released before the call. A chat
                // turn can run for a minute and can pause on an approval
                // prompt; holding the registry for that long would freeze
                // every agent, and the chat you would use to find out why.
                let p = {
                    let providers = ws.providers.lock().unwrap();
                    providers.get(&agent.provider)
                }
                .ok_or_else(|| format!("unknown provider '{}'", agent.provider))?;
                // Streamed if the provider can; a provider that cannot falls
                // back to one late chunk, and nothing downstream can tell.
                p.run_streaming(&request, &|t: &str| {
                    sink(ChatEvent::Delta {
                        conversation_id: conv_id.clone(),
                        text: t.to_string(),
                    });
                })?
            };

            if !response.message.trim().is_empty() {
                reply = response.message.trim().to_string();
            }

            observations.clear();
            let mut acted = false;

            for action in &response.actions {
                match action {
                    AgentAction::Tool(call) => {
                        acted = true;
                        let (ok, output) = Self::run_tool(
                            ws,
                            convs,
                            &conv,
                            call,
                            &scope,
                            &started,
                            &mut delegated,
                        );
                        let msg = ChatMessage {
                            at: now_iso(),
                            from: Speaker::Tool,
                            text: truncate(&output, 600),
                            tool: Some(format!("{}.{}", call.tool, call.action)),
                            ok: Some(ok),
                        };
                        conv.messages.push(msg.clone());
                        appended.push(msg.clone());
                        // Sent as it happens: a long turn should show what it is
                        // doing, not a spinner that could mean anything.
                        sink(ChatEvent::Step {
                            conversation_id: conv_id.clone(),
                            message: msg,
                        });
                        observations.push(Observation {
                            call_id: call.call_id.clone(),
                            tool: call.tool.clone(),
                            action: call.action.clone(),
                            args: call.args.clone(),
                            ok,
                            output,
                        });
                    }
                    AgentAction::Done { summary } => {
                        if reply.trim().is_empty() {
                            reply = summary.clone();
                        }
                    }
                    // The orchestrator talks and delegates; recording decisions
                    // and rewriting feature context are a specialist's job, and
                    // letting it do them here would put project state in the
                    // hands of whatever the chat happened to be about.
                    other => {
                        observations.push(Observation {
                            call_id: String::new(),
                            tool: "assistant".into(),
                            action: "unsupported".into(),
                            args: serde_json::Value::Null,
                            ok: false,
                            output: format!(
                                "{} is not something the assistant does directly — \
                                 delegate it to an agent instead",
                                action_name(other)
                            ),
                        });
                        acted = true;
                    }
                }
            }

            turn += 1;
            if response.complete || !acted {
                break;
            }
        }

        if reply.trim().is_empty() {
            // Honest rather than blank. A silent assistant looks like a bug,
            // and the usual cause is a turn budget spent on tool calls.
            reply = format!(
                "I used {turn} turn{} without reaching an answer. \
                 Ask me again with more detail, or check the activity feed for what ran.",
                if turn == 1 { "" } else { "s" }
            );
        }

        let msg = ChatMessage::said(Speaker::Assistant, &reply);
        conv.messages.push(msg.clone());
        appended.push(msg);
        conv.updated_at = now_iso();
        convs.save(&conv)?;

        ws.bus.emit(
            DomainEvent::new(
                EventType::AgentCompleted,
                scope,
                serde_json::json!({
                    "summary": truncate(&reply, 160),
                    "conversation": conv.id,
                    "delegated": delegated.len(),
                }),
            )
            .caused_by(&started),
        );

        sink(ChatEvent::Done {
            conversation_id: conv_id,
        });

        Ok(AssistantReply {
            conversation_id: conv.id,
            reply,
            appended,
            delegated,
            turns: turn,
        })
    }

    /// Run one tool call. Assistant-only tools are handled here; everything
    /// else goes through the project's `ToolService` and its permission gate,
    /// approval prompt included.
    fn run_tool(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conv: &ConversationMeta,
        call: &ToolCall,
        scope: &EventScope,
        cause: &DomainEvent,
        delegated: &mut Vec<String>,
    ) -> (bool, String) {
        if is_assistant_tool(&call.tool) {
            // Still permission-checked: the orchestrator's right to spawn
            // agents is revocable like anything else.
            let permission = ws.permission_matrix().get(ASSISTANT_ID, &call.tool);
            if matches!(permission, super::tools::Permission::None) {
                return (
                    false,
                    format!("'{}' is denied for the assistant", call.tool),
                );
            }
            return match call.tool.as_str() {
                TOOL_DELEGATE => Self::delegate(ws, conv, call, delegated),
                TOOL_MEMORY => Self::memory(convs, conv, call),
                TOOL_BOTS => Self::make_bot(ws, conv, call, scope, cause),
                _ => (false, format!("unknown assistant tool '{}'", call.tool)),
            };
        }

        let Some(project_id) = conv.project_id.as_deref() else {
            return (
                false,
                format!(
                    "'{}' needs a project in focus — pick one for this conversation first",
                    call.tool
                ),
            );
        };
        let Some(project) = ws.project(project_id) else {
            return (false, format!("no project '{project_id}'"));
        };
        let r = project
            .tools
            .execute(&ws.bus, ASSISTANT_ID, scope, call, Some(cause));
        (
            r.ok,
            if r.ok {
                r.output
            } else {
                r.error.unwrap_or_else(|| "failed".into())
            },
        )
    }

    /// Leave a bot behind in the space this conversation is about.
    ///
    /// Always asked first, whatever the permission matrix says. Every other
    /// assistant tool acts inside the conversation and stops when it ends; a
    /// bot keeps its own heartbeat afterwards, so the person who will live
    /// with it gets to see it written out and say no.
    fn make_bot(
        ws: &Arc<Workspace>,
        conv: &ConversationMeta,
        call: &ToolCall,
        scope: &EventScope,
        cause: &DomainEvent,
    ) -> (bool, String) {
        let s = |k: &str| {
            call.args
                .get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string()
        };
        let Some(project_id) = conv.project_id.as_deref() else {
            return (
                false,
                "a bot lives in a space — pick one for this conversation first".into(),
            );
        };
        let (name, goal) = (s("name"), s("goal"));
        if name.is_empty() || goal.is_empty() {
            return (false, "a bot needs a name and a goal".into());
        }
        if !ws.can_make_bots() {
            return (false, "this build cannot create bots".into());
        }

        // Started by a clock rather than by a person, there is nobody to ask,
        // and a bot that quietly makes more bots overnight is the last thing
        // anyone wants. Refuse before prompting rather than after timing out.
        if scope.unattended {
            return (
                false,
                "making a bot needs a person to say yes, and this run has nobody watching".into(),
            );
        }

        let outcome = ws.ask_approval(ASSISTANT_ID, call, scope, cause);
        if !outcome.allows() {
            return (false, format!("not made — {outcome:?}"));
        }

        let every = match s("every").as_str() {
            "" => "weekdays".to_string(),
            e => e.to_string(),
        };
        let at_min = match s("at").as_str() {
            "" => 8 * 60,
            a => {
                let (h, m) = a.split_once(':').unwrap_or((a, "0"));
                h.trim().parse::<i64>().unwrap_or(8) * 60 + m.trim().parse::<i64>().unwrap_or(0)
            }
        };

        match ws.make_bot(super::state::BotDraft {
            project_id: project_id.to_string(),
            name: name.clone(),
            goal,
            every,
            at_min: at_min.clamp(0, 1439),
        }) {
            Ok(note) => (true, note),
            Err(e) => (false, e),
        }
    }

    fn delegate(
        ws: &Arc<Workspace>,
        conv: &ConversationMeta,
        call: &ToolCall,
        delegated: &mut Vec<String>,
    ) -> (bool, String) {
        let s = |k: &str| {
            call.args
                .get(k)
                .and_then(|v| v.as_str())
                .map(str::to_string)
        };

        match call.action.as_str() {
            "status" => {
                let sessions = ws.sessions_for(conv.project_id.as_deref());
                if sessions.is_empty() {
                    return (true, "No sessions have run yet.".into());
                }
                let lines: Vec<String> = sessions
                    .iter()
                    .take(12)
                    .map(|x| {
                        format!(
                            "{} ({}) — {} on {}, {} turns",
                            x.agent_name,
                            x.agent_id,
                            x.status.label(),
                            x.feature_id,
                            x.turns
                        )
                    })
                    .collect();
                (true, lines.join("\n"))
            }
            "start" => {
                let Some(project_id) = conv.project_id.clone() else {
                    return (
                        false,
                        "no project in focus — pick one for this conversation first".into(),
                    );
                };
                let (Some(agent_id), Some(feature_id)) = (s("agent_id"), s("feature_id")) else {
                    return (false, "agent_id and feature_id are both required".into());
                };
                if agent_id == ASSISTANT_ID {
                    return (
                        false,
                        "the assistant cannot delegate to itself — pick a specialist".into(),
                    );
                }
                if ws.agent(&agent_id).is_none() {
                    return (false, format!("no agent '{agent_id}'"));
                }

                let cmd = StartAgentCommand {
                    project_id,
                    feature_id: feature_id.clone(),
                    agent_id: agent_id.clone(),
                    work_item_id: s("work_item_id"),
                    intent: s("intent"),
                    areas: Vec::new(),
                    depends_on: Vec::new(),
                    unattended: false,
                };

                // Begin synchronously so a bad request fails *here*, where the
                // assistant can say so, rather than on a thread nobody is
                // reading. Only the provider loop goes to the background.
                let live = match AgentRuntime::begin(ws, &cmd) {
                    Ok(l) => l,
                    Err(e) => return (false, e),
                };
                let session_id = live.session_id.clone();
                delegated.push(session_id.clone());

                // A session takes minutes. Holding the chat open for one would
                // make the assistant useless exactly when it is doing the most.
                let bg = ws.clone();
                std::thread::spawn(move || {
                    if let Err(e) = AgentRuntime::drive(&bg, live) {
                        eprintln!("[aiw] delegated session failed: {e}");
                    }
                });

                // Say when the agent behind this is scripted. "I have put
                // Developer A on it" is a claim about real work; if the
                // provider is the mock, the work is a fixture, and the
                // transcript is the only place that would ever say so.
                let scripted = ws
                    .agent(&agent_id)
                    .is_some_and(|a| a.provider == super::provider::MockProvider::ID);
                let caveat = if scripted {
                    format!(
                        " NOTE: {agent_id} is on the mock provider, so this session runs a \
                         script and produces fixture output, not real work. Say so plainly in \
                         your reply. Point it at a real provider under Settings to change that."
                    )
                } else {
                    String::new()
                };

                (
                    true,
                    format!(
                        "Started {agent_id} on {feature_id} (session {session_id}). \
                         It runs in the background; check Activity for progress.{caveat}"
                    ),
                )
            }
            other => (false, format!("unknown delegate action '{other}'")),
        }
    }

    fn memory(convs: &Conversations, conv: &ConversationMeta, call: &ToolCall) -> (bool, String) {
        let store = convs.store();
        let s = |k: &str| call.args.get(k).and_then(|v| v.as_str()).unwrap_or("");

        match call.action.as_str() {
            "list" => {
                let all = store.memories();
                if all.is_empty() {
                    return (true, "Nothing remembered yet.".into());
                }
                let lines: Vec<String> = all
                    .iter()
                    .map(|d| {
                        format!(
                            "[{}] {} — {}",
                            d.meta.id,
                            d.meta.title,
                            truncate(&d.body, 120)
                        )
                    })
                    .collect();
                (true, lines.join("\n"))
            }
            "save" => {
                let title = s("title");
                let body = s("body");
                if title.is_empty() || body.is_empty() {
                    return (false, "title and body are both required".into());
                }
                let tags = call
                    .args
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let doc = Doc {
                    meta: MemoryMeta {
                        id: String::new(),
                        title: title.to_string(),
                        created_at: now_iso(),
                        project_id: match s("project_id") {
                            "" => conv.project_id.clone(),
                            p => Some(p.to_string()),
                        },
                        tags,
                    },
                    body: body.to_string(),
                };
                match store.save_memory(&doc) {
                    // Say where it went. The store split is only reassuring if
                    // you can see it working.
                    Ok(_) => (
                        true,
                        format!("Remembered “{title}” (personal store, not in any repo)."),
                    ),
                    Err(e) => (false, e),
                }
            }
            "forget" => {
                let id = s("id");
                if store.forget_memory(id) {
                    (true, format!("Forgot {id}."))
                } else {
                    (false, format!("no note '{id}'"))
                }
            }
            other => (false, format!("unknown memory action '{other}'")),
        }
    }

    // -- prompt assembly ---------------------------------------------------

    fn system_prompt(
        ws: &Arc<Workspace>,
        _convs: &Conversations,
        conv: &ConversationMeta,
        base: &str,
    ) -> String {
        let mut s = String::from(base.trim());
        s.push_str(
            "\n\nYou coordinate a team of specialist agents. Do small things yourself; \
             hand real implementation work to an agent with delegate.start rather than \
             writing code in the conversation. Say plainly when you have delegated \
             something and to whom.",
        );
        let agents: Vec<String> = ws
            .agents()
            .into_iter()
            .filter(|a| a.id != ASSISTANT_ID)
            .map(|a| format!("- {} ({}): {}", a.id, a.role, a.system.trim()))
            .collect();
        if !agents.is_empty() {
            s.push_str("\n\n# Agents you can delegate to\n\n");
            s.push_str(&agents.join("\n"));
        }
        if conv.project_id.is_none() {
            s.push_str(
                "\n\nNo project is in focus, so only delegation and memory are available. \
                 Ask which project this is about before trying to touch code.",
            );
        }
        s
    }

    /// What the assistant knows going in: who you are, what it remembers, and
    /// where the project stands. Personal facts come from the personal store;
    /// project facts from the project. They are labelled so it is obvious in
    /// the prompt which is which.
    pub fn context(ws: &Arc<Workspace>, convs: &Conversations, conv: &ConversationMeta) -> String {
        let mut parts: Vec<String> = Vec::new();

        let profile = convs.store().profile();
        if !profile.body.trim().is_empty() || !profile.meta.preferences.is_empty() {
            let mut s = String::from("## About you (personal, never committed)\n");
            for p in &profile.meta.preferences {
                s.push_str(&format!("- {p}\n"));
            }
            if !profile.body.trim().is_empty() {
                s.push_str(&format!("\n{}\n", profile.body.trim()));
            }
            parts.push(s);
        }

        let memories = convs.store().memories();
        if !memories.is_empty() {
            let mut s = String::from("## Remembered (personal, never committed)\n");
            for d in memories.iter().take(20) {
                // Notes about another project are noise here.
                if d.meta.project_id.is_some() && d.meta.project_id != conv.project_id {
                    continue;
                }
                s.push_str(&format!(
                    "- [{}] {}: {}\n",
                    d.meta.id,
                    d.meta.title,
                    truncate(&d.body, 200)
                ));
            }
            parts.push(s);
        }

        if let Some(pid) = &conv.project_id {
            if let Some(p) = ws.project(pid) {
                let deck = p.deck();
                let features = deck.feature_slugs();
                let mut s = format!("## Project in focus: {} ({})\n", p.name, p.id);
                if features.is_empty() {
                    s.push_str("No features yet.\n");
                } else {
                    s.push_str("Features:\n");
                    for f in features.iter().take(30) {
                        s.push_str(&format!("- {f}\n"));
                    }
                }
                parts.push(s);
            }
        }

        if parts.is_empty() {
            // "Nothing yet" is a fact, and a better one than silence: a model
            // handed an empty context cannot tell an unconfigured workspace
            // from a failure to assemble one, and neither can we.
            return "## Nothing in focus\n\nNo project is selected and nothing has been remembered yet."
                .to_string();
        }
        parts.join("\n")
    }

    /// The recent conversation, verbatim. Tool results are folded in as
    /// assistant turns so the model can see what actually happened rather than
    /// only what it said it would do.
    fn history(conv: &ConversationMeta) -> Vec<ChatTurn> {
        let msgs = &conv.messages;
        // The last message is the one being answered; it goes in as the goal.
        let end = msgs.len().saturating_sub(1);
        let start = end.saturating_sub(VERBATIM_MESSAGES);
        msgs[start..end]
            .iter()
            .map(|m| match m.from {
                Speaker::User => ChatTurn {
                    role: "user".into(),
                    content: m.text.clone(),
                },
                Speaker::Assistant => ChatTurn {
                    role: "assistant".into(),
                    content: m.text.clone(),
                },
                Speaker::Tool => ChatTurn {
                    role: "assistant".into(),
                    content: format!(
                        "[{} {}] {}",
                        m.tool.clone().unwrap_or_else(|| "tool".into()),
                        if m.ok == Some(false) { "failed" } else { "ok" },
                        m.text
                    ),
                },
            })
            .collect()
    }
}

fn action_name(a: &AgentAction) -> &'static str {
    match a {
        AgentAction::Tool(_) => "a tool call",
        AgentAction::Decision { .. } => "recording a decision",
        AgentAction::UpdateContext { .. } => "rewriting feature context",
        AgentAction::SymbolChanged { .. } => "declaring a symbol change",
        AgentAction::Done { .. } => "finishing",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!(
                "devdeck-assistant-{tag}-{}-{}",
                std::process::id(),
                new_id("t")
            ));
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn convs(t: &Tmp) -> Conversations {
        let s = PersonalStore::at(t.0.join("assistant"));
        s.ensure().unwrap();
        Conversations::new(s)
    }

    #[test]
    fn a_conversation_survives_being_written_and_read_back() {
        let t = Tmp::new("roundtrip");
        let c = convs(&t);
        let mut conv = c.create(Some("tyrex")).unwrap();
        conv.messages
            .push(ChatMessage::said(Speaker::User, "line one\nline two"));
        conv.messages.push(ChatMessage {
            at: now_iso(),
            from: Speaker::Tool,
            text: "ok".into(),
            tool: Some("delegate.start".into()),
            ok: Some(true),
        });
        c.save(&conv).unwrap();

        let back = c.load(&conv.id).unwrap();
        assert_eq!(back.messages.len(), 2);
        // Multi-line text is where a naive transcript format loses data.
        assert_eq!(back.messages[0].text, "line one\nline two");
        assert_eq!(back.messages[1].tool.as_deref(), Some("delegate.start"));
        assert_eq!(back.project_id.as_deref(), Some("tyrex"));
    }

    #[test]
    fn the_first_message_names_the_conversation() {
        let t = Tmp::new("title");
        let c = convs(&t);
        let conv = c.create(None).unwrap();
        assert_eq!(conv.title, "New conversation");

        let mut conv = c.load(&conv.id).unwrap();
        conv.title = truncate("Get offline sync started this week please", 60);
        c.save(&conv).unwrap();
        assert!(c
            .load(&conv.id)
            .unwrap()
            .title
            .starts_with("Get offline sync"));
    }

    #[test]
    fn the_listing_is_newest_first_and_previews_the_last_thing_said() {
        let t = Tmp::new("list");
        let c = convs(&t);
        let mut a = c.create(None).unwrap();
        a.updated_at = "2026-08-01T00:00:00Z".into();
        a.messages.push(ChatMessage::said(Speaker::User, "older"));
        c.save(&a).unwrap();

        let mut b = c.create(None).unwrap();
        b.updated_at = "2026-08-27T00:00:00Z".into();
        b.messages.push(ChatMessage::said(Speaker::User, "newer"));
        // A tool result is not a preview — it is machinery, not conversation.
        b.messages.push(ChatMessage {
            at: now_iso(),
            from: Speaker::Tool,
            text: "some tool output".into(),
            tool: Some("memory.list".into()),
            ok: Some(true),
        });
        c.save(&b).unwrap();

        let list = c.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, b.id, "newest first");
        assert_eq!(list[0].preview, "newer");
    }

    #[test]
    fn history_excludes_the_message_being_answered() {
        let mut conv = ConversationMeta::default();
        conv.messages
            .push(ChatMessage::said(Speaker::User, "first"));
        conv.messages
            .push(ChatMessage::said(Speaker::Assistant, "reply"));
        conv.messages
            .push(ChatMessage::said(Speaker::User, "second"));

        let h = Assistant::history(&conv);
        assert_eq!(
            h.len(),
            2,
            "the latest message goes in as the goal, not twice"
        );
        assert_eq!(h[0].content, "first");
        assert_eq!(h[1].role, "assistant");
    }

    /// A conversation that ran all day must not send an unbounded prompt.
    #[test]
    fn history_is_capped() {
        let mut conv = ConversationMeta::default();
        for i in 0..200 {
            conv.messages
                .push(ChatMessage::said(Speaker::User, format!("msg {i}")));
        }
        let h = Assistant::history(&conv);
        assert_eq!(h.len(), VERBATIM_MESSAGES);
        assert_eq!(
            h.last().unwrap().content,
            "msg 198",
            "the cap keeps the most recent, not the oldest"
        );
    }

    #[test]
    fn a_deleted_conversation_is_gone() {
        let t = Tmp::new("delete");
        let c = convs(&t);
        let conv = c.create(None).unwrap();
        assert!(c.delete(&conv.id));
        assert!(c.load(&conv.id).is_err());
        assert!(c.list().is_empty());
    }
}
