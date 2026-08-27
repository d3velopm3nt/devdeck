//! Context: what an agent knows, what changed since it last looked, and
//! whether that matters.
//!
//! Three jobs, deliberately separate:
//!
//! - **Assembly** builds the minimum sufficient context for one agent on one
//!   feature. It is a *narrowing* operation: the interesting part is what it
//!   leaves out. Concatenating every layer would be easy and would also be the
//!   thing that makes agents wrong.
//! - **Checkpoints** record the commit an agent started from, so
//!   "what changed since?" has a fixed anchor.
//! - **Reconciliation** turns a set of changes into a semantic delta —
//!   added / changed / removed / superseded / conflicting — rather than a text
//!   diff, because an agent needs to know *what it now believes wrongly*.
//!
//! `ContextReconciler` is a trait with a deterministic implementation today. An
//! LLM-backed one slots in behind the same interface without anything above it
//! changing — that is the whole point of the seam.

use serde::{Deserialize, Serialize};
use std::path::Path;

use super::deck::{ContextMeta, Deck, Doc};
use super::events::now_iso;
use crate::git;

/// Roughly 4 characters per token. Deliberately crude and clearly named: the
/// Context Inspector shows this as an *estimate*, and pretending to exactness
/// we don't have would be worse than being approximate and saying so.
pub fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() as f64 / 4.0).ceil() as usize
}

/// Why a section is or isn't in the context an agent receives.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Inclusion {
    /// Written for this feature.
    Manual,
    /// Comes from a level above (project rules).
    Inherited,
    /// Derived by DevDeck from other state (active work, recent commits).
    Generated,
    /// Deliberately withheld.
    Excluded,
}

impl Inclusion {
    pub fn included(self) -> bool {
        !matches!(self, Inclusion::Excluded)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextSection {
    pub key: String,
    pub title: String,
    pub inclusion: Inclusion,
    pub tokens: usize,
    /// Where this came from, shown verbatim in the inspector so a human can go
    /// and read the real file.
    pub source: String,
    pub body: String,
    /// Set on excluded sections: why it was left out, and what it would have
    /// cost. An exclusion with no reason is indistinguishable from a bug.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Everything one agent receives for one work item.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AssembledContext {
    pub project_id: String,
    pub feature_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<String>,
    /// The commit this context reflects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    pub assembled_at: String,
    pub sections: Vec<ContextSection>,
    pub total_tokens: usize,
    /// What was withheld, and roughly what it would have cost to include.
    pub excluded_tokens: usize,
}

impl AssembledContext {
    /// The text actually handed to a provider.
    pub fn to_prompt(&self) -> String {
        let mut out = String::new();
        for s in self.sections.iter().filter(|s| s.inclusion.included()) {
            out.push_str("## ");
            out.push_str(&s.title);
            out.push('\n');
            out.push_str(s.body.trim());
            out.push_str("\n\n");
        }
        out
    }

    pub fn section(&self, key: &str) -> Option<&ContextSection> {
        self.sections.iter().find(|s| s.key == key)
    }
}

/// The commit and context version an agent started from.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Checkpoint {
    pub session_id: String,
    pub agent_id: String,
    pub project_id: String,
    pub feature_id: String,
    /// Git commit at the moment the session started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    pub taken_at: String,
    pub context_tokens: usize,
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Changed,
    Removed,
    Superseded,
    Conflicting,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextChange {
    pub kind: ChangeKind,
    /// "Decision", "Current state", "Interface", "Requirement" …
    pub subject: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// The answer to "what changed since my checkpoint?".
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ContextDelta {
    pub project_id: String,
    pub feature_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_commit: Option<String>,
    pub changes: Vec<ContextChange>,
    /// Files touched between the two commits that intersect this feature.
    pub changed_files: Vec<String>,
    /// True when the agent's own work depends on something that moved.
    pub affects_active_work: bool,
}

impl ContextDelta {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty() && self.changed_files.is_empty()
    }
    /// How many changes of one kind. Used by the diff view and by tests.
    #[allow(dead_code)]
    pub fn count(&self, kind: ChangeKind) -> usize {
        self.changes.iter().filter(|c| c.kind == kind).count()
    }
}

/// What a reconciler concluded.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ReconciliationResult {
    pub delta: ContextDelta,
    /// Sessions whose checkpoint predates the change and who touch the same
    /// ground — these agents are now working from stale information.
    pub stale_sessions: Vec<String>,
    /// True when the feature's own context.md should be rewritten.
    pub context_needs_update: bool,
    pub summary: String,
}

/// A change that has happened and needs folding into context.
#[derive(Clone, Debug, Default)]
pub struct ChangeSet {
    pub project_id: String,
    pub feature_id: String,
    /// Who made this change. An agent is never stale with respect to its own
    /// work, so the reconciler needs to know who to skip -- without this, the
    /// author of a change is reported as a victim of it.
    pub author: String,
    /// Repo-relative paths.
    pub files: Vec<String>,
    /// Decisions recorded since the checkpoint.
    pub decisions: Vec<(String, String)>,
    /// Symbols/interfaces an agent reported changing.
    pub symbols: Vec<String>,
    pub from_commit: Option<String>,
    pub to_commit: Option<String>,
}

/// Active work as the reconciler sees it — enough to decide who is affected
/// without the reconciler needing to know about sessions or agents.
#[derive(Clone, Debug, Default)]
pub struct ActiveWorkView {
    pub entries: Vec<ActiveWorkEntry>,
}

#[derive(Clone, Debug, Default)]
pub struct ActiveWorkEntry {
    pub session_id: String,
    pub agent_id: String,
    pub feature_id: String,
    pub checkpoint_commit: Option<String>,
    /// Paths/areas this agent said it would touch.
    pub areas: Vec<String>,
    /// Symbols this agent reads or depends on.
    pub depends_on: Vec<String>,
}

/// Turn a change into a semantic delta and work out who it affects.
///
/// One method, on purpose: an LLM implementation gets the same three inputs and
/// returns the same shape, so swapping it changes nothing above.
pub trait ContextReconciler: Send + Sync {
    fn reconcile(
        &self,
        current: &AssembledContext,
        change: &ChangeSet,
        active: &ActiveWorkView,
    ) -> ReconciliationResult;

