//! GitHub sign-in via the OAuth **device flow**.
//!
//! Why the device flow and not a redirect: a desktop app has nowhere safe to
//! keep a client secret and no stable redirect URI. The device flow needs
//! neither — the `client_id` below is *public by design*, which is why it can
//! sit in this file and ship in the binary. There is no secret here to leak.
//!
//! The shape of it:
//!
//! 1. `github_device_start` asks GitHub for a pair of codes. The user sees the
//!    short `user_code`; the long `device_code` stays ours.
//! 2. The user types that code into github.com/login/device.
//! 3. `github_device_poll` asks GitHub, once per call, whether that has
//!    happened yet. The frontend drives the repeat so it can show a live
//!    countdown and let the user give up — a Rust-side sleep loop would block
//!    a worker for fifteen minutes and answer nothing in the meantime.
//!
//! Where the token ends up matters as much as getting it. Two places, both
//! deliberate:
//!
//!  * **Windows Credential Manager**, via `creds` — never SQLite, never a log,
//!    and never returned over IPC. The frontend learns *that* we have a token,
//!    never what it is.
//!  * **`gh`, when it is installed** — piped to `gh auth login --with-token`.
//!    Without this step signing in would light up our own chip while `git
//!    push` and every `gh` call stayed logged out, which is a worse lie than
//!    showing nothing at all.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::creds;

/// Credential Manager target for the GitHub OAuth token.
const CRED_TARGET: &str = "devdeck:github:oauth";

/// The OAuth App this build authenticates as.
///
/// **Not yet registered.** Create one at GitHub → Settings → Developer
/// settings → OAuth Apps → New OAuth App, tick **Enable Device Flow**, and
/// paste the client id here. It is public data — the device flow uses no
/// client secret — so committing it is correct and safe.
///
/// Until it is filled in, sign-in reports honestly that this build cannot do
/// it rather than failing with GitHub's opaque 404.
const CLIENT_ID: &str = "";

/// Scopes we ask for, and why each one is here:
///   repo      — read/write the private repos DevDeck already clones and pulls
///   read:org  — resolve org membership so org repos are listable
///   gist      — `gh gist`, and the share-a-snippet path from Stash
const SCOPES: &str = "repo read:org gist";

/// The client id for this run: the env var wins so a developer can point a
/// local build at their own OAuth App without editing the source.
fn client_id() -> String {
    match std::env::var("DEVDECK_GITHUB_CLIENT_ID") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => CLIENT_ID.trim().to_string(),
    }
}

/// Whether this build can start a device flow at all.
///
/// The frontend asks *before* offering the button, so an unconfigured build
/// says "this build has no OAuth app" instead of dead-ending in an error.
#[tauri::command]
pub fn github_oauth_configured() -> bool {
    !client_id().is_empty()
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// Percent-encode one form value.
///
/// Hand-rolled because reqwest's `.form()` needs a feature this build does not
/// enable, and the alternative — pasting values into a string raw — would
/// mangle `grant_type`, whose colons are not legal unencoded in a form body.
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `a=1&b=2`, every value encoded.
fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("DevDeck")
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

// ---------------------------------------------------------------------------
// Step 1 — ask for a code
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct DeviceStart {
    /// The short code the user types into GitHub, e.g. `WDJB-MJHT`.
    pub user_code: String,
    /// Ours, not theirs — the handle we poll with. Never shown.
    pub device_code: String,
    /// Where to send them. GitHub's own value, not one we compose.
    pub verification_uri: String,
    /// Seconds GitHub asks us to wait between polls.
    pub interval: u64,
    /// Seconds until the code dies.
    pub expires_in: u64,
}

#[tauri::command(async)]
pub async fn github_device_start() -> Result<DeviceStart, String> {
    tauri::async_runtime::spawn_blocking(device_start_blocking)
        .await
        .map_err(|e| format!("the sign-in task did not finish: {e}"))?
}

fn device_start_blocking() -> Result<DeviceStart, String> {
    let id = client_id();
    if id.is_empty() {
        return Err(
            "This build has no GitHub OAuth app configured, so it can't start a sign-in. \
             Register one and set its client id (see src-tauri/src/github.rs)."
                .into(),
        );
    }

    let res = http()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form(&[("client_id", id.as_str()), ("scope", SCOPES)]))
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;

    let status = res.status();
    let json: serde_json::Value = res
        .json()
        .map_err(|e| format!("GitHub returned something unreadable: {e}"))?;

    // GitHub answers a bad client_id with 200 + an `error` field as often as
    // with a 4xx, so the body is the authority, not the status code.
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(describe_error(err, &json));
    }
    if !status.is_success() {
        return Err(format!("GitHub refused the request ({status})"));
    }

    let s = |k: &str| {
        json.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let n = |k: &str, d: u64| json.get(k).and_then(|v| v.as_u64()).unwrap_or(d);

    let user_code = s("user_code");
    let device_code = s("device_code");
    if user_code.is_empty() || device_code.is_empty() {
        return Err("GitHub answered without a device code".into());
    }

    Ok(DeviceStart {
        user_code,
        device_code,
        verification_uri: {
            let v = s("verification_uri");
            if v.is_empty() {
                "https://github.com/login/device".into()
            } else {
                v
            }
        },
        // GitHub's documented floor is 5s; honour whatever it actually says.
        interval: n("interval", 5).max(1),
        expires_in: n("expires_in", 900),
    })
}

