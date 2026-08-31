//! The AI Workspace event spine.
//!
//! Everything interesting that happens — an agent starting, a tool running, a
//! file changing, a conflict appearing — becomes a `DomainEvent` on the bus.
//! Services subscribe rather than calling each other, so the chain
//!
//!   tool.executed → file.changed → context.reconciled → context.changed
//!                 → context.delta.detected → conflict.detected
//!
//! is assembled from independent handlers instead of one long function.
//!
//! Two rules keep this from turning into spaghetti:
//!
//! 1. **Commands are not events.** A command asks for something and is a plain
//!    function call returning a `Result`. An event says something already
//!    happened and is past-tense, fire-and-forget.
//! 2. **Derived events carry their cause.** A handler that emits in response to
//!    an event sets `causation_id` and inherits `correlation_id`, and the bus
//!    refuses to dispatch past `MAX_CAUSATION_DEPTH`. That is what stops a
//!    cycle from becoming an infinite loop rather than trusting every handler
//!    to be well behaved.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// A handler that re-emits forever is a bug; this is the backstop that turns it
/// into a dropped event and a log line instead of a hung app.
const MAX_CAUSATION_DEPTH: u32 = 12;
/// Operational history kept in memory for the Activity screen.
const EVENT_BUFFER_LIMIT: usize = 5_000;

static EVENT_SEQ: AtomicU64 = AtomicU64::new(1);

/// Every event type the workspace knows about.
///
/// A string enum rather than free-form strings: a typo in a subscriber filter
/// should be a compile error, not a handler that silently never fires.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EventType {
    WorkspaceCreated,
    WorkspaceUpdated,
    ProjectCreated,
    ProjectUpdated,
    FeatureCreated,
    FeatureUpdated,
    AgentStarted,
    AgentStatusChanged,
    AgentCompleted,
    AgentFailed,
    SessionStarted,
    SessionCheckpointed,
    SessionCompleted,
    WorkClaimed,
    WorkUpdated,
    WorkReleased,
    WorkCompleted,
    ToolRequested,
    ToolExecuted,
    ToolFailed,
    ToolApprovalRequested,
    ToolApprovalResolved,
    ProcessStartRequested,
    ProcessStarted,
    ProcessReady,
    ProcessStopped,
    ProcessFailed,
    FileChanged,
    GitChanged,
    GitCommitCreated,
    ContextChanged,
    ContextReconciliationRequested,
    ContextReconciled,
    ContextDeltaDetected,
    ContextStale,
    DecisionCreated,
    DecisionUpdated,
    DecisionSuperseded,
    ConflictDetected,
    ConflictUpdated,
    ConflictResolved,
    TestStarted,
    TestCompleted,
    TestFailed,
}