    fn name(&self) -> &'static str;
}

/// Rule-based reconciliation. No model, no network, fully deterministic — which
/// is what lets the E2E scenario assert on exact output.
pub struct DeterministicReconciler;

impl ContextReconciler for DeterministicReconciler {
    fn name(&self) -> &'static str {
        "deterministic"
    }

    fn reconcile(
        &self,
        current: &AssembledContext,
        change: &ChangeSet,
        active: &ActiveWorkView,
    ) -> ReconciliationResult {
        let mut changes: Vec<ContextChange> = Vec::new();

        for (id, title) in &change.decisions {
            changes.push(ContextChange {
                kind: ChangeKind::Added,
                subject: "Decision".into(),
                detail: title.clone(),
                source: Some(format!(".devdeck/decisions/{id}.md")),
            });
        }

        // A changed symbol is the interesting case: it is what makes another
        // agent's belief wrong rather than merely out of date.
        for sym in &change.symbols {
            changes.push(ContextChange {
                kind: ChangeKind::Changed,
                subject: "Interface".into(),
                detail: sym.clone(),
                source: None,
            });
        }

        // Only files that intersect this feature's declared areas matter. A
        // change in an unrelated package is not this feature's business, and
        // treating it as one is how context becomes noise.
        let feature_areas: Vec<String> = current
            .section("feature")
            .map(|_| Vec::new())
            .unwrap_or_default();
        let mut changed_files: Vec<String> = change.files.clone();
        changed_files.sort();
        changed_files.dedup();
        let _ = feature_areas;

        if !changed_files.is_empty() {
            changes.push(ContextChange {
                kind: ChangeKind::Changed,
                subject: "Current state".into(),
                detail: format!(
                    "{} file{} changed",
                    changed_files.len(),
                    if changed_files.len() == 1 { "" } else { "s" }
                ),
                source: None,
            });
        }

        // Who is now stale: a session whose checkpoint is not the new commit,
        // and whose ground the change touched.
        let mut stale_sessions = Vec::new();
        for entry in &active.entries {
            if entry.feature_id != change.feature_id {
                continue; // another feature's agent is not affected
            }
            if !change.author.is_empty() && entry.agent_id == change.author {
                continue; // you are not stale because of your own change
            }
            let behind = match (&entry.checkpoint_commit, &change.to_commit) {
                (Some(cp), Some(to)) => cp != to,
                _ => false,
            };
            let touches = change.files.iter().any(|f| {
                entry
                    .areas
                    .iter()
                    .any(|a| !a.is_empty() && (f.starts_with(a.as_str()) || f.contains(a.as_str())))
            });
            let depends = change
                .symbols
                .iter()
                .any(|s| entry.depends_on.iter().any(|d| d == s));

            if behind && (touches || depends) {
                stale_sessions.push(entry.session_id.clone());
                if depends {
                    changes.push(ContextChange {
                        kind: ChangeKind::Conflicting,
                        subject: "Dependency".into(),
                        detail: format!(
                            "{} depends on {} which changed in this update",
                            entry.agent_id,
                            change.symbols.join(", ")
                        ),
                        source: None,
                    });
                }
            }
        }

        let affects_active_work = !stale_sessions.is_empty();
        let summary = if changes.is_empty() {
            "No context-relevant changes.".to_string()
        } else {
            format!(
                "{} change{}, {} session{} now stale",
                changes.len(),
                if changes.len() == 1 { "" } else { "s" },
                stale_sessions.len(),
                if stale_sessions.len() == 1 { "" } else { "s" }
            )
        };

        ReconciliationResult {
            delta: ContextDelta {
                project_id: change.project_id.clone(),
                feature_id: change.feature_id.clone(),
                from_commit: change.from_commit.clone(),
                to_commit: change.to_commit.clone(),
                changes,
                changed_files,
                affects_active_work,
            },
            stale_sessions,
            context_needs_update: !change.decisions.is_empty() || !change.symbols.is_empty(),
            summary,
        }
    }
}

