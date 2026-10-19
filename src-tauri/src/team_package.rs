//! Read-only package inspection, then explicit creation of a team and its text dependencies.
use crate::{
    agent_library, library,
    team_library_model::{self, Team},
    workers::{Worker, WorkerMeta},
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Text {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub name: String,
    pub description: String,
    pub content: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Preview {
    pub folder: String,
    pub fingerprint: String,
    pub team: Team,
    pub texts: Vec<Text>,
    pub skills: BTreeMap<String, Vec<String>>,
    pub context: String,
}
#[derive(Default, Deserialize)]
struct Header {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    skills: Vec<String>,
}
fn failure(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn read(root: &Path, relative: &str) -> Result<String, String> {
    let p = root
        .join(relative)
        .canonicalize()
        .map_err(|e| format!("{relative}: {e}"))?;
    if !p.starts_with(root) {
        return Err(format!("{relative} leaves the package folder."));
    }
    if fs::metadata(&p).map_err(failure)?.len() > 200_000 {
        return Err(format!("{relative} exceeds 200 KB."));
    }
    fs::read_to_string(p).map_err(failure)
}
fn text(root: &Path, id: &str, kind: &str) -> Result<(Text, Header), String> {
    if !team_library_model::valid_id(id) {
        return Err(format!("Invalid {kind} ID '{id}'."));
    }
    let path = if kind == "brief" {
        format!("agents/{id}.md")
    } else {
        format!("skills/{id}/SKILL.md")
    };
    let content = read(root, &path)?;
    let doc =
        crate::aiw::deck::parse_doc::<Header>(&content).map_err(|e| format!("{path}: {e}"))?;
    if doc.meta.name.trim().is_empty() || doc.body.trim().is_empty() {
        return Err(format!("{path} needs a name and instructions."));
    }
    if kind == "skill" && (doc.meta.name != id || doc.meta.description.trim().is_empty()) {
        return Err(format!("{path} needs matching name and a description."));
    }
    // First version imports self-contained skills; never silently omit their resources.
    if kind == "skill"
        && fs::read_dir(root.join("skills").join(id))
            .map_err(failure)?
            .count()
            != 1
    {
        return Err(format!("{path}: this team importer supports self-contained skills only. Import resource-backed skills through Library first."));
    }
    Ok((
        Text {
            id: id.into(),
            kind: kind.into(),
            path,
            name: doc.meta.name.clone(),
            description: doc.meta.description.clone(),
            content,
        },
        doc.meta,
    ))
}
pub fn inspect(folder: &str) -> Result<Preview, String> {
    let mut root = PathBuf::from(folder).canonicalize().map_err(failure)?;
    if !root.is_dir() {
        return Err("Choose the package folder containing team.json.".into());
    }
    if !root.join("team.json").exists() && root.join("factories").is_dir() {
        let candidates = fs::read_dir(root.join("factories"))
            .map_err(failure)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
            .map(|entry| entry.path())
            .filter(|p| p.join("team.json").is_file())
            .collect::<Vec<_>>();
        if candidates.len() == 1 {
            root = candidates[0].canonicalize().map_err(failure)?;
        } else if candidates.len() > 1 {
            return Err(format!(
                "Several team packages found. Choose a package folder: {}",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    let manifest = read(&root, "team.json")
        .map_err(|e| format!("Choose the package folder containing team.json. {e}"))?;
    let team: Team = serde_json::from_str(&manifest).map_err(failure)?;
    team_library_model::validate(&team)?;
    if team.id.len() > 36 || team.name.len() > 200 || team.description.len() > 20000 {
        return Err("Team identity or description is too long.".into());
    }
    let mut texts = Vec::new();
    let mut skills = BTreeMap::new();
    let mut seen = HashSet::new();
    for role in &team.roles {
        let (brief, header) = text(&root, &role.worker, "brief")?;
        skills.insert(role.name.clone(), header.skills.clone());
        if seen.insert((brief.kind.clone(), brief.id.clone())) {
            texts.push(brief);
        }
        for id in header.skills {
            if seen.insert(("skill".into(), id.clone())) {
                texts.push(text(&root, &id, "skill")?.0);
            }
        }
    }
    let context = if root.join("README.md").exists() {
        read(&root, "README.md")?
    } else {
        String::new()
    };
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(&team, &texts, &skills, &context)).map_err(failure)?)
    );
    Ok(Preview {
        folder: root.to_string_lossy().into(),
        fingerprint,
        team,
        texts,
        skills,
        context,
    })
}

pub fn create(root: &Path, preview: Preview) -> Result<Team, String> {
    // Re-read rather than trusting instructions or dependencies supplied by the frontend.
    let source = inspect(&preview.folder)?;
    if source.fingerprint != preview.fingerprint {
        return Err("Package changed. Inspect it again before creating the team.".into());
    }
    let mut db = crate::personal_library::team_connection(root)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(failure)?;
    let request_id = format!("package:{}", source.team.id);
    let previous: Option<(String, String)> = tx
        .query_row(
            "SELECT request,result FROM team_build_requests WHERE id=?1",
            [&request_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(failure)?;
    if let Some((request, result)) = previous {
        if request != source.fingerprint {
            return Err("This team was already imported from different content. Choose a new team ID or edit the saved team.".into());
        }
        let saved: Option<String> = tx
            .query_row(
                "SELECT definition FROM reusable_teams WHERE id=?1",
                [&source.team.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(failure)?;
        return serde_json::from_str(&saved.unwrap_or(result)).map_err(failure);
    }
    let mut team = source.team.clone();
    team.revision = 1;
    let library_dir = root.join("library");
    let index_path = library_dir.join("index.md");
    let old_index = if index_path.exists() {
        Some(fs::read(&index_path).map_err(failure)?)
    } else {
        None
    };
    let mut index = match old_index.as_ref() {
        Some(raw) => {
            crate::aiw::deck::parse_doc::<library::Index>(&String::from_utf8_lossy(raw))?.meta
        }
        None => library::Index::default(),
    };
    let mut writes = Vec::new();
    for item in &source.texts {
        if index
            .items
            .iter()
            .any(|i| i.id == item.id && i.kind == item.kind)
        {
            return Err(format!(
                "{} '{}' already exists in Library. No definitions were replaced.",
                item.kind, item.id
            ));
        }
        let p = if item.kind == "brief" {
            library_dir.join("briefs").join(format!("{}.md", item.id))
        } else {
            library_dir.join("skills").join(&item.id).join("SKILL.md")
        };
        if p.exists() {
            return Err(format!(
                "{} already exists. No files were replaced.",
                p.display()
            ));
        }
        writes.push((p, item.content.clone()));
        index.items.push(library::Item {
            id: item.id.clone(),
            kind: item.kind.clone(),
            name: item.name.clone(),
            what: item.description.clone(),
            repo: format!("local:{}", source.folder),
            commit: source.fingerprint.clone(),
            licence: "repository license; inspect source".into(),
            path: item.path.clone(),
            added_at: crate::aiw::events::now_iso(),
            chars: item.content.chars().count() as i64,
        });
    }
    for role in &mut team.roles {
        let brief_id = role.worker.clone();
        let brief = source
            .texts
            .iter()
            .find(|t| t.kind == "brief" && t.id == brief_id)
            .ok_or("Missing brief")?;
        role.worker = format!("{}-{}", team.id, role.name);
        if !team_library_model::valid_id(&role.worker) {
            return Err("Combined team and role IDs exceed the agent ID limit.".into());
        }
        let worker = Worker {
            meta: WorkerMeta {
                handle: role.worker.clone(),
                name: brief.name.clone(),
                category: if role.kind == "specialist" {
                    "specialist"
                } else {
                    "worker"
                }
                .into(),
                profile: "Custom".into(),
                what: brief.description.clone(),
                brief: brief_id,
                skills: source.skills.get(&role.name).cloned().unwrap_or_default(),
                runner: "claude-code".into(),
                model: "sonnet".into(),
                writes: "branch".into(),
                minutes: 20,
                usd: 2.0,
                created_at: crate::aiw::events::now_iso(),
                ..Default::default()
            },
            body: format!(
                "Package source: {}\nSnapshot: {}\n\nShared package instructions:\n{}",
                source.folder, source.fingerprint, source.context
            ),
        };
        let definition = agent_library::from_worker(&worker)?;
        tx.execute(
            "INSERT INTO agent_definitions(id,definition) VALUES (?1,?2)",
            rusqlite::params![
                definition.id,
                serde_json::to_string(&definition).map_err(failure)?
            ],
        )
        .map_err(|_| "An agent with this identity exists. No agents were replaced.".to_string())?;
    }
    team_library_model::validate(&team)?;
    let result = serde_json::to_string(&team).map_err(failure)?;
    tx.execute(
        "INSERT INTO reusable_teams(id,definition) VALUES (?1,?2)",
        rusqlite::params![team.id, result],
    )
    .map_err(|_| "A team with this identity already exists. No team was replaced.".to_string())?;
    tx.execute(
        "INSERT INTO team_build_requests(id,request,result) VALUES (?1,?2,?3)",
        rusqlite::params![request_id, source.fingerprint, result],
    )
    .map_err(failure)?;
    let mut created = Vec::new();
    let persisted = (|| -> Result<(), String> {
        for (path, content) in &writes {
            fs::create_dir_all(path.parent().ok_or("Invalid library path")?).map_err(failure)?;
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(failure)?;
            created.push(path.clone());
            file.write_all(content.as_bytes()).map_err(failure)?;
        }
        let doc = crate::aiw::deck::Doc {
            meta: index,
            body: "Imported text definitions.\n".into(),
        };
        fs::write(&index_path, crate::aiw::deck::write_doc(&doc)?).map_err(failure)?;
        tx.commit().map_err(failure)
    })();
    if let Err(e) = persisted {
        for p in created {
            let _ = fs::remove_file(p);
        }
        if let Some(raw) = old_index {
            fs::write(&index_path, raw)
                .map_err(|restore| format!("{e}; index restoration failed: {restore}"))?;
        } else if index_path.exists() {
            fs::remove_file(&index_path).map_err(failure)?;
        }
        return Err(e);
    }
    Ok(team)
}

#[tauri::command(async)]
pub fn team_package_inspect(folder: String) -> Result<Preview, String> {
    inspect(&folder)
}
#[tauri::command(async)]
pub fn team_package_create(preview: Preview) -> Result<Team, String> {
    let _guard = library::WRITE.lock().map_err(failure)?;
    let store = crate::aiw::personal::PersonalStore::open()?;
    crate::workers::all_workers()?;
    create(store.root(), preview)
}

/// A template is a self-contained folder. Listing derives its metadata from the files.
pub fn save_template(root: &Path, preview: Preview) -> Result<Preview, String> {
    let source = inspect(&preview.folder)?;
    if source.fingerprint != preview.fingerprint {
        return Err("Package changed. Inspect it again before importing.".into());
    }
    let directory = root.join("library/team-templates");
    fs::create_dir_all(&directory).map_err(failure)?;
    let destination = directory.join(&source.team.id);
    if destination.exists() {
        let saved = inspect(&destination.to_string_lossy())?;
        if saved.fingerprint == source.fingerprint {
            return Ok(saved);
        }
        return Err(
            "A different template with this team ID already exists. No files were replaced.".into(),
        );
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(failure)?
        .as_nanos();
    let staging = directory.join(format!(".import-{nonce}"));
    let result = (|| -> Result<Preview, String> {
        fs::create_dir(&staging).map_err(failure)?;
        fs::write(
            staging.join("team.json"),
            serde_json::to_vec_pretty(&source.team).map_err(failure)?,
        )
        .map_err(failure)?;
        for item in &source.texts {
            let path = staging.join(&item.path);
            fs::create_dir_all(path.parent().ok_or("Invalid template path")?).map_err(failure)?;
            fs::write(path, &item.content).map_err(failure)?;
        }
        if !source.context.is_empty() {
            fs::write(staging.join("README.md"), &source.context).map_err(failure)?;
        }
        fs::write(
            staging.join("source.json"),
            serde_json::to_vec_pretty(
                &serde_json::json!({"folder": source.folder, "fingerprint": source.fingerprint}),
            )
            .map_err(failure)?,
        )
        .map_err(failure)?;
        let staged = inspect(&staging.to_string_lossy())?;
        if staged.fingerprint != source.fingerprint {
            return Err("Imported package does not match the inspected files.".into());
        }
        fs::rename(&staging, &destination).map_err(failure)?;
        inspect(&destination.to_string_lossy())
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}
pub fn templates(root: &Path) -> Result<Vec<Preview>, String> {
    let directory = root.join("library/team-templates");
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(directory).map_err(failure)? {
        let entry = entry.map_err(failure)?;
        if entry.file_type().map_err(failure)?.is_dir()
            && !entry.file_name().to_string_lossy().starts_with('.')
        {
            out.push(inspect(&entry.path().to_string_lossy())?);
        }
    }
    out.sort_by(|a, b| a.team.name.cmp(&b.team.name));
    Ok(out)
}
#[tauri::command(async)]
pub fn team_package_save_template(preview: Preview) -> Result<Preview, String> {
    let _guard = library::WRITE.lock().map_err(failure)?;
    save_template(crate::aiw::personal::PersonalStore::open()?.root(), preview)
}
#[tauri::command(async)]
pub fn team_package_templates() -> Result<Vec<Preview>, String> {
    let _guard = library::WRITE.lock().map_err(failure)?;
    templates(crate::aiw::personal::PersonalStore::open()?.root())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "devdeck-package-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn fixture(&self) -> PathBuf {
            let source =
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../factories/software-factory");
            let target = self.0.join("source");
            fn copy(from: &Path, to: &Path) {
                fs::create_dir_all(to).unwrap();
                for entry in fs::read_dir(from).unwrap() {
                    let entry = entry.unwrap();
                    if entry.file_type().unwrap().is_dir() {
                        copy(&entry.path(), &to.join(entry.file_name()));
                    } else {
                        fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
                    }
                }
            }
            copy(&source, &target);
            target
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn factory_discovery_creation_reopen_and_retry() {
        let sandbox = Sandbox::new();
        let folder = sandbox.fixture();
        let preview = inspect(folder.to_str().unwrap()).unwrap();
        assert_eq!(preview.team.roles.len(), 5);
        assert_eq!(
            preview.texts.iter().filter(|t| t.kind == "skill").count(),
            5
        );
        let root = sandbox.0.join("personal");
        let team = create(&root, preview.clone()).unwrap();
        let retried = create(&root, preview).unwrap();
        assert_eq!(team.revision, retried.revision);
        let definitions = agent_library::list(&root).unwrap();
        assert_eq!(definitions.len(), 5);
        for role in &team.roles {
            let definition = definitions
                .iter()
                .find(|d| d.id == format!("worker:{}", role.worker))
                .unwrap();
            let worker = agent_library::worker(definition).unwrap();
            assert_eq!(worker.meta.skills.len(), 1);
            assert!(!worker.meta.unattended);
            assert!(worker.meta.allow.is_empty());
            assert!(worker.body.contains("Handoff contract"));
            assert!(root
                .join("library/briefs")
                .join(format!("{}.md", worker.meta.brief))
                .is_file());
            assert!(root
                .join("library/skills")
                .join(&worker.meta.skills[0])
                .join("SKILL.md")
                .is_file());
        }
        let pr = team.roles.iter().find(|r| r.name == "pr-manager").unwrap();
        assert_eq!(pr.reports_to, "factory-manager");
        assert!(pr.handoffs.contains(&"verifier".into()));
        let db = crate::personal_library::team_connection(&root).unwrap();
        let saved: String = db
            .query_row(
                "SELECT definition FROM reusable_teams WHERE id='software-factory'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Team>(&saved).unwrap().roles.len(), 5);
    }
    #[test]
    fn template_import_is_files_only_and_survives_source_removal() {
        let sandbox = Sandbox::new();
        let folder = sandbox.fixture();
        let preview = inspect(folder.to_str().unwrap()).unwrap();
        let root = sandbox.0.join("personal");
        let saved = save_template(&root, preview.clone()).unwrap();
        assert_eq!(saved.fingerprint, preview.fingerprint);
        assert_eq!(
            save_template(&root, preview).unwrap().fingerprint,
            saved.fingerprint
        );
        assert!(!root.join("library/agents.sqlite").exists());
        assert!(!root.join("library/index.md").exists());
        fs::remove_dir_all(folder).unwrap();
        let listed = templates(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].team.roles.len(), 5);
        assert_eq!(listed[0].texts.len(), 10);
        assert!(!root.join("library/agents.sqlite").exists());
    }
    #[test]
    fn missing_dependency_and_stale_preview_write_nothing() {
        let sandbox = Sandbox::new();
        let folder = sandbox.fixture();
        let preview = inspect(folder.to_str().unwrap()).unwrap();
        let skill = folder.join("skills/factory-planning/SKILL.md");
        let original = fs::read_to_string(&skill).unwrap();
        fs::write(&skill, format!("{original}\nChanged")).unwrap();
        let root = sandbox.0.join("personal");
        assert!(create(&root, preview)
            .err()
            .unwrap()
            .contains("Package changed"));
        assert!(!root.exists());
        fs::remove_file(skill).unwrap();
        assert!(inspect(folder.to_str().unwrap()).is_err());
    }
    #[test]
    fn conflicting_agent_rolls_back_without_installing_texts() {
        let sandbox = Sandbox::new();
        let folder = sandbox.fixture();
        let preview = inspect(folder.to_str().unwrap()).unwrap();
        let root = sandbox.0.join("personal");
        let existing = Worker {
            meta: WorkerMeta {
                handle: "software-factory-builder".into(),
                name: "Existing builder".into(),
                ..Default::default()
            },
            body: "Keep me".into(),
        };
        agent_library::create(&root, &agent_library::from_worker(&existing).unwrap()).unwrap();
        assert!(create(&root, preview).is_err());
        let definitions = agent_library::list(&root).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].instructions, "Keep me");
        assert!(!root.join("library/index.md").exists());
        assert!(!root.join("library/briefs").exists());
    }
    #[test]
    fn invalid_hierarchy_and_extra_skill_resources_are_rejected() {
        let sandbox = Sandbox::new();
        let folder = sandbox.fixture();
        let manifest = folder.join("team.json");
        let original = fs::read_to_string(&manifest).unwrap();
        let mut team: Team = serde_json::from_str(&original).unwrap();
        team.roles[0].reports_to = "pr-manager".into();
        fs::write(&manifest, serde_json::to_vec(&team).unwrap()).unwrap();
        assert!(inspect(folder.to_str().unwrap()).is_err());
        fs::write(manifest, original).unwrap();
        fs::write(
            folder.join("skills/factory-planning/extra.txt"),
            "dependency",
        )
        .unwrap();
        assert!(inspect(folder.to_str().unwrap())
            .err()
            .unwrap()
            .contains("self-contained"));
    }
}
