//! Issue intake records are snapshots, never evidence that an agent started.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    #[serde(default)]
    pub bindings: Vec<Binding>,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Source {
    pub repository: String,
    pub items: Vec<Value>,
    pub fetched_at: String,
    pub last_attempt: String,
    pub error: String,
    pub warnings: Vec<String>,
    pub truncated: bool,
}
pub fn normalize(items: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|i| {
            i["pull_request"].as_bool() != Some(true)
                && i["number"]
                    .as_u64()
                    .is_some_and(|n| n > 0 && seen.insert(n))
        })
        .collect()
}
pub fn due(last_attempt: &str, now: i64) -> bool {
    chrono::DateTime::parse_from_rfc3339(last_attempt)
        .map(|t| now.saturating_sub(t.timestamp()) >= 60)
        .unwrap_or(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn repeats_are_one_issue_and_prs_are_not_intake() {
        let rows = normalize(vec![
            json!({"number":23}),
            json!({"number":23}),
            json!({"number":24,"pull_request":true}),
            json!({"number":0}),
            json!({"number":25}),
        ]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["number"], 23);
        assert_eq!(rows[1]["number"], 25);
    }
    #[test]
    fn polls_are_bounded_and_restart_uses_saved_attempt() {
        let at = "2026-10-14T18:00:00Z";
        let epoch = chrono::DateTime::parse_from_rfc3339(at)
            .unwrap()
            .timestamp();
        assert!(!due(at, epoch + 59));
        assert!(due(at, epoch + 60));
        assert!(!due(at, epoch - 1));
        assert!(due("", epoch));
    }
}

/// An explicit repository-to-folder assignment authorizes automatic intake.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub repository: String,
    pub node: i64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Dispatch {
    pub repository: String,
    pub number: u64,
    pub node: i64,
    pub workflow: String,
    pub status: String,
    pub message: String,
}

pub fn dispatchable(issue: &Value) -> bool {
    issue["state"].as_str() == Some("open")
        && issue["number"].as_u64().is_some_and(|n| n > 0)
        && issue["pull_request"].as_bool() != Some(true)
}

pub fn selected_template(raw: &str, allowed: &[String]) -> Result<String, String> {
    let value: Value =
        serde_json::from_str(raw.trim()).map_err(|_| "Dev did not return a workflow selection")?;
    let id = value["workflow"]
        .as_str()
        .ok_or("Dev found no suitable workflow")?;
    if !allowed.iter().any(|candidate| candidate == id) {
        return Err("Dev selected a workflow outside the configured folder".into());
    }
    Ok(id.into())
}

#[cfg(test)]
mod dispatch_tests {
    use super::*;
    #[test]
    fn selection_cannot_escape_the_offered_templates() {
        let allowed = vec!["technical".into()];
        assert_eq!(
            selected_template(r#"{"workflow":"technical"}"#, &allowed).unwrap(),
            "technical"
        );
        assert!(selected_template(r#"{"workflow":"../other"}"#, &allowed).is_err());
        assert!(selected_template(r#"{"workflow":null}"#, &allowed).is_err());
        assert!(selected_template("start shell", &allowed).is_err());
    }
    #[test]
    fn only_open_issues_dispatch_and_old_config_stays_read_only() {
        assert!(dispatchable(
            &serde_json::json!({"number":1,"state":"open"})
        ));
        assert!(!dispatchable(
            &serde_json::json!({"number":1,"state":"closed"})
        ));
        assert!(!dispatchable(
            &serde_json::json!({"number":1,"state":"open","pull_request":true})
        ));
        let cfg: Config = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(cfg.bindings.is_empty());
    }
}

/// A durable selection claim is never silently replayed after interruption.
pub fn may_select(record: &Dispatch) -> bool {
    record.workflow.is_empty() && record.status == "pending"
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test]
    fn persisted_claim_and_completed_route_are_not_selected_twice() {
        let mut record = Dispatch {
            repository: "owner/repo".into(),
            number: 23,
            node: 7,
            status: "pending".into(),
            ..Default::default()
        };
        assert!(may_select(&record));
        record.status = "selecting".into();
        let restored: Dispatch =
            serde_json::from_str(&serde_json::to_string(&record).unwrap()).unwrap();
        assert!(!may_select(&restored));
        record.status = "blocked".into();
        assert!(!may_select(&record));
        record.status = "pending".into(); // explicit retry
        assert!(may_select(&record));
        record.workflow = "issue-stable-23".into();
        assert!(!may_select(&record));
    }
}