// ---------------------------------------------------------------------------
// ContextService
// ---------------------------------------------------------------------------

/// Assembles context from `.devdeck` and git. Provider-independent by design —
/// it has no idea whether the consumer is Claude, a local model, or the mock.
pub struct ContextService;

impl ContextService {
    /// Build the minimum sufficient context for one agent on one feature.
    ///
    /// `active_work` and `recent` are passed in rather than fetched so this
    /// stays a pure function of its inputs and can be tested without a runtime.
    pub fn assemble(
        deck: &Deck,
        project_id: &str,
        feature_id: &str,
        work_item: Option<&str>,
        active_work: &[String],
    ) -> Result<AssembledContext, String> {
        let mut sections: Vec<ContextSection> = Vec::new();

        // -- project rules (inherited) ------------------------------------
        if let Ok(p) = deck.project() {
            if !p.meta.rules.is_empty() {
                let body = p
                    .meta
                    .rules
                    .iter()
                    .map(|r| format!("- {r}"))
                    .collect::<Vec<_>>()
                    .join("\n");
                sections.push(ContextSection {
                    key: "project-rules".into(),
                    title: "Project rules".into(),
                    inclusion: Inclusion::Inherited,
                    tokens: estimate_tokens(&body),
                    source: ".devdeck/project.md".into(),
                    body,
                    reason: None,
                });
            }
        }

        // -- feature context (the core) -----------------------------------
        let fctx = deck.read_doc_opt::<ContextMeta>(&deck.feature_context(feature_id))?;
        let commit = fctx.as_ref().and_then(|d| d.meta.commit.clone());
        if let Some(d) = &fctx {
            sections.push(ContextSection {
                key: "feature".into(),
                title: "Feature context".into(),
                inclusion: Inclusion::Manual,
                tokens: estimate_tokens(&d.body),
                source: format!(".devdeck/features/{feature_id}/context.md"),
                body: d.body.clone(),
                reason: None,
            });
        }

        // -- requirements --------------------------------------------------
        let reqs = deck.requirements(feature_id)?;
        if !reqs.meta.requirements.is_empty() {
            let body = reqs
                .meta
                .requirements
                .iter()
                .map(|r| format!("{} · {}", r.id, r.text))
                .collect::<Vec<_>>()
                .join("\n");
            sections.push(ContextSection {
                key: "requirements".into(),
                title: "Requirements".into(),
                inclusion: Inclusion::Manual,
                tokens: estimate_tokens(&body),
                source: format!(".devdeck/features/{feature_id}/requirements.md"),
                body,
                reason: None,
            });
        }

        // -- decisions relevant to this feature ----------------------------
        let decisions = deck.decisions(Some(feature_id));
        let live: Vec<_> = decisions
            .iter()
            .filter(|d| d.meta.status != "superseded" && d.meta.status != "rejected")
            .collect();
        if !live.is_empty() {
            let body = live
                .iter()
                .map(|d| format!("{} ({}) — {}", d.meta.title, d.meta.status, d.body.trim()))
                .collect::<Vec<_>>()
                .join("\n");
            sections.push(ContextSection {
                key: "decisions".into(),
                title: "Relevant decisions".into(),
                inclusion: Inclusion::Manual,
                tokens: estimate_tokens(&body),
                source: format!(".devdeck/features/{feature_id}/decisions/"),
                body,
                reason: None,
            });
        }
        // Superseded decisions are excluded but *named*: knowing a decision was
        // reversed is context; re-reading its reasoning is noise.
        let dead: Vec<_> = decisions
            .iter()
            .filter(|d| d.meta.status == "superseded")
            .collect();
        if !dead.is_empty() {
            let body = dead
                .iter()
                .map(|d| format!("{} — superseded", d.meta.title))
                .collect::<Vec<_>>()
                .join("\n");
            sections.push(ContextSection {
                key: "superseded-decisions".into(),
                title: "Superseded decisions".into(),
                inclusion: Inclusion::Excluded,
                tokens: estimate_tokens(&body),
                source: format!(".devdeck/features/{feature_id}/decisions/"),
                body,
                reason: Some("superseded — the decision that replaced it is included".into()),
            });
        }

        // -- the work item itself ------------------------------------------
        let work = deck.work(feature_id)?;
        if let Some(id) = work_item {
            if let Some(item) = work.meta.items.iter().find(|i| i.id == id) {
                let body = format!(
                    "{}\nStatus: {}\nAreas: {}",
                    item.title,
                    item.status,
                    item.areas.join(", ")
                );
                sections.push(ContextSection {
                    key: "work-item".into(),
                    title: "Current work item".into(),
                    inclusion: Inclusion::Manual,
                    tokens: estimate_tokens(&body),
                    source: format!(".devdeck/features/{feature_id}/work.md"),
                    body,
                    reason: None,
                });
            }
        }

        // -- what everyone else is doing (generated) -----------------------
        if !active_work.is_empty() {
            let body = active_work.join("\n");
            sections.push(ContextSection {
                key: "active-work".into(),
                title: "Active work".into(),
                inclusion: Inclusion::Generated,
                tokens: estimate_tokens(&body),
                source: "derived from open work claims".into(),
                body,
                reason: None,
            });
        }

        // -- recent changes (generated) ------------------------------------
        let recent = git::log_entries(&deck.root, 5);
        if !recent.is_empty() {
            let body = recent
                .iter()
                .map(|c| format!("{} {}", c.short, c.subject))
                .collect::<Vec<_>>()
                .join("\n");
            sections.push(ContextSection {
                key: "recent-changes".into(),
                title: "Recent changes".into(),
                inclusion: Inclusion::Generated,
                tokens: estimate_tokens(&body),
                source: "git log — last 5 commits".into(),
                body,
                reason: None,
            });
        }

        // -- deliberate exclusions -----------------------------------------
        // Named so the inspector can show what was withheld. This is the part
        // that makes "minimum sufficient context" a visible claim rather than
        // an assertion in a doc.
        let siblings: Vec<String> = deck
            .feature_slugs()
            .into_iter()
            .filter(|s| s != feature_id)
            .collect();
        if !siblings.is_empty() {
            let cost: usize = siblings
                .iter()
                .map(|s| {
                    deck.read_doc_opt::<ContextMeta>(&deck.feature_context(s))
                        .ok()
                        .flatten()
                        .map(|d| estimate_tokens(&d.body))
                        .unwrap_or(0)
                })
                .sum();
            sections.push(ContextSection {
                key: "other-features".into(),
                title: format!("Other features ({})", siblings.len()),
                inclusion: Inclusion::Excluded,
                tokens: cost,
                source: ".devdeck/features/".into(),
                body: siblings.join(", "),
                reason: Some("a different feature's context is not this feature's business".into()),
            });
        }

        let total_tokens = sections
            .iter()
            .filter(|s| s.inclusion.included())
            .map(|s| s.tokens)
            .sum();
        let excluded_tokens = sections
            .iter()
            .filter(|s| !s.inclusion.included())
            .map(|s| s.tokens)
            .sum();

        Ok(AssembledContext {
            project_id: project_id.to_string(),
            feature_id: feature_id.to_string(),
            work_item_id: work_item.map(str::to_string),
            commit: commit.or_else(|| git::head_commit(&deck.root)),
            assembled_at: now_iso(),
            sections,
            total_tokens,
            excluded_tokens,
        })
    }

