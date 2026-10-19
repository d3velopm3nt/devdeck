//! Explicit issue completion; local completion never implies remote success.
use serde_json::{json, Value};
use std::{process::{Command, Stdio}, time::Duration};

pub(crate) fn issue(url: &str) -> Result<(String, u64), String> {
    let path = url.strip_prefix("https://github.com/").ok_or("Use a GitHub issue URL.")?;
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 4 || parts[2] != "issues" {
        return Err("The linked source must be a GitHub issue, not a pull request.".into());
    }
    let repo = format!("{}/{}", parts[0], parts[1]);
    let number = parts[3].parse::<u64>().map_err(|_| "Invalid issue number.")?;
    if !crate::visibility_model::repository_valid(&repo) || number == 0 {
        return Err("Invalid GitHub issue reference.".into());
    }
    Ok((repo, number))
}

fn close_with(number: u64, mut request: impl FnMut(bool) -> Result<Value, String>) -> Result<(), String> {
    let before = request(false)?;
    if before["number"].as_u64() != Some(number) || before.get("pull_request").is_some() {
        return Err("GitHub did not return the linked issue; nothing was closed.".into());
    }
    if before["state"] == "closed" { return Ok(()); }
    request(true)?;
    let after = request(false)?;
    if after["number"].as_u64() != Some(number) || after["state"] != "closed" {
        return Err("GitHub closure is not confirmed. Retry issue sync.".into());
    }
    Ok(())
}

pub(crate) fn close(url: &str) -> Result<(), String> {
    let (repo, number) = issue(url)?;
    let endpoint = format!("repos/{repo}/issues/{number}");
    let token = crate::github::stored_token();
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none()).user_agent("DevDeck").build()
        .map_err(|_| "Could not initialize GitHub connection.")?;
    close_with(number, |patch| {
        if let Some(token) = &token {
            let url = format!("https://api.github.com/{endpoint}");
            let req = if patch { client.patch(url).json(&json!({"state":"closed", "state_reason":"completed"})) } else { client.get(url) };
            let response = req.bearer_auth(token).header("Accept", "application/vnd.github+json").send()
                .map_err(|_| "GitHub connection failed. Retry issue sync.")?;
            if !response.status().is_success() { return Err(format!("GitHub rejected issue sync ({}). Check repository write access.", response.status().as_u16())); }
            response.json().map_err(|_| "GitHub returned an unreadable issue.".into())
        } else {
            let mut command = Command::new("gh");
            command.args(["api", &endpoint, "--method", if patch { "PATCH" } else { "GET" }]);
            if patch { command.args(["-f", "state=closed", "-f", "state_reason=completed"]); }
            command.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
            #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
            let bytes = crate::github_issue_read::command_output(&mut command, Duration::from_secs(15))?;
            serde_json::from_slice(&bytes).map_err(|_| "GitHub returned an unreadable issue.".into())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_other_hosts_pull_requests_and_extra_paths() {
        for url in ["https://evil.test/a/b/issues/1", "https://github.com/a/b/pull/1", "https://github.com/a/b/issues/1/extra", "https://github.com/a/b/issues/0"] { assert!(issue(url).is_err()); }
        assert_eq!(issue("https://github.com/a/b/issues/37").unwrap(), ("a/b".into(),37));
    }
    #[test]
    fn closure_is_verified_and_retries_are_idempotent() {
        let mut calls = vec![];
        close_with(37, |patch| { calls.push(patch); Ok(json!({"number":37,"state":if calls.len() > 1 {"closed"} else {"open"}})) }).unwrap();
        assert_eq!(calls, [false,true,false]);
        let mut writes = 0;
        close_with(37, |patch| { if patch {writes+=1}; Ok(json!({"number":37,"state":"closed"})) }).unwrap();
        assert_eq!(writes,0);
        assert!(close_with(37, |_| Ok(json!({"number":37,"state":"open"}))).is_err());
        assert!(close_with(37, |_| Ok(json!({"number":37,"state":"open","pull_request":{}}))).is_err());
    }
}
