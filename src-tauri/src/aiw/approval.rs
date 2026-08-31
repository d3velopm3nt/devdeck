//! Human approval for tool calls.
//!
//! `Permission::Approval` used to mean "refused", which was safe while the only
//! provider was a deterministic mock. With a real model deciding what to run in
//! your terminal it has to mean *ask*, or you set everything to `Full` and the
//! permission system stops meaning anything.
//!
//! The agent's thread blocks while it waits. That is deliberate: the runtime is
//! synchronous and an agent genuinely cannot proceed without an answer. Tauri
//! runs sync commands on a worker thread, so the window stays responsive.
//!
//! Two rules keep a blocked agent from becoming a hung app:
//!
//! 1. **Every wait has a deadline.** Nobody answering is a normal outcome —
//!    you walked away — and it resolves to *denied* with a reason that says so,
//!    never to allowed and never to waiting forever.
//! 2. **Denial is the default at every exit.** A dropped channel, a shutdown, a
//!    timeout: all deny. The only path to "allowed" is a person saying so.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use super::events::{new_id, now_iso};

/// What a person decided about one request.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Decision {
    /// Run it this once.
    Allow,
    /// Run it, and stop asking for this tool and agent.
    AllowAlways,
    /// Refuse this one.
    Deny,
    /// Refuse, and revoke the tool for this agent.
    DenyAlways,
}

impl Decision {
    pub fn allows(self) -> bool {
        matches!(self, Decision::Allow | Decision::AllowAlways)
    }
}

/// Why a request ended the way it did — shown to the agent and recorded.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Decided(Decision),
    /// Nobody answered in time.
    TimedOut,
    /// The workspace went away while waiting.
    Abandoned,
}

impl Outcome {
    pub fn allows(&self) -> bool {
        matches!(self, Outcome::Decided(d) if d.allows())
    }

    /// Wording for the agent. It is fed back as the tool result, so it says
    /// what happened and what would change it.
    pub fn reason(&self, tool: &str) -> String {
        match self {
            Outcome::Decided(Decision::Deny) => format!("'{tool}' was refused by a human"),
            Outcome::Decided(Decision::DenyAlways) => {
                format!("'{tool}' was refused and revoked for this agent")
            }
            Outcome::Decided(d) if d.allows() => format!("'{tool}' was approved"),
            Outcome::Decided(_) => format!("'{tool}' was refused"),
            Outcome::TimedOut => {
                format!("'{tool}' needed approval and nobody answered in time, so it was not run")
            }
            Outcome::Abandoned => {
                format!("'{tool}' needed approval but the workspace shut down first")
            }
        }
    }
}

/// One request waiting on a person.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ApprovalRequest {
    pub id: String,
    pub agent_id: String,
    pub tool: String,
    pub action: String,
    /// One line a human can decide on without reading JSON.
    pub summary: String,
    /// The arguments, for anyone who wants the detail.
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub requested_at: String,
    /// Seconds before this gives up and denies itself.
    pub expires_in: u64,
}

/// Plain-English summary of what is being asked for.
///
/// "run `rm -rf build`" is a decision someone can make in a second;
/// `{"command":"rm -rf build"}` is a puzzle. The whole approval flow is
/// worthless if the prompt cannot be read at a glance.
pub fn describe(tool: &str, action: &str, args: &serde_json::Value) -> String {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("");
    match (tool, action) {
        ("terminal", _) => format!("run `{}`", s("command")),
        ("files", "write") => format!("write {}", s("path")),
        ("files", "read") => format!("read {}", s("path")),
        ("git", "commit") => format!("commit: {}", s("message")),
        ("process", "start") => {
            let c = s("command");
            if c.is_empty() {
                "start the application".into()
            } else {
                format!("start the application with `{c}`")
            }
        }
        ("process", "stop") => "stop the application".into(),
        // A bot outlives the conversation that asked for it, so the prompt
        // names the whole thing — what it is for and when it will wake — not
        // just that a file appears somewhere.
        ("bots", "create") => {
            let every = match s("every") {
                "" => "weekdays",
                e => e,
            };
            let at = match s("at") {
                "" => "08:00",
                a => a,
            };
            format!(
                "leave a bot called \"{}\" here, waking {every} at {at} — {}",
                s("name"),
                s("goal")
            )
        }
        ("tests", _) => {
            let c = s("command");
            if c.is_empty() {
                "run the test suite".into()
            } else {
                format!("run tests with `{c}`")
            }
        }
        _ => format!("{tool}.{action}"),
    }
}

/// Holds the requests waiting on a person, and the channels they will answer on.
pub struct ApprovalBroker {
    waiting: Mutex<HashMap<String, Sender<Decision>>>,
    queue: Mutex<Vec<ApprovalRequest>>,
    timeout: Duration,
}