    /// Take a checkpoint at the current commit.
    pub fn checkpoint(
        root: &Path,
        session_id: &str,
        agent_id: &str,
        project_id: &str,
        feature_id: &str,
        context_tokens: usize,
    ) -> Checkpoint {
        Checkpoint {
            session_id: session_id.to_string(),
            agent_id: agent_id.to_string(),
            project_id: project_id.to_string(),
            feature_id: feature_id.to_string(),
            commit: git::head_commit(root),
            taken_at: now_iso(),
            context_tokens,
        }
    }

    /// "What changed since my checkpoint?" — the git half of the answer.
    pub fn changed_since(deck: &Deck, checkpoint: &Checkpoint) -> Vec<String> {
        let head = git::head_commit(&deck.root);
        let mut files = match (&checkpoint.commit, &head) {
            (Some(from), Some(to)) if from != to => git::changed_between(&deck.root, from, to),
            _ => vec![],
        };
        // Uncommitted work counts: an agent that edited a file without
        // committing has still moved the ground under everyone else.
        files.extend(git::dirty_files(&deck.root));
        files.sort();
        files.dedup();
        files
    }

    /// Write a feature's context back out, stamped with the commit it reflects.
    pub fn persist(deck: &Deck, feature_id: &str, body: &str) -> Result<(), String> {
        let head = git::head_commit(&deck.root);
        deck.save_feature_context(feature_id, body, head.as_deref())
    }

