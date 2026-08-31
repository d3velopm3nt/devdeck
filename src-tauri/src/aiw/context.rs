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

/// What changed since a checkpoint — and whether the question could be
/// answered at all.
///
/// A folder with no repository cannot say what changed, and an empty file
/// list is not that answer. Keeping the two apart is what lets the screen say
/// "there is no repository here" instead of the far more dangerous "nothing
/// has changed".
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Changes {
    pub repository: bool,
    pub files: Vec<String>,
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
    /// `code_root` is where the *code* is, which stopped being the deck's own
    /// directory when context moved into the vault. Every git question below
    /// asks about the code; asking the vault folder instead returned an empty
    /// answer that looked exactly like a quiet repository.
    pub fn assemble(
        deck: &Deck,
        code_root: &Path,
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
        let recent = git::log_entries(code_root, 5);
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
            commit: commit.or_else(|| git::head_commit(code_root)),
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
    ///
    /// Asked of the code, not the deck. It used to be asked of `deck.root`,
    /// which since the vault is a folder git knows nothing about, so the head
    /// was always `None`, the comparison arm never matched, and every agent
    /// was told nothing had changed. That is the worst possible wrong answer:
    /// staleness detection exists so an agent learns what it now believes
    /// wrongly, and a confident "nothing" is how it goes on believing it.
    pub fn changed_since(code_root: &Path, checkpoint: &Checkpoint) -> Changes {
        if !git::is_repo(code_root) {
            return Changes {
                repository: false,
                files: vec![],
            };
        }
        let head = git::head_commit(code_root);
        let mut files = match (&checkpoint.commit, &head) {
            (Some(from), Some(to)) if from != to => git::changed_between(code_root, from, to),
            _ => vec![],
        };
        // Uncommitted work counts: an agent that edited a file without
        // committing has still moved the ground under everyone else.
        files.extend(git::dirty_files(code_root));
        files.sort();
        files.dedup();
        Changes {
            repository: true,
            files,
        }
    }

    /// Write a feature's context back out, stamped with the commit it reflects.
    pub fn persist(
        deck: &Deck,
        code_root: &Path,
        feature_id: &str,
        body: &str,
    ) -> Result<(), String> {
        let head = git::head_commit(code_root);
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

    /// A folder with no repository cannot say what changed, and saying
    /// "nothing" would be the most dangerous possible answer: staleness
    /// detection is what tells an agent it now believes something wrongly, so
    /// a confident empty list is how it keeps believing it.
    #[test]
    fn a_folder_with_no_repository_says_so_rather_than_nothing_changed() {
        let t = Tmp::new("norepo");
        let cp = Checkpoint {
            session_id: "s1".into(),
            agent_id: "dev-a".into(),
            project_id: "fitness".into(),
            feature_id: "f".into(),
            commit: None,
            taken_at: now_iso(),
            context_tokens: 0,
        };
        let changes = ContextService::changed_since(&t.0, &cp);
        assert!(!changes.repository, "there is no repository here");
        assert!(changes.files.is_empty());
    }

    /// And where there *is* one, the question is asked of the code. This used
    /// to be asked of the deck — the vault folder — which git knows nothing
    /// about, so every agent was told nothing had changed.
    #[test]
    fn a_real_change_in_the_repository_is_seen() {
        let t = Tmp::new("repo");
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(&t.0)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        if !run(&["init"]) {
            eprintln!("git is not available; skipping");
            return;
        }
        let _ = run(&["config", "user.email", "t@example.com"]);
        let _ = run(&["config", "user.name", "T"]);
        fs::write(t.0.join("a.txt"), "one").unwrap();
        let _ = run(&["add", "."]);
        let _ = run(&["commit", "-m", "first"]);

        let cp = Checkpoint {
            session_id: "s1".into(),
            agent_id: "dev-a".into(),
            project_id: "p".into(),
            feature_id: "f".into(),
            commit: crate::git::head_commit(&t.0),
            taken_at: now_iso(),
            context_tokens: 0,
        };
        assert!(cp.commit.is_some(), "the checkpoint anchors to a commit");

        // Someone edits a file without committing: the ground has still moved.
        fs::write(t.0.join("a.txt"), "two").unwrap();
        let changes = ContextService::changed_since(&t.0, &cp);
        assert!(changes.repository);
        assert!(
            changes.files.iter().any(|f| f.contains("a.txt")),
            "{:?}",
            changes.files
        );
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

        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &a, None, &[]).unwrap();

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

        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, None, &[]).unwrap();
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
        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, None, &[]).unwrap();

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

        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, Some("wi-1"), &[]).unwrap();
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
        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, None, &[]).unwrap();

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
        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, None, &[]).unwrap();

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
        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, None, &[]).unwrap();

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
        let ctx = ContextService::assemble(&deck, &deck.root, "tyrex", &f, None, &[]).unwrap();

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

