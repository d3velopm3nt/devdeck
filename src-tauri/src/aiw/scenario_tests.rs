//! The end-to-end scenario, and the isolation guarantees around it.
//!
//! These run the *real* runtime, the real bus, the real `.devdeck` on a
//! temporary disk and a real git repo. Nothing is stubbed — the mock provider
//! is a provider, not a bypass. If these pass, the product works; if they are
//! made to pass by special-casing, they are worthless.

use std::path::PathBuf;
use std::sync::Arc;

use super::commands::{run_demo, seed_demo};
use super::context::ContextService;
use super::events::EventType;
use super::runtime::{AgentRuntime, StartAgentCommand};
use super::state::Workspace;
use super::tools::{ToolCall, TOOL_FILES};

struct Tmp(PathBuf);
impl Tmp {
    fn new(tag: &str) -> Self {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "devdeck-aiw-{tag}-{}-{}",
            std::process::id(),
            super::events::new_id("t")
        ));
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

fn ws() -> Arc<Workspace> {
    // A short approval window. Nothing here is watching for a prompt, so the
    // real one would just be dead time: it is the difference between a
    // 26-second suite and a six-minute one.
    let w = Arc::new(Workspace::with_approval_timeout(
        std::time::Duration::from_millis(200),
    ));
    // Same call the app makes at startup; without it the event-driven services
    // are never subscribed and half the behaviour under test cannot happen.
    Workspace::install_handlers(&w);
    w
}

fn saw(ws: &Arc<Workspace>, kind: EventType) -> bool {
    ws.bus.history(None, 5000).iter().any(|e| e.is(kind))
}

// ---------------------------------------------------------------------------
// The defining workflow
// ---------------------------------------------------------------------------

/// The acceptance chain, asserted as one *causal* chain rather than as loose
/// facts about the whole run.
///
/// Developer A changes a shared file → `file.changed` → reconciliation
/// requested → `context.reconciled` → `context.delta.detected` → Developer B's
/// checkpoint is outdated → `context.stale` → `conflict.detected`.
///
/// The ordering is checked inside a single correlation id, not across the whole
/// demo. Globally, the architect reconciles its decision long before Developer A
/// writes anything, so "first file.changed precedes first context.reconciled"
/// is false and would be a meaningless thing to assert anyway — it would pass on
/// coincidence. Following one correlation id proves the events actually caused
/// each other.
#[test]
fn the_event_chain_from_a_file_change_to_a_conflict_actually_happens() {
    let t = Tmp::new("chain");
    let w = ws();
    let result = run_demo(&w, t.0.clone()).expect("demo should run");

    let all = w.bus.history(Some("tyrex"), 5000);

    // The change at the heart of the scenario: Developer A editing the shared
    // interface.
    let file_ev = all
        .iter()
        .find(|e| {
            e.is(EventType::FileChanged)
                && e.payload.get("path").and_then(|v| v.as_str()) == Some("packages/sync/types.ts")
        })
        .unwrap_or_else(|| {
            panic!(
                "Developer A never wrote the shared interface.\nGot: {:#?}",
                all.iter().map(|e| e.kind.clone()).collect::<Vec<_>>()
            )
        });

    let correlation = file_ev
        .correlation_id
        .clone()
        .expect("a derived event must carry a correlation id");

    // Everything caused by that one operation, in order.
    let chain = w.bus.chain(&correlation);
    let names: Vec<String> = chain.iter().map(|e| e.kind.clone()).collect();
    let at = |k: EventType| names.iter().position(|s| s == k.as_str());

    for k in [
        EventType::FileChanged,
        EventType::ContextReconciliationRequested,
        EventType::ContextReconciled,
        EventType::ContextDeltaDetected,
        EventType::ContextStale,
        EventType::ConflictDetected,
    ] {
        assert!(
            at(k).is_some(),
            "'{}' is missing from the causal chain.\nChain: {names:#?}",
            k.as_str()
        );
    }

    let file = at(EventType::FileChanged).unwrap();
    let requested = at(EventType::ContextReconciliationRequested).unwrap();
    let reconciled = at(EventType::ContextReconciled).unwrap();
    let delta = at(EventType::ContextDeltaDetected).unwrap();
    let stale = at(EventType::ContextStale).unwrap();

    assert!(
        file < requested,
        "reconciliation is requested by the change"
    );
    assert!(requested < reconciled, "reconciliation follows its request");
    assert!(reconciled < delta, "the delta comes out of reconciliation");
    assert!(delta < stale, "staleness is decided from the delta");

    // The stale checkpoint must itself raise a conflict — that is the last link.
    let conflict_after_stale = names
        .iter()
        .skip(stale)
        .any(|k| k == EventType::ConflictDetected.as_str());
    assert!(
        conflict_after_stale,
        "the stale checkpoint should raise a conflict.\nChain: {names:#?}"
    );

    assert!(
        !result.conflicts.is_empty(),
        "the scenario is supposed to produce a conflict"
    );

    // And the whole run really did emit every link at least once.
    for k in [
        EventType::SessionStarted,
        EventType::WorkClaimed,
        EventType::ToolExecuted,
        EventType::GitCommitCreated,
        EventType::SessionCompleted,
    ] {
        assert!(saw(&w, k), "'{}' never happened", k.as_str());
    }
}

#[test]
fn the_stale_agent_is_the_one_that_depended_on_the_changed_symbol() {
    let t = Tmp::new("stale");
    let w = ws();
    run_demo(&w, t.0.clone()).unwrap();

    let stale: Vec<String> = w
        .sessions_for(Some("tyrex"))
        .into_iter()
        .filter(|s| s.stale)
        .map(|s| s.agent_id)
        .collect();

    assert!(
        stale.contains(&"dev-b".to_string()),
        "Developer B depends on SyncResult and should have gone stale; stale = {stale:?}"
    );
    assert!(
        !stale.contains(&"dev-a".to_string()),
        "the agent that made the change is not stale by its own change"
    );
}

