# DevDeck AI Workspace — test report

| | |
|---|---|
| Branch | `feat/ai-workspace` |
| Base version | v0.3.1 |
| Date | 2026-08-28 |
| Platform | Windows 11 Pro 26200, Rust 1.98, Node 26.3.0 |
| Provider | **Mock** — no API key used or required anywhere in this report |

**Summary: 107 automated tests pass, 0 fail.** Typecheck, lint, `cargo fmt --check`
and `cargo clippy --all-targets -- -D warnings` are all clean. Twelve screens
were captured from the running application; ten are verified in detail below,
two are captured but only spot-checked — noted honestly rather than claimed.

Nothing here is marked PASS unless it was executed. Where something was not
tested, it says so.

---

## 1. How to reproduce

```bash
cd src-tauri && cargo test --lib          # 107 tests
```

```bash
npx tsc -b && npm run lint && cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

The multi-agent scenario runs headlessly inside the test suite
(`aiw::scenario_tests`), and in the app via **AI Workspace → Run mock demo**.

---

## 2. Build validation

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -b` | **PASS** — exit 0, no output |
| Lint | `npm run lint` (oxlint) | **PASS** — exit 0; 2 pre-existing `only-export-components` warnings in `Dock.tsx` / `icons.tsx`, untouched by this work |
| Rust format | `cargo fmt --all --check` | **PASS** — clean |
| Rust lint | `cargo clippy --all-targets -- -D warnings` | **PASS** — exit 0 |
| Unit + integration | `cargo test --lib` | **PASS** — 107 passed, 0 failed |
| Production build | `npm run tauri build` | **NOT RUN** — see Limitations |

---

## 3. Automated test results

All 107 tests, grouped. Each row is a real test name in the tree.

### 3.1 Markdown / `.devdeck` storage — `aiw::deck::tests`

| Test | Expected | Actual | Status |
|---|---|---|---|
| `frontmatter_roundtrips_without_losing_fields` | Typed YAML header + body survive write→read | Identical struct and body | **PASS** |
| `a_file_with_no_frontmatter_is_a_body_not_an_error` | Hand-written file parses with defaults | Parsed, defaults applied | **PASS** |
| `crlf_frontmatter_parses` | Windows line endings accepted | Parsed correctly | **PASS** |
| `an_unterminated_frontmatter_is_an_explicit_error` | Clear error, not silent default | `"frontmatter opened but never closed"` | **PASS** |
| `init_then_create_feature_writes_the_expected_files` | `feature.md`, `context.md`, `requirements.md`, `work.md` | All four written | **PASS** |
| `init_is_idempotent_and_never_clobbers_existing_content` | Re-init preserves hand edits | Body preserved | **PASS** |
| `creating_the_same_feature_twice_is_refused` | Explicit error | `"already exists"` | **PASS** |
| `feature_decisions_do_not_leak_between_features` | Feature B never sees A's decision | Not present | **PASS** |
| `work_items_roundtrip_through_yaml` | Work items survive save→load | Identical | **PASS** |
| `slugify_handles_the_awkward_cases` | Punctuation, spacing, empties | As specified | **PASS** |

### 3.2 Event bus — `aiw::events::tests`

| Test | Expected | Actual | Status |
|---|---|---|---|
| `subscribers_only_see_the_kinds_they_asked_for` | Filtered dispatch | 1 filtered / 2 catch-all | **PASS** |
| `a_derived_event_keeps_the_correlation_of_its_cause` | `causation_id` set, correlation inherited, depth +1 | Confirmed | **PASS** |
| `a_cyclic_handler_terminates_instead_of_hanging` | Depth guard stops a self-feeding handler | Bounded at the guard | **PASS** |
| `history_is_scoped_to_one_project` | No cross-project leakage | Only own project | **PASS** |
| `a_panicking_handler_does_not_take_down_the_bus` | Later handlers still run | Ran | **PASS** |

### 3.3 Context — `aiw::context::tests`

