//! Sign in with Google, for mail.
//!
//! The thing a person sees is a browser tab and one click. Everything here
//! exists to make that true without a password ever passing through DevDeck.
//!
//! **Why this is allowed to work without paying Google.** Reading a mailbox
//! needs `https://mail.google.com/`, which Google classes as a *restricted*
//! scope, and restricted scopes normally mean verification plus a paid
//! security assessment. Two details make the free route real:
//!
//! - The 7-day refresh-token expiry is tied to a publishing status of
//!   **Testing**, not to being unverified. A project set to **In production**
//!   issues refresh tokens that last, verified or not.
//! - An unverified app using a restricted scope gets a **100-user lifetime
//!   cap** on the project, which cannot be reset or raised, and a consent
//!   screen that says "Google hasn't verified this app".
//!
//! So this is correct for one person connecting their own mailbox, and it is
//! the wrong shape for shipping to strangers. When DevDeck has users, that cap
//! is the thing that runs out, and verification is what it costs to fix.
//!
//! **The loopback flow, and why not a password.** The browser sends the code
//! back to `http://127.0.0.1:<port>` — a listener we open on a port the OS
//! picks, alive only for this one sign-in. DevDeck never sees the password,
//! Google never sees DevDeck, and what we keep afterwards is a refresh token
//! that you can revoke from your Google account without changing anything
//! else.
//!
//! **PKCE is not optional here.** A desktop client secret is not a secret —
//! Google's own documentation says it is embedded in source and "obviously not
//! treated as a secret" — so the secret proves nothing about who is asking.
//! The proof is the verifier: a random string we keep in memory, whose SHA-256
//! we send up front. Another program that intercepts the code cannot exchange
//! it without the verifier it never saw.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

/// Read a mailbox over IMAP, and send over SMTP. One scope covers both.
///
/// There is no lighter scope for reading mail — `gmail.readonly` and
/// `gmail.metadata` are restricted too — so no amount of scope trimming avoids
/// the consent warning. Asking for less would only cost function.
/// `openid email` rides along so the token reply names the account.
///
/// It costs nothing: the request is already restricted because of the mail
/// scope, and these two are the only scopes Google treats as free. What it
/// buys is an onboarding step where nobody types their own address, and an
/// account that cannot be created against the wrong mailbox because the user
/// picked a different one in the chooser.
pub const SCOPE: &str = "https://mail.google.com/ openid email";

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// Compiled-in fallback, empty on purpose.
///
/// The client belongs to whoever ships the build, so it is configured rather
/// than invented: `DEVDECK_GOOGLE_CLIENT_ID` and
/// `DEVDECK_GOOGLE_CLIENT_SECRET` in the environment, or these constants.
/// Left blank here so that a build with no client configured *says so* instead
/// of failing at Google with an error about an unknown client.
const BAKED_CLIENT_ID: &str = "";
const BAKED_CLIENT_SECRET: &str = "";

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;
const B64_STD: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

#[derive(Clone, Debug)]
pub struct GoogleClient {
    pub id: String,
    pub secret: String,
}

