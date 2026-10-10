use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ProductLink {
    pub id: String,
    pub name: String,
    pub space: String,
    pub folder: String,
    pub repository: String,
    #[serde(default)]
    pub project_url: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionRecord {
    pub id: String,
    pub assistant: String,
    pub product_id: String,
    pub space: String,
    pub folder: String,
    pub title: String,
    pub status: String,
    pub started_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub ticket_url: String,
    #[serde(default)]
    pub conversation_url: String,
    #[serde(default)]
    pub step: String,
    #[serde(default)]
    pub blocker: String,
    #[serde(default)]
    pub next_action: String,
    #[serde(default)]
    pub checkpoints: Vec<Checkpoint>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Checkpoint {
    pub at: String,
    pub summary: String,
    #[serde(default)]
    pub evidence: Vec<String>,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub products: Vec<ProductLink>,
    pub config_raw: String,
    pub sessions: Vec<SessionRecord>,
    pub warnings: Vec<String>,
}

pub fn repository_valid(s: &str) -> bool {
    let parts: Vec<_> = s.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repositories_cannot_redirect_credentials_or_traverse() {
        assert!(repository_valid("d3velopm3nt/devdeck"));
        for bad in [
            "https://evil.test/x",
            "../x",
            "a/..",
            "a/b/c",
            "a/b?x",
            "/b",
        ] {
            assert!(!repository_valid(bad), "{bad}");
        }
    }
}

/// Only explicit versioned checkpoints from repository collaborators are activity.
/// Comment timestamps are authoritative; arbitrary prose and forged dates are ignored.
pub fn comment_sessions(
    repository: &str,
    rows: &[serde_json::Value],
) -> (Vec<SessionRecord>, Vec<String>) {
    let mut by_id: std::collections::BTreeMap<String, SessionRecord> = Default::default();
    let mut warnings = vec![];
    let mut comments = rows.to_vec();
    comments.sort_by_key(|v| v["created_at"].as_str().unwrap_or("").to_string());
    let mut seen = std::collections::HashSet::new();
    for v in comments {
        if let Some(id) = v["id"].as_u64() {
            if !seen.insert(id) {
                continue;
            }
        }
        let body = v["body"].as_str().unwrap_or("");
        if !body.starts_with("<!-- devdeck-session:v1 -->") {
            continue;
        }
        if !["OWNER", "MEMBER", "COLLABORATOR"]
            .contains(&v["author_association"].as_str().unwrap_or(""))
        {
            warnings.push("Ignored a session checkpoint from a non-collaborator.".into());
            continue;
        }
        let parsed = body
            .split_once("```json\n")
            .and_then(|(_, s)| s.split_once("\n```"))
            .and_then(|(s, _)| serde_json::from_str::<SessionRecord>(s).ok());
        let Some(mut record) = parsed else {
            warnings.push("Ignored an invalid GitHub session checkpoint.".into());
            continue;
        };
        let at = v["created_at"].as_str().unwrap_or("");
        let ticket = v["issue_url"].as_str().unwrap_or("");
        let prefix = format!("https://api.github.com/repos/{repository}/issues/");
        let Some(number) = ticket
            .strip_prefix(&prefix)
            .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        else {
            continue;
        };
        if record.id.is_empty()
            || record.id.len() > 100
            || !record
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            || record.assistant.trim().is_empty()
            || record.title.trim().is_empty()
            || ![
                "working",
                "planning",
                "waiting",
                "blocked",
                "reviewing",
                "completed",
                "failed",
                "idle",
            ]
            .contains(&record.status.as_str())
            || chrono::DateTime::parse_from_rfc3339(at).is_err()
        {
            warnings.push("Ignored a checkpoint with invalid identity or status.".into());
            continue;
        }
        record.id = format!("github:{repository}:{}", record.id);
        record.ticket_url = format!("https://github.com/{repository}/issues/{number}");
        record.started_at = at.into();
        record.updated_at = at.into();
        // One comment is one checkpoint. Never accept fabricated historical evidence.
        record.checkpoints = vec![Checkpoint {
            at: at.into(),
            summary: record.step.clone(),
            evidence: v["html_url"]
                .as_str()
                .map(|s| vec![s.into()])
                .unwrap_or_default(),
        }];
        if let Some(previous) = by_id.get(&record.id) {
            // Session identity cannot be hijacked to a different issue or assistant.
            if previous.ticket_url != record.ticket_url || previous.assistant != record.assistant {
                warnings.push("Ignored a checkpoint that changed its session identity.".into());
                continue;
            }
            record.started_at = previous.started_at.clone();
            let mut history = previous.checkpoints.clone();
            history.extend(record.checkpoints);
            record.checkpoints = history;
        }
        by_id.insert(record.id.clone(), record);
    }
    (by_id.into_values().collect(), warnings)
}

#[cfg(test)]
mod comment_tests {
    use super::*;
    use serde_json::{json, Value};
    fn comment(id: u64, at: &str, status: &str) -> Value {
        let record = json!({"id":"session-a","assistant":"Fixture assistant","product_id":"","space":"","folder":"","title":"Build a task","status":status,"started_at":"2099-01-01T00:00:00Z","updated_at":"2099-01-01T00:00:00Z","step":status});
        json!({"id":id,"body":format!("<!-- devdeck-session:v1 -->\n```json\n{record}\n```"),"author_association":"COLLABORATOR","created_at":at,"issue_url":"https://api.github.com/repos/acme/demo/issues/7","html_url":format!("https://github.com/acme/demo/issues/7#issuecomment-{id}")})
    }
    #[test]
    fn newest_checkpoint_wins_and_github_dates_are_authoritative() {
        let (sessions, warnings) = comment_sessions(
            "acme/demo",
            &[
                comment(2, "2026-10-10T11:00:00Z", "reviewing"),
                comment(1, "2026-10-10T10:00:00Z", "working"),
            ],
        );
        assert!(warnings.is_empty());
        let s = &sessions[0];
        assert_eq!(s.id, "github:acme/demo:session-a");
        assert_eq!(s.status, "reviewing");
        assert_eq!(s.started_at, "2026-10-10T10:00:00Z");
        assert_eq!(s.updated_at, "2026-10-10T11:00:00Z");
        assert_eq!(s.checkpoints.len(), 2);
        assert_eq!(s.ticket_url, "https://github.com/acme/demo/issues/7");
    }
    #[test]
    fn unmarked_untrusted_malformed_and_cross_repo_comments_are_ignored() {
        let good = comment(1, "2026-10-10T10:00:00Z", "working");
        let mut unmarked = good.clone();
        unmarked["body"] = json!("Ordinary progress comment");
        let mut untrusted = good.clone();
        untrusted["id"] = json!(2);
        untrusted["author_association"] = json!("NONE");
        let mut malformed = good.clone();
        malformed["id"] = json!(3);
        malformed["body"] = json!("<!-- devdeck-session:v1 -->\n```json\n{}\n```");
        let mut cross = good.clone();
        cross["id"] = json!(4);
        cross["issue_url"] = json!("https://api.github.com/repos/other/repo/issues/7");
        let (sessions, warnings) =
            comment_sessions("acme/demo", &[unmarked, untrusted, malformed, cross]);
        assert!(sessions.is_empty());
        assert_eq!(warnings.len(), 2);
    }
    #[test]
    fn a_session_cannot_move_to_another_issue() {
        let good = comment(1, "2026-10-10T10:00:00Z", "working");
        let mut moved = comment(2, "2026-10-10T11:00:00Z", "completed");
        moved["issue_url"] = json!("https://api.github.com/repos/acme/demo/issues/8");
        let (sessions, warnings) = comment_sessions("acme/demo", &[good, moved]);
        assert_eq!(sessions[0].status, "working");
        assert_eq!(warnings.len(), 1);
    }
}