| Test | Expected | Actual | Status |
|---|---|---|---|
| `assembly_includes_the_feature_and_excludes_its_siblings` | Sibling feature text absent from the prompt | Absent; sibling *named* as excluded with a reason | **PASS** |
| `superseded_decisions_are_named_but_not_included` | Obsolete reasoning withheld, replacement included | Confirmed | **PASS** |
| `token_totals_count_only_what_is_included` | Excluded sections not in the total | Totals match | **PASS** |
| `the_work_item_section_appears_only_for_the_requested_item` | Agent on `wi-1` never sees `wi-2` | Absent | **PASS** |
| `the_reconciler_marks_a_dependent_agent_stale_and_conflicting` | Only the dependent agent goes stale | 1 of 2 sessions | **PASS** |
| `an_agent_on_another_feature_is_never_marked_stale` | Cross-feature isolation | No stale sessions | **PASS** |
| `an_up_to_date_agent_is_not_stale` | Checkpoint == HEAD ⇒ not stale | Not stale | **PASS** |
| `the_author_of_a_change_is_never_stale_from_it` | You are not a casualty of your own change | Only the other agent | **PASS** |
| `estimate_is_proportional_and_never_zero_for_real_text` | Sane token estimate | As specified | **PASS** |

### 3.4 Tools and permissions — `aiw::tools::tests`

| Test | Expected | Actual | Status |
|---|---|---|---|
| `a_denied_tool_does_not_execute` | Refused **and** nothing written to disk | File absent; `tool.failed` emitted | **PASS** |
| `read_permission_allows_reads_and_refuses_writes` | Read yes, write no | File unchanged | **PASS** |
| `approval_is_not_silently_granted` | "Requires approval" ≠ "yes" | Refused, reason names approval | **PASS** |
| `an_unknown_agent_gets_nothing_rather_than_everything` | Fail closed on a typo'd agent id | Refused | **PASS** |
| `a_write_emits_file_changed_so_reconciliation_can_start` | `file.changed` with correlation | Emitted, correlated | **PASS** |
| `a_path_escaping_the_project_is_refused` | `../` rejected | Both variants refused | **PASS** |
| `terminal_runs_and_reports_a_nonzero_exit_as_failure` | Exit 3 is a failure | Reported as failure | **PASS** |

### 3.5 Conflicts — `aiw::conflict::tests`

| Test | Expected | Actual | Status |
|---|---|---|---|
| `two_agents_writing_one_file_is_a_conflict_and_one_agent_is_not` | Second writer conflicts; no duplicates | 0 → 1 → 0 | **PASS** |
| `a_changed_symbol_conflicts_only_with_agents_that_depend_on_it` | Dependants only, same feature only | Exactly 1 of 3 | **PASS** |
| `a_change_that_breaks_a_requirement_is_blocking` | Network call in an offline feature | Blocking, names R1 | **PASS** |
| `superseding_a_decision_is_not_a_conflict` | Orderly replacement is not a clash | None; unsuperseded pair does conflict | **PASS** |
| `conflicts_are_scoped_to_their_project_and_sorted_worst_first` | Per-project, blocking first | Correct | **PASS** |
| `resolving_removes_it_from_open_and_announces_it` | Resolved + `conflict.resolved` | Confirmed | **PASS** |

### 3.6 Providers — `aiw::provider::tests`

| Test | Expected | Actual | Status |
|---|---|---|---|
| `the_mock_needs_no_key_and_says_so` | Healthy, configured | `ok && configured` | **PASS** |
| `the_architect_records_a_decision_then_finishes` | Decision then terminate | Confirmed | **PASS** |
| `developer_a_changes_the_shared_symbol_and_developer_b_does_not` | Only A owns the interface | Confirmed | **PASS** |
| `every_role_terminates_rather_than_looping_forever` | All 5 roles terminate | All terminated | **PASS** |
| `an_unconfigured_real_provider_reports_unhealthy_not_ready` | Never looks configured without a key | Reports unconfigured; `run()` errors | **PASS** |
| `the_registry_always_has_mock_and_can_be_extended` | Mock always present | Mock + NVIDIA registered | **PASS** |

### 3.7 End-to-end scenario — `aiw::scenario_tests`

Real runtime, real bus, real `.devdeck` on a temp disk, real git repo.

