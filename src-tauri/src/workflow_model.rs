//! Durable workflow schema and dependency rules, independent of native UI.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub title: String,
    pub steps: Vec<Step>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub id: String,
    pub title: String,
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
            || s.worker.trim().is_empty()
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
#[cfg(test)]
mod tests {
    use super::*;
    fn definition() -> Definition {
        Definition {
            title: "Ship".into(),
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