/// The client this build signs in with, or nothing.
///
/// Environment first so a developer can point a build at their own project
/// without editing tracked source, which is also how this stays out of a
/// commit by default.
pub fn client() -> Option<GoogleClient> {
    let id = std::env::var("DEVDECK_GOOGLE_CLIENT_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| BAKED_CLIENT_ID.to_string());
    let secret = std::env::var("DEVDECK_GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| BAKED_CLIENT_SECRET.to_string());

    if id.trim().is_empty() {
        return None;
    }
    Some(GoogleClient {
        id: id.trim().to_string(),
        // A desktop client can legitimately have no secret. Google issues one
        // for the Desktop app type, but the token endpoint accepts the
        // exchange without it when the client was created without one, so an
        // empty secret is a configuration, not a fault.
        secret: secret.trim().to_string(),
    })
}

/// Why sign-in is unavailable, in the words of the person who can fix it.
pub fn unavailable() -> String {
    "This build has no Google client configured, so there is nothing to sign in with. \
     Set DEVDECK_GOOGLE_CLIENT_ID (and DEVDECK_GOOGLE_CLIENT_SECRET, if the client has one) \
     and restart. An app password works meanwhile and needs no client at all."
        .to_string()
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

fn random_token(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    B64.encode(buf)
}

/// A fresh verifier and its S256 challenge.
pub fn pkce() -> Pkce {
    // 64 bytes lands inside RFC 7636's 43..128 character window once base64url
    // has expanded it, with no padding to strip.
    let verifier = random_token(64);
    let challenge = B64.encode(Sha256::digest(verifier.as_bytes()));
    Pkce {
        verifier,
        challenge,
    }
}

/// An unguessable value tying the callback to the request that started it.
pub fn state_token() -> String {
    random_token(24)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Where to send the browser.
///
/// `access_type=offline` plus `prompt=consent` is what actually returns a
/// refresh token. Without the prompt, Google gives one only on the very first
/// consent ever — so re-connecting an account that was removed would succeed,
/// store no refresh token, and break silently an hour later when the access
/// token expired.
pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str, hint: &str) -> String {
    let mut url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        urlencode(client_id),
        urlencode(redirect),
        urlencode(SCOPE),
        urlencode(challenge),
        urlencode(state),
    );
    if !hint.trim().is_empty() {
        url.push_str(&format!("&login_hint={}", urlencode(hint.trim())));
    }
    url
}

// ---------------------------------------------------------------------------
// The loopback listener
// ---------------------------------------------------------------------------

/// A listener on a port the OS chose, plus the redirect URI naming it.
///
/// 127.0.0.1 rather than `localhost`: the name can resolve to ::1 first on a
/// dual-stack machine, and then the browser knocks on a door we are not
/// standing behind.
pub fn loopback() -> Result<(TcpListener, String), String> {
    let l = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("could not open a local port for the sign-in: {e}"))?;
    let port = l
        .local_addr()
        .map_err(|e| format!("could not read the local port: {e}"))?
        .port();
    Ok((l, format!("http://127.0.0.1:{port}")))
}

/// What the browser came back with.
#[derive(Debug, PartialEq)]
pub enum Callback {
    Code { code: String, state: String },
    Denied(String),
}

/// Pull `code`/`error` out of the request line of a loopback callback.
pub fn parse_callback(request_line: &str) -> Option<Callback> {
    let target = request_line.split_whitespace().nth(1)?;
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut code = String::new();
    let mut state = String::new();
    let mut error = String::new();
    for pair in query.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        let v = percent_decode(v);
        match k {
            "code" => code = v,
            "state" => state = v,
            "error" => error = v,
            _ => {}
        }
    }

    if !error.is_empty() {
        return Some(Callback::Denied(error));
    }
    if code.is_empty() {
        return None;
    }
    Some(Callback::Code { code, state })
}