#[test]
fn a_high_severity_component_conflict_names_both_sides() {
    let t = Tmp::new("conflict");
    let w = ws();
    run_demo(&w, t.0.clone()).unwrap();

    let conflicts = w.conflicts.list(Some("tyrex"), true);
    let component = conflicts
        .iter()
        .find(|c| c.kind == super::conflict::ConflictKind::Component)
        .unwrap_or_else(|| {
            panic!(
                "expected a shared-interface conflict, got: {:#?}",
                conflicts
                    .iter()
                    .map(|c| (&c.kind, &c.title))
                    .collect::<Vec<_>>()
            )
        });

    assert_eq!(component.severity, super::conflict::Severity::High);
    assert_eq!(
        component.left.agent_id, "dev-a",
        "the agent that changed it"
    );
    assert_eq!(
        component.right.agent_id, "dev-b",
        "the agent that depends on it"
    );
    assert!(component.left.detail.contains("SyncResult"));
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

#[test]
fn one_projects_context_never_reaches_another() {
    let t = Tmp::new("projiso");
    let (tyrex, assetx) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());
    w.register_project("assetx", "AssetX", assetx.clone(), assetx.clone());

    let tyrex_ctx = ContextService::assemble(
        &super::deck::Deck::new(tyrex),
        "tyrex",
        "offline-synchronisation",
        None,
        &[],
    )
    .unwrap();
    let prompt = tyrex_ctx.to_prompt();

    assert!(
        !prompt.contains("AssetX"),
        "AssetX content leaked into a TyreX prompt:\n{prompt}"
    );
    assert!(
        !prompt.contains("asset"),
        "AssetX vocabulary leaked into a TyreX prompt:\n{prompt}"
    );
    assert!(prompt.contains("offline"), "TyreX's own context is missing");
}

#[test]
fn one_features_context_never_reaches_another() {
    let t = Tmp::new("featiso");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let deck = super::deck::Deck::new(tyrex);
    deck.save_feature_context(
        "gate-tracking",
        "## Goal\n\nRFID gate reads — GateTracking private marker.\n",
        None,
    )
    .unwrap();

    let ctx =
        ContextService::assemble(&deck, "tyrex", "offline-synchronisation", None, &[]).unwrap();
    let prompt = ctx.to_prompt();

    assert!(
        !prompt.contains("GateTracking private marker"),
        "a sibling feature's context leaked in:\n{prompt}"
    );
    // But its existence is disclosed, so the exclusion is visible rather than
    // silent — that's what the inspector shows.
    let excluded = ctx.section("other-features").expect("siblings are named");
    assert!(excluded.body.contains("gate-tracking"));
}

#[test]
fn events_sessions_and_conflicts_are_scoped_per_project() {
    let t = Tmp::new("evtiso");
    let w = ws();
    run_demo(&w, t.0.clone()).unwrap();

    for ev in w.bus.history(Some("tyrex"), 5000) {
        assert_eq!(
            ev.scope.project_id.as_deref(),
            Some("tyrex"),
            "an AssetX event appeared in TyreX's feed: {ev:?}"
        );
    }
    assert!(
        !w.bus.history(Some("assetx"), 5000).is_empty(),
        "AssetX ran, so it must have events of its own"
    );
    assert!(
        w.sessions_for(Some("assetx"))
            .iter()
            .all(|s| s.project_id == "assetx"),
        "session scoping leaked"
    );
    assert!(
        w.conflicts
            .list(Some("assetx"), true)
            .iter()
            .all(|c| c.project_id == "assetx"),
        "conflict scoping leaked"
    );
}

// ---------------------------------------------------------------------------
// Runtime guarantees
// ---------------------------------------------------------------------------

#[test]
fn a_mock_agent_goes_through_the_same_runtime_as_a_real_one() {
    let t = Tmp::new("runtime");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);

    let outcome = AgentRuntime::run(
        &w,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: "offline-synchronisation".into(),
            agent_id: "dev-a".into(),
            work_item_id: Some("wi-conflict".into()),
            intent: Some("Implement conflict resolution".into()),
            areas: vec!["packages/sync".into()],
            depends_on: vec![],
        },
    )
    .unwrap();

    // The full lifecycle, not a shortcut through it.
    assert_eq!(outcome.status, "Completed");
    assert!(outcome.turns > 0);
    assert!(outcome.context_tokens > 0, "context was actually assembled");
    assert!(saw(&w, EventType::SessionStarted));
    assert!(saw(&w, EventType::SessionCheckpointed));
    assert!(saw(&w, EventType::WorkClaimed));
    assert!(saw(&w, EventType::ToolExecuted));
    assert!(saw(&w, EventType::WorkCompleted));
    assert!(saw(&w, EventType::SessionCompleted));

    let session = w.sessions_for(Some("tyrex")).into_iter().next().unwrap();
    assert!(
        session.checkpoint.is_some(),
        "a session must record the commit it started from"
    );
    assert!(
        !session.transcript.is_empty(),
        "the session recorded nothing"
    );
}

#[test]
fn a_work_item_is_marked_done_in_devdeck_not_just_in_memory() {
    let t = Tmp::new("durable");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());

    AgentRuntime::run(
        &w,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: "offline-synchronisation".into(),
            agent_id: "dev-a".into(),
            work_item_id: Some("wi-conflict".into()),
            intent: None,
            areas: vec![],
            depends_on: vec![],
        },
    )
    .unwrap();

    // Read it back off disk with a fresh Deck — in-memory state is not the
    // source of truth, and this is the test that proves it.
    let deck = super::deck::Deck::new(tyrex);
    let item = deck
        .work("offline-synchronisation")
        .unwrap()
        .meta
        .items
        .into_iter()
        .find(|i| i.id == "wi-conflict")
        .unwrap();
    assert_eq!(item.status, "done");
    assert_eq!(item.assignee.as_deref(), Some("dev-a"));
}

#[test]
fn the_architects_decision_is_written_to_devdeck_and_reaches_later_context() {
    let t = Tmp::new("decision");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());

    AgentRuntime::run(
        &w,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: "offline-synchronisation".into(),
            agent_id: "architect".into(),
            work_item_id: None,
            intent: Some("Define the sync architecture".into()),
            areas: vec![],
            depends_on: vec![],
        },
    )
    .unwrap();

    let deck = super::deck::Deck::new(tyrex);
    let decisions = deck.decisions(Some("offline-synchronisation"));
    assert!(
        decisions
            .iter()
            .any(|d| d.meta.title.contains("Server-authoritative")),
        "the architect's decision was not persisted"
    );

    // And a later agent actually receives it.
    let ctx =
        ContextService::assemble(&deck, "tyrex", "offline-synchronisation", None, &[]).unwrap();
    assert!(
        ctx.to_prompt().contains("Server-authoritative"),
        "a recorded decision must reach the next agent's context"
    );
}