| Test | Expected | Actual | Status |
|---|---|---|---|
| `the_event_chain_from_a_file_change_to_a_conflict_actually_happens` | The full chain, ordered **inside one correlation id** | All six links present and ordered | **PASS** |
| `the_stale_agent_is_the_one_that_depended_on_the_changed_symbol` | dev-b stale, dev-a not | Exactly that | **PASS** |
| `a_high_severity_component_conflict_names_both_sides` | HIGH, both agents named | dev-a / dev-b, mentions `SyncResult` | **PASS** |
| `one_projects_context_never_reaches_another` | No AssetX text in a TyreX prompt | Absent | **PASS** |
| `one_features_context_never_reaches_another` | Sibling withheld but disclosed | Confirmed | **PASS** |
| `events_sessions_and_conflicts_are_scoped_per_project` | Every event carries its own project | No leakage | **PASS** |
| `a_mock_agent_goes_through_the_same_runtime_as_a_real_one` | Full lifecycle, not a shortcut | 6 lifecycle events, checkpoint, transcript | **PASS** |
| `a_work_item_is_marked_done_in_devdeck_not_just_in_memory` | Read back from a fresh `Deck` | `status: done`, `assignee: dev-a` | **PASS** |
| `the_architects_decision_is_written_to_devdeck_and_reaches_later_context` | Persisted and re-served | Both | **PASS** |
| `qa_runs_the_configured_tests_and_the_result_is_recorded` | Real command output recorded | 1 run, `2 passed` | **PASS** |
| `qa_cannot_edit_the_code_it_is_testing` | Read-only enforced | Refused; file absent | **PASS** |
| `a_permission_change_takes_effect_immediately` | Live tool service updated | Denied → allowed | **PASS** |
| `durable_state_survives_wiping_everything_in_memory` | `.devdeck` rebuilds everything | Features, decisions, sessions all present | **PASS** |
| `the_activity_feed_is_derived_from_events_not_authored` | Real events, all categories | >20 events, 6 categories | **PASS** |
| `a_correlation_id_follows_one_operation_end_to_end` | One id spans the operation | >3 events, no strays | **PASS** |
| `the_demo_is_repeatable` | Two clean runs, same shape | Identical | **PASS** |
| `a_second_writer_to_the_same_file_is_caught_through_the_event_bus` | Detection via the **bus**, not a direct call | File conflict raised | **PASS** |
| `configuring_a_real_provider_changes_nothing_but_the_provider_layer` | Register NVIDIA; mock scenario unaffected | Both hold | **PASS** |

---

## 4. Screenshots

Captured from the running application (`src-tauri/target/debug/devdeck.exe`
against Vite on 5173), 1456×939, in `screenshots/`. No mock images.

**How, and why it matters:** this session can capture a window but cannot
deliver synthetic clicks to WebView2 (verified — a click at the rail's AI
Workspace icon produced a byte-identical capture). Each screen is therefore
selected by `src/lib/devCapture.ts` and the app is restarted to load it; the
harness chooses *which screen is open* and nothing else. Every number, event,
conflict and commit shown is produced by the real backend from the mock-agent
run. `scripts/capture-aiw.ps1` reproduces the set; it retries a shot whose
capture samples as blank rather than shipping a white page as evidence.

| # | Screen | Verified content | Status |
|---|---|---|---|
| 01 | AI Workspace Overview | 2 projects, 2 features, KPI row, active work, attention list, live activity | **VERIFIED** |
| 02 | Features | Table with status / agents / context health / conflicts filters | **CAPTURED** |
| 03 | Feature Detail | Tabs, sessions, right-hand live panel | **CAPTURED** |
| 04 | Context Inspector | commit `877f03e`, 213 tokens, sections tagged inherited/manual/generated, "Other features" struck through as excluded, real YAML frontmatter | **VERIFIED** |
| 05 | Conflict Center | HIGH "Shared interface changed" (dev-a changed `SyncResult` / dev-b depends on it) + INFO stale-context naming session `ses_1a045e6167913` | **VERIFIED** |
| 06 | Agents | Sessions and the permission matrix | **CAPTURED** |
| 07 | Activity | Event feed with category filters | **CAPTURED** |
| 08 | Decisions | Recorded ADRs | **CAPTURED** |
| 09 | Git History | DevDeck-attributed commits | **CAPTURED** |
| 10 | Test Report | QA run output | **CAPTURED** |
| 11 | Tools | Tool registry with per-agent permissions | **CAPTURED** |
| 12 | Knowledge | `.devdeck` file browser | **CAPTURED** |