// ---------------------------------------------------------------------------
// Step 2 — poll, once per call
// ---------------------------------------------------------------------------

/// One poll's answer. `Pending` is the normal case and is not an error —
/// modelling it as one would make the frontend treat waiting as failure.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DevicePoll {
    /// Still waiting on the human. `interval` is the new floor if GitHub
    /// asked us to slow down.
    Pending { interval: u64 },
    /// Signed in. The token is already stored; it is deliberately not here.
    Done { login: String, gh: bool },
    /// Over — expired, denied, or refused. `retryable` says whether starting
    /// again is worth offering.
    Failed { message: String, retryable: bool },
}

#[tauri::command(async)]
pub async fn github_device_poll(device_code: String, interval: u64) -> Result<DevicePoll, String> {
    tauri::async_runtime::spawn_blocking(move || device_poll_blocking(device_code, interval))
        .await
        .map_err(|e| format!("the sign-in task did not finish: {e}"))?
}

fn device_poll_blocking(device_code: String, interval: u64) -> Result<DevicePoll, String> {
    let id = client_id();
    if id.is_empty() {
        return Ok(DevicePoll::Failed {
            message: "This build has no GitHub OAuth app configured.".into(),
            retryable: false,
        });
    }

    let res = http()?
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form(&[
            ("client_id", id.as_str()),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ]))
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;

    let json: serde_json::Value = res
        .json()
        .map_err(|e| format!("GitHub returned something unreadable: {e}"))?;

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Ok(match err {
            // The two that mean "keep going".
            "authorization_pending" => DevicePoll::Pending { interval },
            "slow_down" => DevicePoll::Pending {
                // GitHub sends a new interval with slow_down; obey it, and
                // never let it go backwards.
                interval: json
                    .get("interval")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(interval + 5)
                    .max(interval),
            },
            "expired_token" => DevicePoll::Failed {
                message: "That code expired. Start again for a fresh one.".into(),
                retryable: true,
            },
            "access_denied" => DevicePoll::Failed {
                message: "Sign-in was cancelled on GitHub.".into(),
                retryable: true,
            },
            other => DevicePoll::Failed {
                message: describe_error(other, &json),
                retryable: false,
            },
        });
    }

    let token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if token.is_empty() {
        return Ok(DevicePoll::Failed {
            message: "GitHub approved the sign-in but sent no token.".into(),
            retryable: true,
        });
    }

    // Confirm the token works and learn who it belongs to *before* storing it.
    // Storing first would leave a credential behind for an identity we failed
    // to establish.
    let login = whoami(token)?;

    creds::set(CRED_TARGET, &login, token)?;
    // Best effort: gh may not be installed, and that must not fail a sign-in
    // that otherwise worked.
    let gh = hand_token_to_gh(token);

    Ok(DevicePoll::Done { login, gh })
}

/// Turn GitHub's error slugs into something a person can act on.
fn describe_error(err: &str, json: &serde_json::Value) -> String {
    let described = json
        .get("error_description")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim();
    match err {
        "unauthorized_client" | "invalid_client" => {
            "GitHub rejected this app's client id. Check it is a real OAuth App with \
             Device Flow enabled."
                .into()
        }
        "device_flow_disabled" => {
            "This OAuth App has Device Flow turned off. Enable it in the app's settings \
             on GitHub."
                .into()
        }
        _ if !described.is_empty() => described.to_string(),
        _ => format!("GitHub refused the sign-in ({err})"),
    }
}

// ---------------------------------------------------------------------------
// The token, once we have it
// ---------------------------------------------------------------------------

/// Who a token belongs to. Also our proof it is usable at all.
fn whoami(token: &str) -> Result<String, String> {
    let res = http()?
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;

    if !res.status().is_success() {
        return Err(format!(
            "GitHub would not accept the new token ({})",
            res.status()
        ));
    }
    let json: serde_json::Value = res
        .json()
        .map_err(|e| format!("GitHub returned something unreadable: {e}"))?;
    let login = json
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if login.is_empty() {
        return Err("GitHub answered without a login".into());
    }
    Ok(login)
}