#[test]
fn qa_runs_the_configured_tests_and_the_result_is_recorded() {
    let t = Tmp::new("qa");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);

    AgentRuntime::run(
        &w,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: "offline-synchronisation".into(),
            agent_id: "qa".into(),
            work_item_id: Some("wi-tests".into()),
            intent: Some("Verify synchronisation".into()),
            areas: vec![],
            depends_on: vec![],
        },
    )
    .unwrap();

    let runs = w.test_runs(Some("tyrex"));
    assert_eq!(runs.len(), 1, "QA should have recorded exactly one run");
    assert!(runs[0].passed, "the seeded test command exits 0");
    assert!(
        runs[0].output.contains("2 passed"),
        "the recorded output must be the command's real output, got: {}",
        runs[0].output
    );
    assert!(saw(&w, EventType::TestCompleted));
    assert!(saw(&w, EventType::ProcessStarted) || saw(&w, EventType::ToolExecuted));
}

#[test]
fn qa_cannot_edit_the_code_it_is_testing() {
    let t = Tmp::new("qaperms");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    let p = w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());

    // QA is read-only on files by definition; prove the runtime honours it.
    let r = p.tools.execute(
        &w.bus,
        "qa",
        &super::events::EventScope::feature("tyrex", "offline-synchronisation"),
        &ToolCall::new(
            TOOL_FILES,
            "write",
            serde_json::json!({ "path": "packages/sync/types.ts", "content": "sabotage" }),
        ),
        None,
    );

    assert!(!r.ok, "QA must not be able to write application code");
    assert!(
        !tyrex.join("packages/sync/types.ts").exists(),
        "a denied write still reached the disk"
    );
}

#[test]
fn a_permission_change_takes_effect_immediately() {
    let t = Tmp::new("permchange");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());

    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");
    let call = ToolCall::new(
        TOOL_FILES,
        "write",
        serde_json::json!({ "path": "note.txt", "content": "allowed now" }),
    );

    let before = w.project("tyrex").unwrap();
    assert!(
        !before.tools.execute(&w.bus, "qa", &scope, &call, None).ok,
        "QA starts read-only"
    );

    w.set_permission("qa", "files", "full").unwrap();

    // A stale ToolService snapshot would make this silently keep failing.
    let after = w.project("tyrex").unwrap();
    assert!(
        after.tools.execute(&w.bus, "qa", &scope, &call, None).ok,
        "a permission change must reach the live tool service"
    );
    assert!(tyrex.join("note.txt").exists());
}

#[test]
fn durable_state_survives_wiping_everything_in_memory() {
    let t = Tmp::new("survives");
    let w = ws();
    let result = run_demo(&w, t.0.clone()).unwrap();
    let tyrex = PathBuf::from(&result.tyrex_root);

    // Everything ephemeral goes.
    w.reset_runtime_state();
    assert!(w.sessions_for(None).is_empty());
    assert!(w.bus.history(None, 100).is_empty());

    // Everything durable is still on disk, readable by a fresh Deck.
    let deck = super::deck::Deck::new(tyrex);
    assert!(
        deck.exists(),
        ".devdeck is the source of truth and must survive"
    );
    assert!(deck
        .feature_slugs()
        .contains(&"offline-synchronisation".to_string()));
    assert!(
        deck.decisions(Some("offline-synchronisation"))
            .iter()
            .any(|d| d.meta.title.contains("Server-authoritative")),
        "decisions are durable"
    );
    assert!(
        !deck.sessions("offline-synchronisation").is_empty(),
        "session summaries are durable"
    );
}

#[test]
fn the_activity_feed_is_derived_from_events_not_authored() {
    let t = Tmp::new("activity");
    let w = ws();
    run_demo(&w, t.0.clone()).unwrap();

    let feed = w.bus.history(Some("tyrex"), 500);
    assert!(
        feed.len() > 20,
        "a full scenario should produce a real feed"
    );

    // Every entry is a real domain event with a real category — nothing in the
    // feed is display-only filler.
    for e in &feed {
        assert!(!e.kind.is_empty());
        assert!(!e.category.is_empty());
        assert!(!e.timestamp.is_empty());
    }
    let categories: std::collections::HashSet<&str> =
        feed.iter().map(|e| e.category.as_str()).collect();
    for expected in ["Agent", "Task", "Tool", "Context", "Conflict", "Session"] {
        assert!(
            categories.contains(expected),
            "no '{expected}' events in the feed; got {categories:?}"
        );
    }
}

#[test]
fn a_correlation_id_follows_one_operation_end_to_end() {
    let t = Tmp::new("correlation");
    let w = ws();
    run_demo(&w, t.0.clone()).unwrap();

    // Take the file change that started the interesting chain and walk it.
    let file_ev = w
        .bus
        .history(Some("tyrex"), 5000)
        .into_iter()
        .find(|e| e.is(EventType::FileChanged))
        .expect("the scenario writes a file");
    let correlation = file_ev
        .correlation_id
        .clone()
        .expect("a derived event must carry a correlation id");

    let chain = w.bus.chain(&correlation);
    assert!(
        chain.len() > 3,
        "one operation should span several events, got {}",
        chain.len()
    );
    assert!(
        chain.iter().all(
            |e| e.correlation_id.as_deref() == Some(correlation.as_str()) || e.id == correlation
        ),
        "the chain contains an unrelated event"
    );
}

#[test]
fn the_demo_is_repeatable() {
    // Two clean runs must produce the same shape. A scenario that only works
    // the first time is a fixture, not a test.
    let mut shapes = Vec::new();
    for i in 0..2 {
        let t = Tmp::new(&format!("repeat{i}"));
        let w = ws();
        let r = run_demo(&w, t.0.clone()).unwrap();
        shapes.push((
            r.outcomes.len(),
            r.outcomes
                .iter()
                .filter(|o| o.status == "Completed")
                .count(),
            w.conflicts.list(Some("tyrex"), true).len(),
            w.sessions_for(Some("tyrex"))
                .iter()
                .filter(|s| s.stale)
                .count(),
        ));
    }
    assert_eq!(shapes[0], shapes[1], "the scenario is not deterministic");
}

