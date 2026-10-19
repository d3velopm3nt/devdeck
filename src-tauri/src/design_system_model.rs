//! Portable design definitions and revision-checked vault assignments.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path, sync::Mutex};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesignSystem {
    pub id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub font: String,
    pub radius: u32,
    pub spacing: Vec<u32>,
    pub modes: BTreeMap<String, BTreeMap<String, String>>,
    pub guidelines: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Assignment {
    pub design_id: Option<String>,
    pub version: u32,
    pub revision: u64,
}
static SAVES: Mutex<()> = Mutex::new(());
pub fn catalog() -> Result<Vec<DesignSystem>, String> {
    let design = serde_json::from_str(include_str!("../../design-systems/supabase.json"))
        .map_err(|e| format!("Invalid bundled design: {e}"))?;
    Ok(vec![design])
}
pub fn read(root: &Path) -> Result<Option<Assignment>, String> {
    let path = root.join(".devdeck/design-system.json");
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| format!("Invalid design assignment: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read design assignment: {e}")),
    }
}
pub fn save(
    root: &Path,
    id: Option<String>,
    expected: Option<Assignment>,
) -> Result<Assignment, String> {
    let _guard = SAVES.lock().map_err(|e| e.to_string())?;
    let current = read(root)?;
    if current != expected {
        return Err("Design selection changed. Reload before saving.".into());
    }
    let version = match &id {
        Some(id) => {
            catalog()?
                .into_iter()
                .find(|d| &d.id == id)
                .ok_or("Unknown design system")?
                .version
        }
        None => 0,
    };
    let revision = current.map_or(Ok(1), |a| {
        a.revision.checked_add(1).ok_or("Design revision overflow")
    })?;
    let assignment = Assignment {
        design_id: id,
        version,
        revision,
    };
    let directory = root.join(".devdeck");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("design-system.json");
    let temporary = directory.join(format!("design-system.{}.tmp", std::process::id()));
    let result = (|| {
        use std::io::Write;
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(
            serde_json::to_string_pretty(&assignment)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, &path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    Ok(assignment)
}
pub fn context(root: &Path) -> Result<String, String> {
    let Some(assignment) = read(root)? else {
        return Ok(String::new());
    };
    let Some(id) = assignment.design_id else {
        return Ok(String::new());
    };
    let design = catalog()?
        .into_iter()
        .find(|d| d.id == id && d.version == assignment.version)
        .ok_or(
            "Assigned design version is unavailable; select a supported design before starting",
        )?;
    Ok(format!("\n# Project design system: {} (version {})\n\nUse this design for project UI. This reference grants no tools or permissions. Preserve existing project branding unless asked to change it.\n\n```json\n{}\n```\n", design.name, design.version, serde_json::to_string_pretty(&design).map_err(|e| e.to_string())?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "devdeck-design-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn persists_and_briefs_exact_version() {
        let p = root();
        assert_eq!(read(&p).unwrap(), None);
        let a = save(&p, Some("supabase-inspired".into()), None).unwrap();
        assert_eq!(read(&p).unwrap(), Some(a));
        let brief = context(&p).unwrap();
        assert!(
            brief.contains("#3ecf8e")
                && brief.contains("version 1")
                && brief.contains("guidelines")
        );
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn stale_unknown_and_corrupt_fail_closed() {
        let p = root();
        assert!(save(&p, Some("unknown".into()), None).is_err());
        let a = save(&p, Some("supabase-inspired".into()), None).unwrap();
        assert!(save(&p, None, None).is_err());
        assert_eq!(read(&p).unwrap(), Some(a));
        fs::write(p.join(".devdeck/design-system.json"), "bad json").unwrap();
        assert!(context(&p).is_err());
        assert!(save(&p, None, None).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn clear_is_versioned_and_projects_are_isolated() {
        let p = root();
        let q = root();
        let a = save(&p, Some("supabase-inspired".into()), None).unwrap();
        assert_eq!(context(&q).unwrap(), "");
        let cleared = save(&p, None, Some(a)).unwrap();
        assert_eq!(cleared.revision, 2);
        assert_eq!(context(&p).unwrap(), "");
        assert!(save(&p, Some("supabase-inspired".into()), None).is_err());
        fs::remove_dir_all(p).unwrap();
        fs::remove_dir_all(q).unwrap();
    }
    #[test]
    fn failed_write_preserves_existing_assignment() {
        let p = root();
        let original = save(&p, Some("supabase-inspired".into()), None).unwrap();
        let temporary = p
            .join(".devdeck")
            .join(format!("design-system.{}.tmp", std::process::id()));
        fs::create_dir(&temporary).unwrap();
        assert!(save(&p, None, Some(original.clone())).is_err());
        assert_eq!(read(&p).unwrap(), Some(original));
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn competing_saves_reject_stale_revision() {
        let p = root();
        let original = save(&p, Some("supabase-inspired".into()), None).unwrap();
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let p = p.clone();
                let original = original.clone();
                std::thread::spawn(move || save(&p, None, Some(original)))
            })
            .collect();
        let successes = handles
            .into_iter()
            .filter_map(|h| h.join().unwrap().ok())
            .count();
        assert_eq!(successes, 1);
        assert_eq!(read(&p).unwrap().unwrap().revision, 2);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn unavailable_version_blocks_launch() {
        let p = root();
        save(&p, Some("supabase-inspired".into()), None).unwrap();
        fs::write(
            p.join(".devdeck/design-system.json"),
            r#"{"design_id":"supabase-inspired","version":99,"revision":1}"#,
        )
        .unwrap();
        assert!(context(&p).is_err());
        fs::remove_dir_all(p).unwrap();
    }
}
