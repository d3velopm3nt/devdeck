//! Bounded Activity reads. Optional checkpoint comments never discard issues.
use crate::visibility_model::{comment_sessions, repository_valid, SessionRecord};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::Read,
    process::Command,
    sync::mpsc,
    time::{Duration, Instant},
};

// The UI's 20-second deadline leaves five seconds for IPC and serialization.
pub const READ_BUDGET: Duration = Duration::from_secs(15);
const COMMENT_REQUEST_LIMIT: Duration = Duration::from_secs(3);

#[derive(Serialize)]
pub struct IssueSnapshot {
    pub items: Vec<Value>,
    pub fetched_at: String,
    pub truncated: bool,
    pub sessions: Vec<SessionRecord>,
    pub warnings: Vec<String>,
}

pub fn read(
    repository: &str,
    budget: Duration,
    mut fetch: impl FnMut(&str, Duration) -> Result<Value, String>,
) -> Result<IssueSnapshot, String> {
    if !repository_valid(repository) {
        return Err("Use owner/repository.".into());
    }
    let started = Instant::now();
    let remaining = || {
        budget
            .checked_sub(started.elapsed())
            .filter(|d| !d.is_zero())
    };
    let mut items = Vec::new();
    let mut warnings = Vec::new();
    let mut truncated = false;
    for page in 1..=5 {
        let Some(timeout) = remaining() else {
            if items.is_empty() {
                return Err("GitHub issue read timed out before any issues were received. Retry the connection check.".into());
            }
            truncated = true;
            warnings
                .push("Issue pagination timed out. Showing the issues already received.".into());
            break;
        };
        let endpoint =
            format!("repos/{repository}/issues?state=all&sort=updated&per_page=100&page={page}");
        let value = match fetch(&endpoint, timeout) {
            Ok(value) => value,
            Err(e) if !items.is_empty() => {
                truncated = true;
                warnings.push(format!(
                    "Issue pagination incomplete; showing received issues: {e}"
                ));
                break;
            }
            Err(e) => return Err(e),
        };
        let rows = value
            .as_array()
            .ok_or("GitHub returned unreadable issues.")?;
        items.extend(rows.iter().map(|v| json!({
            "number":v["number"], "title":v["title"], "state":v["state"],
            "url":v["html_url"], "updated_at":v["updated_at"],
            "assignees":v["assignees"].as_array().map(|a| a.iter().filter_map(|a| a["login"].as_str()).collect::<Vec<_>>()).unwrap_or_default(),
            "pull_request":v.get("pull_request").is_some()
        })));
        if rows.len() < 100 {
            break;
        }
        if page == 5 {
            truncated = true;
            warnings
                .push("Issue history is limited to the 500 most recently updated items.".into());
        }
    }

    let mut comments = Vec::new();
    for page in 1..=5 {
        let Some(timeout) = remaining() else {
            warnings.push("Issues loaded; checkpoint comment refresh timed out. Previous session records are retained.".into());
            break;
        };
        let endpoint = format!("repos/{repository}/issues/comments?sort=created&direction=desc&per_page=100&page={page}");
        match fetch(&endpoint, timeout.min(COMMENT_REQUEST_LIMIT)) {
            Ok(value) => {
                let Some(rows) = value.as_array() else {
                    warnings.push(
                        "Issues loaded; GitHub returned unreadable checkpoint comments.".into(),
                    );
                    break;
                };
                comments.extend(rows.iter().cloned());
                if rows.len() < 100 {
                    break;
                }
                if page == 5 {
                    warnings.push(
                        "Session history is limited to the 500 latest repository comments.".into(),
                    );
                }
            }
            Err(e) => {
                warnings.push(format!(
                    "Issues loaded; checkpoint comments could not be refreshed: {e}"
                ));
                break;
            }
        }
    }
    let (mut sessions, parse_warnings) = comment_sessions(repository, &comments);
    for session in &mut sessions {
        let number = session
            .ticket_url
            .rsplit('/')
            .next()
            .and_then(|n| n.parse::<u64>().ok());
        if let Some(item) = items
            .iter()
            .find(|item| item["number"].as_u64().is_some_and(|n| Some(n) == number))
        {
            if let Some(url) = item["url"].as_str() {
                session.ticket_url = url.into();
            }
        }
    }
    warnings.extend(parse_warnings);
    Ok(IssueSnapshot {
        items,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        truncated,
        sessions,
        warnings,
    })
}

