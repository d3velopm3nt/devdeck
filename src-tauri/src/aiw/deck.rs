//! The `.devdeck` directory — the durable source of truth.
//!
//! Everything that matters about a project's AI context lives here as Markdown
//! with YAML frontmatter, so it diffs, reviews and merges like code and is
//! readable without DevDeck running. SQLite holds only derived state (indexes,
//! presence, caches); if the database were deleted, everything below could be
//! rebuilt by re-reading these files.
//!
//! ```text
//! .devdeck/
//!   project.md            identity + rules
//!   context.md            project-level context
//!   knowledge/*.md
//!   decisions/*.md
//!   agents/*.md
//!   config/app.yaml       dev / build / test commands
//!   features/<slug>/
//!     feature.md
//!     context.md
//!     requirements.md
//!     work.md             work items + claims
//!     decisions/*.md
//!     sessions/*.md
//! ```
//!
//! The UI never touches these paths directly — it goes through commands that
//! call into here, so there is exactly one place that knows the layout.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub type DeckResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Frontmatter documents
// ---------------------------------------------------------------------------

/// A Markdown file with YAML frontmatter, parsed into a typed header plus the
/// raw body. Generic over the header so each document type gets its own schema
/// rather than everything degenerating into a string map.
#[derive(Clone, Debug, PartialEq)]
pub struct Doc<T> {
    pub meta: T,
    pub body: String,
}

/// Split `---\n<yaml>\n---\n<body>`. A file with no frontmatter is not an
/// error — it is a body with default metadata, because humans will create these
/// by hand and a hard failure on a missing header would be hostile.
pub fn parse_doc<T: for<'de> Deserialize<'de> + Default>(raw: &str) -> DeckResult<Doc<T>> {
    let normalized = raw.replace("\r\n", "\n");
    let trimmed = normalized.trim_start_matches('\u{feff}');

    if !trimmed.starts_with("---") {
        return Ok(Doc {
            meta: T::default(),
            body: trimmed.trim_start_matches('\n').to_string(),
        });
    }

    // Skip the opening fence, then find the closing one at the start of a line.
    let after_open = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return Err("frontmatter opened but never closed".into()),
    };
    let end =
        find_fence(after_open).ok_or_else(|| "frontmatter opened but never closed".to_string())?;
    let yaml = &after_open[..end.0];
    let body = &after_open[end.1..];

    let meta: T = if yaml.trim().is_empty() {
        T::default()
    } else {
        serde_yaml::from_str(yaml).map_err(|e| format!("bad frontmatter: {e}"))?
    };

    Ok(Doc {
        meta,
        body: body.trim_start_matches('\n').to_string(),
    })
}

/// Byte offsets of a closing `---` line: (start of the fence, start of what
/// follows it).
fn find_fence(s: &str) -> Option<(usize, usize)> {
    let mut offset = 0usize;
    for line in s.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some((offset, offset + line.len()));
        }
        offset += line.len();
    }
    None
}

/// The inverse of `parse_doc`. Roundtripping is tested — a writer that drops a
/// field silently loses project knowledge.
pub fn write_doc<T: Serialize>(doc: &Doc<T>) -> DeckResult<String> {
    let yaml = serde_yaml::to_string(&doc.meta).map_err(err)?;
    let body = doc.body.trim_start_matches('\n');
    Ok(format!("---\n{}---\n\n{}\n", yaml, body.trim_end()))
}