/// Give `gh` the same token, so one sign-in covers `git push` too.
///
/// Returns whether it took. A `false` here is not a failed sign-in — it means
/// the chip is authenticated and the CLI is not, which the UI says out loud
/// rather than papering over.
fn hand_token_to_gh(token: &str) -> bool {
    if !on_path("gh") {
        return false;
    }
    let mut cmd = Command::new("gh");
    cmd.args(["auth", "login", "--hostname", "github.com", "--with-token"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_window(&mut cmd);

    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    // The token goes down a pipe, never onto a command line — an argv is
    // readable by any process on the machine.
    if let Some(mut stdin) = child.stdin.take() {
        if writeln!(stdin, "{token}").is_err() {
            return false;
        }
    }
    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
    if ok {
        // Make git itself use gh's credentials, otherwise `git push` still
        // prompts. Failure here is not fatal — the token is already good.
        let mut setup = Command::new("gh");
        setup
            .args(["auth", "setup-git", "--hostname", "github.com"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        no_window(&mut setup);
        let _ = setup.status();
    }
    ok
}

fn on_path(binary: &str) -> bool {
    let mut cmd = Command::new("where");
    cmd.arg(binary)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// The other way in: a token pasted by hand
// ---------------------------------------------------------------------------
//
// The device flow needs a registered OAuth App, and this build has none
// (`CLIENT_ID` is empty). Until it does, a Personal Access Token typed into
// Settings is the whole of GitHub authentication here, so it is a real path
// and not a hidden fallback: same credential target, same `gh` hand-off, same
// promise that the frontend never learns the token back.
//
// The one thing it adds is SCOPES. A PAT is minted by a person ticking boxes,
// and the box they forget is `repo` -- which fails at the first private clone,
// a long way from the screen where the mistake was made. GitHub returns the
// granted scopes in a header on any authenticated request, so we read them at
// paste time and say what is missing while the user is still looking.

/// What a pasted token turned out to be.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct TokenPasted {
    /// The GitHub account the token belongs to.
    pub login: String,
    /// Whether `gh` took the same token. False means the chip is signed in
    /// and the CLI is not -- said out loud rather than papered over.
    pub gh: bool,
    /// Scopes GitHub reports for this token. Empty for a fine-grained token,
    /// which reports none at all -- see `scopes_known`.
    pub scopes: Vec<String>,
    /// Scopes we asked for that this token does not carry.
    pub missing: Vec<String>,
    /// Whether GitHub told us the scopes. A fine-grained PAT sends no
    /// `X-OAuth-Scopes` header, so "no scopes" and "not said" look identical
    /// and only one of them is worth warning about.
    pub scopes_known: bool,
}

/// Store a token the user pasted, after proving it works.
///
/// Validated first, always: writing an unusable token would light up every
/// signed-in surface in the app and fail at the first push. The token is
/// trimmed because a copy from GitHub's UI often brings whitespace, and a
/// leading space is an invisible reason for a 401.
#[tauri::command(async)]
pub async fn github_token_paste(token: String) -> Result<TokenPasted, String> {
    tauri::async_runtime::spawn_blocking(move || paste_blocking(&token))
        .await
        .map_err(|e| format!("the sign-in task did not finish: {e}"))?
}

fn paste_blocking(token: &str) -> Result<TokenPasted, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Paste a token first.".into());
    }
    // Not a format check -- GitHub owns that, and prefixes change. This only
    // catches the paste that obviously went wrong: a URL, a username, a
    // whole page of text.
    if token.contains(char::is_whitespace) {
        return Err(
            "That does not look like a token -- it has spaces in it. Copy just the token, \
             which is one unbroken line."
                .into(),
        );
    }

    let (login, scopes, scopes_known) = whoami_with_scopes(token)?;

    let missing = missing_scopes(SCOPES, &scopes);

    creds::set(CRED_TARGET, &login, token)?;
    let gh = hand_token_to_gh(token);

    Ok(TokenPasted {
        login,
        gh,
        scopes,
        // A fine-grained token reports nothing, so we have nothing to say is
        // missing. Guessing would warn every fine-grained token forever.
        missing: if scopes_known { missing } else { Vec::new() },
        scopes_known,
    })
}

/// Which of the scopes we want this token does not carry.
///
/// `repo` implies its children (`repo:status`, `repo_deployment`), and `admin:org`
/// implies `read:org` -- so a token minted with the broader box ticked is not
/// missing the narrower one, and saying it is would send people back to GitHub
/// to fix a token that already works.
fn missing_scopes(want: &str, have: &[String]) -> Vec<String> {
    fn covers(have: &str, need: &str) -> bool {
        if have == need {
            return true;
        }
        // `repo` is the parent of `repo:status`, `repo_deployment` and the rest.
        if have == "repo" && (need.starts_with("repo:") || need.starts_with("repo_")) {
            return true;
        }
        // `admin:x` outranks `write:x` outranks `read:x` -- and only that way.
        match (have.split_once(':'), need.split_once(':')) {
            (Some((hl, hr)), Some((nl, nr))) if hr == nr => matches!(
                (hl, nl),
                ("admin", "read") | ("admin", "write") | ("write", "read")
            ),
            _ => false,
        }
    }
    want.split_whitespace()
        .filter(|need| !have.iter().any(|h| covers(h, need)))
        .map(str::to_string)
        .collect()
}

/// `whoami`, plus the scopes GitHub reports for the token.
///
/// Separate from `whoami` rather than replacing it: the device flow does not
/// need the scopes, because it asked for them itself and GitHub either
/// granted them or refused the sign-in.
fn whoami_with_scopes(token: &str) -> Result<(String, Vec<String>, bool), String> {
    let res = http()?
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;

    let status = res.status();
    // The header is absent for a fine-grained token and present-but-empty for
    // a classic token with no scopes ticked. Those are different facts.
    let header = res
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let scopes_known = header.is_some();
    let scopes: Vec<String> = header
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "GitHub rejected that token. It may be expired, revoked, or copied \
                    incompletely."
                .to_string(),
            403 => "GitHub refused the token (403). If it is an organisation token, SSO may \
                    need authorising for that org."
                .to_string(),
            other => format!("GitHub would not accept the token ({other})"),
        });
    }

    let json: serde_json::Value = res
        .json()
        .map_err(|e| format!("GitHub returned something unreadable: {e}"))?;
    let login = json
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if login.is_empty() {
        return Err("GitHub answered without a login".into());
    }
    Ok((login, scopes, scopes_known))
}