#[test]
fn a_second_writer_to_the_same_file_is_caught_through_the_event_bus() {
    // Not a direct call into the conflict service: this proves the subscriber
    // is wired, which is the difference between conflict detection working in
    // the product and only working in its unit tests.
    let t = Tmp::new("filebus");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    let p = w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    let call = ToolCall::new(
        TOOL_FILES,
        "write",
        serde_json::json!({ "path": "shared.ts", "content": "one" }),
    );
    p.tools.execute(&w.bus, "dev-a", &scope, &call, None);
    p.tools.execute(&w.bus, "dev-b", &scope, &call, None);

    let conflicts = w.conflicts.list(Some("tyrex"), true);
    assert!(
        conflicts
            .iter()
            .any(|c| c.kind == super::conflict::ConflictKind::File),
        "two agents wrote shared.ts and no file conflict was raised: {:#?}",
        conflicts
            .iter()
            .map(|c| (&c.kind, &c.title))
            .collect::<Vec<_>>()
    );
}

#[test]
fn configuring_a_real_provider_changes_nothing_but_the_provider_layer() {
    let t = Tmp::new("provider");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);

    w.configure_provider(super::state::ProviderConfig {
        kind: "openai-compatible".into(),
        name: "NVIDIA".into(),
        base_url: "https://integrate.api.nvidia.com/v1".into(),
        model: "meta/llama-3.1-70b-instruct".into(),
        ..Default::default()
    })
    .unwrap();

    let listed = w.providers.lock().unwrap().list();
    assert!(
        listed.iter().any(|(id, _, _)| id == "mock"),
        "mock stays available"
    );
    assert!(
        listed.iter().any(|(_, name, _)| name == "NVIDIA"),
        "the configured provider is registered: {listed:?}"
    );

    // And the mock scenario still runs identically — the seam held.
    let outcome = AgentRuntime::run(
        &w,
        &StartAgentCommand {
            project_id: "tyrex".into(),
            feature_id: "offline-synchronisation".into(),
            agent_id: "dev-a".into(),
            work_item_id: Some("wi-conflict".into()),
            intent: None,
            areas: vec![],
            depends_on: vec![],
        },
    )
    .unwrap();
    assert_eq!(outcome.status, "Completed");
}

// ---------------------------------------------------------------------------
// Approvals
//
// `Permission::Approval` used to mean "refused", which was honest but useless:
// with nothing able to say yes, the only way to let an agent do real work was
// `Full`, and a permission level nobody can satisfy is one nobody uses. These
// run the real broker on the real workspace, with a second thread standing in
// for the person at the keyboard.
// ---------------------------------------------------------------------------

/// Wait for the agent to actually be blocked, rather than assuming it got there.
/// Returns the request so a test can assert on what the human was shown.
fn wait_for_prompt(w: &Arc<Workspace>) -> super::approval::ApprovalRequest {
    for _ in 0..600 {
        if let Some(r) = w.pending_approvals().into_iter().next() {
            return r;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("no approval was ever requested — the agent was not blocked");
}

fn approval_fixture() -> (Tmp, Arc<Workspace>, PathBuf, ToolCall) {
    let t = Tmp::new("approve");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    // Long enough for the answering thread to get there, short enough that a
    // broken answer path fails the test rather than stalling the suite.
    let w = Arc::new(Workspace::with_approval_timeout(
        std::time::Duration::from_secs(15),
    ));
    Workspace::install_handlers(&w);
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());
    w.set_permission("qa", "files", "approval").unwrap();
    let call = ToolCall::new(
        TOOL_FILES,
        "write",
        serde_json::json!({ "path": "approved.txt", "content": "a human said yes" }),
    );
    (t, w, tyrex, call)
}

#[test]
fn an_approval_blocks_until_a_human_answers_and_then_the_tool_runs() {
    let (_t, w, tyrex, call) = approval_fixture();
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    let human = {
        let w = w.clone();
        std::thread::spawn(move || {
            let req = wait_for_prompt(&w);
            // What the person is asked has to be legible on its own. A prompt
            // showing raw JSON gets rubber-stamped, which is the same as having
            // no approval at all.
            assert_eq!(req.summary, "write approved.txt");
            assert_eq!(req.agent_id, "qa");
            assert_eq!(req.project_id.as_deref(), Some("tyrex"));
            w.resolve_approval(&req.id, super::approval::Decision::Allow)
                .expect("the waiter should still be there");
        })
    };

    let p = w.project("tyrex").unwrap();
    let r = p.tools.execute(&w.bus, "qa", &scope, &call, None);
    human.join().unwrap();

    assert!(r.ok, "an approved call runs: {:?}", r.error);
    assert!(
        tyrex.join("approved.txt").exists(),
        "and it really wrote the file"
    );
    assert!(saw(&w, EventType::ToolApprovalRequested));
    assert!(saw(&w, EventType::ToolApprovalResolved));
    assert!(w.pending_approvals().is_empty(), "the queue is left clean");
}

#[test]
fn a_denial_stops_the_write_from_ever_happening() {
    let (_t, w, tyrex, call) = approval_fixture();
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    let human = {
        let w = w.clone();
        std::thread::spawn(move || {
            let req = wait_for_prompt(&w);
            w.resolve_approval(&req.id, super::approval::Decision::Deny)
                .unwrap();
        })
    };

    let p = w.project("tyrex").unwrap();
    let r = p.tools.execute(&w.bus, "qa", &scope, &call, None);
    human.join().unwrap();

    assert!(!r.ok, "a refused call must not run");
    assert!(
        !tyrex.join("approved.txt").exists(),
        "a denial has to happen before the side effect, not after it"
    );
    // The agent is told a person said no, not that the tool is broken —
    // otherwise it retries a decision that was already made.
    let why = r.error.unwrap();
    assert!(
        why.contains("refused by a human"),
        "unhelpful reason: {why}"
    );
}

/// The point of "always" — otherwise you answer the same question every turn
/// and start reaching for `Full` just to make it stop.
///
/// This test used to assert the opposite of what it asserts now, and the change
/// is the whole reason standing grants exist. "Always" wrote
/// `set_permission(tool, "full")`, so a yes to writing `approved.txt` was also a
/// yes to writing *anything*, on every project, for ever — and this test proved
/// it by writing a second, unrelated file without a prompt. It now writes a
/// bounded grant for that one call instead: the same call goes through, and the
/// different one still asks.
#[test]
fn always_allow_covers_that_call_and_only_that_call() {
    let (_t, w, tyrex, call) = approval_fixture();
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    let human = {
        let w = w.clone();
        std::thread::spawn(move || {
            let req = wait_for_prompt(&w);
            w.resolve_approval(&req.id, super::approval::Decision::AllowAlways)
                .unwrap();
        })
    };
    let first = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);
    human.join().unwrap();
    assert!(first.ok, "the answered call runs: {:?}", first.error);

    // The level did not move. That is the fix: "always" is now a narrow
    // standing grant, not a promotion to Full.
    assert_eq!(
        w.permission_matrix().get("qa", TOOL_FILES),
        super::tools::Permission::Approval,
        "saying always must not widen the tool"
    );

    // The same call again: nobody is listening, so if it asked it would sit for
    // the full timeout and be refused. Speed is the assertion.
    let started = std::time::Instant::now();
    let again = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);
    assert!(again.ok, "the same call is covered: {:?}", again.error);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "it asked again — the grant did not stick"
    );

    // A *different* file still asks. Someone has to be there to say no, or this
    // would block for the whole timeout.
    let other = ToolCall::new(
        TOOL_FILES,
        "write",
        serde_json::json!({ "path": "again.txt", "content": "not what you agreed to" }),
    );
    let human = {
        let w = w.clone();
        std::thread::spawn(move || {
            let req = wait_for_prompt(&w);
            assert!(
                req.summary.contains("again.txt"),
                "it asked about the right thing: {}",
                req.summary
            );
            w.resolve_approval(&req.id, super::approval::Decision::Deny)
                .unwrap();
        })
    };
    let second = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &other, None);
    human.join().unwrap();

    assert!(!second.ok, "a grant for one file is not a grant for another");
    assert!(
        !tyrex.join("again.txt").exists(),
        "and nothing was written before the refusal"
    );
    assert!(tyrex.join("approved.txt").exists(), "the granted one did run");
}