impl EventType {
    /// The wire name. The UI filters on these, so they are part of the
    /// contract and must not be renamed casually.
    pub fn as_str(self) -> &'static str {
        use EventType::*;
        match self {
            WorkspaceCreated => "workspace.created",
            WorkspaceUpdated => "workspace.updated",
            ProjectCreated => "project.created",
            ProjectUpdated => "project.updated",
            FeatureCreated => "feature.created",
            FeatureUpdated => "feature.updated",
            AgentStarted => "agent.started",
            AgentStatusChanged => "agent.status.changed",
            AgentCompleted => "agent.completed",
            AgentFailed => "agent.failed",
            SessionStarted => "session.started",
            SessionCheckpointed => "session.checkpointed",
            SessionCompleted => "session.completed",
            WorkClaimed => "work.claimed",
            WorkUpdated => "work.updated",
            WorkReleased => "work.released",
            WorkCompleted => "work.completed",
            ToolRequested => "tool.requested",
            ToolExecuted => "tool.executed",
            ToolFailed => "tool.failed",
            ToolApprovalRequested => "tool.approval.requested",
            ToolApprovalResolved => "tool.approval.resolved",
            ProcessStartRequested => "process.start.requested",
            ProcessStarted => "process.started",
            ProcessReady => "process.ready",
            ProcessStopped => "process.stopped",
            ProcessFailed => "process.failed",
            FileChanged => "file.changed",
            GitChanged => "git.changed",
            GitCommitCreated => "git.commit.created",
            ContextChanged => "context.changed",
            ContextReconciliationRequested => "context.reconciliation.requested",
            ContextReconciled => "context.reconciled",
            ContextDeltaDetected => "context.delta.detected",
            ContextStale => "context.stale",
            DecisionCreated => "decision.created",
            DecisionUpdated => "decision.updated",
            DecisionSuperseded => "decision.superseded",
            ConflictDetected => "conflict.detected",
            ConflictUpdated => "conflict.updated",
            ConflictResolved => "conflict.resolved",
            TestStarted => "test.started",
            TestCompleted => "test.completed",
            TestFailed => "test.failed",
        }
    }

    /// Broad bucket, used by the Activity screen's filter chips.
    pub fn category(self) -> &'static str {
        use EventType::*;
        match self {
            AgentStarted | AgentStatusChanged | AgentCompleted | AgentFailed => "Agent",
            SessionStarted | SessionCheckpointed | SessionCompleted => "Session",
            WorkClaimed | WorkUpdated | WorkReleased | WorkCompleted => "Task",
            ToolRequested
            | ToolExecuted
            | ToolFailed
            | ToolApprovalRequested
            | ToolApprovalResolved => "Tool",
            ProcessStartRequested
            | ProcessStarted
            | ProcessReady
            | ProcessStopped
            | ProcessFailed => "Process",
            FileChanged => "File",
            GitChanged | GitCommitCreated => "Git",
            ContextChanged
            | ContextReconciliationRequested
            | ContextReconciled
            | ContextDeltaDetected
            | ContextStale => "Context",
            DecisionCreated | DecisionUpdated | DecisionSuperseded => "Decision",
            ConflictDetected | ConflictUpdated | ConflictResolved => "Conflict",
            TestStarted | TestCompleted | TestFailed => "Test",
            _ => "Workspace",
        }
    }
}

/// Which entities an event is about. Every id is optional because events fire
/// at different depths of the hierarchy, but scoping matters: a subscriber that
/// ignores `project_id` will leak one project's activity into another, which is
/// exactly what the isolation tests check for.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct EventScope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Nobody is watching this one — it was started by a clock, not by you.
    ///
    /// Carried on the scope because the scope already travels everywhere a tool
    /// call goes, and the gate is the one place that has to know. An unattended
    /// call that needs approval is refused *immediately* rather than after the
    /// timeout: there is by definition nobody to ask, and waiting ninety
    /// seconds to reach the same answer only means a bot's morning wake takes
    /// a quarter of an hour to fail.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unattended: bool,
}

impl EventScope {
    /// Project-level scope, for events that are not about one feature.
    #[allow(dead_code)]
    pub fn project(project_id: &str) -> Self {
        Self {
            project_id: Some(project_id.to_string()),
            ..Default::default()
        }
    }
    pub fn feature(project_id: &str, feature_id: &str) -> Self {
        Self {
            project_id: Some(project_id.to_string()),
            feature_id: Some(feature_id.to_string()),
            ..Default::default()
        }
    }
    pub fn with_agent(mut self, agent_id: &str) -> Self {
        self.agent_id = Some(agent_id.to_string());
        self
    }
    pub fn with_session(mut self, session_id: &str) -> Self {
        self.session_id = Some(session_id.to_string());
        self
    }
    /// Mark this as started by a clock rather than by a person.
    pub fn unattended(mut self) -> Self {
        self.unattended = true;
        self
    }

    pub fn with_work_item(mut self, work_item_id: &str) -> Self {
        self.work_item_id = Some(work_item_id.to_string());
        self
    }
}

