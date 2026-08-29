//! The personal store — the half of the split that is *yours*, not a project's.
//!
//! `.devdeck` is per-repo and committed, which is exactly right for feature
//! context, decisions and work items: they belong to the code, they should
//! travel with it, and a teammate cloning the repo should get them.
//!
//! It is exactly wrong for everything the assistant knows about *you*. Your
//! conversations, your preferences, the running notes it keeps — none of that
//! belongs in a work repository. Committing it would leak personal notes into
//! a shared history, and it would not follow you between projects anyway.
//!
//! So there are two roots, and the boundary is enforced rather than assumed:
//!
//! | | `.devdeck` (project) | this (personal) |
//! |---|---|---|
//! | Where | inside the repo | `%APPDATA%\devdeck\assistant` |
//! | Committed | yes, deliberately | **never** |
//! | Scope | one project | every project, and none |
//! | Holds | features, decisions, context | conversations, memory, profile |
//!
//! The format is the same as `.devdeck` — Markdown with typed frontmatter —
//! because the reasons for choosing it there hold here too: you can read it,
//! edit it, grep it, and delete it without a tool.
//!
//! The work half is what this is built for today. The life half (calendar,
//! mail, notes) needs no new store when it arrives — it needs new tools
//! pointed at this one.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::deck::{parse_doc, write_doc, Doc};

pub type PersonalResult<T> = Result<T, String>;

/// What the assistant remembers about you, across every project.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProfileMeta {
    #[serde(default)]
    pub updated_at: String,
    /// Free-form preferences the assistant has been told to keep.
    #[serde(default)]
    pub preferences: Vec<String>,
}

/// One durable note. Small and separately addressable so a wrong one can be
/// deleted without rewriting everything the assistant knows.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MemoryMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub created_at: String,
    /// Optional project this note is about. A note with none is general.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// An agent, as a file.
///
/// The frontmatter is what the runtime needs; the body is the agent's
/// instructions — the thing you actually want to edit, in the format you
/// already write prompts in. That split is deliberate: a system prompt buried
/// in a JSON string is a prompt nobody improves.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AgentMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// architect | developer | qa | reviewer | orchestrator, or your own.
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    /// tool id -> permission.
    #[serde(default)]
    pub permissions: std::collections::HashMap<String, String>,
    /// Skills to append to this agent's instructions, by name.
    #[serde(default)]
    pub skills: Vec<String>,
    /// Built-ins are seeded once and then yours. Marked only so the UI can say
    /// where a row came from; nothing treats them as read-only.
    #[serde(default)]
    pub builtin: bool,
}

/// A reusable block of instructions, shared between agents.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SkillMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// The personal root on disk.
#[derive(Clone, Debug)]
pub struct PersonalStore {
    root: PathBuf,
}

impl PersonalStore {
    /// Point at an explicit root. Tests use this; the app uses [`open`].
    ///
    /// Deliberately does not validate — [`open`] is the checked constructor,
    /// and a test writing to a temp dir should not have to satisfy the
    /// production location rules.
    pub fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The real store, at the OS config location, checked and created.
    pub fn open() -> PersonalResult<Self> {
        let store = Self::at(Self::default_root());
        store.ensure()?;
        Ok(store)
    }

    /// `%APPDATA%\devdeck\assistant` on Windows; the platform equivalent
    /// elsewhere. Alongside `devdeck.sqlite`, which lives in the same place.
    pub fn default_root() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("devdeck")
            .join("assistant")
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn conversations_dir(&self) -> PathBuf {
        self.root.join("conversations")
    }

    pub fn memory_dir(&self) -> PathBuf {
        self.root.join("memory")
    }

    pub fn profile_md(&self) -> PathBuf {
        self.root.join("profile.md")
    }

    pub fn agents_dir(&self) -> PathBuf {
        self.root.join("agents")
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.root.join("skills")
    }

    pub fn agent_md(&self, id: &str) -> PathBuf {
        self.agents_dir().join(format!("{id}.md"))
    }

    pub fn skill_md(&self, name: &str) -> PathBuf {
        self.skills_dir().join(format!("{name}.md"))
    }

    pub fn conversation_md(&self, id: &str) -> PathBuf {
        self.conversations_dir().join(format!("{id}.md"))
    }

    /// Create the layout, refusing a root that git would pick up.
    ///
    /// This is the load-bearing check in the whole module. Everything else is
    /// filing; this is what stops a conversation about your salary ending up in
    /// `git log`. It runs before any directory is created, so a bad root leaves
    /// nothing behind.
    pub fn ensure(&self) -> PersonalResult<()> {
        if let Some(repo) = enclosing_repo(&self.root) {
            return Err(format!(
                "refusing to put the personal store inside a git repository ({}) — \
                 personal notes must never be committable",
                repo.display()
            ));
        }
        std::fs::create_dir_all(self.conversations_dir()).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(self.memory_dir()).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(self.agents_dir()).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(self.skills_dir()).map_err(|e| e.to_string())?;
        Ok(())
    }