/// A grant is spent, and when it runs out the question comes back.
#[test]
fn a_standing_grant_runs_out() {
    let (_t, w, _tyrex, call) = approval_fixture();
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    // One use, so the second call has to ask again.
    let grant = super::grants::Grant {
        agent_id: "qa".into(),
        tool: TOOL_FILES.into(),
        action: "write".into(),
        scope: super::grants::Scope::Exact("approved.txt".into()),
        project_id: "tyrex".into(),
        expires_at: (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
        max_uses: 1,
        ..Default::default()
    };
    w.grants()
        .add(grant, super::tools::Access::Write)
        .unwrap();

    let first = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);
    assert!(first.ok, "the grant covered it: {:?}", first.error);

    let human = {
        let w = w.clone();
        std::thread::spawn(move || {
            let req = wait_for_prompt(&w);
            w.resolve_approval(&req.id, super::approval::Decision::Deny)
                .unwrap();
        })
    };
    let second = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);
    human.join().unwrap();
    assert!(!second.ok, "one use meant one");
}

/// The property the whole design rests on: a grant refines `Approval` and can
/// never override a level that was not going to ask.
#[test]
fn a_grant_cannot_reach_past_a_revoked_tool() {
    let (_t, w, tyrex, call) = approval_fixture();
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    w.grants()
        .add(
            super::grants::Grant {
                agent_id: "qa".into(),
                tool: TOOL_FILES.into(),
                action: "write".into(),
                scope: super::grants::Scope::Exact("approved.txt".into()),
                project_id: "tyrex".into(),
                expires_at: (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
                max_uses: 20,
                ..Default::default()
            },
            super::tools::Access::Write,
        )
        .unwrap();

    // Take the tool away without touching the grant.
    w.set_permission("qa", TOOL_FILES, "none").unwrap();

    let r = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);

    assert!(!r.ok, "revoking the tool has to be a complete answer");
    assert!(!tyrex.join("approved.txt").exists());
    assert!(
        r.error.unwrap().contains("denied"),
        "and it reads as denied, not as a grant that failed"
    );
}

/// The mirror image: "always deny" has to revoke, not just refuse once.
#[test]
fn always_deny_revokes_the_tool_rather_than_refusing_one_call() {
    let (_t, w, _tyrex, call) = approval_fixture();
    let scope = super::events::EventScope::feature("tyrex", "offline-synchronisation");

    let human = {
        let w = w.clone();
        std::thread::spawn(move || {
            let req = wait_for_prompt(&w);
            w.resolve_approval(&req.id, super::approval::Decision::DenyAlways)
                .unwrap();
        })
    };
    let first = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);
    human.join().unwrap();
    assert!(!first.ok);

    let started = std::time::Instant::now();
    let second = w
        .project("tyrex")
        .unwrap()
        .tools
        .execute(&w.bus, "qa", &scope, &call, None);
    assert!(!second.ok, "the tool is gone, not merely refused once");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "a revoked tool must fail outright rather than prompt again"
    );
}

/// A model that is never offered an approvable action can never trigger the
/// prompt, so the two halves have to agree.
#[test]
fn an_approvable_action_is_offered_to_the_model() {
    let w = ws();
    w.set_permission("qa", "files", "approval").unwrap();
    let defs = super::tools::definitions_for("qa", &w.permission_matrix());
    let write = defs
        .iter()
        .find(|d| d.name == "files_write")
        .expect("an action a human can approve is a callable one");
    assert!(write.description.contains("requires human approval"));
}

// ---------------------------------------------------------------------------
// The orchestrator
//
// One assistant you talk to, which hands real work to the specialists. These
// run the real conversation store, the real permission gate and the real
// runtime — the mock is a provider, not a bypass.
// ---------------------------------------------------------------------------

use super::assistant::{Assistant, ChatEvent, Conversations, Speaker, ASSISTANT_ID};
use super::personal::PersonalStore;

/// Nobody is watching. Correctness must not depend on a listener.
fn quiet(_: ChatEvent) {}

fn convs(t: &Tmp) -> Conversations {
    // A temp root, not the real one: a test must never write into the user's
    // actual conversation history.
    let s = PersonalStore::at(t.0.join("personal"));
    s.ensure().unwrap();
    Conversations::new(s)
}