fn percent_decode(s: &str) -> String {
    let b = s.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&format!("{}{}", b[i + 1] as char, b[i + 2] as char), 16)
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The page the browser is left showing. Plain, self-contained, no network.
fn closing_page(title: &str, body: &str) -> String {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title>\
         <style>body{{font:14px/1.6 system-ui,sans-serif;background:#0d1017;color:#cbd5e1;\
         display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}\
         div{{max-width:28rem;padding:2rem}}h1{{font-size:17px;color:#e2e8f0;margin:0 0 .5rem}}</style>\
         <div><h1>{title}</h1><p>{body}</p></div>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{html}",
        html.len()
    )
}

/// Wait for Google to send the browser back, and answer it.
///
/// Anything that is not our callback is answered and ignored rather than
/// accepted: browsers ask for `/favicon.ico` on their own, and treating that
/// as a failed sign-in would end the flow before the real callback arrives.
pub fn wait_for_callback(listener: &TcpListener, expect_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("could not wait on the local port: {e}"))?;

    for stream in listener.incoming() {
        let mut stream = match stream {
            Ok(s) => s,
            Err(e) => return Err(format!("the browser could not reach DevDeck: {e}")),
        };

        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }

        match parse_callback(&line) {
            Some(Callback::Code { code, state }) => {
                // Constant-time is overkill for a value we generated this
                // second, but a mismatch must still end the flow: it means the
                // callback belongs to a different request than ours.
                if state != expect_state {
                    let _ = stream.write_all(
                        closing_page(
                            "That did not come from here",
                            "The sign-in reply did not match the request DevDeck started. \
                             Nothing was saved. Close this tab and try again.",
                        )
                        .as_bytes(),
                    );
                    return Err("the sign-in reply did not match the request that started it \
                                — nothing was saved"
                        .into());
                }
                let _ = stream.write_all(
                    closing_page(
                        "Connected",
                        "DevDeck has what it needs. You can close this tab.",
                    )
                    .as_bytes(),
                );
                return Ok(code);
            }
            Some(Callback::Denied(err)) => {
                let _ = stream.write_all(
                    closing_page(
                        "Not connected",
                        "You can close this tab. Nothing was saved.",
                    )
                    .as_bytes(),
                );
                return Err(match err.as_str() {
                    "access_denied" => {
                        "You declined at Google, so nothing was connected.".to_string()
                    }
                    other => format!("Google refused the sign-in: {other}"),
                });
            }
            // Not the callback — a favicon, a preflight, a stray tab.
            None => {
                let _ = stream.write_all(closing_page("DevDeck", "Nothing to see here.").as_bytes());
            }
        }
    }
    Err("the sign-in was closed before Google answered".into())
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug, Default)]
struct TokenReply {
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    expires_in: i64,
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_description: String,
    #[serde(default)]
    id_token: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Tokens {
    /// Which account consented, straight from Google.
    ///
    /// Not what the person typed. Those differ more often than you would
    /// think — people have several Google accounts and the chooser remembers
    /// a different one — and an account row built on the typed address would
    /// then sync a mailbox the token cannot open.
    #[serde(default)]
    pub email: String,
    pub access: String,
    /// Empty on a refresh: Google returns one only when it issues a new one,
    /// and treating "absent" as "revoked" would log you out on every refresh.
    pub refresh: String,
    pub expires_at_ms: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Encode a form body by hand.
///
/// `reqwest`'s `.form()` sits behind a feature this build does not enable, and
/// turning it on to post five key/value pairs would pull in a dependency for
/// something `urlencode` above already does. The content type has to be set
/// explicitly for the same reason.
fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn post_token(form: &[(&str, &str)]) -> Result<Tokens, String> {
    let reply: TokenReply = reqwest::blocking::Client::new()
        .post(TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form_body(form))
        .send()
        .map_err(|e| format!("could not reach Google to finish the sign-in: {e}"))?
        .json()
        .map_err(|e| format!("Google's reply could not be read: {e}"))?;

    if !reply.error.is_empty() {
        return Err(explain_token_error(&reply.error, &reply.error_description));
    }
    if reply.access_token.is_empty() {
        return Err("Google returned no access token and no error, which should not happen. \
                    Nothing was saved."
            .into());
    }
    Ok(Tokens {
        email: email_from_id_token(&reply.id_token),
        access: reply.access_token,
        refresh: reply.refresh_token,
        // Land a minute early rather than discovering expiry mid-request.
        expires_at_ms: now_ms() + (reply.expires_in.max(0) - 60).max(0) * 1000,
    })
}

/// Say what a token error means for the account, not just what Google called it.
pub fn explain_token_error(code: &str, detail: &str) -> String {
    let tail = if detail.trim().is_empty() {
        String::new()
    } else {
        format!(" (Google said: {detail})")
    };
    match code {
        "invalid_grant" => format!(
            "Google will not accept this sign-in any more. That usually means the access was \
             revoked from your Google account, the password changed, or the project is still on \
             a publishing status of Testing, where refresh tokens expire after seven days. \
             Sign in again to fix it.{tail}"
        ),
        "invalid_client" => format!(
            "Google does not recognise this build's client. Check \
             DEVDECK_GOOGLE_CLIENT_ID and DEVDECK_GOOGLE_CLIENT_SECRET.{tail}"
        ),
        "redirect_uri_mismatch" => format!(
            "Google rejected the local address the browser was sent back to. The OAuth client \
             must be of type Desktop app, which allows any 127.0.0.1 port.{tail}"
        ),
        other => format!("Google refused the sign-in ({other}).{tail}"),
    }
}

pub fn exchange(c: &GoogleClient, code: &str, verifier: &str, redirect: &str) -> Result<Tokens, String> {
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", &c.id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ];
    if !c.secret.is_empty() {
        form.push(("client_secret", &c.secret));
    }
    let t = post_token(&form)?;
    if t.refresh.is_empty() {
        return Err("Google did not return a refresh token, so the connection would stop \
                    working within the hour. Remove DevDeck's access under your Google \
                    account's third-party connections and sign in again."
            .into());
    }
    Ok(t)
}

pub fn refresh(c: &GoogleClient, refresh_token: &str) -> Result<Tokens, String> {
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", &c.id),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    if !c.secret.is_empty() {
        form.push(("client_secret", &c.secret));
    }
    let mut t = post_token(&form)?;
    // Carry the old one forward: a refresh reply usually omits it, and storing
    // the empty string would log the account out on the next hour boundary.
    if t.refresh.is_empty() {
        t.refresh = refresh_token.to_string();
    }
    Ok(t)
}

/// Read the `email` claim out of an ID token.
///
/// The signature is deliberately not checked, and that is not a shortcut: this
/// token came back over TLS from Google's own token endpoint in response to a
/// request we made, which is the one case the OpenID Connect spec says a
/// client may skip validation. There is no third party in the path to forge
/// it.
///
/// An unreadable token yields an empty string rather than an error. The email
/// is a convenience — it saves typing — and failing a whole sign-in because a
/// claim could not be parsed would trade a real connection for a nicety.
pub fn email_from_id_token(id_token: &str) -> String {
    let Some(payload) = id_token.split('.').nth(1) else {
        return String::new();
    };
    let Ok(bytes) = B64.decode(payload) else {
        return String::new();
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return String::new();
    };
    v.get("email")
        .and_then(|e| e.as_str())
        .unwrap_or_default()
        .to_string()
}

/// The SASL initial response both IMAP and SMTP want, base64 of
/// `user=<addr>^Aauth=Bearer <token>^A^A`.
pub fn xoauth2(user: &str, access: &str) -> String {
    B64_STD.encode(format!("user={user}\x01auth=Bearer {access}\x01\x01"))
}

/// Hand a URL to the default browser.
///
/// Duplicated from `open_url` in lib.rs rather than reached for, because that
/// one is a Tauri command and this runs on a worker thread with no app handle.
/// Small enough that sharing it would cost more than it saves.
fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(url)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("could not open your browser: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        let _ = url;
    }
    Ok(())
}