/// The envelope. `payload` is deliberately untyped JSON at this layer — each
/// event type owns its own payload shape, and forcing them into one Rust enum
/// would make adding an event a change to every match arm in the codebase.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DomainEvent {
    pub id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub category: String,
    pub timestamp: String,
    #[serde(flatten)]
    pub scope: EventScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    /// How many events deep in a causal chain this is. The bus stops
    /// dispatching past MAX_CAUSATION_DEPTH.
    pub depth: u32,
    pub payload: serde_json::Value,
}

impl DomainEvent {
    pub fn new(kind: EventType, scope: EventScope, payload: serde_json::Value) -> Self {
        let seq = EVENT_SEQ.fetch_add(1, Ordering::SeqCst);
        Self {
            id: format!("ev_{seq:08}"),
            seq,
            kind: kind.as_str().to_string(),
            category: kind.category().to_string(),
            timestamp: now_iso(),
            scope,
            correlation_id: None,
            causation_id: None,
            depth: 0,
            payload,
        }
    }

    /// Mark this event as caused by `cause`, inheriting its correlation id so a
    /// whole chain can be followed with one filter.
    pub fn caused_by(mut self, cause: &DomainEvent) -> Self {
        self.correlation_id = cause
            .correlation_id
            .clone()
            .or_else(|| Some(cause.id.clone()));
        self.causation_id = Some(cause.id.clone());
        self.depth = cause.depth + 1;
        self
    }

    /// Used by subscribers and tests to match a kind without string
    /// comparison at the call site.
    #[allow(dead_code)]
    pub fn is(&self, kind: EventType) -> bool {
        self.kind == kind.as_str()
    }
}

/// Arc, not Box: `emit` clones the matching handlers out of the lock before
/// running them, so a handler that emits synchronously re-enters `emit`
/// without ever contending for the subscriber lock it is already inside.
type Handler = Arc<dyn Fn(&DomainEvent, &EventBus) + Send + Sync>;

struct Subscription {
    name: String,
    /// Empty = every event.
    kinds: Vec<&'static str>,
    handler: Handler,
}

/// In-process pub/sub plus the operational event log.
///
/// Deliberately not Kafka: this is one desktop app, and an in-process bus keeps
/// the whole chain synchronous and therefore testable without a scheduler.
pub struct EventBus {
    subs: Mutex<Vec<Subscription>>,
    log: Mutex<Vec<DomainEvent>>,
    /// Where events go to reach the outside world (the UI). A plain closure,
    /// not an `AppHandle`: the bus is domain code and must not depend on the
    /// shell it happens to be embedded in. Holding a Tauri handle here also
    /// dragged Tauri's dialog machinery into every binary that linked this
    /// module, which broke the test binary outright.
    sink: Mutex<Option<Sink>>,
}