impl ApprovalBroker {
    pub fn new(timeout: Duration) -> Self {
        Self {
            waiting: Mutex::new(HashMap::new()),
            queue: Mutex::new(Vec::new()),
            timeout,
        }
    }

    /// A broker with no waiting at all: every request denies immediately.
    ///
    /// This is the default a `ToolService` gets, so a service built without an
    /// approval surface behaves exactly as it did before — refusing — rather
    /// than blocking against a queue nobody is reading.
    pub fn immediate_denial() -> Self {
        Self::new(Duration::from_millis(0))
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    /// Requests currently waiting, oldest first.
    pub fn pending(&self) -> Vec<ApprovalRequest> {
        self.queue.lock().unwrap().clone()
    }

    /// Ask, and block until answered, refused or out of time.
    ///
    /// `announce` runs with the request *before* the wait begins, so the event
    /// reaches the UI while there is still time to answer it.
    pub fn ask<F: FnOnce(&ApprovalRequest)>(
        &self,
        request: ApprovalRequest,
        announce: F,
    ) -> Outcome {
        // A zero timeout means there is nothing listening; refuse without
        // queueing a request nobody will ever see.
        if self.timeout.is_zero() {
            announce(&request);
            return Outcome::TimedOut;
        }

        let (tx, rx) = channel::<Decision>();
        let id = request.id.clone();
        self.waiting.lock().unwrap().insert(id.clone(), tx);
        self.queue.lock().unwrap().push(request.clone());

        announce(&request);

        let outcome = match rx.recv_timeout(self.timeout) {
            Ok(d) => Outcome::Decided(d),
            Err(RecvTimeoutError::Timeout) => Outcome::TimedOut,
            // The sender was dropped — the broker was cleared or the app is
            // going down. Not an approval.
            Err(RecvTimeoutError::Disconnected) => Outcome::Abandoned,
        };

        self.forget(&id);
        outcome
    }

    /// Answer a waiting request. False when there is nothing by that id —
    /// already answered, or it timed out while the dialog was open.
    pub fn resolve(&self, id: &str, decision: Decision) -> bool {
        let sender = self.waiting.lock().unwrap().remove(id);
        self.queue.lock().unwrap().retain(|r| r.id != id);
        match sender {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    /// Drop everything waiting. Each waiter sees `Abandoned` and therefore
    /// denies — clearing the queue must never look like blanket approval.
    pub fn clear(&self) {
        self.waiting.lock().unwrap().clear();
        self.queue.lock().unwrap().clear();
    }

    fn forget(&self, id: &str) {
        self.waiting.lock().unwrap().remove(id);
        self.queue.lock().unwrap().retain(|r| r.id != id);
    }
}

impl Default for ApprovalBroker {
    fn default() -> Self {
        Self::immediate_denial()
    }
}

/// Build a request from a call. `expires_in` is carried so the UI can show a
/// countdown rather than having the button go dead without explanation.
#[allow(clippy::too_many_arguments)]
pub fn request_for(
    agent_id: &str,
    tool: &str,
    action: &str,
    args: &serde_json::Value,
    project_id: Option<&str>,
    feature_id: Option<&str>,
    session_id: Option<&str>,
    timeout: Duration,
) -> ApprovalRequest {
    ApprovalRequest {
        id: new_id("apr"),
        agent_id: agent_id.to_string(),
        tool: tool.to_string(),
        action: action.to_string(),
        summary: describe(tool, action, args),
        detail: serde_json::to_string_pretty(args).unwrap_or_default(),
        project_id: project_id.map(str::to_string),
        feature_id: feature_id.map(str::to_string),
        session_id: session_id.map(str::to_string),
        requested_at: now_iso(),
        expires_in: timeout.as_secs(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bot outlives the conversation that asked for it, so the prompt has to
    /// name the whole thing. "bots.create" would be a question nobody can
    /// answer.
    #[test]
    fn a_bot_prompt_says_what_it_is_for_and_when_it_wakes() {
        let d = describe(
            "bots",
            "create",
            &serde_json::json!({
                "name": "Marketing site bot",
                "goal": "Keep the pricing page honest",
                "every": "weekly",
                "at": "18:00"
            }),
        );
        assert!(d.contains("Marketing site bot"), "{d}");
        assert!(d.contains("Keep the pricing page honest"), "{d}");
        assert!(d.contains("weekly") && d.contains("18:00"), "{d}");
    }

    /// The defaults are the ones the tool documents, and the prompt must show
    /// the time it will actually wake rather than leaving it blank.
    #[test]
    fn a_bot_prompt_fills_in_the_defaults_it_will_use() {
        let d = describe(
            "bots",
            "create",
            &serde_json::json!({ "name": "Site bot", "goal": "Ship it" }),
        );
        assert!(d.contains("weekdays") && d.contains("08:00"), "{d}");
    }

    use std::sync::Arc;

    fn req(tool: &str, action: &str, args: serde_json::Value) -> ApprovalRequest {
        request_for(
            "dev-a",
            tool,
            action,
            &args,
            Some("tyrex"),
            Some("offline-sync"),
            None,
            Duration::from_secs(30),
        )
    }

    #[test]
    fn a_request_reads_as_a_sentence_not_as_json() {
        assert_eq!(
            describe(
                "terminal",
                "run",
                &serde_json::json!({ "command": "npm test" })
            ),
            "run `npm test`"
        );
        assert_eq!(
            describe("files", "write", &serde_json::json!({ "path": "src/a.ts" })),
            "write src/a.ts"
        );
        assert_eq!(
            describe("process", "start", &serde_json::json!({})),
            "start the application"
        );
        // Anything unrecognised still says which tool, rather than nothing.
        assert_eq!(
            describe("weird", "thing", &serde_json::json!({})),
            "weird.thing"
        );
    }

    #[test]
    fn an_answer_releases_the_waiter() {
        let b = Arc::new(ApprovalBroker::new(Duration::from_secs(5)));
        let r = req(
            "terminal",
            "run",
            serde_json::json!({ "command": "npm test" }),
        );
        let id = r.id.clone();

        let answerer = {
            let b = b.clone();
            std::thread::spawn(move || {
                // Wait for it to actually be queued before answering.
                for _ in 0..100 {
                    if !b.pending().is_empty() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                b.resolve(&id, Decision::Allow)
            })
        };

        let outcome = b.ask(r, |_| {});
        assert!(outcome.allows(), "an allow must let the caller through");
        assert!(answerer.join().unwrap(), "resolve found the waiter");
        assert!(b.pending().is_empty(), "the queue is cleared afterwards");
    }

    #[test]
    fn a_denial_is_a_denial_and_says_why() {
        let b = Arc::new(ApprovalBroker::new(Duration::from_secs(5)));
        let r = req(
            "terminal",
            "run",
            serde_json::json!({ "command": "rm -rf build" }),
        );
        let id = r.id.clone();
        let b2 = b.clone();
        std::thread::spawn(move || {
            for _ in 0..100 {
                if !b2.pending().is_empty() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            b2.resolve(&id, Decision::Deny);
        });

        let outcome = b.ask(r, |_| {});
        assert!(!outcome.allows());
        assert!(outcome.reason("terminal").contains("refused by a human"));
    }

    /// Walking away must not hang an agent, and must not approve anything.
    #[test]
    fn nobody_answering_denies_rather_than_hanging_or_allowing() {
        let b = ApprovalBroker::new(Duration::from_millis(120));
        let outcome = b.ask(req("terminal", "run", serde_json::json!({})), |_| {});
        assert_eq!(outcome, Outcome::TimedOut);
        assert!(!outcome.allows(), "a timeout must never allow");
        assert!(outcome.reason("terminal").contains("nobody answered"));
        assert!(
            b.pending().is_empty(),
            "a timed-out request leaves no ghost"
        );
    }

    /// The default a ToolService gets when nothing is listening: refuse at once
    /// rather than block against a queue no one is reading.
    #[test]
    fn the_default_broker_refuses_immediately() {
        let b = ApprovalBroker::immediate_denial();
        let started = std::time::Instant::now();
        let outcome = b.ask(req("terminal", "run", serde_json::json!({})), |_| {});
        assert!(!outcome.allows());
        assert!(
            started.elapsed() < Duration::from_millis(50),
            "it must not wait"
        );
    }

    #[test]
    fn the_request_is_announced_before_the_wait_begins() {
        // If the event were emitted after the wait, the UI would only learn
        // about a request once it had already timed out.
        let b = ApprovalBroker::new(Duration::from_millis(80));
        let seen = std::sync::Arc::new(Mutex::new(None::<String>));
        let s = seen.clone();
        b.ask(
            req("files", "write", serde_json::json!({ "path": "a.ts" })),
            |r| {
                *s.lock().unwrap() = Some(r.summary.clone());
            },
        );
        assert_eq!(seen.lock().unwrap().as_deref(), Some("write a.ts"));
    }

    #[test]
    fn resolving_an_unknown_id_is_false_not_a_panic() {
        let b = ApprovalBroker::new(Duration::from_secs(1));
        assert!(!b.resolve("apr_nope", Decision::Allow));
    }

    /// Clearing the queue is not blanket approval.
    #[test]
    fn clearing_the_queue_abandons_waiters_rather_than_allowing_them() {
        let b = Arc::new(ApprovalBroker::new(Duration::from_secs(5)));
        let b2 = b.clone();
        let handle = std::thread::spawn(move || {
            b2.ask(req("terminal", "run", serde_json::json!({})), |_| {})
        });
        for _ in 0..100 {
            if !b.pending().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        b.clear();
        let outcome = handle.join().unwrap();
        assert!(!outcome.allows(), "clearing must not approve anything");
    }
}