/// The distinction that makes this an orchestrator rather than a chat window.
#[test]
fn asking_the_assistant_to_start_work_puts_an_agent_on_it() {
    let t = Tmp::new("orchestrate");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);
    let c = convs(&t);

    let conv = c.create(Some("tyrex")).unwrap();
    let reply = Assistant::send(
        &w,
        &c,
        &conv.id,
        "Can you start work on offline sync?",
        &quiet,
    )
    .unwrap();

    assert_eq!(
        reply.delegated.len(),
        1,
        "it should have delegated: {reply:?}"
    );
    let session = w
        .session(&reply.delegated[0])
        .expect("the session it claims to have started must exist");
    assert_ne!(
        session.agent_id, ASSISTANT_ID,
        "it delegates rather than doing it itself"
    );

    // The transcript records what was actually done, not only what was said.
    let saved = c.load(&conv.id).unwrap();
    assert!(
        saved
            .messages
            .iter()
            .any(|m| m.tool.as_deref() == Some("delegate.start")),
        "the tool step belongs in the transcript"
    );
    assert_eq!(saved.messages.first().unwrap().from, Speaker::User);
    assert_eq!(saved.messages.last().unwrap().from, Speaker::Assistant);
}

/// Delegation must not hold the conversation open for the length of a session.
#[test]
fn delegating_returns_immediately_rather_than_waiting_for_the_agent() {
    let t = Tmp::new("nonblocking");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);
    let c = convs(&t);
    let conv = c.create(Some("tyrex")).unwrap();

    let started = std::time::Instant::now();
    let reply = Assistant::send(&w, &c, &conv.id, "Please start work on it", &quiet).unwrap();
    let elapsed = started.elapsed();

    assert_eq!(reply.delegated.len(), 1);
    assert!(
        elapsed < std::time::Duration::from_secs(10),
        "the chat waited for the whole session ({elapsed:?})"
    );
}

/// The whole point of the store split.
#[test]
fn what_the_assistant_remembers_never_lands_in_the_project() {
    let t = Tmp::new("memsplit");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());
    let c = convs(&t);
    let conv = c.create(Some("tyrex")).unwrap();

    Assistant::send(
        &w,
        &c,
        &conv.id,
        "Remember that I prefer ff-only pulls",
        &quiet,
    )
    .unwrap();

    let notes = c.store().memories();
    assert_eq!(notes.len(), 1, "it should have saved a note");
    assert!(notes[0].body.contains("ff-only"));

    // And nothing of it reached the repository — not the note, not the
    // conversation. This is the assertion the split exists for.
    let deck_dump = super::deck::Deck::new(tyrex.clone()).tree().join("\n");
    assert!(
        !deck_dump.contains("ff-only") && !deck_dump.contains("conv_"),
        "personal state leaked into .devdeck:\n{deck_dump}"
    );
    let stray = walk(&tyrex)
        .into_iter()
        .find(|p| p.to_string_lossy().contains("conv_"));
    assert!(
        stray.is_none(),
        "a conversation file was written into the repo: {stray:?}"
    );
}

fn walk(root: &std::path::Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}

/// The assistant is an agent, not an exception to the rules.
#[test]
fn the_assistant_is_bound_by_the_same_permission_matrix() {
    let w = ws();
    let defs = super::tools::definitions_for(ASSISTANT_ID, &w.permission_matrix());

    // It may delegate and remember.
    assert!(defs.iter().any(|d| d.name == "delegate_start"));
    assert!(defs.iter().any(|d| d.name == "memory_save"));
    // It reads code but does not write it — that is what agents are for.
    assert!(defs.iter().any(|d| d.name == "files_read"));
    assert!(
        !defs.iter().any(|d| d.name == "files_write"),
        "the orchestrator should delegate implementation, not do it"
    );
    // And anything that changes the machine has to ask first.
    let term = defs
        .iter()
        .find(|d| d.name.starts_with("terminal_"))
        .expect("terminal is offered, because a human can approve it");
    assert!(term.description.contains("requires human approval"));

    // Revoking delegation genuinely removes it.
    w.set_permission(ASSISTANT_ID, "delegate", "none").unwrap();
    let after = super::tools::definitions_for(ASSISTANT_ID, &w.permission_matrix());
    assert!(!after.iter().any(|d| d.name.starts_with("delegate_")));
}

/// Without a project, the code tools would have no root to resolve against.
/// Saying so beats offering a model a `files_read` that cannot work.
#[test]
fn a_conversation_with_no_project_is_offered_only_what_it_can_use() {
    let t = Tmp::new("noproject");
    let w = ws();
    let c = convs(&t);
    let conv = c.create(None).unwrap();

    let reply = Assistant::send(&w, &c, &conv.id, "What can you do?", &quiet).unwrap();
    assert!(!reply.reply.trim().is_empty(), "it must say something");
    assert!(reply.delegated.is_empty());
}

/// A tool an agent cannot dispatch must fail loudly rather than doing something
/// surprising with the personal store.
#[test]
fn a_project_tool_service_refuses_the_assistant_only_tools() {
    let t = Tmp::new("assistonly");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    let p = w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);
    let scope = super::events::EventScope::project("tyrex");

    for tool in ["delegate", "memory"] {
        let call = ToolCall::new(tool, "list", serde_json::json!({}));
        let r = p.tools.execute(&w.bus, "dev-a", &scope, &call, None);
        assert!(
            !r.ok,
            "'{tool}' must not run inside a project's tool service"
        );
    }
}

// ---------------------------------------------------------------------------
// Testing a provider
// ---------------------------------------------------------------------------

/// Run something with a deadline, so a deadlock fails the suite in seconds
/// instead of hanging it until the harness gives up.
fn within<T: Send + 'static>(secs: u64, what: &str, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    match rx.recv_timeout(std::time::Duration::from_secs(secs)) {
        Ok(v) => v,
        Err(_) => panic!("{what} did not finish within {secs}s — it is deadlocked"),
    }
}

/// The Test button used to hang forever.
///
/// The command held the registry lock, then called a probe that locked the same
/// non-reentrant mutex again. It affected every provider, and it looked like a
/// slow network rather than a deadlock, which is what made it hard to see.
#[test]
fn testing_a_provider_does_not_deadlock_on_the_registry_lock() {
    let w = ws();
    // No model, so the probe refuses before any network call — the point is
    // that it *returns*, not what it says.
    w.configure_provider(super::state::ProviderConfig {
        kind: "anthropic".into(),
        model: String::new(),
        ..Default::default()
    })
    .unwrap();

    let w2 = w.clone();
    let r = within(10, "Anthropic test", move || w2.test_provider("anthropic"));
    assert!(r.is_err(), "no model means it cannot succeed");
    assert!(
        r.unwrap_err().to_lowercase().contains("model"),
        "and it should say which piece is missing"
    );
}