/// The whole sign-in, start to finish, on the calling thread.
///
/// Blocking on purpose. It is called from a blocking task, and the alternative
/// — a callback that resolves somewhere else later — would spread one
/// linear conversation with Google across three places.
///
/// Nothing is written anywhere by this function. It returns tokens and lets
/// the caller decide what to keep, so a sign-in that succeeds against the
/// wrong account cannot half-overwrite the right one.
pub fn sign_in(hint: &str) -> Result<Tokens, String> {
    let client = client().ok_or_else(unavailable)?;
    let (listener, redirect) = loopback()?;
    let p = pkce();
    let state = state_token();

    open_in_browser(&auth_url(&client.id, &redirect, &p.challenge, &state, hint))?;

    let code = wait_for_callback(&listener, &state)?;
    exchange(&client, &code, &p.verifier, &redirect)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_the_sha256_of_the_verifier() {
        let p = pkce();
        // RFC 7636 puts the verifier between 43 and 128 characters.
        assert!(p.verifier.len() >= 43 && p.verifier.len() <= 128, "{}", p.verifier.len());
        assert_eq!(p.challenge, B64.encode(Sha256::digest(p.verifier.as_bytes())));
        // base64url, and unpadded — a '+' or '=' here is rejected by Google.
        assert!(!p.challenge.contains('+') && !p.challenge.contains('/'));
        assert!(!p.challenge.contains('='));
    }

    #[test]
    fn two_sign_ins_never_share_a_verifier_or_a_state() {
        assert_ne!(pkce().verifier, pkce().verifier);
        assert_ne!(state_token(), state_token());
    }

    /// Without both of these Google returns an access token and no refresh
    /// token, and the account dies quietly an hour later.
    #[test]
    fn the_url_asks_for_a_refresh_token_explicitly() {
        let u = auth_url("cid", "http://127.0.0.1:5000", "chal", "st", "");
        assert!(u.contains("access_type=offline"));
        assert!(u.contains("prompt=consent"));
        assert!(u.contains("code_challenge_method=S256"));
        assert!(u.contains("scope=https%3A%2F%2Fmail.google.com%2F"));
        assert!(u.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5000"));
        // No hint given, so none sent — an empty login_hint makes Google show
        // an account chooser with a blank entry.
        assert!(!u.contains("login_hint"));
    }

    #[test]
    fn an_address_is_passed_as_a_hint_so_the_right_account_is_offered() {
        let u = auth_url("cid", "http://127.0.0.1:1", "c", "s", " someone@example.com ");
        assert!(u.contains("login_hint=someone%40example.com"));
    }

    #[test]
    fn a_callback_yields_its_code_and_state() {
        let got = parse_callback("GET /?code=4%2F0AY&state=abc123 HTTP/1.1").unwrap();
        assert_eq!(
            got,
            Callback::Code {
                code: "4/0AY".into(),
                state: "abc123".into()
            }
        );
    }

    #[test]
    fn a_refusal_is_a_refusal_not_a_missing_code() {
        assert_eq!(
            parse_callback("GET /?error=access_denied&state=abc HTTP/1.1"),
            Some(Callback::Denied("access_denied".into()))
        );
    }

    /// A browser asks for this by itself. Reading it as a failed sign-in would
    /// end the flow before the real callback ever arrives.
    #[test]
    fn a_favicon_request_is_not_a_callback() {
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(parse_callback("GET / HTTP/1.1"), None);
    }

    #[test]
    fn the_account_that_consented_is_read_from_the_reply() {
        // header.payload.signature — only the middle part is read.
        let payload = B64.encode(br#"{"email":"someone@gmail.com","email_verified":true}"#);
        assert_eq!(
            email_from_id_token(&format!("aGVhZGVy.{payload}.c2ln")),
            "someone@gmail.com"
        );
    }

    #[test]
    fn an_unreadable_id_token_costs_the_convenience_not_the_sign_in() {
        for bad in ["", "not-a-jwt", "a.!!!.c", "a.e30.c"] {
            assert_eq!(email_from_id_token(bad), "", "{bad}");
        }
    }

    #[test]
    fn the_scope_asks_who_signed_in_as_well_as_for_the_mailbox() {
        assert!(SCOPE.contains("https://mail.google.com/"));
        assert!(SCOPE.contains("email"));
        // Both must survive encoding into the URL as one space-separated value.
        let u = auth_url("c", "http://127.0.0.1:1", "ch", "st", "");
        assert!(u.contains("mail.google.com%2F%20openid%20email"));
    }

    #[test]
    fn the_sasl_string_is_what_both_protocols_expect() {
        let s = xoauth2("me@example.com", "tok");
        let raw = String::from_utf8(B64_STD.decode(s).unwrap()).unwrap();
        assert_eq!(raw, "user=me@example.com\x01auth=Bearer tok\x01\x01");
    }

    #[test]
    fn a_loopback_names_the_port_it_actually_opened() {
        let (l, redirect) = loopback().unwrap();
        let port = l.local_addr().unwrap().port();
        assert_eq!(redirect, format!("http://127.0.0.1:{port}"));
        // Never `localhost`: it can resolve to ::1 first, and then the browser
        // knocks on a door we are not behind.
        assert!(!redirect.contains("localhost"));
    }

    #[test]
    fn a_build_with_no_client_says_so_rather_than_failing_at_google() {
        // Guards the real trap: an empty client id would otherwise reach
        // Google and come back as "invalid_client", which reads like the id is
        // wrong rather than absent.
        assert!(unavailable().contains("DEVDECK_GOOGLE_CLIENT_ID"));
        assert!(unavailable().contains("app password"));
    }

    #[test]
    fn a_form_body_escapes_what_would_otherwise_split_it() {
        // An authorization code really does contain '/' and often '+'; sending
        // it raw silently truncates the value at the server.
        let b = form_body(&[("code", "4/0AY+x=="), ("grant_type", "authorization_code")]);
        assert_eq!(b, "code=4%2F0AY%2Bx%3D%3D&grant_type=authorization_code");
    }

    #[test]
    fn an_expired_grant_names_the_publishing_status_trap() {
        let m = explain_token_error("invalid_grant", "Token has been expired or revoked.");
        assert!(m.contains("seven days"), "the Testing-status trap must be named");
        assert!(m.contains("Sign in again"));
        assert!(m.contains("Token has been expired"), "keep what Google said");
    }
}