/// Drain stdout concurrently (large pages exceed pipe capacity) and kill a
/// stalled CLI. No credentials are passed on its command line or in errors.
pub fn command_output(command: &mut Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|_| "Connect GitHub in Settings or sign in with gh first.".to_string())?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("GitHub CLI output unavailable.")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .read_to_end(&mut bytes)
            .map(|_| bytes)
            .map_err(|_| "GitHub CLI output could not be read.".to_string());
        let _ = tx.send(result);
    });
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err("GitHub CLI could not read the repository. Check sign-in and repository access.".into());
                }
                let remaining = timeout.saturating_sub(started.elapsed());
                return rx
                    .recv_timeout(remaining)
                    .map_err(|_| "GitHub CLI output timed out.".to_string())?;
            }
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("GitHub CLI status could not be read.".into());
            }
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("GitHub CLI request timed out. Check the connection and retry.".into());
        }
        std::thread::sleep(
            Duration::from_millis(10).min(timeout.saturating_sub(started.elapsed())),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn issue() -> Value {
        json!({"number":8,"title":"Activity","state":"open","html_url":"https://github.com/acme/app/issues/8","assignees":[]})
    }
    #[test]
    fn comment_failure_preserves_issues_and_is_a_warning() {
        let mut calls = Vec::new();
        let snapshot = read("acme/app", READ_BUDGET, |url, timeout| {
            calls.push((url.to_string(), timeout));
            if url.contains("/comments?") {
                Err("Network timed out".into())
            } else {
                Ok(json!([issue()]))
            }
        })
        .unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert!(snapshot.warnings[0].contains("Issues loaded"));
        assert!(calls[1].1 <= COMMENT_REQUEST_LIMIT);
    }
    #[test]
    fn first_issue_auth_failure_remains_an_error() {
        let error = read("acme/app", READ_BUDGET, |_, _| {
            Err("GitHub returned 401".into())
        })
        .err()
        .unwrap();
        assert!(error.contains("401"));
    }
    #[test]
    fn later_issue_page_failure_keeps_partial_results() {
        let mut calls = 0;
        let snapshot = read("acme/app", READ_BUDGET, |_, _| {
            calls += 1;
            match calls {
                1 => Ok(Value::Array(vec![issue(); 100])),
                2 => Err("timeout".into()),
                _ => Ok(json!([])),
            }
        })
        .unwrap();
        assert_eq!(snapshot.items.len(), 100);
        assert!(snapshot.truncated);
        assert!(snapshot.warnings[0].contains("pagination incomplete"));
    }
    #[test]
    fn malformed_comments_do_not_hide_the_issue_list() {
        let snapshot = read("acme/app", READ_BUDGET, |url, _| {
            if url.contains("/comments?") {
                Ok(json!({}))
            } else {
                Ok(json!([issue()]))
            }
        })
        .unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert!(snapshot.warnings[0].contains("unreadable checkpoint"));
    }
    #[test]
    fn exhausted_budget_never_starts_another_request() {
        assert!(read("acme/app", Duration::ZERO, |_, _| panic!(
            "No request allowed"
        ))
        .is_err());
    }
    #[cfg(unix)]
    #[test]
    fn cli_timeout_kills_the_stalled_process() {
        let mut command = Command::new("sh");
        command
            .args(["-c", "exec sleep 5"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let started = Instant::now();
        assert!(command_output(&mut command, Duration::from_millis(50))
            .unwrap_err()
            .contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[cfg(unix)]
    #[test]
    fn cli_large_output_is_drained_without_pipe_deadlock() {
        let mut command = Command::new("sh");
        command
            .args(["-c", "head -c 131072 /dev/zero"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        assert_eq!(
            command_output(&mut command, Duration::from_secs(2))
                .unwrap()
                .len(),
            131072
        );
    }
}