    // -- documents ---------------------------------------------------------

    pub fn read_doc<T: for<'de> Deserialize<'de> + Default>(
        &self,
        p: &Path,
    ) -> PersonalResult<Doc<T>> {
        let raw = std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
        parse_doc(&raw)
    }

    pub fn read_doc_opt<T: for<'de> Deserialize<'de> + Default>(
        &self,
        p: &Path,
    ) -> PersonalResult<Option<Doc<T>>> {
        if !p.exists() {
            return Ok(None);
        }
        self.read_doc(p).map(Some)
    }

    pub fn write_doc_at<T: Serialize>(&self, p: &Path, doc: &Doc<T>) -> PersonalResult<()> {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let raw = write_doc(doc)?;
        std::fs::write(p, raw).map_err(|e| format!("{}: {e}", p.display()))
    }

    pub fn profile(&self) -> Doc<ProfileMeta> {
        self.read_doc_opt(&self.profile_md())
            .ok()
            .flatten()
            .unwrap_or_else(|| Doc {
                meta: ProfileMeta::default(),
                body: String::new(),
            })
    }

    pub fn save_profile(&self, doc: &Doc<ProfileMeta>) -> PersonalResult<()> {
        self.write_doc_at(&self.profile_md(), doc)
    }

    /// Notes, newest first. Unreadable files are skipped rather than failing
    /// the lot — one hand-edited note with bad YAML should not blind the
    /// assistant to everything else it knows.
    pub fn memories(&self) -> Vec<Doc<MemoryMeta>> {
        let mut out: Vec<Doc<MemoryMeta>> = Vec::new();
        let Ok(entries) = std::fs::read_dir(self.memory_dir()) else {
            return out;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Ok(Some(d)) = self.read_doc_opt::<MemoryMeta>(&p) {
                out.push(d);
            }
        }
        out.sort_by(|a, b| b.meta.created_at.cmp(&a.meta.created_at));
        out
    }

    /// Every agent on disk, by name. An unreadable one is skipped rather than
    /// failing the lot — one hand-edited file with bad YAML should not cost you
    /// the rest of your team.
    pub fn agents(&self) -> Vec<Doc<AgentMeta>> {
        let mut out = self.read_dir_docs::<AgentMeta>(&self.agents_dir());
        out.sort_by(|a, b| a.meta.name.cmp(&b.meta.name));
        out
    }

    pub fn save_agent(&self, doc: &Doc<AgentMeta>) -> PersonalResult<PathBuf> {
        if doc.meta.id.trim().is_empty() {
            return Err("an agent needs an id".into());
        }
        let p = self.agent_md(&doc.meta.id);
        self.write_doc_at(&p, doc)?;
        Ok(p)
    }

    pub fn forget_agent(&self, id: &str) -> bool {
        std::fs::remove_file(self.agent_md(id)).is_ok()
    }

    pub fn skills(&self) -> Vec<Doc<SkillMeta>> {
        let mut out = self.read_dir_docs::<SkillMeta>(&self.skills_dir());
        out.sort_by(|a, b| a.meta.name.cmp(&b.meta.name));
        out
    }

    pub fn save_skill(&self, doc: &Doc<SkillMeta>) -> PersonalResult<PathBuf> {
        if doc.meta.name.trim().is_empty() {
            return Err("a skill needs a name".into());
        }
        let p = self.skill_md(&doc.meta.name);
        self.write_doc_at(&p, doc)?;
        Ok(p)
    }

    pub fn forget_skill(&self, name: &str) -> bool {
        std::fs::remove_file(self.skill_md(name)).is_ok()
    }

    fn read_dir_docs<T: for<'de> Deserialize<'de> + Default>(&self, dir: &Path) -> Vec<Doc<T>> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Ok(Some(d)) = self.read_doc_opt::<T>(&p) {
                out.push(d);
            }
        }
        out
    }

    pub fn save_memory(&self, doc: &Doc<MemoryMeta>) -> PersonalResult<PathBuf> {
        let id = if doc.meta.id.is_empty() {
            super::events::new_id("mem")
        } else {
            doc.meta.id.clone()
        };
        let p = self.memory_dir().join(format!("{id}.md"));
        let mut doc = doc.clone();
        doc.meta.id = id;
        self.write_doc_at(&p, &doc)?;
        Ok(p)
    }

    pub fn forget_memory(&self, id: &str) -> bool {
        std::fs::remove_file(self.memory_dir().join(format!("{id}.md"))).is_ok()
    }
}