type Sink = Box<dyn Fn(&DomainEvent) + Send + Sync>;

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            subs: Mutex::new(Vec::new()),
            log: Mutex::new(Vec::new()),
            sink: Mutex::new(None),
        }
    }

    /// Route events somewhere outside the process (in the app, to the
    /// webview). Without a sink the bus still works fully, which is what lets
    /// every test run headless.
    pub fn attach_sink<F>(&self, sink: F)
    where
        F: Fn(&DomainEvent) + Send + Sync + 'static,
    {
        *self.sink.lock().unwrap() = Some(Box::new(sink));
    }

    pub fn subscribe<F>(&self, name: &str, kinds: &[EventType], handler: F)
    where
        F: Fn(&DomainEvent, &EventBus) + Send + Sync + 'static,
    {
        self.subs.lock().unwrap().push(Subscription {
            name: name.to_string(),
            kinds: kinds.iter().map(|k| k.as_str()).collect(),
            handler: Arc::new(handler),
        });
    }

    /// Publish an event: record it, hand it to the UI, then run subscribers.
    ///
    /// Recording happens first so an event is in the history even if a handler
    /// panics — an activity feed that silently drops the event that broke
    /// something is worse than useless.
    pub fn emit(&self, event: DomainEvent) -> DomainEvent {
        if event.depth > MAX_CAUSATION_DEPTH {
            eprintln!(
                "[aiw] dropping {} at depth {} — causal chain too deep (cycle?)",
                event.kind, event.depth
            );
            return event;
        }

        {
            let mut log = self.log.lock().unwrap();
            log.push(event.clone());
            let len = log.len();
            if len > EVENT_BUFFER_LIMIT {
                log.drain(..len - EVENT_BUFFER_LIMIT);
            }
        }

        if let Some(sink) = self.sink.lock().unwrap().as_ref() {
            sink(&event);
        }

        // Clone the matching handlers out of the lock before running any of
        // them. A handler is free to emit (that is how derived events work),
        // which re-enters this function — holding the subscriber lock across
        // the call would deadlock on the first such handler.
        let matching: Vec<(String, Handler)> = {
            let subs = self.subs.lock().unwrap();
            subs.iter()
                .filter(|s| s.kinds.is_empty() || s.kinds.contains(&event.kind.as_str()))
                .map(|s| (s.name.clone(), s.handler.clone()))
                .collect()
        };

        for (name, handler) in matching {
            // One bad handler must not stop the rest of the chain, and must
            // not lose the event that has already been recorded.
            // One bad handler must not stop the rest of the chain, and must
            // not lose the event that has already been recorded.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                handler(&event, self);
            }));
            if result.is_err() {
                eprintln!("[aiw] handler '{name}' panicked on {}", event.kind);
            }
        }

        event
    }

    /// Convenience: build and emit in one step.
    pub fn publish(
        &self,
        kind: EventType,
        scope: EventScope,
        payload: serde_json::Value,
    ) -> DomainEvent {
        self.emit(DomainEvent::new(kind, scope, payload))
    }

    /// Operational history, newest last. `project_id` scopes it — the Activity
    /// screen must never show one project's events under another.
    pub fn history(&self, project_id: Option<&str>, limit: usize) -> Vec<DomainEvent> {
        let log = self.log.lock().unwrap();
        let mut out: Vec<DomainEvent> = log
            .iter()
            .filter(|e| match project_id {
                None => true,
                Some(p) => e.scope.project_id.as_deref() == Some(p),
            })
            .cloned()
            .collect();
        if out.len() > limit {
            out.drain(..out.len() - limit);
        }
        out
    }

    /// Every event sharing a correlation id, in order — used to prove a chain
    /// actually happened rather than asserting on each event separately.
    pub fn chain(&self, correlation_id: &str) -> Vec<DomainEvent> {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(|e| {
                e.correlation_id.as_deref() == Some(correlation_id) || e.id == correlation_id
            })
            .cloned()
            .collect()
    }

    pub fn clear(&self) {
        self.log.lock().unwrap().clear();
    }

    /// Size of the operational log; used by the demo result and by tests.
    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.log.lock().unwrap().len()
    }
}

/// An ISO-8601 UTC timestamp.
///
/// The clock comes from `SystemTime`, not `chrono::Utc::now()`. chrono's
/// `now()` pulls in its `clock` feature, which on Windows links a second set of
/// windows-sys bindings alongside Tauri's; that combination produced a
/// STATUS_ENTRYPOINT_NOT_FOUND at process start — the whole test binary failed
/// to load. Formatting through `from_timestamp_millis` is the path the rest of
/// this crate already uses and links cleanly.
pub fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Short unique id for entities that need one (sessions, claims, conflicts).
pub fn new_id(prefix: &str) -> String {
    let n = EVENT_SEQ.fetch_add(1, Ordering::SeqCst);
    let t = now_millis();
    format!("{prefix}_{t:x}{n:x}")
}