#[test]
fn testing_an_openai_compatible_provider_does_not_deadlock_either() {
    let w = ws();
    // A port nothing listens on: the probe fails fast and offline, which is
    // what makes this safe to run anywhere.
    w.configure_provider(super::state::ProviderConfig {
        kind: "openai-compatible".into(),
        name: "Local".into(),
        base_url: "http://127.0.0.1:1".into(),
        model: "whatever".into(),
        ..Default::default()
    })
    .unwrap();

    let w2 = w.clone();
    let r = within(20, "OpenAI-compatible test", move || {
        w2.test_provider("openai-compatible")
    });
    assert!(r.is_err(), "nothing is listening on that port");
}

/// The registry must be usable while a probe is running, or one slow test
/// button freezes every agent in the workspace.
#[test]
fn the_registry_stays_open_while_a_provider_is_being_tested() {
    let w = ws();
    w.configure_provider(super::state::ProviderConfig {
        kind: "openai-compatible".into(),
        name: "Local".into(),
        base_url: "http://127.0.0.1:1".into(),
        model: "whatever".into(),
        ..Default::default()
    })
    .unwrap();

    let probing = {
        let w = w.clone();
        std::thread::spawn(move || w.test_provider("openai-compatible"))
    };
    // Something an agent does constantly. If the probe held the lock, this
    // would block until the network call gave up.
    let w2 = w.clone();
    within(5, "reading the agent list during a probe", move || {
        for _ in 0..50 {
            let _ = w2.agents();
        }
    });
    let _ = probing.join();
}

#[test]
fn testing_a_provider_that_was_never_configured_says_so() {
    let w = ws();
    let r = within(5, "unknown provider", move || w.test_provider("nope"));
    assert!(r.unwrap_err().contains("not configured"));
}

/// A model turn must not hold the provider registry.
///
/// It used to: `get` returned a borrow, so the lock lived for the whole call.
/// Every other agent queued behind whoever was talking, and an agent paused on
/// an approval prompt held it for the length of the prompt — so the app looked
/// hung at exactly the moment you went to find out why.
#[test]
fn a_running_agent_does_not_hold_the_provider_registry() {
    let t = Tmp::new("providerlock");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);

    let running = {
        let w = w.clone();
        std::thread::spawn(move || {
            AgentRuntime::run(
                &w,
                &StartAgentCommand {
                    project_id: "tyrex".into(),
                    feature_id: "offline-synchronisation".into(),
                    agent_id: "dev-a".into(),
                    work_item_id: None,
                    intent: Some("hold the lock if you can".into()),
                    areas: vec![],
                    depends_on: vec![],
                },
            )
        })
    };

    // Something a second agent does on every turn. If the first still held the
    // registry, this would block until it finished.
    let w2 = w.clone();
    within(10, "reaching the registry while an agent runs", move || {
        for _ in 0..200 {
            let _ = w2.providers.lock().unwrap().get("mock");
        }
    });

    running
        .join()
        .unwrap()
        .expect("the agent should still finish");
}

// ---------------------------------------------------------------------------
// Defaults, and remembering what you change
// ---------------------------------------------------------------------------

/// The defaults were written when a deterministic mock was the only provider,
/// where unrestricted terminal access was harmless. With a real model choosing
/// the command it is not, so anything that runs a command has to ask.
#[test]
fn nobody_gets_to_run_a_command_without_asking() {
    let w = ws();
    let m = w.permission_matrix();
    for agent in ["dev-a", "dev-b", "qa", ASSISTANT_ID] {
        for tool in ["terminal", "process"] {
            let p = m.get(agent, tool);
            assert!(
                !matches!(p, super::tools::Permission::Full),
                "{agent} may run {tool} unprompted by default ({p:?})"
            );
        }
    }
}

/// Not everything should ask, or you learn to click Allow without reading.
/// Writing code and committing it stays inside the project; running the suite
/// is what the developers do constantly.
#[test]
fn the_work_itself_is_not_gated_behind_a_prompt() {
    let w = ws();
    let m = w.permission_matrix();
    for tool in ["files", "git", "tests"] {
        assert!(
            matches!(m.get("dev-a", tool), super::tools::Permission::Full),
            "a developer should not need permission to {tool}"
        );
    }
    // QA stays read-only on files: reporting a defect is useful, silently
    // editing the code under test is not.
    assert!(matches!(
        m.get("qa", "files"),
        super::tools::Permission::Read
    ));
}

/// The orchestrator delegates; it does not implement. That is what makes the
/// specialists' permissions mean anything.
#[test]
fn the_assistant_still_cannot_write_code_itself() {
    let w = ws();
    let m = w.permission_matrix();
    assert!(matches!(
        m.get(ASSISTANT_ID, "files"),
        super::tools::Permission::Read
    ));
    assert!(matches!(
        m.get(ASSISTANT_ID, "delegate"),
        super::tools::Permission::Full
    ));
}

/// Saved grants are overlaid on the current defaults, not swapped in for them:
/// a tool added in a later version must arrive with its intended default rather
/// than with nothing.
#[test]
fn restoring_permissions_keeps_defaults_for_anything_not_saved() {
    let w = ws();
    w.set_permission("dev-a", "terminal", "full").unwrap();
    let saved = w.permission_grants();
    assert!(saved.contains(&(
        "dev-a".to_string(),
        "terminal".to_string(),
        "full".to_string()
    )));

    // A fresh workspace, as after a restart.
    let fresh = ws();
    assert!(
        !matches!(
            fresh.permission_matrix().get("dev-a", "terminal"),
            super::tools::Permission::Full
        ),
        "the default is the tightened one"
    );
    fresh.restore_permissions(&saved);
    assert!(
        matches!(
            fresh.permission_matrix().get("dev-a", "terminal"),
            super::tools::Permission::Full
        ),
        "a choice you made must survive a restart, or the matrix is a suggestion"
    );
    // And everything not in the saved set still has its default.
    assert!(matches!(
        fresh.permission_matrix().get("qa", "files"),
        super::tools::Permission::Read
    ));
}