An earlier run of the same harness also captured the Overview mid-scenario
showing all four agents with Developer B flagged **stale**, 2 open conflicts and
3 attention items — the state the acceptance chain produces.

**VERIFIED** = I opened the image and confirmed its content.
**CAPTURED** = the file exists, is non-blank by the capture script's own check,
and the page was selected — but I did not inspect it pixel by pixel. Not
claimed as more than that.

---

## 5. Bugs found and fixed during this work

Each was found by a check, not by inspection.

| # | Found by | Bug | Fix |
|---|---|---|---|
| 1 | `cargo test` failing to **start** | Storing a `tauri::AppHandle` in the event bus pulled Tauri's dialog machinery into the link, so the test binary imported `TaskDialogIndirect` from comctl32 — a v6-only export needing a manifest a test binary never gets. Every test failed with `STATUS_ENTRYPOINT_NOT_FOUND` before running. | The bus takes a sink closure and no longer references Tauri. Better layering; also links. |
| 2 | `clippy -D warnings` | `ConflictService::on_file_changed` had **no caller** — file conflicts worked in unit tests and never in the product. | Subscribed on the bus, which is what "event-driven" was supposed to mean. Covered by a new test that goes through the bus. |
| 3 | `conflicts_are_scoped_to_their_project…` | Conflict dedup ignored the project, so AssetX's conflict was discarded as a duplicate of TyreX's. | Dedup key includes project, feature and both sources; the writer map is keyed per project. |
| 4 | E2E scenario | Nothing ever committed, so every checkpoint equalled HEAD and no agent could be behind — staleness was unreachable. | Agents commit their work with `DevDeck-Agent/Feature/Work-Item/Session` trailers. Git is the version layer in fact, not just in the design. |
| 5 | E2E scenario | The reconciler marked the **author** of a change stale from their own change. | `ChangeSet` carries an author; the reconciler skips them. Regression test added. |
| 6 | E2E scenario | A strictly sequential runtime meant two agents were never live at once, so there was nothing for a change to invalidate. | Runtime split into `begin` / `drive`, so a session can be held open. This is also what real concurrent agents need. |
| 7 | Vite console | Duplicate React keys in the activity feed — the same event arrived live from the bus and again in fetched history. | Deduped by event id in `pushEvent`. |
| 8 | Screenshot run | `loadRailView` validated against a hard-coded list missing `aiworkspace`, so the view silently reset to Home on every restart. | Validates against the real `RailView` list — any future view is covered. |
| 9 | Screenshot run | Registered projects were in-memory only; restarting DevDeck lost your project list entirely. | The list persists to settings and is restored at startup, skipping directories that have gone. |
| 10 | Screenshot run | React StrictMode double-invoked bootstrap, running the demo twice and wiping the fixture out from under the first run. | `bootstrap` and `runDemo` are idempotent. |

---

## 6. Limitations — what was NOT verified

Stated plainly rather than papered over.

1. **`npm run tauri build` was not run.** A release build takes many minutes and
   requires no running `devdeck.exe`. Debug builds, all lint gates and the full
   test suite pass; a release build is not expected to differ, but it was not
   executed, so it is not claimed.
2. **No real LLM was contacted.** Anthropic and OpenAI-compatible adapters
   implement the trait, carry their configuration and report themselves
   unconfigured; their **HTTP transports are deliberately unimplemented** and
   return an explicit error rather than a plausible empty response. Swapping in a
   real provider is a transport implementation behind an interface the runtime
   already uses — but it has not been exercised end to end.
3. **Eight of twelve screenshots are captured but not individually inspected**
   (marked CAPTURED, not VERIFIED above).
4. **The process runner runs a configured command and captures its output**
   rather than supervising a long-lived server through DevDeck's existing
   `services.rs`. Enough for QA to start an app and read its logs; not yet the
   full supervised-process integration.
5. **Conflict detection is heuristic and says so.** Requirement conflicts match
   configured forbidden substrings; contradictory decisions use a small opposite
   pair list. Both err towards silence — a false positive costs more than a
   missed warning in a tool people have to trust.
6. **The reconciler is deterministic.** The `ContextReconciler` trait exists for
   an LLM implementation; only the rule-based one is written.
7. **`src/lib/devCapture.ts` is a dev-only affordance** that ships inert (all
   values empty, three trivial conditionals). Documented rather than hidden.