// ---------------------------------------------------------------------------
// Document schemas
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ProjectMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct FeatureMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// The manager accountable for it, by handle. One field, so "one owner per
    /// feature" enforces itself, and "who is accountable for this" is
    /// answerable from the feature alone rather than from a roster that can
    /// drift from it.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub owner: String,
    /// planned | in-progress | review | blocked | completed
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub areas: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ContextMeta {
    #[serde(default)]
    pub id: String,
    /// project-context | feature-context
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    /// Git commit this context was last written at — the checkpoint anchor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct DecisionMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    /// proposed | approved | superseded | rejected
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub impacts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct RequirementsMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requirements: Vec<Requirement>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Requirement {
    pub id: String,
    pub text: String,
    /// Words that, if an agent's change introduces them, contradict this
    /// requirement. Crude but deterministic, and honest about being a
    /// heuristic — see ConflictService.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub forbids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct WorkMeta {
    #[serde(default)]
    pub feature: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<WorkItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct WorkItem {
    pub id: String,
    pub title: String,
    /// unclaimed | claimed | in-progress | blocked | done
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub areas: Vec<String>,
    /// When it has to be done by: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM` when the
    /// hour matters.
    ///
    /// In the deck rather than the personal store, deliberately: a deadline on
    /// a piece of work is the project's own truth, shared with whoever has the
    /// repository, and it belongs beside the item it is about. *Your* day —
    /// the routine, the notes — is the other side of that split and never
    /// goes here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SessionMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_item: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
    #[serde(default)]
    pub status: String,
}

/// `config/app.yaml` — how to run this project. The process runner and the test
/// service both read it, so an agent starting an app and QA running tests use
/// the same declared commands rather than guessing.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct AppConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dev: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready_log: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/// Knows where everything lives. Every path in the workspace comes from here.
#[derive(Clone, Debug)]
pub struct Deck {
    pub root: PathBuf,
}

impl Deck {
    /// `root` is the project directory (the one holding `.devdeck`).
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn dir(&self) -> PathBuf {
        self.root.join(".devdeck")
    }
    pub fn exists(&self) -> bool {
        self.dir().is_dir()
    }
    pub fn project_md(&self) -> PathBuf {
        self.dir().join("project.md")
    }
    pub fn context_md(&self) -> PathBuf {
        self.dir().join("context.md")
    }
    pub fn knowledge_dir(&self) -> PathBuf {
        self.dir().join("knowledge")
    }
    pub fn decisions_dir(&self) -> PathBuf {
        self.dir().join("decisions")
    }
    pub fn agents_dir(&self) -> PathBuf {
        self.dir().join("agents")
    }
    pub fn config_dir(&self) -> PathBuf {
        self.dir().join("config")
    }
    pub fn app_config(&self) -> PathBuf {
        self.config_dir().join("app.yaml")
    }
    pub fn features_dir(&self) -> PathBuf {
        self.dir().join("features")
    }
    pub fn feature_dir(&self, slug: &str) -> PathBuf {
        self.features_dir().join(slug)
    }
    pub fn feature_md(&self, slug: &str) -> PathBuf {
        self.feature_dir(slug).join("feature.md")
    }
    pub fn feature_context(&self, slug: &str) -> PathBuf {
        self.feature_dir(slug).join("context.md")
    }
    pub fn feature_requirements(&self, slug: &str) -> PathBuf {
        self.feature_dir(slug).join("requirements.md")
    }
    pub fn feature_work(&self, slug: &str) -> PathBuf {
        self.feature_dir(slug).join("work.md")
    }
    pub fn feature_decisions(&self, slug: &str) -> PathBuf {
        self.feature_dir(slug).join("decisions")
    }
    pub fn feature_sessions(&self, slug: &str) -> PathBuf {
        self.feature_dir(slug).join("sessions")
    }

    /// Path relative to the project root, with forward slashes — what events
    /// and the UI use, so behaviour does not differ between Windows and CI.
    pub fn rel(&self, p: &Path) -> String {
        p.strip_prefix(&self.root)
            .unwrap_or(p)
            .to_string_lossy()
            .replace('\\', "/")
    }

    // -- reading ----------------------------------------------------------

    pub fn read_doc<T: for<'de> Deserialize<'de> + Default>(&self, p: &Path) -> DeckResult<Doc<T>> {
        let raw = fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
        parse_doc(&raw)
    }

    pub fn read_doc_opt<T: for<'de> Deserialize<'de> + Default>(
        &self,
        p: &Path,
    ) -> DeckResult<Option<Doc<T>>> {
        if !p.is_file() {
            return Ok(None);
        }
        self.read_doc(p).map(Some)
    }

    pub fn write_doc_at<T: Serialize>(&self, p: &Path, doc: &Doc<T>) -> DeckResult<()> {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::write(p, write_doc(doc)?).map_err(|e| format!("{}: {e}", p.display()))
    }

    pub fn project(&self) -> DeckResult<Doc<ProjectMeta>> {
        self.read_doc(&self.project_md())
    }

    pub fn app_cfg(&self) -> AppConfig {
        fs::read_to_string(self.app_config())
            .ok()
            .and_then(|s| serde_yaml::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Feature slugs, sorted, so listings are stable between runs.
    pub fn feature_slugs(&self) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(self.features_dir())
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
            .collect();
        out.sort();
        out
    }

    pub fn feature(&self, slug: &str) -> DeckResult<Doc<FeatureMeta>> {
        self.read_doc(&self.feature_md(slug))
    }

    pub fn work(&self, slug: &str) -> DeckResult<Doc<WorkMeta>> {
        match self.read_doc_opt::<WorkMeta>(&self.feature_work(slug))? {
            Some(d) => Ok(d),
            None => Ok(Doc {
                meta: WorkMeta {
                    feature: slug.to_string(),
                    items: vec![],
                },
                body: String::new(),
            }),
        }
    }

    pub fn requirements(&self, slug: &str) -> DeckResult<Doc<RequirementsMeta>> {
        match self.read_doc_opt::<RequirementsMeta>(&self.feature_requirements(slug))? {
            Some(d) => Ok(d),
            None => Ok(Doc {
                meta: RequirementsMeta::default(),
                body: String::new(),
            }),
        }
    }

    /// Decisions for one feature plus the project-wide ones, newest first.
    /// Scoped deliberately: a feature must not receive another feature's
    /// decisions, which is what the isolation test asserts.
    pub fn decisions(&self, slug: Option<&str>) -> Vec<Doc<DecisionMeta>> {
        let mut dirs = vec![self.decisions_dir()];
        if let Some(s) = slug {
            dirs.push(self.feature_decisions(s));
        }
        let mut out: Vec<Doc<DecisionMeta>> = dirs
            .iter()
            .flat_map(|d| fs::read_dir(d).into_iter().flatten().flatten())
            .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
            .filter_map(|e| self.read_doc::<DecisionMeta>(&e.path()).ok())
            .filter(|d| match slug {
                // A project-level decision has no feature and applies to all;
                // a feature-scoped one only applies to its own feature.
                Some(s) => d.meta.feature.as_deref().map(|f| f == s).unwrap_or(true),
                None => true,
            })
            .collect();
        out.sort_by(|a, b| b.meta.created.cmp(&a.meta.created));
        out
    }

    /// Durable session records for a feature. Read by the sessions view
    /// and by the durability test.
    #[allow(dead_code)]
    pub fn sessions(&self, slug: &str) -> Vec<Doc<SessionMeta>> {
        let mut out: Vec<Doc<SessionMeta>> = fs::read_dir(self.feature_sessions(slug))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
            .filter_map(|e| self.read_doc::<SessionMeta>(&e.path()).ok())
            .collect();
        out.sort_by(|a, b| b.meta.started.cmp(&a.meta.started));
        out
    }

    // -- writing ----------------------------------------------------------

    /// Create the skeleton. Idempotent: running it on an existing deck adds
    /// only what is missing and never overwrites a file that already has
    /// content someone wrote.
    pub fn init(&self, project_id: &str, name: &str) -> DeckResult<()> {
        for d in [
            self.dir(),
            self.knowledge_dir(),
            self.decisions_dir(),
            self.agents_dir(),
            self.config_dir(),
            self.features_dir(),
        ] {
            fs::create_dir_all(&d).map_err(err)?;
        }

        if !self.project_md().is_file() {
            self.write_doc_at(
                &self.project_md(),
                &Doc {
                    meta: ProjectMeta {
                        id: project_id.to_string(),
                        name: name.to_string(),
                        repo: None,
                        rules: vec![],
                        updated: Some(super::events::now_iso()),
                    },
                    body: format!("# {name}\n\nProject-level rules and identity."),
                },
            )?;
        }
        if !self.context_md().is_file() {
            self.write_doc_at(
                &self.context_md(),
                &Doc {
                    meta: ContextMeta {
                        id: project_id.to_string(),
                        kind: "project-context".into(),
                        status: Some("active".into()),
                        updated: Some(super::events::now_iso()),
                        commit: None,
                    },
                    body: "## Purpose\n\n## Architecture\n\n## Priorities\n".to_string(),
                },
            )?;
        }
        if !self.app_config().is_file() {
            fs::write(
                self.app_config(),
                serde_yaml::to_string(&AppConfig::default()).map_err(err)?,
            )
            .map_err(err)?;
        }
        Ok(())
    }

    /// Create a feature and its four files. Returns the slug.
    pub fn create_feature(&self, name: &str, goal: &str, areas: &[String]) -> DeckResult<String> {
        let slug = slugify(name);
        if slug.is_empty() {
            return Err("feature name has no usable characters".into());
        }
        if self.feature_dir(&slug).exists() {
            return Err(format!("feature '{slug}' already exists"));
        }
        fs::create_dir_all(self.feature_decisions(&slug)).map_err(err)?;
        fs::create_dir_all(self.feature_sessions(&slug)).map_err(err)?;

        let now = super::events::now_iso();
        self.write_doc_at(
            &self.feature_md(&slug),
            &Doc {
                meta: FeatureMeta {
                    id: slug.clone(),
                    name: name.to_string(),
                    // Unowned until a manager takes it: a feature that arrives
                    // pre-assigned to whoever happened to create it is how
                    // accountability becomes a side effect.
                    owner: String::new(),
                    status: "planned".into(),
                    areas: areas.to_vec(),
                    goal: Some(goal.to_string()),
                    updated: Some(now.clone()),
                },
                body: format!("# {name}\n\n## Goal\n\n{goal}\n"),
            },
        )?;
        self.write_doc_at(
            &self.feature_context(&slug),
            &Doc {
                meta: ContextMeta {
                    id: slug.clone(),
                    kind: "feature-context".into(),
                    status: Some("planned".into()),
                    updated: Some(now.clone()),
                    commit: None,
                },
                body: format!(
                    "## Goal\n\n{goal}\n\n## Current state\n\n- Not started.\n\n## Rules\n\n## Open questions\n"
                ),
            },
        )?;
        self.write_doc_at(
            &self.feature_requirements(&slug),
            &Doc {
                meta: RequirementsMeta {
                    id: slug.clone(),
                    requirements: vec![],
                },
                body: "## Requirements\n".to_string(),
            },
        )?;
        self.write_doc_at(
            &self.feature_work(&slug),
            &Doc {
                meta: WorkMeta {
                    feature: slug.clone(),
                    items: vec![],
                },
                body: "## Work items\n".to_string(),
            },
        )?;
        Ok(slug)
    }

    pub fn save_work(&self, slug: &str, work: &WorkMeta) -> DeckResult<()> {
        self.write_doc_at(
            &self.feature_work(slug),
            &Doc {
                meta: work.clone(),
                body: "## Work items\n".to_string(),
            },
        )
    }

    pub fn save_decision(
        &self,
        slug: Option<&str>,
        doc: &Doc<DecisionMeta>,
    ) -> DeckResult<PathBuf> {
        let dir = match slug {
            Some(s) => self.feature_decisions(s),
            None => self.decisions_dir(),
        };
        fs::create_dir_all(&dir).map_err(err)?;
        let path = dir.join(format!("{}.md", slugify(&doc.meta.id)));
        self.write_doc_at(&path, doc)?;
        Ok(path)
    }

    pub fn save_session(&self, slug: &str, doc: &Doc<SessionMeta>) -> DeckResult<PathBuf> {
        let dir = self.feature_sessions(slug);
        fs::create_dir_all(&dir).map_err(err)?;
        let path = dir.join(format!("{}.md", slugify(&doc.meta.id)));
        self.write_doc_at(&path, doc)?;
        Ok(path)
    }

    /// Rewrite a feature's context body, stamping the commit it reflects.
    pub fn save_feature_context(
        &self,
        slug: &str,
        body: &str,
        commit: Option<&str>,
    ) -> DeckResult<()> {
        let mut doc = self
            .read_doc_opt::<ContextMeta>(&self.feature_context(slug))?
            .unwrap_or(Doc {
                meta: ContextMeta {
                    id: slug.to_string(),
                    kind: "feature-context".into(),
                    ..Default::default()
                },
                body: String::new(),
            });
        doc.body = body.to_string();
        doc.meta.updated = Some(super::events::now_iso());
        if let Some(c) = commit {
            doc.meta.commit = Some(c.to_string());
        }
        self.write_doc_at(&self.feature_context(slug), &doc)
    }

    /// Every Markdown file under `.devdeck`, relative — powers the Knowledge
    /// browser tree.
    pub fn tree(&self) -> Vec<String> {
        let mut out = Vec::new();
        collect(&self.dir(), &self.root, &mut out);
        out.sort();
        out
    }
}

fn collect(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, root, out);
        } else if p
            .extension()
            .map(|x| x == "md" || x == "yaml")
            .unwrap_or(false)
        {
            out.push(
                p.strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
}

/// `Offline Synchronisation` → `offline-synchronisation`.
pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !out.is_empty() && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("devdeck-deck-{tag}-{}", std::process::id()));
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

    #[test]
    fn frontmatter_roundtrips_without_losing_fields() {
        let doc = Doc {
            meta: FeatureMeta {
                id: "offline-sync".into(),
                name: "Offline Synchronisation".into(),
                owner: "marketing".into(),
                status: "in-progress".into(),
                areas: vec!["packages/sync".into(), "api/sync".into()],
                goal: Some("Keep working with no connectivity.".into()),
                updated: Some("2026-08-28T10:00:00.000Z".into()),
            },
            body: "# Offline Synchronisation\n\n## Goal\n\nSurvive a dead link.".into(),
        };

        let text = write_doc(&doc).unwrap();
        let back: Doc<FeatureMeta> = parse_doc(&text).unwrap();

        assert_eq!(back.meta, doc.meta, "metadata survived the roundtrip");
        assert_eq!(back.body.trim(), doc.body.trim(), "body survived");
    }

    #[test]
    fn a_file_with_no_frontmatter_is_a_body_not_an_error() {
        let parsed: Doc<ContextMeta> = parse_doc("# Just markdown\n\nNo header here.").unwrap();
        assert_eq!(parsed.meta, ContextMeta::default());
        assert!(parsed.body.starts_with("# Just markdown"));
    }

    #[test]
    fn crlf_frontmatter_parses() {
        // Windows editors will write these; a parser that only handles \n
        // would report every hand-edited file as malformed.
        let raw = "---\r\nid: x\r\nname: Thing\r\nstatus: planned\r\n---\r\n\r\nBody text.\r\n";
        let d: Doc<FeatureMeta> = parse_doc(raw).unwrap();
        assert_eq!(d.meta.id, "x");
        assert_eq!(d.meta.name, "Thing");
        assert_eq!(d.body.trim(), "Body text.");
    }

    #[test]
    fn an_unterminated_frontmatter_is_an_explicit_error() {
        let e = parse_doc::<FeatureMeta>("---\nid: x\nno closing fence\n").unwrap_err();
        assert!(e.contains("never closed"), "got: {e}");
    }

    #[test]
    fn init_then_create_feature_writes_the_expected_files() {
        let t = Tmp::new("init");
        let deck = t.deck();
        deck.init("tyrex", "TyreX").unwrap();
        assert!(deck.project_md().is_file());
        assert!(deck.context_md().is_file());
        assert!(deck.app_config().is_file());

        let slug = deck
            .create_feature(
                "Offline Synchronisation",
                "Work without connectivity.",
                &["packages/sync".into()],
            )
            .unwrap();
        assert_eq!(slug, "offline-synchronisation");
        assert!(deck.feature_md(&slug).is_file());
        assert!(deck.feature_context(&slug).is_file());
        assert!(deck.feature_requirements(&slug).is_file());
        assert!(deck.feature_work(&slug).is_file());

        let f = deck.feature(&slug).unwrap();
        assert_eq!(f.meta.name, "Offline Synchronisation");
        assert_eq!(f.meta.status, "planned");
        assert_eq!(f.meta.areas, vec!["packages/sync".to_string()]);
    }

    #[test]
    fn init_is_idempotent_and_never_clobbers_existing_content() {
        let t = Tmp::new("idem");
        let deck = t.deck();
        deck.init("tyrex", "TyreX").unwrap();
        let mut p = deck.project().unwrap();
        p.body = "# TyreX\n\nHand-written notes worth keeping.".into();
        deck.write_doc_at(&deck.project_md(), &p).unwrap();

        deck.init("tyrex", "TyreX").unwrap();

        let after = deck.project().unwrap();
        assert!(
            after.body.contains("Hand-written notes worth keeping"),
            "re-init must not overwrite an existing project.md"
        );
    }

    #[test]
    fn creating_the_same_feature_twice_is_refused() {
        let t = Tmp::new("dupe");
        let deck = t.deck();
        deck.init("p", "P").unwrap();
        deck.create_feature("Gate Tracking", "g", &[]).unwrap();
        let e = deck.create_feature("Gate Tracking", "g", &[]).unwrap_err();
        assert!(e.contains("already exists"), "got: {e}");
    }

    #[test]
    fn feature_decisions_do_not_leak_between_features() {
        let t = Tmp::new("dleak");
        let deck = t.deck();
        deck.init("p", "P").unwrap();
        let a = deck.create_feature("Alpha", "a", &[]).unwrap();
        let b = deck.create_feature("Beta", "b", &[]).unwrap();

        deck.save_decision(
            Some(&a),
            &Doc {
                meta: DecisionMeta {
                    id: "adr-alpha".into(),
                    title: "Alpha only".into(),
                    status: "approved".into(),
                    feature: Some(a.clone()),
                    created: Some("2026-01-01".into()),
                    ..Default::default()
                },
                body: "Alpha reasoning.".into(),
            },
        )
        .unwrap();

        let for_b = deck.decisions(Some(&b));
        assert!(
            !for_b.iter().any(|d| d.meta.id == "adr-alpha"),
            "Beta received Alpha's decision: {:?}",
            for_b.iter().map(|d| d.meta.id.clone()).collect::<Vec<_>>()
        );
        let for_a = deck.decisions(Some(&a));
        assert!(for_a.iter().any(|d| d.meta.id == "adr-alpha"));
    }

    #[test]
    fn work_items_roundtrip_through_yaml() {
        let t = Tmp::new("work");
        let deck = t.deck();
        deck.init("p", "P").unwrap();
        let slug = deck.create_feature("Sync", "s", &[]).unwrap();

        let work = WorkMeta {
            feature: slug.clone(),
            items: vec![WorkItem {
                id: "wi-1".into(),
                title: "Conflict resolution".into(),
                status: "claimed".into(),
                assignee: Some("claude".into()),
                areas: vec!["packages/sync".into()],
                due: None,
            }],
        };
        deck.save_work(&slug, &work).unwrap();

        let back = deck.work(&slug).unwrap();
        assert_eq!(back.meta, work);
    }

    #[test]
    fn slugify_handles_the_awkward_cases() {
        assert_eq!(
            slugify("Offline Synchronisation"),
            "offline-synchronisation"
        );
        assert_eq!(slugify("  Gate / Tracking!  "), "gate-tracking");
        assert_eq!(slugify("Tyre—Lifecycle"), "tyre-lifecycle");
        assert_eq!(slugify("!!!"), "");
    }
}
