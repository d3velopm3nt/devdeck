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
use super::mentions::{self, Handover};
use super::runtime::{AgentRuntime, LiveSession, StartAgentCommand};
use super::state::Workspace;
use super::tools::{
    is_assistant_tool, ToolCall, TOOL_BOTS, TOOL_DELEGATE, TOOL_MEMORY, TOOL_ROUTINE, TOOL_SKILL,
    TOOL_WORK,
};

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
    /// Who said it, when that is not simply "the assistant": a bot's id, an
    /// agent's id. A thread with three bots and two agents in it cannot be
    /// read without this, and inferring the speaker from the conversation's
    /// title only works while exactly one thing is talking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

impl ChatMessage {
    fn said(from: Speaker, text: impl Into<String>) -> Self {
        Self {
            at: now_iso(),
            from,
            text: text.into(),
            tool: None,
            ok: None,
            by: None,
        }
    }

    /// Somebody joining a thread. Public because bots are resolved a layer
    /// up, where the database is — `aiw` knows agents and nothing else.
    pub fn pulled_in(by: &str, text: impl Into<String>) -> Self {
        Self::note(by, "pulled-in", true, text)
    }

    /// Something the thread records rather than something anyone said: a
    /// participant pulled in, a claim moving, a session reporting back. Drawn
    /// as a receipt, never as a speech bubble — nobody asked it a question.
    fn note(by: &str, tag: &str, ok: bool, text: impl Into<String>) -> Self {
        Self {
            at: now_iso(),
            from: Speaker::Assistant,
            text: text.into(),
            tool: Some(tag.to_string()),
            ok: Some(ok),
            by: Some(by.to_string()),
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
    /// The bot this is the thread of, when it is one. A bot's thread is the
    /// same shape as a conversation with the assistant — you, it, and what it
    /// did — so it is the same record, marked rather than duplicated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_node: Option<i64>,
    /// The feature this is the thread of, when it is one.
    ///
    /// The feature *is* the room: it already exists in the deck, so it gains
    /// a thread rather than a new object beside it. One conversation per
    /// (project, feature), found or made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    /// The node this is the thread of, when it is one — a workspace, a folder,
    /// a project. Any level of the tree can be talked to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<i64>,
    /// Context parts this conversation has switched off, by key.
    ///
    /// Assembly decides what is *available*; this decides what is sent. A
    /// thread where the profile is noise, or where twenty remembered notes are
    /// crowding out the question, should be able to say so — and keep saying
    /// it, which is why it is on the conversation rather than in a menu.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_off: Vec<String>,
    /// Tools this conversation has switched off, by tool id.
    ///
    /// Not a permission: the matrix still decides what may ever run, and this
    /// only decides what is offered in this room. Turning `files` off here
    /// cannot grant it anywhere.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools_off: Vec<String>,
    /// Replacement text for a context part, by key. What you write is what is
    /// sent — assembly is a starting point, not a verdict.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub context_edits: std::collections::BTreeMap<String, String>,
    /// Everyone who has been pulled in, by agent or bot id.
    ///
    /// Being in a thread is free — this list is what a mention writes, and it
    /// carries no permission at all. Being *handed work* is a claim transfer,
    /// which goes through the gate and is not recorded here.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub participants: Vec<String>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

/// Who a turn runs as.
///
/// The assistant and a bot go through one loop: same provider call, same tool
/// gate, same transcript. What differs is the voice and the permissions, and
/// that is all this carries. `agent_id` is what the permission matrix is asked
/// about — an id it has never heard of gets nothing, which is how a bot with
/// no agent can talk without being able to act. `runs_as` is the agent whose
/// provider and model do the talking.
#[derive(Clone, Debug)]
pub struct Persona {
    pub agent_id: String,
    pub runs_as: String,
    pub name: String,
    pub system: String,
    /// Who this persona may hand work to, when that is not the matrix's call.
    ///
    /// A bot has no row in the permission matrix — an unknown id gets nothing,
    /// which is how a bot with no agent cannot act. But a bot *manages*, and
    /// managing is putting work on people: its team. So a bot's gate is its
    /// team list rather than the matrix, and an agent or the assistant keeps
    /// `None` here and is judged by the matrix as before.
    pub may_delegate_to: Option<Vec<String>>,
    /// The feature this persona manages, when it is a bot with a plan. Work
    /// handed over from its own thread lands there, and `work.add` without a
    /// feature named means this one.
    pub plan: Option<String>,
    /// The other managers this one may pass an item to.
    ///
    /// A bot hands work to its team, and a team is agents. But a manager also
    /// has other managers around it — the bots below it in the tree, and any
    /// bot someone pulls into the room — and giving one of them an item is a
    /// different act from starting a session: it goes on *their* plan and is
    /// announced in *their* thread, for them to put someone on.
    ///
    /// The shell fills this in, because `aiw` knows nothing about bots. What
    /// arrives here is a plain list of rooms with plans.
    pub hand_on_to: Vec<Colleague>,
    /// Tools this persona may use without a row in the permission matrix.
    ///
    /// A bot has no row — an id nothing knows gets nothing, which is what
    /// makes a bot with no agent unable to touch the machine. But it left a
    /// bot unable to keep *its own plan* either, while its instructions told
    /// it to, so it read the goal, said something sensible and could change
    /// nothing. That is the "bots only know about goals" complaint, and it was
    /// exactly right.
    ///
    /// Deliberately narrow: what belongs here is managing — the work items of
    /// the feature this persona manages, which are files in the deck. Anything
    /// that reaches the machine — files, git, the terminal, starting an agent
    /// — is still the matrix's call and still happens in a session.
    pub manages_with: Vec<String>,
    /// Words only: no tools this turn, whatever the matrix says.
    ///
    /// This is how an agent answers a mention. Being named in a room is free
    /// and must stay free, and an agent with `files: full` answering `@dev-a
    /// what do you think?` by editing a file would make a mention into a
    /// handover by the back door. Work happens in a session, when someone
    /// hands it an item.
    pub talk_only: bool,
}

/// Another manager, as much of one as `aiw` needs to know: a name, a room,
/// and somewhere to put an item.
#[derive(Clone, Debug, Default)]
pub struct Colleague {
    /// What people type after the `@`.
    pub handle: String,
    pub name: String,
    /// The conversation key of its thread — a node, as far as this is
    /// concerned.
    pub node_id: i64,
    pub project_id: String,
    /// The feature it manages. Without one there is nowhere to put an item,
    /// and saying so is better than putting it nowhere.
    pub plan: Option<String>,
}

impl Persona {
    pub fn assistant(system: &str) -> Self {
        Self {
            agent_id: ASSISTANT_ID.into(),
            runs_as: ASSISTANT_ID.into(),
            name: "Assistant".into(),
            system: system.to_string(),
            may_delegate_to: None,
            plan: None,
            hand_on_to: Vec::new(),
            manages_with: Vec::new(),
            talk_only: false,
        }
    }

    /// An agent speaking in a thread, as itself, with no hands.
    pub fn agent_in_thread(agent: &super::state::AgentDef, thread: &str) -> Self {
        Self {
            agent_id: agent.id.clone(),
            runs_as: agent.id.clone(),
            name: agent.name.clone(),
            system: format!(
                "{}\n\nYou are answering in the thread \u{201c}{thread}\u{201d}, as yourself, \
                 because someone named you. Reply briefly: what you see, what you would do, what \
                 you need. You have no tools in a thread - work happens in a session when someone \
                 hands you an item with @{} take \"...\" - so do not claim to have changed \
                 anything.",
                agent.system.trim(),
                agent.id
            ),
            may_delegate_to: None,
            plan: None,
            hand_on_to: Vec::new(),
            manages_with: Vec::new(),
            talk_only: true,
        }
    }
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
    /// Somebody started or finished a turn. This is what lets a room show,
    /// live, who is thinking: a pill that lights up when you name an agent
    /// and goes out when it has answered.
    Turn {
        conversation_id: String,
        by: String,
        name: String,
        done: bool,
    },
    /// The turn is over; the transcript on disk is now authoritative.
    Done { conversation_id: String },
}

/// One piece of what a turn will be told, named and measured.
///
/// The context used to be a string built in one pass: right for the model,
/// opaque to everyone else. You could not see what was in it, could not tell
/// which part was crowding out the rest, and could not take one out without
/// changing the code. Same assembly, in pieces — and the pieces are what the
/// panel shows and what the turn sends, so the two cannot disagree.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ContextPart {
    /// Stable across assemblies: what "off" and an edit are remembered by.
    pub key: String,
    pub title: String,
    /// Where it came from, in words — a file, a store, a lookup.
    pub source: String,
    /// Which side of the store split it comes from, for the eye rather than
    /// the model: `personal` is yours and never committed, `deck` is the
    /// project's and lives in the vault, `yours` is text you wrote here.
    ///
    /// The same vocabulary the Context page on a feature already uses, so the
    /// two screens do not teach two colour schemes for one idea.
    pub origin: String,
    pub tokens: u32,
    /// Whether this conversation is sending it.
    pub on: bool,
    /// Whether the body below is yours rather than the assembly's.
    pub edited: bool,
    pub body: String,
}

/// One tool as it appears to a turn: what it is, what it may do, what it
/// costs to offer.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ToolLine {
    pub id: String,
    pub title: String,
    pub description: String,
    /// full | read | approval — what the matrix says, which this cannot widen.
    pub permission: String,
    pub actions: u32,
    pub tokens: u32,
    pub on: bool,
}

/// Everything a turn will carry, itemised, with what each piece costs.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ContextView {
    pub parts: Vec<ContextPart>,
    pub tools: Vec<ToolLine>,
    pub system_tokens: u32,
    pub context_tokens: u32,
    pub tool_tokens: u32,
    pub history_turns: u32,
    pub history_tokens: u32,
    pub total_tokens: u32,
}