/// A grant for a tool that no longer exists must not resurrect it.
#[test]
fn a_saved_grant_for_an_unknown_tool_is_ignored() {
    let w = ws();
    w.restore_permissions(&[("dev-a".into(), "telepathy".into(), "full".into())]);
    let defs = super::tools::definitions_for("dev-a", &w.permission_matrix());
    assert!(!defs.iter().any(|d| d.name.starts_with("telepathy")));
}

/// Restoring must actually reach the live tool services, not just the agent
/// list — a permission change that stops at the model is one that appears to
/// work and changes nothing.
#[test]
fn restored_permissions_reach_the_running_tool_services() {
    let t = Tmp::new("restoreperm");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex.clone());

    let scope = super::events::EventScope::project("tyrex");
    let call = ToolCall::new(
        TOOL_FILES,
        "write",
        serde_json::json!({ "path": "restored.txt", "content": "yes" }),
    );
    assert!(
        !w.project("tyrex")
            .unwrap()
            .tools
            .execute(&w.bus, "qa", &scope, &call, None)
            .ok,
        "QA starts read-only"
    );

    w.restore_permissions(&[("qa".into(), "files".into(), "full".into())]);
    assert!(
        w.project("tyrex")
            .unwrap()
            .tools
            .execute(&w.bus, "qa", &scope, &call, None)
            .ok,
        "a restored grant must reach the live tool service"
    );
}

/// "I've put Developer A on it" is a claim about real work. If the agent is on
/// the mock, the session produces a fixture, and the transcript is the only
/// place that would ever say so.
#[test]
fn delegating_to_a_scripted_agent_says_that_it_is_scripted() {
    let t = Tmp::new("scripted");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();
    w.register_project("tyrex", "TyreX", tyrex.clone(), tyrex);
    let c = convs(&t);
    let conv = c.create(Some("tyrex")).unwrap();

    Assistant::send(&w, &c, &conv.id, "start work on offline sync", &quiet).unwrap();

    let saved = c.load(&conv.id).unwrap();
    let step = saved
        .messages
        .iter()
        .find(|m| m.tool.as_deref() == Some("delegate.start"))
        .expect("it should have delegated");
    assert!(
        step.text.contains("mock provider") && step.text.contains("fixture"),
        "a scripted session must not read as real work: {}",
        step.text
    );
}

// ---------------------------------------------------------------------------
// One project list
//
// The AI Workspace used to keep its own registry — string ids, a JSON blob in
// settings, no link to `nodes`. "TyreX" here and a `tyrex` project in the
// Explorer were two unrelated records that happened to share a folder.
// ---------------------------------------------------------------------------

#[test]
fn syncing_adopts_every_project_and_forgets_the_ones_that_went() {
    let t = Tmp::new("sync");
    let (tyrex, assetx) = seed_demo(&t.0).unwrap();
    let w = ws();

    let changed = w.sync_projects(&[
        ("7".into(), "TyreX".into(), tyrex.clone(), tyrex.clone()),
        ("9".into(), "AssetX".into(), assetx.clone(), assetx.clone()),
    ]);
    assert_eq!(changed, 2);
    assert!(w.project("7").is_some());
    assert!(w.project("9").is_some());

    // Delete one in the Explorer and it must leave here too. A project that
    // lingered would be the split registry all over again.
    let changed = w.sync_projects(&[("7".into(), "TyreX".into(), tyrex.clone().clone(), tyrex.clone())]);
    assert_eq!(changed, 1, "one eviction, no re-registration");
    assert!(w.project("7").is_some());
    assert!(
        w.project("9").is_none(),
        "a removed project must not linger"
    );
}

/// A handle owns the running-app state, so rebuilding it on every sync would
/// forget which apps an agent had started.
#[test]
fn an_unchanged_project_keeps_its_handle() {
    let t = Tmp::new("stable");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();

    let wanted = vec![("7".to_string(), "TyreX".to_string(), tyrex.clone(), tyrex.clone())];
    w.sync_projects(&wanted);
    let first = w.project("7").unwrap();

    assert_eq!(
        w.sync_projects(&wanted),
        0,
        "nothing changed, nothing to do"
    );
    let again = w.project("7").unwrap();
    assert!(
        Arc::ptr_eq(&first, &again),
        "the same project must keep the same handle across a sync"
    );

    // A rename is a real change and does rebuild.
    let renamed = vec![("7".to_string(), "Tyre Exchange".to_string(), tyrex.clone(), tyrex)];
    assert_eq!(w.sync_projects(&renamed), 1);
    assert_eq!(w.project("7").unwrap().name, "Tyre Exchange");
}

/// Moving a project on disk has to move where its agents read and write, or
/// they would keep operating on the old folder.
#[test]
fn a_moved_project_gets_a_new_root() {
    let t = Tmp::new("moved");
    let (tyrex, assetx) = seed_demo(&t.0).unwrap();
    let w = ws();

    w.sync_projects(&[("7".into(), "TyreX".into(), tyrex.clone(), tyrex)]);
    assert_eq!(
        w.sync_projects(&[("7".into(), "TyreX".into(), assetx.clone().clone(), assetx.clone())]),
        1
    );
    assert_eq!(w.project("7").unwrap().root, assetx);
}

/// `.devdeck` is keyed by the folder, not by the id we happen to call a
/// project. That is why re-identifying projects during the merge could not lose
/// a feature, a decision or a commit.
#[test]
fn re_identifying_a_project_keeps_everything_on_disk() {
    let t = Tmp::new("reid");
    let (tyrex, _) = seed_demo(&t.0).unwrap();
    let w = ws();

    w.sync_projects(&[("tyrex".into(), "TyreX".into(), tyrex.clone().clone(), tyrex.clone())]);
    let before = w.project("tyrex").unwrap().deck().feature_slugs();
    assert!(!before.is_empty(), "the fixture has features");

    // The same folder, under the id a node would give it.
    w.sync_projects(&[("42".into(), "TyreX".into(), tyrex.clone(), tyrex)]);
    assert!(w.project("tyrex").is_none());
    let after = w.project("42").unwrap().deck().feature_slugs();
    assert_eq!(
        before, after,
        "the same folder still holds the same features"
    );
}

/// A project node with no path has no root to resolve against. Registering one
/// produces an agent that fails on its first file read, rather than a project
/// that is visibly not set up yet — so the sync leaves it out.
#[test]
fn a_project_with_no_path_is_not_adopted() {
    let w = ws();
    assert_eq!(w.sync_projects(&[]), 0);
    assert!(w.summaries().is_empty());
}