/// Do we hold a token of our own? Never *what* it is.
#[tauri::command]
pub fn github_token_stored() -> bool {
    creds::exists(CRED_TARGET)
}

/// Sign out: drop our token, and tell `gh` to drop its own.
///
/// Both, always — leaving gh signed in after the user asked to sign out would
/// leave `git push` working under an identity the UI says is gone.
#[tauri::command(async)]
pub async fn github_sign_out(also_gh: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        creds::delete(CRED_TARGET);
        if also_gh && on_path("gh") {
            let mut cmd = Command::new("gh");
            cmd.args(["auth", "logout", "--hostname", "github.com"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            no_window(&mut cmd);
            let _ = cmd.status();
        }
    })
    .await
    .map_err(|e| format!("the sign-out task did not finish: {e}"))
}

/// Read the identity our own token maps to.
///
/// The fallback for `setup::github_user` when `gh` is not installed: without
/// it, signing in through the device flow would still show "not signed in"
/// on a machine with no CLI.
pub fn user_from_stored_token() -> Option<(String, String, String)> {
    let token = creds::get(CRED_TARGET)?;
    let res = http()
        .ok()?
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let json: serde_json::Value = res.json().ok()?;
    let s = |k: &str| {
        json.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let login = s("login");
    if login.is_empty() {
        return None;
    }
    let name = {
        let n = s("name");
        if n.is_empty() {
            login.clone()
        } else {
            n
        }
    };
    Some((login, name, s("avatar_url")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn have(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_token_with_everything_is_missing_nothing() {
        assert!(missing_scopes(SCOPES, &have(&["repo", "read:org", "gist"])).is_empty());
    }

    #[test]
    fn the_box_people_forget_is_named() {
        // The failure this whole check exists for: a token minted without
        // `repo` clones public repos happily and dies on the first private one.
        assert_eq!(
            missing_scopes(SCOPES, &have(&["read:org", "gist"])),
            vec!["repo".to_string()]
        );
    }

    #[test]
    fn a_broader_scope_covers_the_narrower_one() {
        // `admin:org` is strictly more than `read:org`. Sending someone back
        // to GitHub to add `read:org` to a token that already administers the
        // org would be a lie dressed as helpfulness.
        assert!(missing_scopes("read:org", &have(&["admin:org"])).is_empty());
        assert!(missing_scopes("read:org", &have(&["write:org"])).is_empty());
    }

    #[test]
    fn a_narrower_scope_does_not_cover_the_broader_one() {
        assert_eq!(
            missing_scopes("admin:org", &have(&["read:org"])),
            vec!["admin:org".to_string()]
        );
    }

    #[test]
    fn a_token_with_no_scopes_at_all_is_missing_all_of_them() {
        assert_eq!(missing_scopes(SCOPES, &[]).len(), 3);
    }
}