/// Where progress goes. A no-op is a valid sink, and nothing about
/// correctness may depend on anyone listening: the conversation on disk is the
/// record, and progress is a courtesy.
pub type ChatSink<'a> = &'a (dyn Fn(ChatEvent) + Send + Sync);

/// Says the turn ended, however it ended.
///
/// "Thinking…" beside a name is the interface believing a turn is still
/// running, and it believes that until it is told otherwise. A turn that
/// returned early — a provider that timed out, a conversation that could not
/// be written — told nobody, so the pill span for as long as the app was open
/// while the model call had failed two minutes ago.
///
/// A guard rather than a line at each exit, because the next early return
/// added would forget it again. Dropping is the one thing every path does.
struct TurnEnds<'a> {
    sink: ChatSink<'a>,
    conversation_id: String,
    by: String,
    name: String,
}

impl Drop for TurnEnds<'_> {
    fn drop(&mut self) {
        (self.sink)(ChatEvent::Turn {
            conversation_id: self.conversation_id.clone(),
            by: self.by.clone(),
            name: self.name.clone(),
            done: true,
        });
        (self.sink)(ChatEvent::Done {
            conversation_id: self.conversation_id.clone(),
        });
    }
}

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
    /// And who said it. A room with five things talking in it cannot be
    /// previewed without naming the speaker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_node: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<i64>,
    /// Who is in it, so a list of threads can say so without loading each one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub participants: Vec<String>,
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/// One writer at a time, for every conversation in the process.
///
/// A thread is a file, and appending to it is read-modify-write. Three things
/// post into the same room — the turn you are having, an agent's session
/// ending, a wake's receipt — and without this the last writer to finish wins,
/// silently dropping whatever the others added. It was not theoretical: the
/// first end-to-end run of a handover lost the assistant's own reply.
///
/// Deliberately global rather than per-`Conversations`, because the background
/// thread that reports a session back opens its own handle on the same store.
/// Writes are a few milliseconds, so one gate costs nothing worth measuring.
static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Take the write gate, surviving a panic in whoever held it last: a poisoned
/// lock must not mean the app can never write a message again.
fn writing() -> std::sync::MutexGuard<'static, ()> {
    WRITING.lock().unwrap_or_else(|e| e.into_inner())
}

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

    /// Change something about a conversation that is not a message.
    ///
    /// Under the same lock as appending, and re-reading inside it, because a
    /// conversation is a whole file: a turn appending a message while a
    /// checkbox was being saved would write one of them over the other. That
    /// exact bug ate messages here once already, which is why the gate exists
    /// rather than each writer being careful.
    pub fn update_meta(
        &self,
        id: &str,
        change: impl FnOnce(&mut ConversationMeta),
    ) -> Result<ConversationMeta, String> {
        let _gate = writing();
        let mut conv = self.load(id)?;
        change(&mut conv);
        self.save(&conv)?;
        Ok(conv)
    }

    pub fn create(&self, project_id: Option<&str>) -> Result<ConversationMeta, String> {
        let now = now_iso();
        let meta = ConversationMeta {
            id: new_id("conv"),
            title: "New conversation".into(),
            started_at: now.clone(),
            updated_at: now,
            project_id: project_id.map(str::to_string),
            bot_node: None,
            feature: None,
            node: None,
            participants: Vec::new(),
            messages: Vec::new(),
            ..Default::default()
        };
        self.save(&meta)?;
        Ok(meta)
    }

    /// A feature's thread: found if it exists, made if it does not.
    ///
    /// One per feature per project. The title is the feature's name, and the
    /// first thing said does not rename it — a room is not named after
    /// whoever walked in first.
    pub fn for_feature(
        &self,
        project_id: &str,
        feature_id: &str,
        name: &str,
    ) -> Result<ConversationMeta, String> {
        let _gate = writing();
        if let Some(existing) = self.list().into_iter().find(|c| {
            c.feature.as_deref() == Some(feature_id) && c.project_id.as_deref() == Some(project_id)
        }) {
            return self.load(&existing.id);
        }
        let now = now_iso();
        let meta = ConversationMeta {
            id: new_id("conv"),
            title: name.to_string(),
            started_at: now.clone(),
            updated_at: now,
            project_id: Some(project_id.to_string()),
            bot_node: None,
            feature: Some(feature_id.to_string()),
            node: None,
            participants: Vec::new(),
            messages: Vec::new(),
            ..Default::default()
        };
        self.save(&meta)?;
        Ok(meta)
    }

    /// A node's thread: found if it exists, made if it does not.
    ///
    /// Every level of the tree has one — a workspace, a folder, a project.
    /// What differs between them is what there is to say, not whether you can
    /// say it.
    pub fn for_node(&self, node_id: i64, name: &str) -> Result<ConversationMeta, String> {
        let _gate = writing();
        if let Some(existing) = self.list().into_iter().find(|c| c.node == Some(node_id)) {
            return self.load(&existing.id);
        }
        let now = now_iso();
        let meta = ConversationMeta {
            id: new_id("conv"),
            title: name.to_string(),
            started_at: now.clone(),
            updated_at: now,
            project_id: Some(node_id.to_string()),
            bot_node: None,
            feature: None,
            node: Some(node_id),
            participants: Vec::new(),
            messages: Vec::new(),
            ..Default::default()
        };
        self.save(&meta)?;
        Ok(meta)
    }

    /// A bot's thread: found if it exists, made if it does not.
    ///
    /// One per bot, by the node it lives on. The title is the bot's name and
    /// stays that way — the first thing said does not rename a bot.
    pub fn for_bot(
        &self,
        node_id: i64,
        project_id: &str,
        name: &str,
    ) -> Result<ConversationMeta, String> {
        let _gate = writing();
        if let Some(existing) = self
            .list()
            .into_iter()
            .find(|c| c.bot_node == Some(node_id))
        {
            return self.load(&existing.id);
        }
        let now = now_iso();
        let meta = ConversationMeta {
            id: new_id("conv"),
            title: name.to_string(),
            started_at: now.clone(),
            updated_at: now,
            project_id: Some(project_id.to_string()),
            bot_node: Some(node_id),
            feature: None,
            node: None,
            participants: Vec::new(),
            messages: Vec::new(),
            ..Default::default()
        };
        self.save(&meta)?;
        Ok(meta)
    }

    /// Something the bot said on its own — a wake report — appended without a
    /// turn. The receipt is the log, and the thread is where the receipt goes.
    pub fn post_as_bot(&self, conv_id: &str, text: &str) -> Result<ChatMessage, String> {
        self.post(conv_id, ChatMessage {
            at: now_iso(),
            from: Speaker::Assistant,
            text: text.trim().to_string(),
            tool: Some("wake".into()),
            ok: Some(true),
            by: None,
        })
    }

    /// Append one message to a thread nobody is holding open.
    ///
    /// This is how an agent reports back after the conversation that started
    /// it has moved on, and how a bot posts into a feature's room. Re-reads
    /// before writing, because the thread may have grown since the caller
    /// last saw it — a session takes minutes, and overwriting what was said
    /// while it ran would lose exactly the messages worth keeping.
    pub fn post(&self, conv_id: &str, msg: ChatMessage) -> Result<ChatMessage, String> {
        let _gate = writing();
        let mut conv = self.load(conv_id)?;
        conv.messages.push(msg.clone());
        conv.updated_at = now_iso();
        self.save(&conv)?;
        Ok(msg)
    }

    /// Append a turn's messages to whatever is on disk *now*.
    ///
    /// Everything else about the conversation — its title, who is in it — is
    /// carried over from the turn, because those are the fields a turn
    /// changes. The messages are appended rather than replaced, which is what
    /// makes two things writing to one room safe.
    pub fn append(
        &self,
        conv: &ConversationMeta,
        appended: &[ChatMessage],
    ) -> Result<(), String> {
        let _gate = writing();
        let mut fresh = match self.load(&conv.id) {
            Ok(f) => f,
            // Gone from under us. Saving our copy is the honest fallback: the
            // messages exist and belong somewhere.
            Err(_) => conv.clone(),
        };
        fresh.title = conv.title.clone();
        fresh.feature = conv.feature.clone();
        fresh.node = conv.node;
        fresh.bot_node = conv.bot_node;
        for p in &conv.participants {
            if !fresh.participants.iter().any(|x| x.eq_ignore_ascii_case(p)) {
                fresh.participants.push(p.clone());
            }
        }
        for m in appended {
            // Same instant, same kind, same words, same speaker is the same
            // message — which only happens if a caller retried, and appending
            // it twice would be a second bug on top of the first.
            //
            // "Same kind" is load-bearing. A tool result and the reply that
            // reports it are routinely the same sentence at the same
            // millisecond by the same agent, and without `from` and `tool` in
            // the key the reply was being dropped as a duplicate of its own
            // evidence — which is how a delegation ended with the transcript
            // stopping at the tool call.
            let already = fresh.messages.iter().any(|x| {
                x.at == m.at
                    && x.from == m.from
                    && x.tool == m.tool
                    && x.text == m.text
                    && x.by == m.by
            });
            if !already {
                fresh.messages.push(m.clone());
            }
        }
        // In the order things happened, not in the order they were written.
        // A session that finished mid-turn is appended after the turn's own
        // messages, and a room that reads out of order is a room you have to
        // reconstruct in your head. Timestamps are ISO-8601 UTC, so sorting
        // them as text is sorting them as time; equal ones keep the order they
        // arrived in, which is why this is a stable sort.
        fresh.messages.sort_by(|a, b| a.at.cmp(&b.at));
        fresh.updated_at = now_iso();
        self.save(&fresh)
    }

    /// Record that someone is now in this thread. Idempotent: being mentioned
    /// twice does not make you two participants.
    pub fn add_participant(&self, conv_id: &str, who: &str) -> Result<bool, String> {
        let _gate = writing();
        let mut conv = self.load(conv_id)?;
        if conv.participants.iter().any(|p| p.eq_ignore_ascii_case(who)) {
            return Ok(false);
        }
        conv.participants.push(who.to_string());
        conv.updated_at = now_iso();
        self.save(&conv)?;
        Ok(true)
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
            let last = m
                .messages
                .iter()
                .rev()
                .find(|x| x.from != Speaker::Tool);
            out.push(ConversationSummary {
                preview: last.map(|x| truncate(&x.text, 120)).unwrap_or_default(),
                preview_by: last.and_then(|x| x.by.clone()),
                messages: m.messages.len(),
                id: m.id,
                title: m.title,
                started_at: m.started_at,
                updated_at: m.updated_at,
                project_id: m.project_id,
                bot_node: m.bot_node,
                feature: m.feature,
                node: m.node,
                participants: m.participants,
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
            // Whoever actually said it. A room has several voices in it, and
            // a transcript that calls all of them "Assistant" is unreadable
            // outside the app — which is the one place this rendering is for.
            Speaker::Assistant => match msg.by.as_deref() {
                Some(id) if !id.is_empty() => id.to_string(),
                _ if m.bot_node.is_some() => m.title.clone(),
                _ => "Assistant".to_string(),
            },
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
        let agent = ws
            .agent(ASSISTANT_ID)
            .ok_or_else(|| format!("no '{ASSISTANT_ID}' agent"))?;
        Self::send_as(ws, convs, conversation_id, text, sink, &Persona::assistant(&agent.system))
    }

    /// One turn, as whoever `persona` says. The assistant and every bot come
    /// through here; nothing about the loop knows which it is.
    pub fn send_as(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conversation_id: &str,
        text: &str,
        sink: ChatSink,
        persona: &Persona,
    ) -> Result<AssistantReply, String> {
        Self::turn(ws, convs, conversation_id, text, sink, persona, true)
    }

    /// Answer something that is already in the thread.
    ///
    /// This is what makes a room a room: one message can be answered by more
    /// than one participant. `@qa the suite is red` reaches the bot managing
    /// the feature *and* anyone else it names, and each answers as itself — so
    /// the second one must not post the question again on its way in.
    ///
    /// One hop, deliberately: replies are not re-read for mentions. Two bots
    /// that each name the other would otherwise talk until the budget ran out,
    /// which is a bill rather than a conversation.
    pub fn answer_as(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conversation_id: &str,
        text: &str,
        sink: ChatSink,
        persona: &Persona,
    ) -> Result<AssistantReply, String> {
        Self::turn(ws, convs, conversation_id, text, sink, persona, false)
    }

    #[allow(clippy::too_many_arguments)]
    fn turn(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conversation_id: &str,
        text: &str,
        sink: ChatSink,
        persona: &Persona,
        echo: bool,
    ) -> Result<AssistantReply, String> {
        if text.trim().is_empty() {
            return Err("nothing to send".into());
        }
        let mut conv = convs.load(conversation_id)?;
        let agent = ws
            .agent(&persona.runs_as)
            .ok_or_else(|| format!("no '{}' agent", persona.runs_as))?;
        let me: &str = &persona.agent_id;

        // The first thing said names the conversation. Better than "New
        // conversation" forever, and cheaper than asking a model for a title.
        // A bot's thread is already named after the bot.
        if echo && conv.messages.is_empty() && conv.bot_node.is_none() && conv.feature.is_none()
            && conv.node.is_none()
        {
            conv.title = truncate(text.trim(), 60);
        }
        let mut appended: Vec<ChatMessage> = Vec::new();
        if echo {
            let said = ChatMessage::said(Speaker::User, text.trim());
            conv.messages.push(said.clone());
            appended.push(said);
        }

        // A message can pull people in and hand work over before anything has
        // answered it. Both are facts about the thread rather than something a
        // model decides, so they happen here and are recorded as receipts.
        let mut delegated: Vec<String> = Vec::new();
        for note in if echo {
            Self::pull_in(ws, &mut conv, text, persona)
        } else {
            Vec::new()
        } {
            appended.push(note.clone());
            sink(ChatEvent::Step {
                conversation_id: conv.id.clone(),
                message: note,
            });
        }
        if let Some(h) = mentions::handover(text).filter(|_| echo) {
            let note = Self::hand_over(ws, convs, &conv, persona, &h, &mut delegated);
            conv.messages.push(note.clone());
            appended.push(note.clone());
            sink(ChatEvent::Step {
                conversation_id: conv.id.clone(),
                message: note,
            });
        }

        let scope = match &conv.project_id {
            Some(p) => EventScope::project(p).with_agent(me),
            None => EventScope::default().with_agent(me),
        };
        let started = ws.bus.emit(DomainEvent::new(
            EventType::AgentStarted,
            scope.clone(),
            serde_json::json!({ "name": agent.name, "conversation": conv.id }),
        ));

        sink(ChatEvent::Turn {
            conversation_id: conv.id.clone(),
            by: persona.agent_id.clone(),
            name: persona.name.clone(),
            done: false,
        });
        // From here on the turn is live in the interface, and every way out of
        // this function — answered, refused, timed out, panicked — has to put
        // that light out.
        let _ends = TurnEnds {
            sink,
            conversation_id: conv.id.clone(),
            by: persona.agent_id.clone(),
            name: persona.name.clone(),
        };

        let mut tools = if persona.talk_only {
            Vec::new()
        } else {
            let mut t = super::tools::definitions_for(me, &ws.permission_matrix());
            // A manager's own plan, offered even though a bot has no row.
            for id in &persona.manages_with {
                for extra in super::tools::definitions_of(id) {
                    if !t.iter().any(|d| d.name == extra.name) {
                        t.push(extra);
                    }
                }
            }
            t
        };
        // Switched off for this room. Not a permission — the matrix still
        // decides what may ever run, and this only decides what is offered
        // here. A thread about planning does not need `terminal` in front of
        // it, and every tool offered is prompt spent whether it is used or not.
        if !conv.tools_off.is_empty() {
            tools.retain(|t| {
                let tool = t.name.split('_').next().unwrap_or("");
                !conv.tools_off.iter().any(|off| off == tool)
            });
        }

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
        let mut reply = String::new();
        let mut turn = 0u32;

        while turn < MAX_TURNS {
            let request = AgentRequest {
                agent_id: me.to_string(),
                role: agent.role.clone(),
                model: agent.model.clone(),
                system: Self::system_prompt(ws, convs, &conv, &persona.system),
                context: Self::context(ws, convs, &conv),
                goal: text.trim().to_string(),
                tools: tools.clone(),
                observations: observations.clone(),
                turn,
                history: Self::history(&conv),
            };

            let started_at = std::time::Instant::now();
            let outcome: Result<AgentResponse, String> = {
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
                })
            };
            // Recorded either way. A turn that failed is the one you most
            // want to read afterwards.
            ws.log_call(super::state::CallRecord {
                at: chrono::Local::now().timestamp_millis(),
                speaker: persona.agent_id.clone(),
                speaker_name: persona.name.clone(),
                kind: if persona.agent_id.starts_with("bot:") {
                    "bot".into()
                } else if persona.agent_id == ASSISTANT_ID {
                    "assistant".into()
                } else {
                    "agent".into()
                },
                runs_as: agent.id.clone(),
                provider: agent.provider.clone(),
                model: agent.model.clone(),
                project_id: conv.project_id.clone().unwrap_or_default(),
                project_name: conv
                    .project_id
                    .as_deref()
                    .and_then(|p| ws.project(p))
                    .map(|p| p.name.clone())
                    .unwrap_or_default(),
                feature: conv.feature.clone().unwrap_or_default(),
                conversation: conv.id.clone(),
                session: String::new(),
                turn,
                ms: started_at.elapsed().as_millis() as i64,
                ok: outcome.is_ok(),
                error: outcome.as_ref().err().cloned().unwrap_or_default(),
                prompt: format!(
                    "# system\n{}\n\n# context\n{}\n\n# goal\n{}",
                    request.system, request.context, request.goal
                ),
                reply: outcome
                    .as_ref()
                    .map(|r| r.message.clone())
                    .unwrap_or_default(),
                tools: request.tools.len(),
                usage: outcome.as_ref().ok().and_then(|r| r.usage),
            });
            let response: AgentResponse = match outcome {
                Ok(r) => r,
                Err(e) => {
                    // Into the transcript as well as the log. A turn that died
                    // silently left a thread whose last word was the question,
                    // which reads exactly like an answer still coming.
                    let note = ChatMessage::note(
                        &persona.agent_id,
                        "turn",
                        false,
                        format!("{} could not answer: {e}", persona.name),
                    );
                    let _ = convs.append(&conv, std::slice::from_ref(&note));
                    sink(ChatEvent::Step {
                        conversation_id: conv_id.clone(),
                        message: note,
                    });
                    return Err(e);
                }
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
                            persona.plan.as_deref(),
                            &persona.manages_with,
                            me,
                            call,
                            &scope,
                            &started,
                            &mut delegated,
                            persona.talk_only,
                        );
                        let msg = ChatMessage {
                            at: now_iso(),
                            from: Speaker::Tool,
                            text: truncate(&output, 600),
                            tool: Some(format!("{}.{}", call.tool, call.action)),
                            ok: Some(ok),
                            by: Some(me.to_string()),
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

        let mut msg = ChatMessage::said(Speaker::Assistant, &reply);
        // In a room with several bots in it, "who said this" cannot be
        // inferred from the conversation's title.
        msg.by = Some(persona.agent_id.clone());
        conv.messages.push(msg.clone());
        appended.push(msg);

        // What the speaker *said* is read the same way what you said was:
        // `@qa` pulls qa in, `@dev-a take "…"` hands the work over — gated by
        // what this speaker may do. Before this, a bot that wrote "I've
        // handed dev-a the item" had done nothing, and nothing on screen said
        // so. It is bounded: a reply may cause at most a few handovers per
        // human message, so two managers cannot pass work between themselves
        // until the budget is the bill.
        if !persona.talk_only && Self::auto_budget_left(&conv) {
            for note in Self::pull_in(ws, &mut conv, &reply, persona) {
                appended.push(note.clone());
                sink(ChatEvent::Step {
                    conversation_id: conv_id.clone(),
                    message: note,
                });
            }
            if let Some(h) = mentions::handover(&reply) {
                let note = Self::hand_over(ws, convs, &conv, persona, &h, &mut delegated);
                conv.messages.push(note.clone());
                appended.push(note.clone());
                sink(ChatEvent::Step {
                    conversation_id: conv_id.clone(),
                    message: note,
                });
            }
        }
        conv.updated_at = now_iso();

        // Write by appending to what is on disk *now*, not by saving the copy
        // this turn started with.
        //
        // A turn holds its copy for as long as the model takes, and things
        // arrive in the meantime: a wake posting a receipt, an agent reporting
        // back, another participant answering the same question. Saving our
        // copy would silently drop every one of them — and a thread that
        // quietly loses messages is worse than one that fails loudly, because
        // you only notice weeks later when the message you remember is gone.
        convs.append(&conv, &appended)?;

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

        // `_ends` says the turn is over, on this path and on every other.

        Ok(AssistantReply {
            conversation_id: conv.id,
            reply,
            appended,
            delegated,
            turns: turn,
        })
    }

    /// Wake an agent from a thread, because a person asked.
    ///
    /// In a feature's room there is work to give it, so this starts a session
    /// on that feature and the session reports back here when it ends — the
    /// pill goes to *working*. Anywhere else there is nothing to hand it, so
    /// it reads the thread and answers as itself. Both are things a person
    /// did, which is why neither goes through the delegate gate: the gate
    /// is for one agent moving another's work.
    pub fn wake_into_thread(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conversation_id: &str,
        agent_id: &str,
        sink: ChatSink,
    ) -> Result<String, String> {
        let conv = convs.load(conversation_id)?;
        let agent = ws
            .agent(agent_id)
            .ok_or_else(|| format!("no agent '{agent_id}'"))?;
        if agent.id == ASSISTANT_ID {
            return Err("the assistant is always awake — just say something".into());
        }

        if let (Some(project_id), Some(feature_id)) = (conv.project_id.clone(), conv.feature.clone())
        {
            convs.add_participant(conversation_id, &agent.id)?;
            let cmd = StartAgentCommand {
                project_id,
                feature_id: feature_id.clone(),
                agent_id: agent.id.clone(),
                work_item_id: None,
                intent: Some(format!(
                    "Woken from the thread by a person: read the thread, pick up what is open on \
                     {feature_id}, and report back"
                )),
                areas: Vec::new(),
                depends_on: Vec::new(),
                unattended: false,
                stop_at: Vec::new(),
            };
            let live = AgentRuntime::begin(ws, &cmd)?;
            convs.post(
                conversation_id,
                ChatMessage::note(
                    &agent.id,
                    "handover",
                    true,
                    format!("@{} woken by you — working on {feature_id}", agent.id),
                ),
            )?;
            Self::drive_and_report(ws, convs, live, conversation_id.to_string(), &agent);
            return Ok(format!("{} is working on {feature_id}", agent.name));
        }

        // No work to give it here: it talks.
        convs.add_participant(conversation_id, &agent.id)?;
        let who = Persona::agent_in_thread(&agent, &conv.title);
        Self::answer_as(
            ws,
            convs,
            conversation_id,
            "You were woken by the person reading this thread. Read it and say, briefly, what you \
             see and what you would do first.",
            sink,
            &who,
        )?;
        Ok(format!("{} answered", agent.name))
    }

    /// Whether a reply may still cause a handover on its own.
    ///
    /// Three per human message. A person saying something resets it; a bot
    /// saying something does not. That is the whole loop-breaker: two
    /// managers who each write "@you take it" at each other run out of
    /// budget on the third pass and have to wait for a person.
    fn auto_budget_left(conv: &ConversationMeta) -> bool {
        let since_user = conv
            .messages
            .iter()
            .rev()
            .take_while(|m| m.from != Speaker::User)
            .filter(|m| m.tool.as_deref() == Some("handover") && m.ok == Some(true))
            .count();
        since_user < 3
    }

    /// Pull the people this message mentions into the thread.
    ///
    /// Free, and deliberately so: a mention costs nothing, needs nobody's
    /// permission, and gives the mentioned party exactly one thing — this
    /// thread, from here on. Work changing hands is [`Self::hand_over`], and
    /// it is a different thing with a different gate.
    ///
    /// Only agents are resolved here. A bot is a file in a folder that this
    /// layer knows nothing about, so the caller registers those before the
    /// turn starts — which is why `participants` is a plain list of names
    /// rather than anything typed.
    fn pull_in(
        ws: &Arc<Workspace>,
        conv: &mut ConversationMeta,
        text: &str,
        persona: &Persona,
    ) -> Vec<ChatMessage> {
        let mut notes = Vec::new();
        for name in mentions::mentions(text) {
            if conv.participants.iter().any(|p| p.eq_ignore_ascii_case(&name)) {
                continue;
            }
            let Some(agent) = ws.agent(&name) else { continue };
            conv.participants.push(agent.id.clone());
            let note = ChatMessage::note(
                &agent.id,
                "pulled-in",
                true,
                format!(
                    "@{} pulled in by {} — reads this thread from here on",
                    agent.id, persona.name
                ),
            );
            conv.messages.push(note.clone());
            notes.push(note);
        }
        notes
    }

    /// Move a work item to somebody.
    ///
    /// This is the line the whole design rests on: being in a thread is free,
    /// being handed work is a claim transfer. So it goes through the same gate
    /// as `delegate.start` — if the speaker may not delegate, the claim does
    /// not move, and the thread says so rather than quietly doing nothing.
    fn hand_over(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conv: &ConversationMeta,
        persona: &Persona,
        h: &Handover,
        delegated: &mut Vec<String>,
    ) -> ChatMessage {
        let refuse = |why: String| ChatMessage::note(&persona.agent_id, "handover", false, why);

        // A feature's room names its feature. A bot's own thread does not,
        // but the bot has a plan, and that plan is a feature — so work handed
        // over from a bot's thread goes onto the bot's plan.
        let feature_id = conv.feature.clone().or_else(|| persona.plan.clone());
        let (Some(project_id), Some(feature_id)) = (conv.project_id.clone(), feature_id) else {
            return refuse(
                "Work changes hands inside a feature — this thread is not one and nobody here \
                 has a plan, so nothing moved."
                    .into(),
            );
        };
        // Passing it to another manager is a different act from starting a
        // session, and it is checked first: the receiver is a room with a
        // plan, not an agent with hands.
        if let Some(c) = persona
            .hand_on_to
            .iter()
            .find(|c| c.handle.eq_ignore_ascii_case(&h.agent))
            .cloned()
        {
            return Self::hand_on(ws, convs, conv, persona, h, &c);
        }

        // The gate. For an agent or the assistant it is the matrix, and an id
        // the matrix has never heard of gets nothing. For a bot it is its
        // team: a manager may put work on the people it manages and nobody
        // else, which is what a team list is for.
        //
        // With one addition: itself. A bot that names an agent runs as that
        // agent, and a manager rolling up its sleeves on its own plan needs no
        // permission from a team list it is not on. It still goes through a
        // session, so the work still leaves a receipt.
        let mine = !persona.runs_as.is_empty()
            && persona.runs_as != ASSISTANT_ID
            && (h.agent.eq_ignore_ascii_case(&persona.runs_as)
                || h.agent.eq_ignore_ascii_case("me")
                || h.agent.eq_ignore_ascii_case("self"));
        let allowed = mine
            || match &persona.may_delegate_to {
                Some(team) => team.iter().any(|t| t.eq_ignore_ascii_case(&h.agent)),
                None => !matches!(
                    ws.permission_matrix().get(&persona.agent_id, TOOL_DELEGATE),
                    super::tools::Permission::None
                ),
            };
        if !allowed {
            return refuse(match &persona.may_delegate_to {
                Some(team) if team.is_empty() => format!(
                    "{} has no team, so there is nobody it may hand work to. Nothing moved.",
                    persona.name
                ),
                Some(team) => format!(
                    "{} may only hand work to its team ({}), and @{} is not on it. Nothing moved.",
                    persona.name,
                    team.join(", "),
                    h.agent
                ),
                None => format!(
                    "{} may not hand work over — that goes through the same gate as \
                     delegate.start, and it is not granted here. Nothing moved.",
                    persona.name
                ),
            });
        }
        let wanted_agent = if mine { persona.runs_as.clone() } else { h.agent.clone() };
        let Some(agent) = ws.agent(&wanted_agent) else {
            return refuse(format!(
                "Nobody here is called @{wanted_agent}, so nothing moved."
            ));
        };
        let Some(project) = ws.project(&project_id) else {
            return refuse(format!("No project '{project_id}', so nothing moved."));
        };
        let wanted = h.what.trim().to_lowercase();
        if wanted.is_empty() {
            return refuse("Say which work item to hand over.".into());
        }
        let deck = project.deck();
        let mut items = deck
            .work(&feature_id)
            .map(|w| w.meta.items)
            .unwrap_or_default();
        let found = items
            .iter()
            .position(|i| i.id.to_lowercase() == wanted || i.title.to_lowercase() == wanted)
            .or_else(|| items.iter().position(|i| i.title.to_lowercase().contains(&wanted)));
        let item = match found {
            Some(i) => items[i].clone(),
            // A manager saying "take this" about something not on the plan is
            // the act of putting it on the plan. Only a manager: an agent or
            // the assistant naming an item that does not exist is naming the
            // wrong thing, and the honest answer to that is still no.
            None if persona.plan.as_deref() == Some(feature_id.as_str()) => {
                let title = h.what.trim();
                let new_item = super::deck::WorkItem {
                    id: format!("w{:02}-{}", items.len() + 1, super::deck::slugify(title)),
                    title: title.to_string(),
                    status: "unclaimed".into(),
                    assignee: None,
                    areas: Vec::new(),
                    due: None,
                };
                items.push(new_item.clone());
                let meta = super::deck::WorkMeta {
                    feature: feature_id.clone(),
                    items: items.clone(),
                };
                if let Err(e) = deck.save_work(&feature_id, &meta) {
                    return refuse(format!("could not add “{title}” to the plan: {e}"));
                }
                new_item
            }
            None => {
                return refuse(format!(
                    "No work item on {feature_id} matching “{}”, so nothing moved.",
                    h.what
                ));
            }
        };
        let item = &item;
        let was = if item.status.trim().is_empty() {
            "unclaimed".to_string()
        } else {
            item.status.clone()
        };

        let cmd = StartAgentCommand {
            project_id,
            feature_id,
            agent_id: agent.id.clone(),
            work_item_id: Some(item.id.clone()),
            intent: Some(format!("{} handed this over: {}", persona.name, item.title)),
            areas: Vec::new(),
            depends_on: Vec::new(),
            unattended: false,
            stop_at: Vec::new(),
        };
        let live = match AgentRuntime::begin(ws, &cmd) {
            Ok(l) => l,
            Err(e) => return refuse(format!("{} could not take it: {e}", agent.id)),
        };
        delegated.push(live.session_id.clone());
        Self::drive_and_report_to(ws, convs, live, conv.id.clone(), &agent, Some(persona.clone()));

        ChatMessage::note(
            &agent.id,
            "handover",
            true,
            format!(
                "“{}” claimed by @{} — was {was}. Handed over by {}.",
                item.title, agent.id, persona.name
            ),
        )
    }

    /// Give an item to another manager.
    ///
    /// Not a session: a manager is not a pair of hands, so this puts the item
    /// on *their* plan and says so in *their* room, which is where they will
    /// see it and put someone on it. The sender's own copy is marked as passed
    /// on rather than deleted — two rows, one on each side, so neither board
    /// quietly loses the item and the Team page can show it moving.
    ///
    /// Everything here is refusable and says why. "I gave it to the platform
    /// bot" with nothing on the platform bot's plan is exactly the sentence
    /// this whole design exists to prevent.
    fn hand_on(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conv: &ConversationMeta,
        persona: &Persona,
        h: &Handover,
        to: &Colleague,
    ) -> ChatMessage {
        let refuse = |why: String| ChatMessage::note(&persona.agent_id, "handover", false, why);
        let title = h.what.trim().to_string();
        if title.is_empty() {
            return refuse("Say which work item to pass on.".into());
        }
        let Some(plan) = to.plan.clone().filter(|p| !p.trim().is_empty()) else {
            return refuse(format!(
                "{} manages no feature, so there is nowhere to put “{title}”. Nothing moved.",
                to.name
            ));
        };
        let Some(project) = ws.project(&to.project_id) else {
            return refuse(format!(
                "{} belongs to a space this cannot reach, so nothing moved.",
                to.name
            ));
        };

        // On their plan. An item already there is not added twice — being told
        // about it again is not a second piece of work.
        let deck = project.deck();
        let mut work = deck.work(&plan).map(|w| w.meta).unwrap_or(super::deck::WorkMeta {
            feature: plan.clone(),
            items: vec![],
        });
        let already = work
            .items
            .iter()
            .any(|i| i.title.eq_ignore_ascii_case(&title));
        let their_id = if already {
            work.items
                .iter()
                .find(|i| i.title.eq_ignore_ascii_case(&title))
                .map(|i| i.id.clone())
                .unwrap_or_default()
        } else {
            let id = format!(
                "w{:02}-{}",
                work.items.len() + 1,
                super::deck::slugify(&title)
            );
            work.items.push(super::deck::WorkItem {
                id: id.clone(),
                title: title.clone(),
                status: "unclaimed".into(),
                assignee: None,
                areas: Vec::new(),
                due: None,
            });
            if let Err(e) = deck.save_work(&plan, &work) {
                return refuse(format!("could not put “{title}” on {}: {e}", to.name));
            }
            id
        };

        // The sender's own copy, if it has one, records where it went.
        let mut mine_note = String::new();
        if let (Some(project_id), Some(feature)) =
            (conv.project_id.clone(), conv.feature.clone().or_else(|| persona.plan.clone()))
        {
            if let Some(p) = ws.project(&project_id) {
                let d = p.deck();
                if let Ok(w) = d.work(&feature) {
                    let mut meta = w.meta;
                    if let Some(i) = meta
                        .items
                        .iter_mut()
                        .find(|i| i.title.eq_ignore_ascii_case(&title))
                    {
                        i.status = "passed on".into();
                        i.assignee = Some(to.handle.clone());
                        if d.save_work(&feature, &meta).is_ok() {
                            mine_note = format!(" Marked passed on, on {feature}.");
                        }
                    }
                }
            }
        }

        // Their room hears about it, from the manager who asked.
        match convs.for_bot(to.node_id, &to.project_id, &to.name) {
            Ok(room) => {
                let _ = convs.post(
                    &room.id,
                    ChatMessage::note(
                        &persona.agent_id,
                        "handover",
                        true,
                        format!(
                            "{} passed “{title}” to you — it is on {plan} as {their_id}, \
                             unclaimed. Put someone on it with @name take \"{title}\".",
                            persona.name
                        ),
                    ),
                );
            }
            Err(e) => {
                return refuse(format!(
                    "“{title}” is on {}'s plan as {their_id}, but its thread could not be \
                     reached to tell it: {e}",
                    to.name
                ));
            }
        }

        ChatMessage::note(
            &persona.agent_id,
            "handover",
            true,
            format!(
                "“{title}” passed to @{} — {} on {plan}, unclaimed, and said so in its thread.{mine_note} \
                 A manager takes work by putting someone on it, so nothing is running yet.",
                to.handle,
                if already {
                    "already".to_string()
                } else {
                    format!("added as {their_id}")
                }
            ),
        )
    }

    /// Run a session in the background and report back into the thread it came
    /// from.
    ///
    /// The reporting is the point. A session started from a conversation and
    /// finishing somewhere else is how "I put dev-a on it" becomes a claim
    /// nobody can check — so the thread that started it gets one message when
    /// it ends, in the receipt shape: what ran, what changed, what it could
    /// not do.
    fn drive_and_report(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        live: LiveSession,
        conv_id: String,
        agent: &super::state::AgentDef,
    ) {
        Self::drive_and_report_to(ws, convs, live, conv_id, agent, None)
    }

    /// As above, and then whoever manages the room reacts to the receipt.
    ///
    /// Agent-to-bot is the half of the conversation that was missing: dev-a
    /// finished and said so, and the manager that put it there said nothing.
    /// One reaction per receipt, as a talkless turn budgeted like any other,
    /// so a manager cannot answer its own answer forever.
    fn drive_and_report_to(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        live: LiveSession,
        conv_id: String,
        agent: &super::state::AgentDef,
        host: Option<Persona>,
    ) {
        let bg = ws.clone();
        let who = agent.id.clone();
        let name = agent.name.clone();
        // The store this conversation actually came from. Asking the workspace
        // for its own would be the same object in the app and a different one
        // anywhere the caller opened its own — and a receipt written into the
        // wrong store is a receipt nobody ever sees.
        let store = convs.store().clone();
        std::thread::spawn(move || {
            let line = match AgentRuntime::drive(&bg, live) {
                Ok(out) => format!(
                    "{name} finished — {} turn{}, {} file{} touched, {} refused.\n{}",
                    out.turns,
                    if out.turns == 1 { "" } else { "s" },
                    out.files_touched.len(),
                    if out.files_touched.len() == 1 { "" } else { "s" },
                    out.refused,
                    out.summary.trim(),
                ),
                Err(e) => {
                    eprintln!("[aiw] delegated session failed: {e}");
                    format!("{name} could not finish — {e}")
                }
            };
            // Best effort, and it says so: the session happened whether or not
            // its receipt could be written, and failing the run over its
            // transcript would be backwards.
            let convs = Conversations::new(store);
            let posted = convs
                .post(
                    &conv_id,
                    ChatMessage::note(&who, "session", !line.contains("could not finish"), line.clone()),
                )
                .map(|_| ());
            if let Err(e) = posted {
                eprintln!("[aiw] {who} finished but its receipt could not be written: {e}");
                return;
            }
            // The manager reads the receipt and says what happens next.
            if let Some(h) = host {
                let quiet = |_: ChatEvent| {};
                let prompt = format!(
                    "@{who} reported back: {line}\nSay, briefly, what that means for the goal \
                     and what happens next."
                );
                if let Err(e) = Self::answer_as(&bg, &convs, &conv_id, &prompt, &quiet, &h) {
                    eprintln!("[aiw] {} could not react to {who}'s receipt: {e}", h.name);
                }
            }
        });
    }

    /// Run one tool call. Assistant-only tools are handled here; everything
    /// else goes through the project's `ToolService` and its permission gate,
    /// approval prompt included.
    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    fn run_tool(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conv: &ConversationMeta,
        persona_plan: Option<&str>,
        // The tools this persona manages with, allowed without a matrix row.
        persona_manages: &[String],
        me: &str,
        call: &ToolCall,
        scope: &EventScope,
        cause: &DomainEvent,
        delegated: &mut Vec<String>,
        talk_only: bool,
    ) -> (bool, String) {
        if talk_only {
            return (
                false,
                format!(
                    "'{}' is not available in a thread - this is a conversation, not a session. \
                     Say what you would do; someone can hand you the item.",
                    call.tool
                ),
            );
        }
        if is_assistant_tool(&call.tool) {
            // Still permission-checked: the orchestrator's right to spawn
            // agents is revocable like anything else — and a bot's is decided
            // by its own row in the matrix, not the assistant's.
            let permission = ws.permission_matrix().get(me, &call.tool);
            let manages = persona_manages.iter().any(|t| t == &call.tool);
            if !manages && matches!(permission, super::tools::Permission::None) {
                return (
                    false,
                    format!("'{}' is denied for {me}", call.tool),
                );
            }
            return match call.tool.as_str() {
                TOOL_DELEGATE => Self::delegate(ws, convs, conv, call, delegated),
                TOOL_MEMORY => Self::memory(convs, conv, call),
                TOOL_BOTS => Self::make_bot(ws, conv, me, call, scope, cause),
                TOOL_ROUTINE => Self::make_routine(ws, conv, me, call, scope, cause),
                TOOL_SKILL => Self::save_skill(ws, call),
                TOOL_WORK => Self::plan_work(ws, conv, persona_plan, call),
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
            .execute(&ws.bus, me, scope, call, Some(cause));
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
        me: &str,
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

        let outcome = ws.ask_approval(me, call, scope, cause);
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

    /// Turn a sentence into a routine.
    ///
    /// Asked first, always, for the same reason a bot is: it keeps happening
    /// after the conversation ends. And refused outright when nobody is
    /// watching — a run started by a clock that quietly adds more clock rows
    /// is how a machine fills up with things nobody remembers agreeing to.
    fn make_routine(
        ws: &Arc<Workspace>,
        conv: &ConversationMeta,
        me: &str,
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
                "a routine belongs to a space — pick one for this conversation first".into(),
            );
        };
        let what = s("what");
        if what.is_empty() {
            return (false, "say what the routine is for".into());
        }
        if !ws.can_make_routines() {
            return (false, "this build cannot create routines".into());
        }
        if scope.unattended {
            return (
                false,
                "setting up a routine needs a person to say yes, and this run has nobody watching"
                    .into(),
            );
        }
        let outcome = ws.ask_approval(me, call, scope, cause);
        if !outcome.allows() {
            return (false, format!("not set up — {outcome:?}"));
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
        match ws.make_routine(super::state::RoutineDraft {
            project_id: project_id.to_string(),
            what,
            every,
            at_min: at_min.clamp(0, 1439),
            on: s("on"),
        }) {
            Ok(note) => (true, note),
            Err(e) => (false, e),
        }
    }

    fn delegate(
        ws: &Arc<Workspace>,
        convs: &Conversations,
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
                    stop_at: Vec::new(),
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
                // make the assistant useless exactly when it is doing the most
                // — so it runs in the background and reports back into this
                // thread when it is done.
                let Some(def) = ws.agent(&agent_id) else {
                    return (false, format!("no agent '{agent_id}'"));
                };
                Self::drive_and_report(ws, convs, live, conv.id.clone(), &def);

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

    /// Add an item to a plan, or mark one.
    ///
    /// Not gated by the matrix. A manager's plan is its own `work.md`, inside
    /// the deck of the space it manages; touching that is what managing is,
    /// not a reach into the machine. The item's status is honest from the
    /// start — unclaimed — and the Work view is what it looks like.
    fn plan_work(
        ws: &Arc<Workspace>,
        conv: &ConversationMeta,
        plan: Option<&str>,
        call: &ToolCall,
    ) -> (bool, String) {
        let s = |k: &str| call.args.get(k).and_then(|v| v.as_str()).unwrap_or("").trim();
        let Some(project_id) = conv.project_id.as_deref() else {
            return (false, "a work item belongs to a space — pick one first".into());
        };
        let Some(project) = ws.project(project_id) else {
            return (false, format!("no project '{project_id}'"));
        };
        let feature = match (conv.feature.as_deref(), plan, s("feature")) {
            (_, _, f) if !f.is_empty() => f.to_string(),
            (Some(f), _, _) => f.to_string(),
            (None, Some(p), _) => p.to_string(),
            _ => return (false, "which feature? this thread has none and you manage none".into()),
        };
        let deck = project.deck();
        match call.action.as_str() {
            "add" => {
                let title = s("title");
                if title.is_empty() {
                    return (false, "a work item needs a title".into());
                }
                let mut work = deck.work(&feature).unwrap_or_else(|_| Doc {
                    meta: super::deck::WorkMeta {
                        feature: feature.clone(),
                        items: vec![],
                    },
                    body: String::new(),
                });
                let id = format!("w{:02}-{}", work.meta.items.len() + 1, super::deck::slugify(title));
                work.meta.items.push(super::deck::WorkItem {
                    id: id.clone(),
                    title: title.to_string(),
                    status: "unclaimed".into(),
                    assignee: None,
                    areas: Vec::new(),
                    due: None,
                });
                match deck.save_work(&feature, &work.meta) {
                    Ok(()) => (
                        true,
                        format!("Added “{title}” to {feature} as {id}, unclaimed. Hand it to someone with @name take \"{title}\"."),
                    ),
                    Err(e) => (false, e),
                }
            }
            "list" => match deck.work(&feature) {
                Ok(w) if w.meta.items.is_empty() => (true, format!("{feature} has no work items yet.")),
                Ok(w) => (
                    true,
                    w.meta
                        .items
                        .iter()
                        .map(|i| format!("- {} · {} · {}{}", i.id, i.title, i.status, i.assignee.as_deref().map(|a| format!(" · {a}")).unwrap_or_default()))
                        .collect::<Vec<_>>()
                        .join("\n"),
                ),
                Err(e) => (false, e),
            },
            // Ticking one off and letting one go. Both find the item the same
            // way `take` does — by id, then by exact title, then by a title
            // that contains what was said — so a manager can name an item the
            // way it appears in the thread rather than by its slug.
            "done" | "drop" => {
                let wanted = s("title").to_lowercase();
                if wanted.is_empty() {
                    return (false, "which item? name it by title or id".into());
                }
                let mut work = match deck.work(&feature) {
                    Ok(w) => w.meta,
                    Err(e) => return (false, e),
                };
                let found = work
                    .items
                    .iter()
                    .position(|i| i.id.to_lowercase() == wanted || i.title.to_lowercase() == wanted)
                    .or_else(|| {
                        work.items
                            .iter()
                            .position(|i| i.title.to_lowercase().contains(&wanted))
                    });
                let Some(at) = found else {
                    return (
                        false,
                        format!("nothing on {feature} matches “{}”, so nothing changed", s("title")),
                    );
                };
                let was = work.items[at].status.clone();
                let title = work.items[at].title.clone();
                if call.action == "done" {
                    work.items[at].status = "done".into();
                } else {
                    work.items[at].status = "unclaimed".into();
                    work.items[at].assignee = None;
                }
                match deck.save_work(&feature, &work) {
                    Ok(()) if call.action == "done" => {
                        (true, format!("Marked “{title}” done on {feature} — was {was}."))
                    }
                    Ok(()) => (
                        true,
                        format!("Let “{title}” go on {feature} — unclaimed again, was {was}."),
                    ),
                    Err(e) => (false, e),
                }
            }
            other => (false, format!("unknown work action '{other}'")),
        }
    }

    /// Write down how something is done.
    ///
    /// Not gated by a prompt, unlike a bot or a routine, and the difference is
    /// real rather than a convenience: a skill is words. It installs nothing,
    /// runs nothing and grants nothing — an agent has to be pointed at it
    /// before it changes anything, and that is a separate act. What the
    /// receipt must do is say exactly what was written and where.
    fn save_skill(ws: &Arc<Workspace>, call: &ToolCall) -> (bool, String) {
        if call.action != "save" {
            return (false, format!("unknown skill action '{}'", call.action));
        }
        let s = |k: &str| call.args.get(k).and_then(|v| v.as_str()).unwrap_or("").trim();
        let (name, body) = (s("name"), s("body"));
        if name.is_empty() || body.is_empty() {
            return (false, "a skill needs a name and instructions".into());
        }
        match ws.save_skill(&Doc {
            meta: super::personal::SkillMeta {
                name: name.to_string(),
                description: s("description").to_string(),
            },
            body: body.to_string(),
        }) {
            Ok(()) => (
                true,
                format!(
                    "Saved the skill “{name}” to your personal store, outside every repository. \
                     It changes nothing until an agent names it under skills:."
                ),
            ),
            Err(e) => (false, e),
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
    /// The context this conversation will send, as the pieces it is made of.
    ///
    /// One function builds both the string and the breakdown, so what the
    /// panel shows and what the model receives cannot drift — a panel that
    /// describes a *different* assembly than the one that ran is worse than no
    /// panel, because it is believed.
    pub fn context_parts(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conv: &ConversationMeta,
    ) -> Vec<ContextPart> {
        let mut out: Vec<ContextPart> = Vec::new();
        let mut add = |key: &str, title: &str, source: &str, origin: &str, body: String| {
            if body.trim().is_empty() {
                return;
            }
            let edited = conv.context_edits.get(key).cloned();
            let body = edited.clone().unwrap_or(body);
            out.push(ContextPart {
                tokens: super::context::estimate_tokens(&body) as u32,
                key: key.to_string(),
                title: title.to_string(),
                source: source.to_string(),
                // What you wrote is yours, whatever assembled the original.
                origin: if edited.is_some() { "yours" } else { origin }.to_string(),
                on: !conv.context_off.iter().any(|k| k == key),
                edited: edited.is_some(),
                body,
            });
        };

        let profile = convs.store().profile();
        if !profile.body.trim().is_empty() || !profile.meta.preferences.is_empty() {
            let mut s = String::from("## About you (personal, never committed)\n");
            for p in &profile.meta.preferences {
                s.push_str(&format!("- {p}\n"));
            }
            if !profile.body.trim().is_empty() {
                s.push_str(&format!("\n{}\n", profile.body.trim()));
            }
            add("profile", "About you", "personal store · profile", "personal", s);
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
            add("memory", "Remembered", "personal store · memory", "personal", s);
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
                add("project", "Project in focus", ".devdeck · features", "deck", s);
            }
        }

        out
    }

    /// The same context, as the string a turn actually sends.
    pub fn context(ws: &Arc<Workspace>, convs: &Conversations, conv: &ConversationMeta) -> String {
        let parts: Vec<String> = Self::context_parts(ws, convs, conv)
            .into_iter()
            .filter(|p| p.on)
            .map(|p| p.body)
            .collect();

        if parts.is_empty() {
            // "Nothing yet" is a fact, and a better one than silence: a model
            // handed an empty context cannot tell an unconfigured workspace
            // from a failure to assemble one, and neither can we. It is also
            // what a conversation that switched everything off should hear.
            return "## Nothing in focus\n\nNo project is selected and nothing has been remembered yet."
                .to_string();
        }
        parts.join("\n")
    }

    /// Everything this conversation will send on its next turn, itemised.
    ///
    /// Assembled by the same functions the turn uses, so the panel cannot
    /// describe one context while another is sent. The tools are listed with
    /// what they cost, because a tool definition is prompt too — twenty tools
    /// nobody calls are still twenty tools paid for on every turn.
    pub fn context_view(
        ws: &Arc<Workspace>,
        convs: &Conversations,
        conversation_id: &str,
        persona: &Persona,
    ) -> Result<ContextView, String> {
        let conv = convs.load(conversation_id)?;
        let parts = Self::context_parts(ws, convs, &conv);

        let mut tools: Vec<ToolLine> = Vec::new();
        if !persona.talk_only {
            let matrix = ws.permission_matrix();
            let mut ids: Vec<String> = super::tools::registry()
                .into_iter()
                .map(|t| t.id)
                .filter(|id| {
                    !matches!(matrix.get(&persona.agent_id, id), super::tools::Permission::None)
                        || persona.manages_with.iter().any(|m| m == id)
                })
                .collect();
            ids.sort();
            ids.dedup();
            for id in ids {
                let defs = super::tools::definitions_of(&id);
                let tokens: usize = defs
                    .iter()
                    .map(|d| {
                        super::context::estimate_tokens(&d.description)
                            + super::context::estimate_tokens(&d.input_schema.to_string())
                    })
                    .sum();
                let info = super::tools::registry().into_iter().find(|t| t.id == id);
                tools.push(ToolLine {
                    on: !conv.tools_off.iter().any(|off| off == &id),
                    actions: defs.len() as u32,
                    tokens: tokens as u32,
                    // A manager's own plan is allowed by what it is rather
                    // than by a row, and the matrix says "none" about it —
                    // true, and misleading printed beside a tool that works.
                    permission: if persona.manages_with.iter().any(|m| m == &id)
                        && matches!(
                            matrix.get(&persona.agent_id, &id),
                            super::tools::Permission::None
                        ) {
                        "manager's own".to_string()
                    } else {
                        format!("{:?}", matrix.get(&persona.agent_id, &id)).to_lowercase()
                    },
                    title: info
                        .as_ref()
                        .map(|t| t.name.clone())
                        .unwrap_or_else(|| id.clone()),
                    description: info.map(|t| t.description).unwrap_or_default(),
                    id,
                });
            }
        }

        let history = Self::history(&conv);
        let history_tokens: usize = history
            .iter()
            .map(|t| super::context::estimate_tokens(&t.content))
            .sum();

        let sent: u32 = parts.iter().filter(|p| p.on).map(|p| p.tokens).sum();
        let tool_tokens: u32 = tools.iter().filter(|t| t.on).map(|t| t.tokens).sum();
        Ok(ContextView {
            system_tokens: super::context::estimate_tokens(&persona.system) as u32,
            context_tokens: sent,
            tool_tokens,
            history_turns: history.len() as u32,
            history_tokens: history_tokens as u32,
            total_tokens: sent + tool_tokens + history_tokens as u32
                + super::context::estimate_tokens(&persona.system) as u32,
            parts,
            tools,
        })
    }

    /// The recent conversation, verbatim. Tool results are folded in as
    /// assistant turns so the model can see what actually happened rather than
    /// only what it said it would do.
    fn history(conv: &ConversationMeta) -> Vec<ChatTurn> {
        let msgs = &conv.messages;
        // Everything except the message being answered, which goes in as the
        // goal. That is the last *user* message, not the last message: a
        // handover receipt is appended after it, and dropping the final
        // element dropped exactly that — so a bot was answering without
        // knowing whether the work it had just handed over had moved, and
        // said it had when it had not.
        let end = msgs
            .iter()
            .rposition(|m| m.from == Speaker::User)
            .unwrap_or(msgs.len().saturating_sub(1));
        let start = end.saturating_sub(VERBATIM_MESSAGES);
        msgs[start..end]
            .iter()
            .chain(msgs[(end + 1).min(msgs.len())..].iter())
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
            by: None,
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
            by: None,
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
