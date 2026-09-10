//! Conflicts: when two pieces of work, or a piece of work and a rule, disagree.
//!
//! This service never gets called directly. It watches the bus — `file.changed`,
//! `work.claimed`, `decision.created`, `context.delta.detected` — and decides
//! whether what just happened contradicts something else that is live. Being
//! event-driven is what makes it work for agents nobody told it about.
//!
//! Detection is heuristic and says so. The honest framing is "these two look
//! like they disagree, here is the evidence" — not "this is broken". A conflict
//! centre that cries wolf gets ignored, so severity is conservative and every
//! conflict carries the two sides that produced it.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use super::events::{new_id, now_iso, DomainEvent, EventBus, EventScope, EventType};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    High,
    Blocking,
}

impl Severity {
    /// Wire label for the UI. Kept beside the enum so there is one spelling.
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            Severity::Info => "INFO",
            Severity::Warning => "WARNING",
            Severity::High => "HIGH",
            Severity::Blocking => "BLOCKING",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictKind {
    /// Two agents writing the same file.
    File,
    /// One agent changed a symbol another depends on.
    Component,
    /// A new decision contradicts a live one.
    Decision,
    /// A change violates a stated requirement.
    Requirement,
    /// An agent is working from a context that has moved on.
    StaleContext,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConflictSide {
    pub agent_id: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Conflict {
    pub id: String,
    pub kind: ConflictKind,
    pub severity: Severity,
    pub title: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    /// The two things that disagree. Always both — a conflict with one side is
    /// an assertion, not evidence.
    pub left: ConflictSide,
    pub right: ConflictSide,
    pub detected_at: String,
    pub resolved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
}

/// What the detector needs to know about live work to judge a change.
#[derive(Clone, Debug, Default)]
pub struct WorkView {
    pub claims: Vec<ClaimView>,
    /// Requirement id → (text, forbidden substrings).
    pub requirements: Vec<(String, String, Vec<String>)>,
    /// Live decisions: id → title.
    pub decisions: Vec<(String, String)>,
}

#[derive(Clone, Debug, Default)]
pub struct ClaimView {
    pub claim_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub feature_id: String,
    pub areas: Vec<String>,
    pub depends_on: Vec<String>,
}

/// Holds open conflicts and decides when a new one exists.
#[derive(Default)]
pub struct ConflictService {
    conflicts: Mutex<Vec<Conflict>>,
    /// Files written, and by whom, so a second writer can be spotted.
    writers: Mutex<HashMap<String, Vec<String>>>,
}

impl ConflictService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open(&self, project_id: Option<&str>) -> Vec<Conflict> {
        self.list(project_id, false)
    }

    pub fn list(&self, project_id: Option<&str>, include_resolved: bool) -> Vec<Conflict> {
        let mut v: Vec<Conflict> = self
            .conflicts
            .lock()
            .unwrap()
            .iter()
            .filter(|c| include_resolved || !c.resolved)
            .filter(|c| project_id.map(|p| c.project_id == p).unwrap_or(true))
            .cloned()
            .collect();
        // Worst first — the blocking one must not be below the fold.
        v.sort_by_key(|c| std::cmp::Reverse(c.severity));
        v
    }

    pub fn resolve(
        &self,
        bus: &EventBus,
        id: &str,
        by: &str,
        how: &str,
    ) -> Result<Conflict, String> {
        let mut list = self.conflicts.lock().unwrap();
        let Some(c) = list.iter_mut().find(|c| c.id == id) else {
            return Err(format!("no conflict '{id}'"));
        };
        c.resolved = true;
        c.resolved_by = Some(by.to_string());
        c.resolution = Some(how.to_string());
        let out = c.clone();
        drop(list);

        bus.publish(
            EventType::ConflictResolved,
            EventScope {
                project_id: Some(out.project_id.clone()),
                feature_id: out.feature_id.clone(),
                ..Default::default()
            },
            serde_json::json!({ "conflictId": out.id, "by": by, "resolution": how }),
        );
        Ok(out)
    }

    fn record(&self, bus: &EventBus, c: Conflict, cause: Option<&DomainEvent>) -> Option<Conflict> {
        {
            let mut list = self.conflicts.lock().unwrap();
            // The same disagreement re-detected on every subsequent event would
            // bury the feed; one open conflict per (kind, title, sides).
            let dupe = list.iter().any(|e| {
                !e.resolved
                    && e.project_id == c.project_id
                    && e.feature_id == c.feature_id
                    && e.kind == c.kind
                    && e.title == c.title
                    && e.left.agent_id == c.left.agent_id
                    && e.right.agent_id == c.right.agent_id
                    // Two agents clashing over *different* files are two
                    // conflicts, not one.
                    && e.left.source == c.left.source
                    && e.right.source == c.right.source
            });
            if dupe {
                return None;
            }
            list.push(c.clone());
        }

        let scope = EventScope {
            project_id: Some(c.project_id.clone()),
            feature_id: c.feature_id.clone(),
            ..Default::default()
        };
        let ev = DomainEvent::new(
            EventType::ConflictDetected,
            scope,
            serde_json::json!({
                "conflictId": c.id,
                "kind": c.kind,
                "severity": c.severity,
                "title": c.title,
                "left": c.left,
                "right": c.right,
            }),
        );
        bus.emit(match cause {
            Some(x) => ev.caused_by(x),
            None => ev,
        });
        Some(c)
    }

    /// A file was written. Conflict if someone else already wrote it.
    pub fn on_file_changed(
        &self,
        bus: &EventBus,
        ev: &DomainEvent,
        work: &WorkView,
    ) -> Vec<Conflict> {
        let Some(path) = ev.payload.get("path").and_then(|v| v.as_str()) else {
            return vec![];
        };
        let Some(agent) = ev.payload.get("by").and_then(|v| v.as_str()) else {
            return vec![];
        };
        let project_id = ev.scope.project_id.clone().unwrap_or_default();

        let previous: Vec<String> = {
            let mut w = self.writers.lock().unwrap();
            // Keyed by project as well as path: `src/index.ts` in two projects
            // is two different files.
            let entry = w.entry(format!("{project_id}::{path}")).or_default();
            let others: Vec<String> = entry.iter().filter(|a| *a != agent).cloned().collect();
            if !entry.iter().any(|a| a == agent) {
                entry.push(agent.to_string());
            }
            others
        };

        let mut out = Vec::new();

        // An agent that claimed this area but has not written yet is a softer
        // signal than two actual writers, so it is reported at Info.
        for claim in &work.claims {
            if claim.agent_id == agent {
                continue;
            }
            if !claim
                .areas
                .iter()
                .any(|a| !a.is_empty() && path.starts_with(a.as_str()))
            {
                continue;
            }
            if let Some(c) = self.record(
                bus,
                Conflict {
                    id: new_id("cf"),
                    kind: ConflictKind::File,
                    severity: Severity::Info,
                    title: "Write inside another agent's claimed area".into(),
                    project_id: project_id.clone(),
                    feature_id: ev.scope.feature_id.clone(),
                    left: ConflictSide {
                        agent_id: claim.agent_id.clone(),
                        detail: format!(
                            "claimed {} (session {})",
                            claim.areas.join(", "),
                            claim.session_id
                        ),
                        source: Some(claim.claim_id.clone()),
                    },
                    right: ConflictSide {
                        agent_id: agent.to_string(),
                        detail: format!("wrote {path}"),
                        source: Some(path.to_string()),
                    },
                    detected_at: now_iso(),
                    resolved: false,
                    resolved_by: None,
                    resolution: None,
                },
                Some(ev),
            ) {
                out.push(c);
            }
        }

        for other in previous {
            if let Some(c) = self.record(
                bus,
                Conflict {
                    id: new_id("cf"),
                    kind: ConflictKind::File,
                    severity: Severity::Warning,
                    title: "Same file edited by two agents".into(),
                    project_id: project_id.clone(),
                    feature_id: ev.scope.feature_id.clone(),
                    left: ConflictSide {
                        agent_id: other.clone(),
                        detail: format!("wrote {path}"),
                        source: Some(path.to_string()),
                    },
                    right: ConflictSide {
                        agent_id: agent.to_string(),
                        detail: format!("also wrote {path}"),
                        source: Some(path.to_string()),
                    },
                    detected_at: now_iso(),
                    resolved: false,
                    resolved_by: None,
                    resolution: None,
                },
                Some(ev),
            ) {
                out.push(c);
            }
        }

        // A change that breaks a stated requirement is the serious case.
        if let Some(content) = ev.payload.get("content").and_then(|v| v.as_str()) {
            let lower = content.to_lowercase();
            for (rid, text, forbids) in &work.requirements {
                for bad in forbids {
                    if !bad.is_empty() && lower.contains(&bad.to_lowercase()) {
                        if let Some(c) = self.record(
                            bus,
                            Conflict {
                                id: new_id("cf"),
                                kind: ConflictKind::Requirement,
                                severity: Severity::Blocking,
                                title: "Requirement conflict".into(),
                                project_id: project_id.clone(),
                                feature_id: ev.scope.feature_id.clone(),
                                left: ConflictSide {
                                    agent_id: "requirement".into(),
                                    detail: format!("{rid} · {text}"),
                                    source: Some(rid.clone()),
                                },
                                right: ConflictSide {
                                    agent_id: agent.to_string(),
                                    detail: format!("introduced '{bad}' in {path}"),
                                    source: Some(path.to_string()),
                                },
                                detected_at: now_iso(),
                                resolved: false,
                                resolved_by: None,
                                resolution: None,
                            },
                            Some(ev),
                        ) {
                            out.push(c);
                        }
                    }
                }
            }
        }

        out
    }

    /// A symbol changed. Conflict for every live claim that depends on it.
    pub fn on_symbol_changed(
        &self,
        bus: &EventBus,
        ev: &DomainEvent,
        symbol: &str,
        by: &str,
        work: &WorkView,
    ) -> Vec<Conflict> {
        let project_id = ev.scope.project_id.clone().unwrap_or_default();
        let feature_id = ev.scope.feature_id.clone();
        let mut out = Vec::new();

        for claim in &work.claims {
            if claim.agent_id == by {
                continue; // the author of a change does not conflict with it
            }
            if Some(&claim.feature_id) != feature_id.as_ref() {
                continue; // another feature's work is not affected
            }
            if !claim.depends_on.iter().any(|d| d == symbol) {
                continue;
            }
            if let Some(c) = self.record(
                bus,
                Conflict {
                    id: new_id("cf"),
                    kind: ConflictKind::Component,
                    severity: Severity::High,
                    title: "Shared interface changed".into(),
                    project_id: project_id.clone(),
                    feature_id: feature_id.clone(),
                    left: ConflictSide {
                        agent_id: by.to_string(),
                        detail: format!("changed {symbol}"),
                        source: None,
                    },
                    right: ConflictSide {
                        agent_id: claim.agent_id.clone(),
                        detail: format!("depends on {symbol}"),
                        source: None,
                    },
                    detected_at: now_iso(),
                    resolved: false,
                    resolved_by: None,
                    resolution: None,
                },
                Some(ev),
            ) {
                out.push(c);
            }
        }
        out
    }

    /// A decision was recorded. Conflict if it contradicts a live one.
    pub fn on_decision(&self, bus: &EventBus, ev: &DomainEvent, work: &WorkView) -> Vec<Conflict> {
        let Some(id) = ev.payload.get("id").and_then(|v| v.as_str()) else {
            return vec![];
        };
        let title = ev
            .payload
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let supersedes = ev.payload.get("supersedes").and_then(|v| v.as_str());
        let author = ev
            .payload
            .get("author")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let project_id = ev.scope.project_id.clone().unwrap_or_default();

        // Superseding is the *orderly* path: it is a replacement, not a clash.
        if supersedes.is_some() {
            return vec![];
        }

        let mut out = Vec::new();
        for (other_id, other_title) in &work.decisions {
            if other_id == id {
                continue;
            }
            if contradicts(title, other_title) {
                if let Some(c) = self.record(
                    bus,
                    Conflict {
                        id: new_id("cf"),
                        kind: ConflictKind::Decision,
                        severity: Severity::High,
                        title: "Contradictory decisions".into(),
                        project_id: project_id.clone(),
                        feature_id: ev.scope.feature_id.clone(),
                        left: ConflictSide {
                            agent_id: "recorded".into(),
                            detail: other_title.clone(),
                            source: Some(other_id.clone()),
                        },
                        right: ConflictSide {
                            agent_id: author.to_string(),
                            detail: title.to_string(),
                            source: Some(id.to_string()),
                        },
                        detected_at: now_iso(),
                        resolved: false,
                        resolved_by: None,
                        resolution: None,
                    },
                    Some(ev),
                ) {
                    out.push(c);
                }
            }
        }
        out
    }

    /// An agent's context went stale. Informational unless it also depends on
    /// what moved — in which case the symbol path above already raised a
    /// stronger conflict, so this stays low severity on purpose.
    pub fn on_stale(
        &self,
        bus: &EventBus,
        ev: &DomainEvent,
        session_id: &str,
        agent_id: &str,
    ) -> Option<Conflict> {
        self.record(
            bus,
            Conflict {
                id: new_id("cf"),
                kind: ConflictKind::StaleContext,
                severity: Severity::Info,
                title: "Agent is working from an older context".into(),
                project_id: ev.scope.project_id.clone().unwrap_or_default(),
                feature_id: ev.scope.feature_id.clone(),
                left: ConflictSide {
                    agent_id: "context".into(),
                    detail: "feature context moved on".into(),
                    source: None,
                },
                right: ConflictSide {
                    agent_id: agent_id.to_string(),
                    detail: format!("session {session_id} checkpoint is behind"),
                    source: None,
                },
                detected_at: now_iso(),
                resolved: false,
                resolved_by: None,
                resolution: None,
            },
            Some(ev),
        )
    }

    pub fn clear(&self) {
        self.conflicts.lock().unwrap().clear();
        self.writers.lock().unwrap().clear();
    }
}

/// Do two decision titles look like they say opposite things?
///
/// Crude by design — it pairs a small set of known opposites rather than
/// pretending to understand the sentences. A false negative here is a missed
/// warning; a false positive is a conflict centre nobody trusts, so it errs
/// towards silence.
fn contradicts(a: &str, b: &str) -> bool {
    const OPPOSITES: &[(&str, &str)] = &[
        ("server-authoritative", "client-authoritative"),
        ("server authoritative", "client authoritative"),
        ("trust the client", "never trust the client"),
        ("offline-first", "online-only"),
        ("sqlite", "indexeddb"),
    ];
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    OPPOSITES
        .iter()
        .any(|(x, y)| (a.contains(x) && b.contains(y)) || (a.contains(y) && b.contains(x)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn file_event(project: &str, feature: &str, path: &str, by: &str) -> DomainEvent {
        DomainEvent::new(
            EventType::FileChanged,
            EventScope::feature(project, feature),
            serde_json::json!({ "path": path, "by": by }),
        )
    }

    #[test]
    fn two_agents_writing_one_file_is_a_conflict_and_one_agent_is_not() {
        let bus = Arc::new(EventBus::new());
        let svc = ConflictService::new();
        let work = WorkView::default();

        let first = svc.on_file_changed(&bus, &file_event("p", "f", "sync.ts", "claude"), &work);
        assert!(first.is_empty(), "the first writer conflicts with nobody");

        let second = svc.on_file_changed(&bus, &file_event("p", "f", "sync.ts", "cursor"), &work);
        assert_eq!(second.len(), 1, "a second writer is a conflict");
        assert_eq!(second[0].kind, ConflictKind::File);
        assert_eq!(second[0].severity, Severity::Warning);

        // Same agent writing again must not pile up conflicts.
        let again = svc.on_file_changed(&bus, &file_event("p", "f", "sync.ts", "cursor"), &work);
        assert!(
            again.is_empty(),
            "re-detecting the same clash spams the feed"
        );
    }

    #[test]
    fn a_changed_symbol_conflicts_only_with_agents_that_depend_on_it() {
        let bus = Arc::new(EventBus::new());
        let svc = ConflictService::new();
        let ev = file_event("p", "offline-sync", "packages/sync/types.ts", "claude");

        let work = WorkView {
            claims: vec![
                ClaimView {
                    agent_id: "cursor".into(),
                    feature_id: "offline-sync".into(),
                    depends_on: vec!["SyncResult".into()],
                    ..Default::default()
                },
                ClaimView {
                    agent_id: "qa".into(),
                    feature_id: "offline-sync".into(),
                    depends_on: vec![],
                    ..Default::default()
                },
                // Right symbol, wrong feature — must not be dragged in.
                ClaimView {
                    agent_id: "codex".into(),
                    feature_id: "gate-tracking".into(),
                    depends_on: vec!["SyncResult".into()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let out = svc.on_symbol_changed(&bus, &ev, "SyncResult", "claude", &work);
        assert_eq!(out.len(), 1, "exactly the dependent agent in this feature");
        assert_eq!(out[0].right.agent_id, "cursor");
        assert_eq!(out[0].severity, Severity::High);
    }

    #[test]
    fn a_change_that_breaks_a_requirement_is_blocking() {
        let bus = Arc::new(EventBus::new());
        let svc = ConflictService::new();
        let work = WorkView {
            requirements: vec![(
                "R1".into(),
                "A site must function with no connectivity for 72 h.".into(),
                vec!["fetch(".into()],
            )],
            ..Default::default()
        };

        let ev = DomainEvent::new(
            EventType::FileChanged,
            EventScope::feature("p", "offline-sync"),
            serde_json::json!({
                "path": "services/gates.ts",
                "by": "codex",
                "content": "const r = await fetch('https://api.example.com/gate')"
            }),
        );

        let out = svc.on_file_changed(&bus, &ev, &work);
        let req = out
            .iter()
            .find(|c| c.kind == ConflictKind::Requirement)
            .expect("mandatory network call in an offline feature");
        assert_eq!(req.severity, Severity::Blocking);
        assert!(req.left.detail.contains("R1"));
    }

    #[test]
    fn superseding_a_decision_is_not_a_conflict() {
        let bus = Arc::new(EventBus::new());
        let svc = ConflictService::new();
        let work = WorkView {
            decisions: vec![("adr-1".into(), "Trust the client timestamp".into())],
            ..Default::default()
        };

        let ev = DomainEvent::new(
            EventType::DecisionCreated,
            EventScope::feature("p", "f"),
            serde_json::json!({
                "id": "adr-2",
                "title": "Never trust the client timestamp",
                "author": "architect",
                "supersedes": "adr-1"
            }),
        );
        assert!(
            svc.on_decision(&bus, &ev, &work).is_empty(),
            "an orderly replacement is not a clash"
        );

        // The same pair *without* supersedes is a genuine contradiction.
        let ev2 = DomainEvent::new(
            EventType::DecisionCreated,
            EventScope::feature("p", "f"),
            serde_json::json!({
                "id": "adr-3",
                "title": "Never trust the client timestamp",
                "author": "architect"
            }),
        );
        let out = svc.on_decision(&bus, &ev2, &work);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, ConflictKind::Decision);
    }

    #[test]
    fn conflicts_are_scoped_to_their_project_and_sorted_worst_first() {
        let bus = Arc::new(EventBus::new());
        let svc = ConflictService::new();
        let work = WorkView {
            requirements: vec![("R1".into(), "offline".into(), vec!["fetch(".into()])],
            ..Default::default()
        };

        svc.on_file_changed(&bus, &file_event("tyrex", "f", "a.ts", "claude"), &work);
        svc.on_file_changed(&bus, &file_event("tyrex", "f", "a.ts", "cursor"), &work);
        svc.on_file_changed(
            &bus,
            &DomainEvent::new(
                EventType::FileChanged,
                EventScope::feature("tyrex", "f"),
                serde_json::json!({ "path": "b.ts", "by": "codex", "content": "fetch(" }),
            ),
            &work,
        );
        svc.on_file_changed(&bus, &file_event("assetx", "g", "z.ts", "claude"), &work);
        svc.on_file_changed(&bus, &file_event("assetx", "g", "z.ts", "cursor"), &work);

        let tyrex = svc.open(Some("tyrex"));
        assert!(
            tyrex.iter().all(|c| c.project_id == "tyrex"),
            "another project's conflicts leaked in"
        );
        assert_eq!(
            tyrex[0].severity,
            Severity::Blocking,
            "the blocking one must sort first"
        );

        let assetx = svc.open(Some("assetx"));
        assert_eq!(assetx.len(), 1);
    }

    #[test]
    fn resolving_removes_it_from_open_and_announces_it() {
        let bus = Arc::new(EventBus::new());
        let svc = ConflictService::new();
        let work = WorkView::default();
        svc.on_file_changed(&bus, &file_event("p", "f", "a.ts", "claude"), &work);
        let c =
            svc.on_file_changed(&bus, &file_event("p", "f", "a.ts", "cursor"), &work)[0].clone();

        svc.resolve(&bus, &c.id, "jayjay", "merged by hand")
            .unwrap();

        assert!(svc.open(Some("p")).is_empty());
        assert_eq!(svc.list(Some("p"), true).len(), 1);
        assert!(bus
            .history(None, 50)
            .iter()
            .any(|e| e.is(EventType::ConflictResolved)));
    }
}
