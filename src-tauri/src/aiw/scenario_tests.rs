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
    let w = Arc::new(Workspace::new());
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
    w.register_project("tyrex", "TyreX", tyrex.clone());
    w.register_project("assetx", "AssetX", assetx.clone());

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
    w.register_project("tyrex", "TyreX", tyrex);

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
    w.register_project("tyrex", "TyreX", tyrex.clone());

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
    w.register_project("tyrex", "TyreX", tyrex.clone());

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
    w.register_project("tyrex", "TyreX", tyrex);

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
    let p = w.register_project("tyrex", "TyreX", tyrex.clone());

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
    w.register_project("tyrex", "TyreX", tyrex.clone());

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
    let p = w.register_project("tyrex", "TyreX", tyrex);
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
    w.register_project("tyrex", "TyreX", tyrex);

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