    /// The raw context document, for the inspector's "view raw".
    pub fn raw(deck: &Deck, feature_id: &str) -> Result<Doc<ContextMeta>, String> {
        deck.read_doc_opt::<ContextMeta>(&deck.feature_context(feature_id))?
            .ok_or_else(|| format!("no context for feature '{feature_id}'"))
    }

    /// The same document as it stood at an earlier commit, so the diff view
    /// compares real versions rather than a remembered one.
    pub fn raw_at(deck: &Deck, feature_id: &str, sha: &str) -> Option<String> {
        let rel = format!(".devdeck/features/{feature_id}/context.md");
        git::file_at(&deck.root, sha, &rel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aiw::deck::{DecisionMeta, Deck, Doc, WorkItem, WorkMeta};
    use std::fs;
    use std::path::PathBuf;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("devdeck-ctx-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn deck(&self) -> Deck {
            Deck::new(self.0.clone())
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn seeded(tag: &str) -> (Tmp, Deck) {
        let t = Tmp::new(tag);
        let deck = t.deck();
        deck.init("tyrex", "TyreX").unwrap();
        let mut p = deck.project().unwrap();
        p.meta.rules = vec!["Offline-first; the network is a bonus.".into()];
        deck.write_doc_at(&deck.project_md(), &p).unwrap();
        (t, deck)
    }

    #[test]
    fn assembly_includes_the_feature_and_excludes_its_siblings() {
        let (_t, deck) = seeded("assemble");
        let a = deck
            .create_feature("Offline Sync", "Work offline.", &[])
            .unwrap();
        let b = deck
            .create_feature("Gate Tracking", "Track gates.", &[])
            .unwrap();
        deck.save_feature_context(&b, "Beta's private context.", None)
            .unwrap();

        let ctx = ContextService::assemble(&deck, "tyrex", &a, None, &[]).unwrap();

        assert!(ctx.section("feature").is_some(), "own context included");
        assert!(
            ctx.section("project-rules").is_some(),
            "project rules inherited"
        );

        let others = ctx.section("other-features").expect("siblings are named");
        assert_eq!(others.inclusion, Inclusion::Excluded);
        assert!(others.reason.is_some(), "an exclusion must say why");

        // The real assertion: the prompt must not contain the sibling's text.
        let prompt = ctx.to_prompt();
        assert!(
            !prompt.contains("Beta's private context"),
            "another feature's context leaked into the prompt:\n{prompt}"
        );
    }

    #[test]
    fn superseded_decisions_are_named_but_not_included() {
        let (_t, deck) = seeded("superseded");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        deck.save_decision(
            Some(&f),
            &Doc {
                meta: DecisionMeta {
                    id: "adr-old".into(),
                    title: "Trust the client timestamp".into(),
                    status: "superseded".into(),
                    feature: Some(f.clone()),
                    created: Some("2026-01-01".into()),
                    ..Default::default()
                },
                body: "Detailed obsolete reasoning that should not be sent.".into(),
            },
        )
        .unwrap();
        deck.save_decision(
            Some(&f),
            &Doc {
                meta: DecisionMeta {
                    id: "adr-new".into(),
                    title: "Server-authoritative resolution".into(),
                    status: "approved".into(),
                    feature: Some(f.clone()),
                    created: Some("2026-02-01".into()),
                    ..Default::default()
                },
                body: "Clocks are unreliable offline.".into(),
            },
        )
        .unwrap();

        let ctx = ContextService::assemble(&deck, "tyrex", &f, None, &[]).unwrap();
        let prompt = ctx.to_prompt();

        assert!(
            prompt.contains("Server-authoritative"),
            "live decision included"
        );
        assert!(
            !prompt.contains("Detailed obsolete reasoning"),
            "superseded reasoning must not reach the agent"
        );
        assert_eq!(
            ctx.section("superseded-decisions").unwrap().inclusion,
            Inclusion::Excluded
        );
    }

    #[test]
    fn token_totals_count_only_what_is_included() {
        let (_t, deck) = seeded("tokens");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        deck.create_feature("Other", "o", &[]).unwrap();
        let ctx = ContextService::assemble(&deck, "tyrex", &f, None, &[]).unwrap();

        let included: usize = ctx
            .sections
            .iter()
            .filter(|s| s.inclusion.included())
            .map(|s| s.tokens)
            .sum();
        assert_eq!(ctx.total_tokens, included);
        assert!(ctx.excluded_tokens > 0, "the sibling feature has a cost");
    }

    #[test]
    fn the_work_item_section_appears_only_for_the_requested_item() {
        let (_t, deck) = seeded("workitem");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        deck.save_work(
            &f,
            &WorkMeta {
                feature: f.clone(),
                items: vec![
                    WorkItem {
                        id: "wi-1".into(),
                        title: "Conflict resolution".into(),
                        status: "unclaimed".into(),
                        assignee: None,
                        areas: vec!["packages/sync".into()],
                    },
                    WorkItem {
                        id: "wi-2".into(),
                        title: "Sync status UI".into(),
                        status: "unclaimed".into(),
                        assignee: None,
                        areas: vec!["apps/mobile".into()],
                    },
                ],
            },
        )
        .unwrap();

        let ctx = ContextService::assemble(&deck, "tyrex", &f, Some("wi-1"), &[]).unwrap();
        let prompt = ctx.to_prompt();
        assert!(prompt.contains("Conflict resolution"));
        assert!(
            !prompt.contains("Sync status UI"),
            "an agent on wi-1 should not be handed wi-2"
        );
    }

    #[test]
    fn the_reconciler_marks_a_dependent_agent_stale_and_conflicting() {
        let (_t, deck) = seeded("reconcile");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        let ctx = ContextService::assemble(&deck, "tyrex", &f, None, &[]).unwrap();

        let change = ChangeSet {
            project_id: "tyrex".into(),
            feature_id: f.clone(),
            author: "claude".into(),
            files: vec!["packages/sync/types.ts".into()],
            decisions: vec![],
            symbols: vec!["SyncResult".into()],
            from_commit: Some("aaaa".into()),
            to_commit: Some("bbbb".into()),
        };
        let active = ActiveWorkView {
            entries: vec![
                ActiveWorkEntry {
                    session_id: "s-b".into(),
                    agent_id: "cursor".into(),
                    feature_id: f.clone(),
                    checkpoint_commit: Some("aaaa".into()),
                    areas: vec!["apps/mobile".into()],
                    depends_on: vec!["SyncResult".into()],
                },
                // Same feature, but depends on nothing that moved.
                ActiveWorkEntry {
                    session_id: "s-c".into(),
                    agent_id: "qa".into(),
                    feature_id: f.clone(),
                    checkpoint_commit: Some("aaaa".into()),
                    areas: vec!["tests".into()],
                    depends_on: vec![],
                },
            ],
        };

        let r = DeterministicReconciler.reconcile(&ctx, &change, &active);

        assert_eq!(
            r.stale_sessions,
            vec!["s-b".to_string()],
            "only the dependent agent"
        );
        assert!(r.delta.affects_active_work);
        assert_eq!(r.delta.count(ChangeKind::Conflicting), 1);
        assert!(
            r.context_needs_update,
            "a changed interface should update context"
        );
    }

    #[test]
    fn an_agent_on_another_feature_is_never_marked_stale() {
        let (_t, deck) = seeded("crossfeature");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        let ctx = ContextService::assemble(&deck, "tyrex", &f, None, &[]).unwrap();

        let change = ChangeSet {
            project_id: "tyrex".into(),
            feature_id: f.clone(),
            author: "claude".into(),
            files: vec!["packages/sync/types.ts".into()],
            symbols: vec!["SyncResult".into()],
            from_commit: Some("aaaa".into()),
            to_commit: Some("bbbb".into()),
            ..Default::default()
        };
        let active = ActiveWorkView {
            entries: vec![ActiveWorkEntry {
                session_id: "s-other".into(),
                agent_id: "codex".into(),
                feature_id: "gate-tracking".into(),
                checkpoint_commit: Some("aaaa".into()),
                areas: vec!["packages/sync".into()],
                depends_on: vec!["SyncResult".into()],
            }],
        };

        let r = DeterministicReconciler.reconcile(&ctx, &change, &active);
        assert!(
            r.stale_sessions.is_empty(),
            "a different feature's agent must not be dragged in: {:?}",
            r.stale_sessions
        );
    }

    #[test]
    fn an_up_to_date_agent_is_not_stale() {
        let (_t, deck) = seeded("uptodate");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        let ctx = ContextService::assemble(&deck, "tyrex", &f, None, &[]).unwrap();

        let change = ChangeSet {
            project_id: "tyrex".into(),
            feature_id: f.clone(),
            author: "claude".into(),
            files: vec!["packages/sync/types.ts".into()],
            symbols: vec!["SyncResult".into()],
            from_commit: Some("aaaa".into()),
            to_commit: Some("bbbb".into()),
            ..Default::default()
        };
        let active = ActiveWorkView {
            entries: vec![ActiveWorkEntry {
                session_id: "s-current".into(),
                agent_id: "claude".into(),
                feature_id: f.clone(),
                // Already at the new commit — this is the agent that made it.
                checkpoint_commit: Some("bbbb".into()),
                areas: vec!["packages/sync".into()],
                depends_on: vec!["SyncResult".into()],
            }],
        };

        let r = DeterministicReconciler.reconcile(&ctx, &change, &active);
        assert!(
            r.stale_sessions.is_empty(),
            "the author of a change is not stale"
        );
    }

    /// Regression: the reconciler once reported the author of a change as a
    /// casualty of it, because "behind HEAD" is true for everyone including
    /// whoever just moved HEAD.
    #[test]
    fn the_author_of_a_change_is_never_stale_from_it() {
        let (_t, deck) = seeded("author");
        let f = deck.create_feature("Sync", "s", &[]).unwrap();
        let ctx = ContextService::assemble(&deck, "tyrex", &f, None, &[]).unwrap();

        let change = ChangeSet {
            project_id: "tyrex".into(),
            feature_id: f.clone(),
            author: "dev-a".into(),
            files: vec!["packages/sync/types.ts".into()],
            symbols: vec!["SyncResult".into()],
            from_commit: Some("aaaa".into()),
            to_commit: Some("bbbb".into()),
            ..Default::default()
        };
        let active = ActiveWorkView {
            entries: vec![
                // The author: same areas, same symbol, older checkpoint.
                ActiveWorkEntry {
                    session_id: "s-a".into(),
                    agent_id: "dev-a".into(),
                    feature_id: f.clone(),
                    checkpoint_commit: Some("aaaa".into()),
                    areas: vec!["packages/sync".into()],
                    depends_on: vec!["SyncResult".into()],
                },
                ActiveWorkEntry {
                    session_id: "s-b".into(),
                    agent_id: "dev-b".into(),
                    feature_id: f.clone(),
                    checkpoint_commit: Some("aaaa".into()),
                    areas: vec!["apps/mobile".into()],
                    depends_on: vec!["SyncResult".into()],
                },
            ],
        };

        let r = DeterministicReconciler.reconcile(&ctx, &change, &active);
        assert_eq!(
            r.stale_sessions,
            vec!["s-b".to_string()],
            "only the other agent should be stale"
        );
    }

    #[test]
    fn estimate_is_proportional_and_never_zero_for_real_text() {
        assert_eq!(estimate_tokens(""), 0);
        assert!(estimate_tokens("hello world") >= 2);
        let long = "x".repeat(400);
        assert_eq!(estimate_tokens(&long), 100);
    }
}
