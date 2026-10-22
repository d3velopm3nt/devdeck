//! Shared GitHub repository API mechanics; credentials remain owned by github.rs.
use serde_json::Value;
use std::{
    process::{Command, Stdio},
    time::Duration,
};

pub fn guarded_request<T>(
    method: &str,
    guard: impl FnOnce(&str) -> Result<(), String>,
    request: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let capability = match method {
        "GET" | "HEAD" => "repository.read",
        "POST" | "PATCH" | "PUT" | "DELETE" => "repository.write",
        _ => return Err("Unsupported GitHub method".into()),
    };
    guard(capability)?;
    request()
}
pub fn request(
    endpoint: &str,
    method: &str,
    body: Option<Value>,
    timeout: Duration,
) -> Result<Value, String> {
    guarded_request(
        method,
        |cap| crate::connector_policy::runtime_check("github:global", cap, None, None),
        || {
            let token = crate::github::stored_token();
            send(endpoint, method, body, timeout, token.as_deref())
        },
    )
}
pub fn request_with_token(endpoint: &str, timeout: Duration, token: &str) -> Result<Value, String> {
    guarded_request(
        "GET",
        |cap| crate::connector_policy::runtime_check("github:global", cap, None, None),
        || send(endpoint, "GET", None, timeout, Some(token)),
    )
}
fn send(
    endpoint: &str,
    method: &str,
    body: Option<Value>,
    timeout: Duration,
    token: Option<&str>,
) -> Result<Value, String> {
    if endpoint.starts_with('/')
        || endpoint.contains("://")
        || endpoint.chars().any(|c| c.is_control())
    {
        return Err("Invalid GitHub API endpoint".into());
    }
    if let Some(token) = token {
        let client = reqwest::blocking::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("DevDeck")
            .build()
            .map_err(|_| "Cannot initialize GitHub transport")?;
        let mut request = client
            .request(
                reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Invalid method")?,
                format!("https://api.github.com/{endpoint}"),
            )
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .map_err(|_| "GitHub request failed or timed out")?;
        if !response.status().is_success() {
            return Err(format!(
                "GitHub returned {}. Check account permissions or rate limits.",
                response.status().as_u16()
            ));
        }
        response
            .json()
            .map_err(|_| "GitHub returned unreadable data".into())
    } else {
        let mut command = Command::new("gh");
        command
            .args([
                "api",
                "--hostname",
                "github.com",
                endpoint,
                "--method",
                method,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        if let Some(body) = body {
            command.args(["--input", "-"]);
            // Existing bounded process helper owns spawn/wait. Input is a private temporary
            // pipe; never put issue text or credentials in process arguments.
            let bytes = crate::github_issue_read::command_output_with_input(
                &mut command,
                timeout,
                Some(body.to_string().into_bytes()),
            )?;
            return serde_json::from_slice(&bytes)
                .map_err(|_| "GitHub CLI returned unreadable data".into());
        }
        let bytes = crate::github_issue_read::command_output(&mut command, timeout)?;
        serde_json::from_slice(&bytes).map_err(|_| "GitHub CLI returned unreadable data".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connector_github_denies_before_credentials_or_transport() {
        let calls = std::cell::Cell::new(0);
        let result = guarded_request(
            "GET",
            |_| Err("paused".into()),
            || {
                calls.set(calls.get() + 1);
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(calls.get(), 0);
        assert_eq!(
            guarded_request(
                "GET",
                |cap| {
                    assert_eq!(cap, "repository.read");
                    Ok(())
                },
                || Ok(7)
            )
            .unwrap(),
            7
        );
        assert!(guarded_request(
            "PATCH",
            |cap| {
                assert_eq!(cap, "repository.write");
                Err("restricted".into())
            },
            || Ok(())
        )
        .is_err());
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[test]
    fn connector_github_lifecycle_blocks_read_and_write_without_changing_owner_data() {
        use crate::connector_policy::{self as policy, Control};
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE settings(key TEXT,value TEXT);INSERT INTO settings VALUES('github','credential-reference')").unwrap();
        let calls = std::cell::Cell::new(0);
        let request = |method| {
            guarded_request(
                method,
                |cap| policy::check(&db, "github:global", cap, None, None),
                || {
                    calls.set(calls.get() + 1);
                    Ok(())
                },
            )
        };
        request("GET").unwrap();
        let mut control = Control {
            key: "github:global".into(),
            state: "paused".into(),
            ..Default::default()
        };
        policy::save(&db, control.clone(), 0).unwrap();
        assert!(request("GET").is_err());
        assert!(request("PATCH").is_err());
        control.state = "disconnected".into();
        policy::save(&db, control.clone(), 1).unwrap();
        assert!(request("GET").is_err());
        control.state = "active".into();
        policy::save(&db, control, 2).unwrap();
        request("PATCH").unwrap();
        assert_eq!(calls.get(), 2);
        assert_eq!(
            db.query_row("SELECT value FROM settings", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "credential-reference"
        );
    }
}