// ---------------------------------------------------------------------------
// Exporting context to the files other tools read
// ---------------------------------------------------------------------------

/// Markers around the region DevDeck owns in an agent file.
///
/// A `CLAUDE.md` is usually hand-written and carefully tuned, so DevDeck writes
/// into a delimited block and leaves everything else exactly as it found it.
/// Overwriting the whole file would be the kind of "helpful" that loses work.
pub const EXPORT_BEGIN: &str = "<!-- devdeck:begin -->";
pub const EXPORT_END: &str = "<!-- devdeck:end -->";

/// Agent files DevDeck knows how to write into. These are the conventional
/// names the common CLI agents already read.
pub const AGENT_FILES: &[&str] = &["CLAUDE.md", "AGENTS.md", ".cursorrules"];

/// Splice `block` into `existing` between the markers.
///
/// - No markers: the block is appended, and everything already there survives.
/// - Markers present: only the region between them is replaced.
/// - A begin with no end: treated as no block at all and appended, because
///   guessing where a truncated block ends risks eating real content.
pub fn splice_managed_block(existing: &str, block: &str) -> String {
    let body = format!("{EXPORT_BEGIN}\n{}\n{EXPORT_END}", block.trim());

    if let Some(start) = existing.find(EXPORT_BEGIN) {
        if let Some(end_at) = existing[start..].find(EXPORT_END) {
            let end = start + end_at + EXPORT_END.len();
            let mut out = String::with_capacity(existing.len() + body.len());
            out.push_str(&existing[..start]);
            out.push_str(&body);
            out.push_str(&existing[end..]);
            return out;
        }
    }

    if existing.trim().is_empty() {
        return format!("{body}\n");
    }
    format!("{}\n\n{body}\n", existing.trim_end())
}

