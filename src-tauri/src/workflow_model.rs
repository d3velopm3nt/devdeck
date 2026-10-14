//! Durable workflow schema and dependency rules, independent of native UI.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn workflow_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
    {
        return Err("Workflow IDs use lowercase letters, numbers, - or _.".into());
    }
    let p = if id == "default" {
        dir.join("WORKFLOW.md")
    } else {
        dir.join(".devdeck/workflows").join(format!("{id}.md"))
    };
    // Existing symlinks must not redirect a workflow outside its folder.
    let base = dir.canonicalize().map_err(|e| e.to_string())?;
    let mut ancestor = p.as_path();
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or("Invalid workflow path")?;
    }
    if !ancestor
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(base)
    {
        return Err("Workflow path leaves its folder.".into());
    }
    Ok(p)
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub title: String,
    #[serde(default)]
    pub team: String,
    #[serde(default)]
    pub ticket_url: String,
    pub steps: Vec<Step>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub worker: String,
    /// Existing target node, never a path guessed from the workflow's location.
    pub target: i64,
    #[serde(default)]
    pub needs: Vec<String>,
    pub instructions: String,
    #[serde(default)]
    pub status: Status,
    #[serde(default)]
    pub claim: String,
    #[serde(default)]
    pub run: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default)]
    pub previous_runs: Vec<String>,
    /// Portable progress from an assistant working outside the desktop runtime.
    #[serde(default)]
    pub actor: String,
    #[serde(default)]
    pub next_action: String,
    #[serde(default)]
    pub updated_at: String,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Pending,
    Starting,
    Running,
    Review,
    Done,
    Blocked,
}
pub(crate) fn validate(d: &Definition) -> Result<(), String> {
    if d.title.trim().is_empty() || d.steps.is_empty() || d.steps.len() > 100 {
        return Err("Give the workflow a title and between 1 and 100 steps.".into());
    }
    let mut ids = HashSet::new();
    for s in &d.steps {
        if s.id.is_empty()
            || !s
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            || !ids.insert(s.id.as_str())
        {
            return Err("Step IDs must be unique words using letters, numbers, - or _.".into());
        }
        if s.title.trim().is_empty()
            || (s.worker.trim().is_empty() && (s.role.is_empty() || d.team.is_empty()))
            || s.target <= 0
            || s.instructions.trim().is_empty()
        {
            return Err(format!(
                "{} needs a title, worker, target node and instructions.",
                s.id
            ));
        }
    }
    let mut visited = HashSet::new();
    loop {
        let before = visited.len();
        for s in &d.steps {
            if s.needs.iter().any(|n| !ids.contains(n.as_str())) {
                return Err(format!("{} names a dependency that does not exist.", s.id));
            }
            if s.needs.iter().all(|n| visited.contains(n.as_str())) {
                visited.insert(s.id.as_str());
            }
        }
        if visited.len() == d.steps.len() {
            return Ok(());
        }
        if before == visited.len() {
            return Err("Workflow dependencies contain a cycle.".into());
        }
    }
}
pub(crate) fn ready(d: &Definition, index: usize) -> bool {
    let s = &d.steps[index];
    matches!(s.status, Status::Pending | Status::Blocked)
        && s.needs.iter().all(|id| {
            d.steps
                .iter()
                .any(|x| x.id == *id && x.status == Status::Done)
        })
}
pub(crate) fn receipt_status(status: &str, ok: bool) -> Status {
    match status {
        "running" => Status::Running,
        "done" | "kept" if ok => Status::Review,
        _ => Status::Blocked,
    }
}
/// External work never bypasses dependency or live-run ownership gates.
pub(crate) fn checkpoint(
    d: &mut Definition,
    id: &str,
    actor: &str,
    evidence: &str,
    next_action: &str,
    submit: bool,
) -> Result<(), String> {
    if actor.trim().is_empty() || evidence.trim().is_empty() || next_action.trim().is_empty() {
        return Err("Record the assistant, progress evidence and next action.".into());
    }
    let i = d
        .steps
        .iter()
        .position(|s| s.id == id)
        .ok_or("Step not found.")?;
    if !ready(d, i) {
        return Err("This step is already claimed or its dependencies are not accepted.".into());
    }
    let s = &mut d.steps[i];
    if !s.run.is_empty() {
        s.previous_runs.push(std::mem::take(&mut s.run));
    }
    s.claim.clear();
    s.actor = actor.trim().into();
    s.evidence = evidence.trim().into();
    s.next_action = next_action.trim().into();
    s.updated_at = chrono::Utc::now().to_rfc3339();
    s.status = if submit {
        Status::Review
    } else {
        Status::Blocked
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn definition() -> Definition {
        Definition {
            title: "Ship".into(),
            ticket_url: String::new(),
            team: String::new(),
            steps: vec![
                Step {
                    id: "build".into(),
                    title: "Build".into(),
                    worker: "builder".into(),
                    target: 1,
                    instructions: "Build and test".into(),
                    ..Default::default()
                },
                Step {
                    id: "docs".into(),
                    title: "Docs".into(),
                    worker: "writer".into(),
                    target: 1,
                    instructions: "Document accepted output".into(),
                    needs: vec!["build".into()],
                    ..Default::default()
                },
            ],
        }
    }
    #[test]
    fn external_handoff_keeps_dependencies_and_live_claims() {
        let mut d = definition();
        assert!(checkpoint(&mut d, "docs", "Claude", "Draft", "Verify", true).is_err());
        assert!(checkpoint(&mut d, "build", "", "Draft", "Verify", true).is_err());
        checkpoint(
            &mut d,
            "build",
            "ChatGPT",
            "Commit abc; tests passed",
            "Review output",
            true,
        )
        .unwrap();
        assert_eq!(d.steps[0].status, Status::Review);
        assert!(!ready(&d, 1));
        d.steps[0].status = Status::Done;
        checkpoint(
            &mut d,
            "docs",
            "Claude",
            "Partial guide",
            "Add screenshots",
            false,
        )
        .unwrap();
        assert_eq!(d.steps[1].status, Status::Blocked);
        assert_eq!(d.steps[1].next_action, "Add screenshots");
        d.steps[1].status = Status::Running;
        assert!(checkpoint(&mut d, "docs", "ChatGPT", "Changed", "Continue", true).is_err());
    }
    #[test]
    fn review_is_not_dependency_completion() {
        let mut d = definition();
        assert!(ready(&d, 0));
        assert!(!ready(&d, 1));
        for status in [
            Status::Starting,
            Status::Running,
            Status::Review,
            Status::Blocked,
        ] {
            d.steps[0].status = status;
            assert!(!ready(&d, 1));
        }
        d.steps[0].status = Status::Done;
        assert!(ready(&d, 1));
        d.steps[1].status = Status::Running;
        assert!(!ready(&d, 1));
    }
    #[test]
    fn rejects_cycles_missing_and_duplicate_ids() {
        let mut d = definition();
        assert!(validate(&d).is_ok());
        d.steps[0].needs.push("docs".into());
        assert!(validate(&d).is_err());
        d.steps[0].needs = vec!["missing".into()];
        assert!(validate(&d).is_err());
        d.steps[0].needs.clear();
        d.steps[1].id = "build".into();
        assert!(validate(&d).is_err());
    }
    #[test]
    fn failures_and_interruptions_never_unlock_work() {
        for status in [
            "failed",
            "interrupted",
            "stopped",
            "blocked",
            "discarded",
            "unknown",
        ] {
            assert_eq!(receipt_status(status, true), Status::Blocked);
        }
        assert_eq!(receipt_status("done", false), Status::Blocked);
        assert_eq!(receipt_status("done", true), Status::Review);
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;
    #[test]
    fn workflows_share_a_folder_without_sharing_receipts() {
        let dir = std::env::temp_dir().join(format!("workflow-paths-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mobile = workflow_path(&dir, "mobile-release").unwrap();
        let web = workflow_path(&dir, "web-release").unwrap();
        assert_ne!(mobile, web);
        assert_eq!(
            workflow_path(&dir, "default").unwrap(),
            dir.join("WORKFLOW.md")
        );
        for id in ["", "../escape", "a/b", "C:\\file", "A", ".", ".."] {
            assert!(workflow_path(&dir, id).is_err(), "{id}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_redirect_workflow_storage() {
        let dir = std::env::temp_dir().join(format!("workflow-links-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(std::env::temp_dir(), dir.join(".devdeck")).unwrap();
        assert!(workflow_path(&dir, "mobile").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

/// Instantiate a reusable definition without copying ownership or prior receipts.
pub fn for_ticket(
    template: &Definition,
    repository: &str,
    number: u64,
    title: &str,
) -> Result<Definition, String> {
    if !crate::visibility_model::repository_valid(repository)
        || number == 0
        || title.trim().is_empty()
        || title.len() > 1000
    {
        return Err("Choose a valid GitHub issue.".into());
    }
    let mut definition = template.clone();
    definition.title = format!("#{number} · {}", title.trim());
    definition.ticket_url = format!("https://github.com/{repository}/issues/{number}");
    for step in &mut definition.steps {
        step.status = Status::Pending;
        step.run.clear();
        step.claim.clear();
        step.evidence.clear();
        step.previous_runs.clear();
        step.actor.clear();
        step.next_action.clear();
        step.updated_at.clear();
    }
    validate(&definition)?;
    Ok(definition)
}
#[cfg(test)]
mod ticket_tests {
    use super::*;
    #[test]
    fn a_new_ticket_never_inherits_completed_work_or_permissions_from_a_receipt() {
        let template = Definition {
            title: "Technical".into(),
            steps: vec![Step {
                id: "plan".into(),
                title: "Plan".into(),
                worker: "lead".into(),
                target: 1,
                instructions: "Plan".into(),
                status: Status::Done,
                run: "old-run".into(),
                evidence: "old evidence".into(),
                previous_runs: vec!["older".into()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let run = for_ticket(&template, "owner/repo", 23, "Orb test").unwrap();
        assert_eq!(run.ticket_url, "https://github.com/owner/repo/issues/23");
        assert_eq!(run.steps[0].status, Status::Pending);
        assert!(
            run.steps[0].run.is_empty()
                && run.steps[0].evidence.is_empty()
                && run.steps[0].previous_runs.is_empty()
        );
        assert_eq!(template.steps[0].status, Status::Done);
        assert!(for_ticket(&template, "../repo", 23, "Orb").is_err());
    }
}
