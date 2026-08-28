//! AgentRuntime — the session lifecycle.
//!
//! ```text
//! start session → assemble context → claim work → invoke provider
//!   → execute permitted tools → react to events → checkpoint
//!   → complete → summary
//! ```
//!
//! Every agent goes through this, mock or real. The runtime owns the loop; the
//! provider only ever answers "what next?". That is why swapping in Claude or a
//! local model changes nothing here: the tool execution, permission checks,
//! checkpointing and event emission are all on this side of the seam.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::context::{ChangeSet, ContextService};
use super::deck::{DecisionMeta, Doc};
use super::events::{now_iso, DomainEvent, EventScope, EventType};
use super::provider::{AgentAction, AgentRequest, AgentResponse};
use super::state::{
    new_claim_id, new_session_id, Session, SessionStatus, TestRun, TranscriptEntry, WorkClaim,
    Workspace,
};
use super::tools::TOOL_TESTS;

/// A provider that never says "done" would spin forever; the runtime stops
/// regardless. Chosen well above the longest built-in script.
const MAX_TURNS: u32 = 8;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StartAgentCommand {
    pub project_id: String,
    pub feature_id: String,
    pub agent_id: String,
    #[serde(default)]
    pub work_item_id: Option<String>,
    #[serde(default)]
    pub intent: Option<String>,
    /// Areas this agent expects to touch, for claim overlap detection.
    #[serde(default)]
    pub areas: Vec<String>,
    /// Symbols it reads — what makes it go stale when they change.
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SessionOutcome {
    pub session_id: String,
    pub status: String,
    pub turns: u32,
    pub summary: String,
    pub files_touched: Vec<String>,
    pub context_tokens: usize,
    pub conflicts_detected: usize,
}

/// A session that has started, taken its checkpoint and claimed its work, but
/// has not yet run its provider loop.
///
/// This exists because agents genuinely overlap in time: Developer B is still
/// working when Developer A changes the interface underneath it. A runtime that
/// could only run a session start-to-finish in one call could never represent
/// that, and "who went stale?" would be unanswerable -- the only live session
/// would always be the one doing the changing.
pub struct LiveSession {
    pub session_id: String,
    cmd: StartAgentCommand,
    agent: super::state::AgentDef,
    scope: EventScope,
    checkpoint: super::context::Checkpoint,
    claim_id: String,
    claimed: DomainEvent,
    started: DomainEvent,
    context: super::context::AssembledContext,
    intent: String,
}

pub struct AgentRuntime;

impl AgentRuntime {
    /// Start a session and leave it live: context assembled, checkpoint taken,
    /// work claimed, status Working. Nothing has been asked of the provider.
    pub fn begin(ws: &Arc<Workspace>, cmd: &StartAgentCommand) -> Result<LiveSession, String> {
        Self::begin_inner(ws, cmd)
    }

    /// Run a live session's provider loop through to completion.
    pub fn drive(ws: &Arc<Workspace>, live: LiveSession) -> Result<SessionOutcome, String> {
        Self::drive_inner(ws, live)
    }

    /// Run one agent to completion.
    ///
    /// Synchronous on purpose: the demo, the tests and the acceptance chain all
    /// need a deterministic order of events. Concurrency here would buy nothing
    /// and would make "did the conflict fire?" a race.
    pub fn run(ws: &Arc<Workspace>, cmd: &StartAgentCommand) -> Result<SessionOutcome, String> {
        let live = Self::begin_inner(ws, cmd)?;
        Self::drive_inner(ws, live)
    }

    fn begin_inner(ws: &Arc<Workspace>, cmd: &StartAgentCommand) -> Result<LiveSession, String> {
        let Some(project) = ws.project(&cmd.project_id) else {
            return Err(format!("unknown project '{}'", cmd.project_id));
        };
        let Some(agent) = ws.agent(&cmd.agent_id) else {
            return Err(format!("unknown agent '{}'", cmd.agent_id));
        };
        let deck = project.deck();
        if !deck.feature_md(&cmd.feature_id).is_file() {
            return Err(format!(
                "feature '{}' does not exist in {}",
                cmd.feature_id, cmd.project_id
            ));
        }

        let session_id = new_session_id();
        let scope = EventScope::feature(&cmd.project_id, &cmd.feature_id)
            .with_agent(&cmd.agent_id)
            .with_session(&session_id);

        // -- 1. start ------------------------------------------------------
        let started = ws.bus.publish(
            EventType::SessionStarted,
            scope.clone(),
            serde_json::json!({
                "sessionId": session_id, "agent": agent.id, "role": agent.role,
                "provider": agent.provider, "model": agent.model,
            }),
        );
        ws.bus.emit(
            DomainEvent::new(
                EventType::AgentStarted,
                scope.clone(),
                serde_json::json!({ "agent": agent.id, "name": agent.name }),
            )
            .caused_by(&started),
        );

        // -- 2. assemble context ------------------------------------------
        let active_lines = ws.active_work_lines(&cmd.project_id, &cmd.feature_id);
        let context = ContextService::assemble(
            &deck,
            &cmd.project_id,
            &cmd.feature_id,
            cmd.work_item_id.as_deref(),
            &active_lines,
        )?;

        // -- 3. checkpoint -------------------------------------------------
        // Taken before any work: this is the state the agent believes in, and
        // what "stale" is later measured against.
        let checkpoint = ContextService::checkpoint(
            &project.root,
            &session_id,
            &agent.id,
            &cmd.project_id,
            &cmd.feature_id,
            context.total_tokens,
        );
        ws.bus.emit(
            DomainEvent::new(
                EventType::SessionCheckpointed,
                scope.clone(),
                serde_json::json!({
                    "commit": checkpoint.commit, "contextTokens": context.total_tokens
                }),
            )
            .caused_by(&started),
        );

        ws.add_session(Session {
            id: session_id.clone(),
            agent_id: agent.id.clone(),
            agent_name: agent.name.clone(),
            role: agent.role.clone(),
            project_id: cmd.project_id.clone(),
            feature_id: cmd.feature_id.clone(),
            work_item_id: cmd.work_item_id.clone(),
            status: SessionStatus::Planning,
            started_at: now_iso(),
            ended_at: None,
            checkpoint: Some(checkpoint.clone()),
            stale: false,
            turns: 0,
            context_tokens: context.total_tokens,
            files_touched: vec![],
            transcript: vec![],
            summary: None,
        });

        // -- 4. claim work -------------------------------------------------
        let intent = cmd
            .intent
            .clone()
            .unwrap_or_else(|| format!("{} work on {}", agent.role, cmd.feature_id));
        let claim = WorkClaim {
            id: new_claim_id(),
            agent_id: agent.id.clone(),
            session_id: session_id.clone(),
            project_id: cmd.project_id.clone(),
            feature_id: cmd.feature_id.clone(),
            work_item_id: cmd.work_item_id.clone(),
            intent: intent.clone(),
            areas: cmd.areas.clone(),
            depends_on: cmd.depends_on.clone(),
            status: "active".into(),
            started_at: now_iso(),
        };
        ws.add_claim(claim.clone());
        let claimed = ws.bus.emit(
            DomainEvent::new(
                EventType::WorkClaimed,
                scope
                    .clone()
                    .with_work_item(cmd.work_item_id.as_deref().unwrap_or(&claim.id)),
                serde_json::json!({
                    "claimId": claim.id, "intent": intent,
                    "areas": claim.areas, "dependsOn": claim.depends_on,
                }),
            )
            .caused_by(&started),
        );

        // Mark the work item claimed in .devdeck — durable, not just in memory.
        if let Some(wi) = &cmd.work_item_id {
            if let Ok(mut work) = deck.work(&cmd.feature_id) {
                if let Some(item) = work.meta.items.iter_mut().find(|i| &i.id == wi) {
                    item.status = "in-progress".into();
                    item.assignee = Some(agent.id.clone());
                }
                let _ = deck.save_work(&cmd.feature_id, &work.meta);
            }
        }

        ws.update_session(&session_id, |s| s.status = SessionStatus::Working);
        ws.bus.emit(
            DomainEvent::new(
                EventType::AgentStatusChanged,
                scope.clone(),
                serde_json::json!({ "status": "working" }),
            )
            .caused_by(&claimed),
        );

        Ok(LiveSession {
            session_id,
            cmd: cmd.clone(),
            agent,
            scope,
            checkpoint,
            claim_id: claim.id,
            claimed,
            started,
            context,
            intent,
        })
    }

    /// The provider loop and everything after it.
    fn drive_inner(ws: &Arc<Workspace>, live: LiveSession) -> Result<SessionOutcome, String> {
        let LiveSession {
            session_id,
            cmd,
            agent,
            scope,
            checkpoint,
            claim_id,
            claimed,
            started,
            context,
            intent,
        } = live;
        let cmd = &cmd;
        let Some(project) = ws.project(&cmd.project_id) else {
            return Err(format!("unknown project '{}'", cmd.project_id));
        };
        let deck = project.deck();

        // -- 5. the loop ---------------------------------------------------
        let mut observations: Vec<super::provider::Observation> = Vec::new();
        let mut files_touched: Vec<String> = Vec::new();
        let mut summary = String::new();
        let mut turns = 0u32;
        let mut failed: Option<String> = None;

        for turn in 0..MAX_TURNS {
            turns = turn + 1;

            let request = AgentRequest {
                agent_id: agent.id.clone(),
                role: agent.role.clone(),
                model: agent.model.clone(),
                system: agent.system.clone(),
                context: context.to_prompt(),
                goal: intent.clone(),
                // Filtered by this agent's permissions, so what a provider is
                // offered is exactly what it is allowed to call.
                tools: super::tools::definitions_for(&agent.id, &ws.permission_matrix()),
                observations: observations.clone(),
                turn,
                // A goal-driven agent has no conversation to carry.
                history: Vec::new(),
            };

            let response: AgentResponse = {
                let providers = ws.providers.lock().unwrap();
                let Some(p) = providers.get(&agent.provider) else {
                    return Err(format!("unknown provider '{}'", agent.provider));
                };
                match p.run(&request) {
                    Ok(r) => r,
                    Err(e) => {
                        failed = Some(e);
                        break;
                    }
                }
            };

            if !response.message.is_empty() {
                ws.update_session(&session_id, |s| {
                    s.transcript.push(TranscriptEntry {
                        at: now_iso(),
                        kind: "message".into(),
                        text: response.message.clone(),
                    });
                });
            }

            let mut done = response.complete;
            for action in &response.actions {
                match action {
                    AgentAction::Tool(call) => {
                        let result =
                            project
                                .tools
                                .execute(&ws.bus, &agent.id, &scope, call, Some(&claimed));
                        observations.push(super::provider::Observation {
                            // Empty for the mock, which has no wire protocol;
                            // a real provider's calls carry their own id, and
                            // the result has to reference it.
                            call_id: call.call_id.clone(),
                            tool: call.tool.clone(),
                            action: call.action.clone(),
                            args: call.args.clone(),
                            ok: result.ok,
                            output: if result.ok {
                                result.output.clone()
                            } else {
                                result.error.clone().unwrap_or_default()
                            },
                        });
                        ws.update_session(&session_id, |s| {
                            s.transcript.push(TranscriptEntry {
                                at: now_iso(),
                                kind: if result.ok { "tool" } else { "tool-error" }.into(),
                                text: format!("{}.{}", call.tool, call.action),
                            });
                        });

                        for f in &result.changed_files {
                            if !files_touched.contains(f) {
                                files_touched.push(f.clone());
                            }
                        }

                        // A file write is what starts reconciliation. Commit
                        // it first so the repo actually moves -- otherwise every
                        // checkpoint still equals HEAD and nothing is ever stale.
                        if !result.changed_files.is_empty() {
                            let sha = Self::commit_change(
                                ws,
                                &project.root,
                                &scope,
                                &claimed,
                                &agent.id,
                                &cmd.feature_id,
                                cmd.work_item_id.as_deref(),
                                &session_id,
                                &format!("{}: {}", agent.name, intent),
                                &result.changed_files,
                            );
                            Self::reconcile(
                                ws,
                                &cmd.project_id,
                                &cmd.feature_id,
                                &agent.id,
                                &claimed,
                                ChangeSet {
                                    project_id: cmd.project_id.clone(),
                                    feature_id: cmd.feature_id.clone(),
                                    author: agent.id.clone(),
                                    files: result.changed_files.clone(),
                                    decisions: vec![],
                                    symbols: vec![],
                                    from_commit: checkpoint.commit.clone(),
                                    to_commit: sha
                                        .or_else(|| crate::git::head_commit(&project.root)),
                                },
                            );
                        }

                        // Test runs are recorded so the Test Report screen has
                        // something real to show.
                        if call.tool == TOOL_TESTS {
                            let cfg = deck.app_cfg();
                            let run = TestRun {
                                id: super::events::new_id("test"),
                                project_id: cmd.project_id.clone(),
                                feature_id: Some(cmd.feature_id.clone()),
                                agent_id: agent.id.clone(),
                                command: cfg.test.clone().unwrap_or_else(|| "(none)".into()),
                                started_at: now_iso(),
                                ended_at: Some(now_iso()),
                                passed: result.ok,
                                output: result.output.clone(),
                            };
                            ws.add_test_run(run.clone());
                            ws.bus.emit(
                                DomainEvent::new(
                                    if result.ok {
                                        EventType::TestCompleted
                                    } else {
                                        EventType::TestFailed
                                    },
                                    scope.clone(),
                                    serde_json::json!({
                                        "runId": run.id, "passed": run.passed,
                                        "command": run.command,
                                    }),
                                )
                                .caused_by(&claimed),
                            );
                        }
                    }

                    AgentAction::Decision {
                        id,
                        title,
                        body,
                        impacts,
                        supersedes,
                    } => {
                        let doc = Doc {
                            meta: DecisionMeta {
                                id: id.clone(),
                                title: title.clone(),
                                status: "approved".into(),
                                feature: Some(cmd.feature_id.clone()),
                                author: Some(agent.id.clone()),
                                created: Some(now_iso()),
                                impacts: impacts.clone(),
                                supersedes: supersedes.clone(),
                            },
                            body: body.clone(),
                        };
                        match deck.save_decision(Some(&cmd.feature_id), &doc) {
                            Ok(path) => {
                                let rel = deck.rel(&path);
                                let ev = ws.bus.emit(
                                    DomainEvent::new(
                                        EventType::DecisionCreated,
                                        scope.clone(),
                                        serde_json::json!({
                                            "id": id, "title": title, "author": agent.id,
                                            "supersedes": supersedes, "path": rel,
                                        }),
                                    )
                                    .caused_by(&claimed),
                                );
                                let work_view =
                                    ws.work_view(&cmd.project_id, Some(&cmd.feature_id));
                                ws.conflicts.on_decision(&ws.bus, &ev, &work_view);

                                let sha = Self::commit_change(
                                    ws,
                                    &project.root,
                                    &scope,
                                    &claimed,
                                    &agent.id,
                                    &cmd.feature_id,
                                    cmd.work_item_id.as_deref(),
                                    &session_id,
                                    &format!("Decision: {title}"),
                                    std::slice::from_ref(&rel),
                                );
                                Self::reconcile(
                                    ws,
                                    &cmd.project_id,
                                    &cmd.feature_id,
                                    &agent.id,
                                    &claimed,
                                    ChangeSet {
                                        project_id: cmd.project_id.clone(),
                                        feature_id: cmd.feature_id.clone(),
                                        author: agent.id.clone(),
                                        files: vec![rel],
                                        decisions: vec![(id.clone(), title.clone())],
                                        symbols: vec![],
                                        from_commit: checkpoint.commit.clone(),
                                        to_commit: sha
                                            .or_else(|| crate::git::head_commit(&project.root)),
                                    },
                                );
                            }
                            Err(e) => observations.push(super::provider::Observation {
                                call_id: String::new(),
                                tool: "decision".into(),
                                action: "record".into(),
                                // Not a tool call, so there are no arguments
                                // to echo back.
                                args: serde_json::Value::Null,
                                ok: false,
                                output: e,
                            }),
                        }
                    }

                    AgentAction::UpdateContext { body } => {
                        match ContextService::persist(&deck, &cmd.feature_id, body) {
                            Ok(_) => {
                                ws.bus.emit(
                                    DomainEvent::new(
                                        EventType::ContextChanged,
                                        scope.clone(),
                                        serde_json::json!({
                                            "featureId": cmd.feature_id,
                                            "by": agent.id,
                                        }),
                                    )
                                    .caused_by(&claimed),
                                );
                            }
                            Err(e) => observations.push(super::provider::Observation {
                                call_id: String::new(),
                                tool: "decision".into(),
                                action: "record".into(),
                                // Not a tool call, so there are no arguments
                                // to echo back.
                                args: serde_json::Value::Null,
                                ok: false,
                                output: e,
                            }),
                        }
                    }

                    AgentAction::SymbolChanged { symbol } => {
                        // The semantic fact, separate from the bytes: this is
                        // what makes another agent's belief wrong.
                        let ev = ws.bus.emit(
                            DomainEvent::new(
                                EventType::ContextChanged,
                                scope.clone(),
                                serde_json::json!({
                                    "symbol": symbol, "by": agent.id,
                                    "featureId": cmd.feature_id,
                                }),
                            )
                            .caused_by(&claimed),
                        );
                        let work_view = ws.work_view(&cmd.project_id, Some(&cmd.feature_id));
                        ws.conflicts
                            .on_symbol_changed(&ws.bus, &ev, symbol, &agent.id, &work_view);

                        Self::reconcile(
                            ws,
                            &cmd.project_id,
                            &cmd.feature_id,
                            &agent.id,
                            &claimed,
                            ChangeSet {
                                project_id: cmd.project_id.clone(),
                                feature_id: cmd.feature_id.clone(),
                                author: agent.id.clone(),
                                files: vec![],
                                decisions: vec![],
                                symbols: vec![symbol.clone()],
                                from_commit: checkpoint.commit.clone(),
                                to_commit: crate::git::head_commit(&project.root),
                            },
                        );
                    }

                    AgentAction::Done { summary: s } => {
                        summary = s.clone();
                        done = true;
                    }
                }
            }

            if done {
                break;
            }
        }

        // -- 6. complete ---------------------------------------------------
        let conflicts_before = ws.conflicts.open(Some(&cmd.project_id)).len();
        ws.release_claim(
            &claim_id,
            if failed.is_some() {
                "released"
            } else {
                "completed"
            },
        );
        ws.bus.emit(
            DomainEvent::new(
                if failed.is_some() {
                    EventType::WorkReleased
                } else {
                    EventType::WorkCompleted
                },
                scope.clone(),
                serde_json::json!({ "claimId": claim_id }),
            )
            .caused_by(&claimed),
        );

        if let Some(wi) = &cmd.work_item_id {
            if failed.is_none() {
                if let Ok(mut work) = deck.work(&cmd.feature_id) {
                    if let Some(item) = work.meta.items.iter_mut().find(|i| &i.id == wi) {
                        item.status = "done".into();
                    }
                    let _ = deck.save_work(&cmd.feature_id, &work.meta);
                }
            }
        }

        let status = if let Some(e) = &failed {
            ws.bus.emit(
                DomainEvent::new(
                    EventType::AgentFailed,
                    scope.clone(),
                    serde_json::json!({ "error": e }),
                )
                .caused_by(&started),
            );
            SessionStatus::Failed
        } else {
            ws.bus.emit(
                DomainEvent::new(
                    EventType::AgentCompleted,
                    scope.clone(),
                    serde_json::json!({ "summary": summary }),
                )
                .caused_by(&started),
            );
            SessionStatus::Completed
        };

        if summary.is_empty() {
            summary = failed
                .clone()
                .unwrap_or_else(|| "Session ended with no summary.".into());
        }

        ws.update_session(&session_id, |s| {
            s.status = status;
            s.ended_at = Some(now_iso());
            s.turns = turns;
            s.files_touched = files_touched.clone();
            s.summary = Some(summary.clone());
        });

        // Durable session record.
        let _ = deck.save_session(
            &cmd.feature_id,
            &Doc {
                meta: super::deck::SessionMeta {
                    id: session_id.clone(),
                    agent: agent.id.clone(),
                    feature: Some(cmd.feature_id.clone()),
                    work_item: cmd.work_item_id.clone(),
                    started: Some(checkpoint.taken_at.clone()),
                    ended: Some(now_iso()),
                    checkpoint: checkpoint.commit.clone(),
                    status: format!("{status:?}").to_lowercase(),
                },
                body: format!("# Session {session_id}\n\n{summary}\n"),
            },
        );

        ws.bus.emit(
            DomainEvent::new(
                EventType::SessionCompleted,
                scope,
                serde_json::json!({ "summary": summary, "turns": turns }),
            )
            .caused_by(&started),
        );

        Ok(SessionOutcome {
            session_id,
            status: status.label().to_string(),
            turns,
            summary,
            files_touched,
            context_tokens: context.total_tokens,
            conflicts_detected: conflicts_before,
        })
    }

    /// Commit an agent's change, attributed to it.
    ///
    /// This is what makes a checkpoint mean something: without a commit the
    /// repo never moves, every checkpoint equals HEAD, and no agent can ever be
    /// behind. Git is the version layer, so a change that is not committed is a
    /// change the rest of the system cannot see.
    #[allow(clippy::too_many_arguments)]
    fn commit_change(
        ws: &Arc<Workspace>,
        project_root: &std::path::Path,
        scope: &EventScope,
        cause: &DomainEvent,
        agent_id: &str,
        feature_id: &str,
        work_item: Option<&str>,
        session_id: &str,
        message: &str,
        paths: &[String],
    ) -> Option<String> {
        if paths.is_empty() {
            return None;
        }
        match crate::git::commit_with_metadata(
            project_root,
            message,
            paths,
            Some(agent_id),
            Some(feature_id),
            work_item,
            Some(session_id),
        ) {
            Ok(sha) => {
                ws.bus.emit(
                    DomainEvent::new(
                        EventType::GitCommitCreated,
                        scope.clone(),
                        serde_json::json!({
                            "sha": sha,
                            "short": crate::git::short_sha(&sha),
                            "message": message,
                            "files": paths,
                        }),
                    )
                    .caused_by(cause),
                );
                Some(sha)
            }
            Err(e) => {
                // Honest: a failed commit is reported, not swallowed. Silently
                // ignoring it would surface much later as "nobody ever goes
                // stale", which is very hard to trace back to here.
                eprintln!("[aiw] commit failed for {agent_id}: {e}");
                None
            }
        }
    }

    /// Reconcile a change into context and announce who it broke.
    ///
    /// This is the middle of the acceptance chain: it turns a raw change into
    /// `context.reconciled` → `context.delta.detected` / `context.stale`, and
    /// hands the stale sessions to the conflict service.
    fn reconcile(
        ws: &Arc<Workspace>,
        project_id: &str,
        feature_id: &str,
        by: &str,
        cause: &DomainEvent,
        change: ChangeSet,
    ) {
        let Some(project) = ws.project(project_id) else {
            return;
        };
        let deck = project.deck();

        let requested = ws.bus.emit(
            DomainEvent::new(
                EventType::ContextReconciliationRequested,
                EventScope::feature(project_id, feature_id).with_agent(by),
                serde_json::json!({ "files": change.files, "symbols": change.symbols }),
            )
            .caused_by(cause),
        );

        let Ok(current) = ContextService::assemble(&deck, project_id, feature_id, None, &[]) else {
            return;
        };
        let active = ws.active_work_view(project_id);
        let result = ws.reconciler.reconcile(&current, &change, &active);

        let reconciled = ws.bus.emit(
            DomainEvent::new(
                EventType::ContextReconciled,
                EventScope::feature(project_id, feature_id),
                serde_json::json!({
                    "summary": result.summary,
                    "changes": result.delta.changes,
                    "staleSessions": result.stale_sessions,
                    "reconciler": ws.reconciler.name(),
                }),
            )
            .caused_by(&requested),
        );

        if !result.delta.is_empty() {
            ws.bus.emit(
                DomainEvent::new(
                    EventType::ContextDeltaDetected,
                    EventScope::feature(project_id, feature_id),
                    serde_json::json!({
                        "delta": result.delta,
                        "affectsActiveWork": result.delta.affects_active_work,
                    }),
                )
                .caused_by(&reconciled),
            );
        }

        for session_id in &result.stale_sessions {
            let Some(session) = ws.session(session_id) else {
                continue;
            };
            ws.update_session(session_id, |s| s.stale = true);
            let stale_ev = ws.bus.emit(
                DomainEvent::new(
                    EventType::ContextStale,
                    EventScope::feature(project_id, feature_id)
                        .with_agent(&session.agent_id)
                        .with_session(session_id),
                    serde_json::json!({
                        "sessionId": session_id,
                        "agent": session.agent_id,
                        "checkpoint": session.checkpoint.as_ref().and_then(|c| c.commit.clone()),
                    }),
                )
                .caused_by(&reconciled),
            );
            ws.conflicts
                .on_stale(&ws.bus, &stale_ev, session_id, &session.agent_id);
        }
    }
}