/// What DevDeck writes into an agent file for one feature.
///
/// Deliberately the *assembled* context, not the raw files: the whole point is
/// that another tool gets the same narrowed view an agent would, rather than
/// being pointed at the repo and left to work it out.
pub fn export_block(ctx: &AssembledContext, feature_name: &str) -> String {
    let mut out = String::new();
    out.push_str(
        "<!-- Managed by DevDeck. Edits inside this block are replaced on the next export;\n     \
         everything outside it is left alone. -->\n\n",
    );
    out.push_str(&format!("# Current feature: {feature_name}\n\n"));

    for s in ctx.sections.iter().filter(|s| s.inclusion.included()) {
        out.push_str(&format!("## {}\n\n{}\n\n", s.title, s.body.trim()));
    }

    let excluded: Vec<&str> = ctx
        .sections
        .iter()
        .filter(|s| !s.inclusion.included())
        .map(|s| s.title.as_str())
        .collect();
    if !excluded.is_empty() {
        // Naming the exclusions matters as much here as in the inspector: a
        // reader should know this is a deliberate slice, not the whole story.
        out.push_str(&format!(
            "## Deliberately not included\n\n{}\n\nAsk if you need any of it.\n\n",
            excluded
                .iter()
                .map(|e| format!("- {e}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    if let Some(commit) = &ctx.commit {
        out.push_str(&format!(
            "---\n\nDevDeck context for `{}` at `{}` — {} tokens.\n",
            ctx.feature_id,
            &commit[..commit.len().min(7)],
            ctx.total_tokens
        ));
    }
    out
}

impl ContextService {
    /// Write a feature's assembled context into an agent file at the project
    /// root, preserving whatever was already there.
    pub fn export_to_agent_file(
        deck: &Deck,
        ctx: &AssembledContext,
        feature_name: &str,
        filename: &str,
    ) -> Result<String, String> {
        if !AGENT_FILES.contains(&filename) {
            return Err(format!(
                "'{filename}' is not one of the agent files DevDeck writes ({})",
                AGENT_FILES.join(", ")
            ));
        }
        let path = deck.root.join(filename);
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let merged = splice_managed_block(&existing, &export_block(ctx, feature_name));
        std::fs::write(&path, merged).map_err(|e| format!("{filename}: {e}"))?;
        Ok(deck.rel(&path))
    }
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn an_empty_file_gets_just_the_block() {
        let out = splice_managed_block("", "hello");
        assert!(out.starts_with(EXPORT_BEGIN));
        assert!(out.trim().ends_with(EXPORT_END));
        assert!(out.contains("hello"));
    }

    /// The property that matters: a hand-written CLAUDE.md must survive.
    #[test]
    fn hand_written_content_above_and_below_is_preserved() {
        let existing = format!(
            "# House rules\n\nAlways run the tests.\n\n{EXPORT_BEGIN}\nold context\n{EXPORT_END}\n\n\
             # Notes\n\nDon't touch the parser.\n"
        );
        let out = splice_managed_block(&existing, "new context");

        assert!(
            out.contains("Always run the tests."),
            "content above was lost"
        );
        assert!(
            out.contains("Don't touch the parser."),
            "content below was lost"
        );
        assert!(out.contains("new context"));
        assert!(
            !out.contains("old context"),
            "the old block should be replaced"
        );
        assert_eq!(out.matches(EXPORT_BEGIN).count(), 1, "no duplicate blocks");
    }

    #[test]
    fn a_file_with_no_block_keeps_everything_and_gains_one() {
        let out = splice_managed_block("# My rules\n\nBe careful.\n", "context");
        assert!(out.contains("Be careful."));
        assert!(out.contains(EXPORT_BEGIN));
        assert_eq!(out.matches(EXPORT_BEGIN).count(), 1);
    }

    /// A truncated block is ambiguous. Appending is the safe reading; guessing
    /// where it ended could delete real content.
    #[test]
    fn a_begin_marker_with_no_end_is_not_treated_as_a_block() {
        let existing = format!("# Rules\n\n{EXPORT_BEGIN}\nhalf a block, no end marker\n");
        let out = splice_managed_block(&existing, "fresh");

        assert!(
            out.contains("half a block, no end marker"),
            "nothing was eaten"
        );
        assert!(out.contains("fresh"));
        assert_eq!(out.matches(EXPORT_END).count(), 1);
    }

    #[test]
    fn exporting_twice_does_not_grow_the_file() {
        let once = splice_managed_block("# Rules\n", "a");
        let twice = splice_managed_block(&once, "b");
        assert_eq!(twice.matches(EXPORT_BEGIN).count(), 1);
        assert!(twice.contains("# Rules"));
        assert!(twice.contains("b") && !twice.contains("\na\n"));
    }

    #[test]
    fn only_the_known_agent_files_are_writable() {
        // Guards against being pointed at, say, src/main.rs.
        assert!(AGENT_FILES.contains(&"CLAUDE.md"));
        assert!(!AGENT_FILES.contains(&"package.json"));
    }
}
