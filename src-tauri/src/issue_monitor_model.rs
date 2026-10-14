//! Issue intake records are snapshots, never evidence that an agent started.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
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