pub type SharedBus = Arc<EventBus>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn subscribers_only_see_the_kinds_they_asked_for() {
        let bus = EventBus::new();
        let agent_hits = Arc::new(AtomicUsize::new(0));
        let all_hits = Arc::new(AtomicUsize::new(0));

        let a = agent_hits.clone();
        bus.subscribe("agents", &[EventType::AgentStarted], move |_, _| {
            a.fetch_add(1, Ordering::SeqCst);
        });
        let b = all_hits.clone();
        bus.subscribe("everything", &[], move |_, _| {
            b.fetch_add(1, Ordering::SeqCst);
        });

        bus.publish(
            EventType::AgentStarted,
            EventScope::project("p1"),
            serde_json::json!({}),
        );
        bus.publish(
            EventType::FileChanged,
            EventScope::project("p1"),
            serde_json::json!({}),
        );

        assert_eq!(agent_hits.load(Ordering::SeqCst), 1, "filtered subscriber");
        assert_eq!(all_hits.load(Ordering::SeqCst), 2, "catch-all subscriber");
    }

    #[test]
    fn a_derived_event_keeps_the_correlation_of_its_cause() {
        let bus = Arc::new(EventBus::new());
        bus.subscribe("reconcile", &[EventType::FileChanged], |ev, bus| {
            bus.emit(
                DomainEvent::new(
                    EventType::ContextReconciled,
                    ev.scope.clone(),
                    serde_json::json!({}),
                )
                .caused_by(ev),
            );
        });

        let root = bus.publish(
            EventType::FileChanged,
            EventScope::feature("p1", "f1"),
            serde_json::json!({ "path": "a.ts" }),
        );

        let chain = bus.chain(&root.id);
        assert_eq!(chain.len(), 2, "root plus the derived event: {chain:?}");
        let derived = chain
            .iter()
            .find(|e| e.is(EventType::ContextReconciled))
            .unwrap();
        assert_eq!(derived.causation_id.as_deref(), Some(root.id.as_str()));
        assert_eq!(derived.depth, 1);
    }

    /// A handler that reacts to its own output would spin forever without the
    /// depth guard. This is the test that proves the guard, not the comment.
    #[test]
    fn a_cyclic_handler_terminates_instead_of_hanging() {
        let bus = Arc::new(EventBus::new());
        bus.subscribe("loop", &[EventType::ContextChanged], |ev, bus| {
            bus.emit(
                DomainEvent::new(
                    EventType::ContextChanged,
                    ev.scope.clone(),
                    serde_json::json!({}),
                )
                .caused_by(ev),
            );
        });

        bus.publish(
            EventType::ContextChanged,
            EventScope::project("p1"),
            serde_json::json!({}),
        );

        // Bounded, and bounded by the guard rather than by luck.
        assert!(
            bus.count() <= (MAX_CAUSATION_DEPTH as usize) + 2,
            "expected the depth guard to stop the cycle, got {} events",
            bus.count()
        );
    }

    #[test]
    fn history_is_scoped_to_one_project() {
        let bus = EventBus::new();
        bus.publish(
            EventType::AgentStarted,
            EventScope::project("tyrex"),
            serde_json::json!({}),
        );
        bus.publish(
            EventType::AgentStarted,
            EventScope::project("assetx"),
            serde_json::json!({}),
        );

        let tyrex = bus.history(Some("tyrex"), 100);
        assert_eq!(tyrex.len(), 1);
        assert_eq!(tyrex[0].scope.project_id.as_deref(), Some("tyrex"));
    }

    #[test]
    fn a_panicking_handler_does_not_take_down_the_bus() {
        let bus = EventBus::new();
        let after = Arc::new(AtomicUsize::new(0));
        bus.subscribe("bad", &[EventType::FileChanged], |_, _| {
            panic!("handler blew up");
        });
        let a = after.clone();
        bus.subscribe("good", &[EventType::FileChanged], move |_, _| {
            a.fetch_add(1, Ordering::SeqCst);
        });

        bus.publish(
            EventType::FileChanged,
            EventScope::project("p1"),
            serde_json::json!({}),
        );

        assert_eq!(
            after.load(Ordering::SeqCst),
            1,
            "a later handler still runs after an earlier one panics"
        );
    }
}