/// The nearest ancestor (or the path itself) containing a `.git`, if any.
///
/// Checked by walking up rather than by asking git, so it holds even when git
/// is not installed and costs nothing.
pub fn enclosing_repo(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        if p.join(".git").exists() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!(
                "devdeck-personal-{tag}-{}-{}",
                std::process::id(),
                super::super::events::new_id("t")
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

    /// The whole reason the split exists. If this check ever regresses, the
    /// assistant's memory of your private conversations becomes a file in
    /// someone's pull request.
    #[test]
    fn the_personal_store_refuses_to_live_inside_a_repository() {
        let t = Tmp::new("inrepo");
        std::fs::create_dir_all(t.0.join(".git")).unwrap();

        let nested = t.0.join("deep").join("nested");
        let err = PersonalStore::at(&nested)
            .ensure()
            .expect_err("a root under a repo must be refused");
        assert!(err.contains("git repository"), "unhelpful refusal: {err}");
        assert!(
            !nested.exists(),
            "a refused root must not be created on the way to failing"
        );
    }

    #[test]
    fn a_root_outside_a_repository_is_created_with_its_layout() {
        let t = Tmp::new("ok");
        let s = PersonalStore::at(t.0.join("assistant"));
        s.ensure().unwrap();
        assert!(s.conversations_dir().is_dir());
        assert!(s.memory_dir().is_dir());
    }

    /// The real location has to satisfy the rule it enforces, or the app
    /// refuses to start its own assistant.
    #[test]
    fn the_default_root_is_not_inside_a_repository() {
        let root = PersonalStore::default_root();
        assert!(
            enclosing_repo(&root).is_none(),
            "the shipped personal root is inside a repo: {}",
            root.display()
        );
        // And it sits beside the database rather than somewhere of its own.
        assert!(root.ends_with("devdeck/assistant") || root.ends_with("devdeck\\assistant"));
    }

    #[test]
    fn a_memory_round_trips_and_can_be_forgotten() {
        let t = Tmp::new("mem");
        let s = PersonalStore::at(&t.0);
        s.ensure().unwrap();

        let doc = Doc {
            meta: MemoryMeta {
                title: "Prefers ff-only pulls".into(),
                created_at: "2026-08-28T09:00:00Z".into(),
                project_id: Some("tyrex".into()),
                tags: vec!["git".into()],
                ..Default::default()
            },
            body: "Never rebase shared branches.".into(),
        };
        let p = s.save_memory(&doc).unwrap();
        assert!(p.exists());

        let all = s.memories();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].meta.title, "Prefers ff-only pulls");
        assert_eq!(all[0].body.trim(), "Never rebase shared branches.");
        // An id was minted on the way in, so it can be addressed later.
        let id = all[0].meta.id.clone();
        assert!(!id.is_empty());

        assert!(s.forget_memory(&id));
        assert!(s.memories().is_empty(), "forgetting has to actually delete");
    }

    #[test]
    fn one_unreadable_note_does_not_hide_the_others() {
        let t = Tmp::new("badyaml");
        let s = PersonalStore::at(&t.0);
        s.ensure().unwrap();
        s.save_memory(&Doc {
            meta: MemoryMeta {
                title: "good".into(),
                created_at: "2026-08-28T09:00:00Z".into(),
                ..Default::default()
            },
            body: "fine".into(),
        })
        .unwrap();
        std::fs::write(
            s.memory_dir().join("hand-edited.md"),
            "---\nthis: [is not: valid yaml\n---\nbody",
        )
        .unwrap();

        let all = s.memories();
        assert_eq!(all.len(), 1, "the readable note still comes back");
        assert_eq!(all[0].meta.title, "good");
    }

    #[test]
    fn the_profile_reads_as_empty_before_it_is_ever_written() {
        let t = Tmp::new("profile");
        let s = PersonalStore::at(&t.0);
        s.ensure().unwrap();
        assert!(s.profile().meta.preferences.is_empty());

        let mut doc = s.profile();
        doc.meta.preferences.push("Terse answers".into());
        doc.meta.updated_at = "2026-08-28T09:00:00Z".into();
        doc.body = "Works on Windows, PowerShell 5.1.".into();
        s.save_profile(&doc).unwrap();

        let back = PersonalStore::at(&t.0).profile();
        assert_eq!(back.meta.preferences, vec!["Terse answers".to_string()]);
        assert!(back.body.contains("PowerShell"));
    }
}
