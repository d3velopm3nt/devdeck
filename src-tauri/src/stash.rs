//! Stash — the context-aware clip vault (Phase 1: capture + vault).
//!
//! Capture is event-driven: a message-only window registers with
//! `AddClipboardFormatListener` and Windows posts `WM_CLIPBOARDUPDATE`
//! whenever the clipboard changes. Nothing polls.
//!
//! Two rules the rest of this file exists to keep:
//!
//! 1. **Password managers win.** A clip carrying
//!    `ExcludeClipboardContentFromMonitorProcessing` or
//!    `CanIncludeInClipboardHistory = 0` is dropped before we even look at it.
//! 2. **Secrets are metadata only.** Anything the heuristic flags is recorded
//!    as "a secret was copied here, in this project, at this time" — the value
//!    itself is never written to SQLite.

use rusqlite::{params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

use crate::db::{err, Db};

/// Clips larger than this are skipped outright — a copied 5 MB log belongs in
/// a file, not in the vault, and it would bloat every list query.
const MAX_BYTES: usize = 512 * 1024;

/// How long after DevDeck writes the clipboard itself we treat an identical
/// capture as our own echo rather than a fresh clip.
const ECHO_WINDOW_MS: u128 = 4_000;

/// Days an untouched clip is kept before retention prunes it.
pub const DEFAULT_RETENTION_DAYS: i64 = 30;
/// How often the capture path re-checks retention. Cheap enough to sit in the
/// clipboard handler, rare enough not to matter.
const PRUNE_EVERY_MS: i64 = 60 * 60 * 1000;

/// Whether the FTS5 index exists. False = this SQLite has no FTS5 and search
/// falls back to a substring scan; the UI is told, never silently degraded.
static FTS: AtomicBool = AtomicBool::new(false);

pub fn set_fts_available(ok: bool) {
    FTS.store(ok, Ordering::Relaxed);
}

fn fts_available() -> bool {
    FTS.load(Ordering::Relaxed)
}

// ---------- state ----------

/// The workspace/project the UI is sitting in. The backend can't know the
/// selection, so the frontend pushes it here whenever it changes; every
/// capture is stamped with whatever was current at that moment. This is the
/// differentiator — "that connection string from the tyrex bug" is findable
/// six weeks later because the clip remembers where you were.
#[derive(Default, Clone)]
pub struct Ctx {
    pub project_id: Option<i64>,
    pub project_name: String,
    pub workspace_name: String,
}

pub struct StashState {
    /// Capture on/off (persisted in settings as `stash_capture`).
    pub enabled: AtomicBool,
    /// Show the capture toast (persisted as `stash_toast`).
    pub toast: AtomicBool,
    /// Paste straight into the app you came from, rather than only copying
    /// (persisted as `stash_auto_paste`). Off by default: synthesising a
    /// keystroke into someone else's window is the kind of thing you opt into.
    pub auto_paste: AtomicBool,
    /// Days to keep an untouched clip (persisted as `stash_retention_days`).
    /// 0 = keep everything forever.
    pub retention_days: std::sync::atomic::AtomicI64,
    /// When the last automatic prune ran, so a long-running app prunes
    /// occasionally without needing a timer thread of its own.
    last_prune: std::sync::atomic::AtomicI64,
    ctx: Mutex<Ctx>,
    /// Fingerprint of a clip DevDeck just put on the clipboard, so copying an
    /// item back out doesn't re-capture it as a new one.
    echo: Mutex<Option<(String, std::time::Instant)>>,
}

impl Default for StashState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            toast: AtomicBool::new(true),
            auto_paste: AtomicBool::new(false),
            retention_days: std::sync::atomic::AtomicI64::new(DEFAULT_RETENTION_DAYS),
            last_prune: std::sync::atomic::AtomicI64::new(0),
            ctx: Mutex::new(Ctx::default()),
            echo: Mutex::new(None),
        }
    }
}

impl StashState {
    fn context(&self) -> Ctx {
        self.ctx.lock().map(|c| c.clone()).unwrap_or_default()
    }

    fn is_echo(&self, hash: &str) -> bool {
        let Ok(echo) = self.echo.lock() else {
            return false;
        };
        match echo.as_ref() {
            Some((h, at)) => h == hash && at.elapsed().as_millis() <= ECHO_WINDOW_MS,
            None => false,
        }
    }

    /// Remember that DevDeck is about to put `text` on the clipboard, so the
    /// capture it triggers is recognised as our own echo.
    fn arm_echo(&self, text: &str) {
        if let Ok(mut echo) = self.echo.lock() {
            *echo = Some((hash(text), std::time::Instant::now()));
        }
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// FNV-1a: a content fingerprint for dedupe only, never for security.
fn hash(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    format!("{h:016x}")
}

// ---------- classification ----------

fn is_hex_str(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, c) in b.iter().enumerate() {
        let ok = match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        };
        if !ok {
            return false;
        }
    }
    true
}

fn is_b64url(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'=')
}

fn is_jwt(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3
        && parts[0].starts_with("eyJ")
        && parts[0].len() >= 8
        && parts[1].len() >= 8
        && parts.iter().all(|p| is_b64url(p))
}

fn is_url(s: &str) -> bool {
    !s.contains(char::is_whitespace)
        && ["http://", "https://", "ws://", "wss://", "ftp://"]
            .iter()
            .any(|p| s.starts_with(p))
}

fn is_path(s: &str) -> bool {
    if s.contains('\n') || s.len() > 400 {
        return false;
    }
    let b = s.as_bytes();
    // C:\… or C:/…
    let drive = b.len() > 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    let unc = s.starts_with("\\\\");
    let posix = (s.starts_with('/') || s.starts_with("./") || s.starts_with("../") || s.starts_with("~/"))
        && s.len() > 2;
    drive || unc || posix
}

fn is_json(s: &str) -> bool {
    let starts = s.starts_with('{') || s.starts_with('[');
    let ends = s.ends_with('}') || s.ends_with(']');
    starts && ends && serde_json::from_str::<serde_json::Value>(s).is_ok()
}

fn is_stacktrace(s: &str) -> bool {
    if !s.contains('\n') {
        return false;
    }
    s.contains("Traceback (most recent call last)")
        || s.contains("\n    at ")
        || s.contains("\n\tat ")
        || s.contains("panicked at")
        || s.contains("\n  File \"")
        || (s.contains("Exception") && s.contains("\n    "))
}

fn is_sql(s: &str) -> bool {
    let lower = s.trim_start().to_ascii_lowercase();
    let first = lower.split(|c: char| c.is_whitespace()).next().unwrap_or("");
    let starts = matches!(
        first,
        "select" | "insert" | "update" | "delete" | "create" | "alter" | "drop" | "with" | "truncate" | "explain"
    );
    let body = [" from ", " into ", " set ", " table ", " values", " where ", " join "]
        .iter()
        .any(|k| lower.contains(k));
    starts && body
}

/// json · sql · url · path · jwt · uuid · hex · stacktrace · text.
pub fn classify(text: &str) -> &'static str {
    let t = text.trim();
    if is_jwt(t) {
        "jwt"
    } else if is_url(t) {
        "url"
    } else if is_uuid(t) {
        "uuid"
    } else if is_json(t) {
        "json"
    } else if is_stacktrace(t) {
        "stacktrace"
    } else if is_sql(t) {
        "sql"
    } else if is_path(t) {
        "path"
    } else if !t.contains(char::is_whitespace)
        && t.len() >= 8
        && (is_hex_str(t)
            || (t.starts_with("0x") && is_hex_str(&t[2..]))
            || (t.starts_with('#') && t.len() <= 9 && is_hex_str(&t[1..])))
    {
        "hex"
    } else {
        "text"
    }
}

/// Which sidebar group a type belongs to.
fn group_of(item_type: &str) -> &'static str {
    match item_type {
        "json" | "sql" => "code",
        "url" => "links",
        "stacktrace" => "errors",
        _ => "clips",
    }
}

// ---------- the secret heuristic ----------

/// Shannon entropy per character — high on random tokens, low on prose.
fn entropy(s: &str) -> f64 {
    let mut counts = [0usize; 256];
    let mut n = 0usize;
    for b in s.bytes() {
        counts[b as usize] += 1;
        n += 1;
    }
    if n == 0 {
        return 0.0;
    }
    let mut e = 0.0f64;
    for c in counts.iter().filter(|c| **c > 0) {
        let p = *c as f64 / n as f64;
        e -= p * p.log2();
    }
    e
}

/// Vendor token prefixes worth recognising by shape alone.
const TOKEN_PREFIXES: &[(&str, usize, &str)] = &[
    ("sk-", 24, "looks like an API key"),
    ("sk_live_", 16, "looks like a live secret key"),
    ("sk_test_", 16, "looks like a secret key"),
    ("rk_live_", 16, "looks like a restricted key"),
    ("ghp_", 20, "looks like a GitHub token"),
    ("gho_", 20, "looks like a GitHub token"),
    ("ghu_", 20, "looks like a GitHub token"),
    ("ghs_", 20, "looks like a GitHub token"),
    ("ghr_", 20, "looks like a GitHub token"),
    ("github_pat_", 24, "looks like a GitHub token"),
    ("glpat-", 16, "looks like a GitLab token"),
    ("xoxb-", 16, "looks like a Slack token"),
    ("xoxp-", 16, "looks like a Slack token"),
    ("xoxa-", 16, "looks like a Slack token"),
    ("xoxs-", 16, "looks like a Slack token"),
    ("AIza", 30, "looks like a Google API key"),
    ("ya29.", 20, "looks like an OAuth token"),
    ("npm_", 30, "looks like an npm token"),
    ("dop_v1_", 24, "looks like a DigitalOcean token"),
    ("shpat_", 24, "looks like a Shopify token"),
    ("SG.", 30, "looks like a SendGrid key"),
    ("hf_", 24, "looks like a Hugging Face token"),
];

/// Words that make the right-hand side of a `key = value` a credential.
const SECRET_KEYS: &[&str] = &[
    "password", "passwd", "pwd", "secret", "token", "apikey", "api_key", "api-key", "accesskey",
    "access_key", "access-key", "secretkey", "secret_key", "client_secret", "clientsecret",
    "authorization", "auth_token", "private_key", "privatekey", "connectionstring",
];

/// Values that are obviously placeholders, not real credentials.
fn is_placeholder(v: &str) -> bool {
    let l = v.trim().trim_matches(['"', '\'']).to_ascii_lowercase();
    l.is_empty()
        || l.len() < 8
        || l.starts_with("${")
        || l.starts_with('<')
        || l.starts_with("your")
        || l.starts_with("xxx")
        || l.starts_with("***")
        || l.starts_with("changeme")
        || l.starts_with("env.")
        || l.chars().all(|c| c == '*' || c == '.' || c == '•')
}

/// `Some(reason)` when this clip must not have its value persisted.
pub fn secret_reason(text: &str) -> Option<&'static str> {
    let t = text.trim();
    if t.contains("-----BEGIN") && t.contains("PRIVATE KEY") {
        return Some("looks like a private key");
    }
    // AWS access key id: AKIA + 16 uppercase alphanumerics.
    if let Some(i) = t.find("AKIA") {
        let rest = &t[i + 4..];
        if rest.len() >= 16
            && rest[..16]
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            return Some("looks like an AWS access key");
        }
    }
    for (prefix, min_len, reason) in TOKEN_PREFIXES {
        if t.split(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .any(|w| w.starts_with(prefix) && w.len() >= *min_len)
        {
            return Some(reason);
        }
    }
    // user:password@host in a connection string / URL.
    if let Some(at) = t.find('@') {
        if let Some(scheme) = t[..at].find("://") {
            let creds = &t[scheme + 3..at];
            if let Some((_, pass)) = creds.split_once(':') {
                if !pass.is_empty() && !is_placeholder(pass) {
                    return Some("looks like a connection string with a password");
                }
            }
        }
    }
    // key = value / "key": "value" on any line.
    for line in t.lines().take(200) {
        let Some(sep) = line.find(['=', ':']) else {
            continue;
        };
        let key = line[..sep]
            .trim()
            .trim_matches(['"', '\'', '-', ' '])
            .to_ascii_lowercase();
        let val = line[sep + 1..].trim().trim_end_matches(',');
        if SECRET_KEYS.iter().any(|k| key == *k || key.ends_with(k)) && !is_placeholder(val) {
            return Some("contains a credential");
        }
    }
    // Last resort: one long, high-entropy, opaque token. Hashes, UUIDs, URLs
    // and paths are excluded — they're high-entropy but not secret.
    //
    // JWTs are excluded too, and that is a deliberate trade-off rather than an
    // oversight. A JWT *is* a bearer credential, and this fallback would
    // otherwise swallow every one of them — which would make the `jwt` type
    // and its decode action unreachable, since a flagged clip stores no value
    // to decode. The roadmap asks for both, so a token you can recognise as a
    // JWT is kept and shown with an amber badge; anything that merely looks
    // random still gets flagged. Delete `!is_jwt(t)` to reverse that call.
    if !t.contains(char::is_whitespace)
        && (32..=512).contains(&t.len())
        && !is_hex_str(t)
        && !is_uuid(t)
        && !is_url(t)
        && !is_path(t)
        && !is_jwt(t)
        && !t.starts_with("data:")
        && t.bytes().any(|b| b.is_ascii_digit())
        && t.bytes().any(|b| b.is_ascii_alphabetic())
        && entropy(t) >= 4.2
    {
        return Some("looks like a high-entropy secret");
    }
    None
}

/// Words that mean "there may be a credential in this picture".
const OCR_SENSITIVE_WORDS: &[&str] = &[
    "password", "passwd", "api key", "apikey", "api-key", "secret key", "access key",
    "client secret", "private key", "bearer ", "credential", "auth token", "access token",
    "bot token", "connection string", "recovery code", "seed phrase",
];

/// The guardrail for text lifted *out of an image*.
///
/// Deliberately blunter than `secret_reason`. OCR flattens layout, so the
/// `key: value` shape that rule depends on is usually destroyed -- a
/// screenshot of a login form comes back as one long line, and the careful
/// heuristic sails straight past a real password. So for images, the mere
/// presence of a credential word is enough to withhold the text.
///
/// That trades false positives for safety on purpose. A wrongly-flagged
/// screenshot is still findable by name, date, project and tag, and is one
/// click from opening. A missed one puts a live password in a searchable
/// database, which is the exact thing this vault promises never to do.
pub fn ocr_secret_reason(text: &str) -> Option<&'static str> {
    if let Some(reason) = secret_reason(text) {
        return Some(reason);
    }
    let lower = text.to_ascii_lowercase();
    if OCR_SENSITIVE_WORDS.iter().any(|w| lower.contains(w)) {
        return Some("this image may show a credential");
    }
    None
}

// ---------- rows ----------

#[derive(Serialize, Clone, Debug)]
pub struct StashItem {
    pub id: i64,
    /// clip = captured from the clipboard · note = you wrote it here.
    pub kind: String,
    pub item_type: String,
    pub title: String,
    /// Only `stash_get` fills this — lists carry `preview` so they stay small.
    /// Always None for a secret: the value was never stored.
    pub content: Option<String>,
    /// Your own text about this clip. Indexed for search.
    pub note: String,
    pub tags: Vec<String>,
    /// Screenshots only: where the image actually lives. We link, never copy,
    /// so deleting the stash row leaves your picture untouched.
    pub file_path: String,
    /// Screenshots only: a small data: URI, so the list can draw itself
    /// without loading full-size images.
    pub thumb: String,
    pub preview: String,
    pub bytes: i64,
    pub project_id: Option<i64>,
    pub project_name: String,
    pub workspace_name: String,
    pub source_app: String,
    pub is_secret: bool,
    pub secret_reason: String,
    pub pinned: bool,
    pub created_at: i64,
    pub used_count: i64,
}

/// Tags come back as one unit-separated string per row, so listing N items
/// stays a single query instead of N+1.
const TAG_SEP: char = '\u{1f}';

const LIST_COLS: &str = "i.id, i.kind, i.item_type, i.title, i.preview, i.bytes, i.project_id, \
     i.project_name, i.workspace_name, i.source_app, i.is_secret, i.secret_reason, i.pinned, \
     i.created_at, i.used_count, i.note, \
     (SELECT group_concat(g.name, char(31)) FROM stash_item_tags t \
        JOIN stash_tags g ON g.id = t.tag_id WHERE t.item_id = i.id) AS tags, \
     i.file_path, i.thumb";

fn row_to_item(row: &rusqlite::Row, with_content: bool) -> rusqlite::Result<StashItem> {
    let mut tags: Vec<String> = row
        .get::<_, Option<String>>(16)?
        .map(|s| s.split(TAG_SEP).map(str::to_string).collect())
        .unwrap_or_default();
    // group_concat doesn't promise an order; make the chips stable.
    tags.sort_by_key(|t| t.to_lowercase());
    Ok(StashItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        item_type: row.get(2)?,
        title: row.get(3)?,
        content: if with_content { row.get(19)? } else { None },
        note: row.get(15)?,
        tags,
        file_path: row.get(17)?,
        thumb: row.get(18)?,
        preview: row.get(4)?,
        bytes: row.get(5)?,
        project_id: row.get(6)?,
        project_name: row.get(7)?,
        workspace_name: row.get(8)?,
        source_app: row.get(9)?,
        is_secret: row.get::<_, i64>(10)? != 0,
        secret_reason: row.get(11)?,
        pinned: row.get::<_, i64>(12)? != 0,
        created_at: row.get(13)?,
        used_count: row.get(14)?,
    })
}

fn item_by_id(conn: &rusqlite::Connection, id: i64) -> Result<StashItem, String> {
    conn.query_row(
        &format!("SELECT {LIST_COLS}, i.content FROM stash_items i WHERE i.id = ?1"),
        params![id],
        |r| row_to_item(r, true),
    )
    .map_err(err)
}

// ---------- capture → row ----------

/// One line, trimmed, that names the clip in a list.
fn derive_title(text: &str, item_type: &str) -> String {
    let first = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .trim();
    let mut title: String = first.chars().take(90).collect();
    if first.chars().count() > 90 {
        title.push('…');
    }
    if title.is_empty() {
        item_type.to_string()
    } else {
        title
    }
}

fn derive_preview(text: &str) -> String {
    let mut out = String::new();
    for (i, line) in text.lines().take(4).enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(line.trim_end());
        if out.len() > 300 {
            break;
        }
    }
    if out.len() > 300 {
        out.truncate(
            (0..=300)
                .rev()
                .find(|i| out.is_char_boundary(*i))
                .unwrap_or(0),
        );
        out.push('…');
    }
    out
}

/// What the capture thread hands to the database.
pub struct Captured {
    pub text: String,
    pub source_app: String,
}

/// Store a captured clip. Returns the new row, or None when it was skipped
/// (duplicate of the newest clip, our own echo, or empty).
pub fn record(app: &tauri::AppHandle, cap: Captured) -> Option<StashItem> {
    let text = cap.text;
    if text.trim().is_empty() || text.len() > MAX_BYTES {
        return None;
    }
    let state = app.try_state::<std::sync::Arc<StashState>>()?;
    if !state.enabled.load(Ordering::Relaxed) {
        return None;
    }
    let fingerprint = hash(&text);
    if state.is_echo(&fingerprint) {
        return None;
    }
    let ctx = state.context();

    let db = app.try_state::<Db>()?;
    let conn = db.0.lock().ok()?;

    // Dedupe consecutive identical clips: re-copying the clip that's already
    // on top just floats it back up instead of stacking a second row.
    let newest: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, hash FROM stash_items ORDER BY created_at DESC, id DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    if let Some((id, h)) = &newest {
        if *h == fingerprint {
            let _ = conn.execute(
                "UPDATE stash_items SET created_at = ?1 WHERE id = ?2",
                params![now_millis(), id],
            );
            return None;
        }
    }

    let secret = secret_reason(&text);
    let item_type = if secret.is_some() {
        "text"
    } else {
        classify(&text)
    };
    let bytes = text.len() as i64;
    // The branch that keeps the promise: a flagged clip contributes a title,
    // a shape and a timestamp — never its value.
    let (title, preview, stored) = match secret {
        Some(reason) => (
            reason.to_string(),
            "•".repeat(text.trim().chars().count().min(32)),
            None,
        ),
        None => (
            derive_title(&text, item_type),
            derive_preview(&text),
            Some(text.as_str()),
        ),
    };

    let created = now_millis();
    conn.execute(
        "INSERT INTO stash_items
            (kind, item_type, title, content, preview, bytes, hash, project_id, project_name,
             workspace_name, source_app, is_secret, secret_reason, created_at)
         VALUES ('clip', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            item_type,
            title,
            stored,
            preview,
            bytes,
            fingerprint,
            ctx.project_id,
            ctx.project_name,
            ctx.workspace_name,
            cap.source_app,
            secret.is_some() as i64,
            secret.unwrap_or_default(),
            created,
        ],
    )
    .ok()?;
    let id = conn.last_insert_rowid();
    drop(conn);

    let item = StashItem {
        id,
        kind: "clip".into(),
        item_type: item_type.into(),
        title,
        content: None,
        note: String::new(),
        tags: Vec::new(),
        file_path: String::new(),
        thumb: String::new(),
        preview,
        bytes,
        project_id: ctx.project_id,
        project_name: ctx.project_name,
        workspace_name: ctx.workspace_name,
        source_app: cap.source_app,
        is_secret: secret.is_some(),
        secret_reason: secret.unwrap_or_default().into(),
        pinned: false,
        created_at: created,
        used_count: 0,
    };
    let _ = app.emit("stash:item", item.clone());
    // Raise the toast from here rather than letting its window ask. The toast
    // lives in a window that is hidden until this moment, and a hidden
    // webview is not a reliable thing to depend on for "did you notice the
    // event?" -- the backend knows a clip landed, so the backend shows it.
    if state.toast.load(Ordering::Relaxed) {
        let (w, h) = crate::TOAST_SIZE;
        crate::place_and_show_toast(app, w, h);
    }

    // Retention, folded into the capture path: an app left open for a week
    // should still prune, and this beats owning a timer thread for one DELETE.
    let days = state.retention_days.load(Ordering::Relaxed);
    let last = state.last_prune.load(Ordering::Relaxed);
    if days > 0 && created - last > PRUNE_EVERY_MS {
        state.last_prune.store(created, Ordering::Relaxed);
        if let Ok(conn) = db.0.lock() {
            let _ = prune(&conn, days);
        }
    }
    Some(item)
}

// ---------- queries ----------

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
pub struct StashQuery {
    /// Free text. Matched with FTS5 when available, else a substring scan.
    /// Either way it also matches tag names — typing a tag into the search
    /// box should find the things you tagged with it.
    pub query: String,
    /// Sidebar group: all | pinned | notes | clips | code | links | errors | secrets.
    pub filter: String,
    /// Exact type from a smart tag ("" = any).
    pub item_type: String,
    /// Exact user tag name ("" = any).
    pub tag: String,
    pub project_id: Option<i64>,
    /// Restrict to clips captured outside any project.
    pub no_project: bool,
    pub limit: i64,
}

/// Items carrying a given tag name (case-insensitive via the column collation).
const TAGGED_SUBQUERY: &str = "i.id IN (SELECT t.item_id FROM stash_item_tags t \
     JOIN stash_tags g ON g.id = t.tag_id WHERE g.name = ?)";
/// Same, but matching the tag name loosely — used to fold tags into search.
const TAG_LIKE_SUBQUERY: &str = "i.id IN (SELECT t.item_id FROM stash_item_tags t \
     JOIN stash_tags g ON g.id = t.tag_id WHERE g.name LIKE ?)";

/// Turn arbitrary user text into a safe FTS5 MATCH expression: every token
/// becomes a quoted prefix phrase, so punctuation can't become syntax.
fn fts_expr(query: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for tok in query.split_whitespace() {
        let cleaned = tok.replace('"', "");
        if !cleaned.chars().any(char::is_alphanumeric) {
            continue;
        }
        parts.push(format!("\"{cleaned}\"*"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn types_in_group(group: &str) -> Option<&'static [&'static str]> {
    match group {
        "code" => Some(&["json", "sql"]),
        "links" => Some(&["url"]),
        "errors" => Some(&["stacktrace"]),
        "clips" => Some(&["text", "path", "uuid", "hex", "jwt"]),
        _ => None,
    }
}

#[tauri::command]
pub fn stash_list(db: tauri::State<Db>, q: StashQuery) -> Result<Vec<StashItem>, String> {
    let conn = db.0.lock().unwrap();
    list_query(&conn, &q)
}

/// The list query itself, against a plain connection so it can be tested.
fn list_query(conn: &rusqlite::Connection, q: &StashQuery) -> Result<Vec<StashItem>, String> {
    let mut sql = format!("SELECT {LIST_COLS} FROM stash_items i");
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut wheres: Vec<String> = Vec::new();

    let expr = fts_expr(&q.query);
    let like = format!("%{}%", q.query.trim());
    match (&expr, fts_available()) {
        (Some(e), true) => {
            wheres.push(format!(
                "(i.id IN (SELECT rowid FROM stash_fts WHERE stash_fts MATCH ?) OR {TAG_LIKE_SUBQUERY})"
            ));
            args.push(Box::new(e.clone()));
            args.push(Box::new(like));
        }
        (Some(_), false) => {
            // No FTS5 in this build — substring scan over the same fields.
            wheres.push(format!(
                "(i.title LIKE ? OR i.content LIKE ? OR i.note LIKE ? OR {TAG_LIKE_SUBQUERY})"
            ));
            for _ in 0..4 {
                args.push(Box::new(like.clone()));
            }
        }
        _ => {}
    }

    match q.filter.as_str() {
        "pinned" => wheres.push("i.pinned = 1".into()),
        "secrets" => wheres.push("i.is_secret = 1".into()),
        "notes" => wheres.push("i.kind = 'note'".into()),
        "screenshots" => wheres.push("i.kind = 'screenshot'".into()),
        other => {
            if let Some(types) = types_in_group(other) {
                let holes = vec!["?"; types.len()].join(", ");
                wheres.push(format!("i.item_type IN ({holes}) AND i.is_secret = 0"));
                for t in types {
                    args.push(Box::new(*t));
                }
            }
        }
    }
    if !q.item_type.is_empty() {
        // Flagged clips are stored as `text` but belong to no type tag — the
        // sidebar counts exclude them, so the list must too.
        wheres.push("i.item_type = ? AND i.is_secret = 0".into());
        args.push(Box::new(q.item_type.clone()));
    }
    if !q.tag.is_empty() {
        wheres.push(TAGGED_SUBQUERY.into());
        args.push(Box::new(q.tag.clone()));
    }
    if q.no_project {
        wheres.push("i.project_id IS NULL".into());
    } else if let Some(pid) = q.project_id {
        wheres.push("i.project_id = ?".into());
        args.push(Box::new(pid));
    }
    if !wheres.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&wheres.join(" AND "));
    }
    sql.push_str(" ORDER BY i.pinned DESC, i.created_at DESC LIMIT ?");
    args.push(Box::new(if q.limit > 0 { q.limit } else { 300 }));

    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(params_from_iter(args.iter().map(|a| a.as_ref())), |r| {
            row_to_item(r, false)
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn stash_get(db: tauri::State<Db>, id: i64) -> Result<StashItem, String> {
    let conn = db.0.lock().unwrap();
    item_by_id(&conn, id)
}

#[derive(Serialize, Default)]
pub struct TypeCount {
    pub item_type: String,
    pub n: i64,
}

#[derive(Serialize, Default)]
pub struct ProjectCount {
    pub project_id: Option<i64>,
    pub name: String,
    pub n: i64,
}

#[derive(Serialize, Default)]
pub struct TagCount {
    pub id: i64,
    pub name: String,
    pub n: i64,
}

#[derive(Serialize, Default)]
pub struct StashCounts {
    pub all: i64,
    pub pinned: i64,
    pub notes: i64,
    pub screenshots: i64,
    pub clips: i64,
    pub code: i64,
    pub links: i64,
    pub errors: i64,
    pub secrets: i64,
    pub types: Vec<TypeCount>,
    pub projects: Vec<ProjectCount>,
    pub tags: Vec<TagCount>,
}

#[tauri::command]
pub fn stash_counts(db: tauri::State<Db>) -> Result<StashCounts, String> {
    let conn = db.0.lock().unwrap();
    let mut counts = StashCounts::default();

    let mut stmt = conn
        .prepare("SELECT item_type, is_secret, pinned, COUNT(*) FROM stash_items GROUP BY 1, 2, 3")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)? != 0,
                r.get::<_, i64>(2)? != 0,
                r.get::<_, i64>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let mut by_type: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for (item_type, is_secret, pinned, n) in rows {
        counts.all += n;
        if pinned {
            counts.pinned += n;
        }
        if is_secret {
            counts.secrets += n;
            continue; // a flagged clip belongs to no type group
        }
        *by_type.entry(item_type.clone()).or_default() += n;
        match group_of(&item_type) {
            "code" => counts.code += n,
            "links" => counts.links += n,
            "errors" => counts.errors += n,
            _ => counts.clips += n,
        }
    }
    counts.types = by_type
        .into_iter()
        .map(|(item_type, n)| TypeCount { item_type, n })
        .collect();
    counts.types.sort_by(|a, b| b.n.cmp(&a.n));

    let mut stmt = conn
        .prepare(
            "SELECT project_id, project_name, COUNT(*) FROM stash_items
             GROUP BY project_id, project_name ORDER BY 3 DESC",
        )
        .map_err(err)?;
    counts.projects = stmt
        .query_map([], |r| {
            Ok(ProjectCount {
                project_id: r.get(0)?,
                name: r.get(1)?,
                n: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    counts.notes = conn
        .query_row(
            "SELECT COUNT(*) FROM stash_items WHERE kind = 'note'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    counts.screenshots = conn
        .query_row(
            "SELECT COUNT(*) FROM stash_items WHERE kind = 'screenshot'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    counts.tags = tag_counts(&conn)?;
    Ok(counts)
}

/// Open a screenshot in whatever views images on this machine. Restricted to
/// paths this vault already links to, so it can't be turned into a generic
/// "open anything" by a crafted argument.
#[tauri::command]
pub fn stash_open_file(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let path: String = conn
        .query_row(
            "SELECT file_path FROM stash_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(err)?;
    drop(conn);
    if path.is_empty() {
        return Err("This item isn't a file.".into());
    }
    if !std::path::Path::new(&path).exists() {
        return Err(format!("That file is gone: {path}"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(err)?;
    }
    Ok(())
}

/// Re-run the image guardrail over screenshots already stored.
///
/// The OCR path shipped before this check existed, so a vault that was
/// indexed by that build is holding text lifted out of login screens. Running
/// on every launch is deliberate: it costs one scan, and it means a rule we
/// tighten later reaches rows captured under the looser one. Returns how many
/// were redacted.
pub fn redact_stored_ocr(conn: &rusqlite::Connection) -> Result<usize, String> {
    let mut stmt = conn
        .prepare("SELECT id, content FROM stash_items WHERE kind = 'screenshot' AND content <> ''")
        .map_err(err)?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    drop(stmt);

    let mut redacted = 0usize;
    for (id, content) in rows {
        let Some(reason) = ocr_secret_reason(&content) else {
            continue;
        };
        // Drop the text and the thumbnail. The FTS triggers fire on this
        // UPDATE, so the words leave the search index too -- redacting the
        // row while leaving it searchable would be no redaction at all.
        conn.execute(
            "UPDATE stash_items
                SET content = '', thumb = '', is_secret = 1, secret_reason = ?1, preview = ?1
              WHERE id = ?2",
            params![reason, id],
        )
        .map_err(err)?;
        redacted += 1;
    }
    Ok(redacted)
}

// ---------- retention ----------

/// Delete clips older than `days`, keeping anything you signalled you care
/// about. The exemptions matter more than the rule: a vault that quietly eats
/// something you tagged is worse than one that keeps too much, so pinned
/// clips, notes you wrote yourself, anything tagged, and anything with a note
/// attached all survive regardless of age.
///
/// Screenshots are exempt outright. They're links to files that still exist
/// in your Pictures folder, and most are older than any sane retention window
/// -- pruning them would import your history and then quietly delete it again.
/// The folder decides what exists; retention only bounds captured text.
///
/// `days <= 0` means keep everything. Returns how many rows went.
pub fn prune(conn: &rusqlite::Connection, days: i64) -> Result<usize, String> {
    if days <= 0 {
        return Ok(0);
    }
    let cutoff = now_millis() - days.saturating_mul(24 * 60 * 60 * 1000);
    let removed = conn
        .execute(
            "DELETE FROM stash_items
              WHERE pinned = 0
                AND kind <> 'note'
                AND kind <> 'screenshot'
                AND note = ''
                AND created_at < ?1
                AND id NOT IN (SELECT item_id FROM stash_item_tags)",
            params![cutoff],
        )
        .map_err(err)?;
    Ok(removed)
}

/// Prune using the current setting. Returns the number of clips removed, so
/// the UI can say what happened instead of silently changing the list.
#[tauri::command]
pub fn stash_prune(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
) -> Result<usize, String> {
    let days = state.retention_days.load(Ordering::Relaxed);
    let conn = db.0.lock().unwrap();
    let n = prune(&conn, days)?;
    state.last_prune.store(now_millis(), Ordering::Relaxed);
    Ok(n)
}

/// Persist a new retention window and apply it straight away — changing the
/// number should visibly do the thing, not wait for a restart.
#[tauri::command]
pub fn stash_set_retention(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    days: i64,
) -> Result<usize, String> {
    let days = days.clamp(0, 3650);
    state.retention_days.store(days, Ordering::Relaxed);
    let conn = db.0.lock().unwrap();
    crate::db::setting_set_conn(&conn, "stash_retention_days", &days.to_string())?;
    let n = prune(&conn, days)?;
    state.last_prune.store(now_millis(), Ordering::Relaxed);
    Ok(n)
}

// ---------- tags ----------

fn tag_counts(conn: &rusqlite::Connection) -> Result<Vec<TagCount>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.name, COUNT(t.item_id) AS n FROM stash_tags g
             LEFT JOIN stash_item_tags t ON t.tag_id = g.id
             GROUP BY g.id, g.name ORDER BY n DESC, g.name COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagCount {
                id: r.get(0)?,
                name: r.get(1)?,
                n: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

#[tauri::command]
pub fn stash_tags_list(db: tauri::State<Db>) -> Result<Vec<TagCount>, String> {
    let conn = db.0.lock().unwrap();
    tag_counts(&conn)
}

/// Tidy a typed tag into its stored form, or None if it isn't usable.
fn normalize_tag(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .trim()
        .trim_start_matches('#')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() || cleaned.chars().count() > 32 {
        None
    } else {
        Some(cleaned)
    }
}

/// Split one input box into tags: comma-separated, so a tag can hold spaces.
pub fn parse_tags(input: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in input.split(',') {
        if let Some(tag) = normalize_tag(part) {
            if !out.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
                out.push(tag);
            }
        }
    }
    out
}

/// Attach one or more tags, creating any that don't exist yet. Returns the
/// item's full tag list so the UI doesn't need a follow-up read.
#[tauri::command]
pub fn stash_tag_add(
    db: tauri::State<Db>,
    id: i64,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = db.0.lock().unwrap();
    tag_add(&conn, id, &names)
}

fn tag_add(
    conn: &rusqlite::Connection,
    id: i64,
    names: &[String],
) -> Result<Vec<String>, String> {
    for raw in names {
        for tag in parse_tags(raw) {
            conn.execute(
                "INSERT OR IGNORE INTO stash_tags (name, created_at) VALUES (?1, ?2)",
                params![tag, now_millis()],
            )
            .map_err(err)?;
            conn.execute(
                "INSERT OR IGNORE INTO stash_item_tags (item_id, tag_id)
                 SELECT ?1, id FROM stash_tags WHERE name = ?2",
                params![id, tag],
            )
            .map_err(err)?;
        }
    }
    tags_of(conn, id)
}

#[tauri::command]
pub fn stash_tag_remove(
    db: tauri::State<Db>,
    id: i64,
    name: String,
) -> Result<Vec<String>, String> {
    let conn = db.0.lock().unwrap();
    tag_remove(&conn, id, &name)
}

fn tag_remove(conn: &rusqlite::Connection, id: i64, name: &str) -> Result<Vec<String>, String> {
    conn.execute(
        "DELETE FROM stash_item_tags WHERE item_id = ?1
           AND tag_id = (SELECT id FROM stash_tags WHERE name = ?2)",
        params![id, name],
    )
    .map_err(err)?;
    prune_orphan_tags(conn);
    tags_of(conn, id)
}

/// Drop a tag from every item at once (from the sidebar).
#[tauri::command]
pub fn stash_tag_delete(db: tauri::State<Db>, tag_id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM stash_tags WHERE id = ?1", params![tag_id])
        .map_err(err)?;
    Ok(())
}

/// A tag nobody uses would sit in the sidebar leading to an empty list.
fn prune_orphan_tags(conn: &rusqlite::Connection) {
    let _ = conn.execute(
        "DELETE FROM stash_tags WHERE id NOT IN (SELECT tag_id FROM stash_item_tags)",
        [],
    );
}

fn tags_of(conn: &rusqlite::Connection, id: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT g.name FROM stash_item_tags t JOIN stash_tags g ON g.id = t.tag_id
             WHERE t.item_id = ?1 ORDER BY g.name COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![id], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

// ---------- editing ----------

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
pub struct StashEdit {
    pub id: i64,
    /// Each field is optional: None leaves it alone, Some replaces it.
    pub title: Option<String>,
    pub content: Option<String>,
    pub note: Option<String>,
}

const MAX_TITLE: usize = 200;
const MAX_NOTE: usize = 8_000;

/// Cap a user-supplied string on a char boundary.
fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

/// Refuse to persist a secret-shaped value, even one typed deliberately. The
/// promise is that a secret's value never reaches SQLite -- an exception for
/// hand-edits would make that promise conditional, and a conditional promise
/// about credentials is worth nothing. Says exactly why, so it never looks
/// like the save silently failed.
fn reject_if_secret(text: &str) -> Result<(), String> {
    match secret_reason(text) {
        Some(reason) => Err(format!(
            "Not saved: this {reason}. Stash never writes a secret's value to disk — \
             keep it in your password manager and reference it here in a note."
        )),
        None => Ok(()),
    }
}

/// Edit a clip's title, content or note. Editing the content re-derives
/// everything that hangs off it: type, size, preview, dedupe fingerprint.
#[tauri::command]
pub fn stash_update(db: tauri::State<Db>, edit: StashEdit) -> Result<StashItem, String> {
    let conn = db.0.lock().unwrap();
    update_item(&conn, &edit)
}

fn update_item(conn: &rusqlite::Connection, edit: &StashEdit) -> Result<StashItem, String> {
    if let Some(text) = &edit.content {
        if text.len() > MAX_BYTES {
            return Err(format!(
                "Not saved: {} KB is over the {} KB limit for a clip.",
                text.len() / 1024,
                MAX_BYTES / 1024
            ));
        }
        reject_if_secret(text)?;
        let item_type = classify(text);
        // Editing a flagged clip into something harmless clears the flag --
        // the row is now backed by a value we're willing to store.
        conn.execute(
            "UPDATE stash_items
                SET content = ?1, item_type = ?2, bytes = ?3, hash = ?4, preview = ?5,
                    is_secret = 0, secret_reason = ''
              WHERE id = ?6",
            params![
                text,
                item_type,
                text.len() as i64,
                hash(text),
                derive_preview(text),
                edit.id
            ],
        )
        .map_err(err)?;
    }
    if let Some(title) = &edit.title {
        let title = clamp(title.trim(), MAX_TITLE);
        // An emptied title falls back to the content's first line rather than
        // leaving an unnamed row in the list.
        let title = if title.is_empty() {
            let body: Option<String> = conn
                .query_row(
                    "SELECT coalesce(content, preview) FROM stash_items WHERE id = ?1",
                    params![edit.id],
                    |r| r.get(0),
                )
                .ok();
            derive_title(&body.unwrap_or_default(), "untitled")
        } else {
            title
        };
        conn.execute(
            "UPDATE stash_items SET title = ?1 WHERE id = ?2",
            params![title, edit.id],
        )
        .map_err(err)?;
    }
    if let Some(note) = &edit.note {
        conn.execute(
            "UPDATE stash_items SET note = ?1 WHERE id = ?2",
            params![clamp(note.trim_end(), MAX_NOTE), edit.id],
        )
        .map_err(err)?;
    }
    item_by_id(&conn, edit.id)
}

/// Write a note from scratch — an item that never touched the clipboard.
#[tauri::command]
pub fn stash_create_note(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    title: String,
    content: String,
) -> Result<StashItem, String> {
    let ctx = state.context();
    let conn = db.0.lock().unwrap();
    create_note(&conn, &ctx, &title, &content)
}

fn create_note(
    conn: &rusqlite::Connection,
    ctx: &Ctx,
    title: &str,
    content: &str,
) -> Result<StashItem, String> {
    if content.len() > MAX_BYTES {
        return Err("Not saved: that note is too large.".into());
    }
    reject_if_secret(content)?;
    let item_type = classify(content);
    let title = clamp(title.trim(), MAX_TITLE);
    let title = if title.is_empty() {
        derive_title(content, "note")
    } else {
        title
    };
    conn.execute(
        "INSERT INTO stash_items
            (kind, item_type, title, content, note, preview, bytes, hash, project_id,
             project_name, workspace_name, source_app, created_at)
         VALUES ('note', ?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8, ?9, 'DevDeck', ?10)",
        params![
            item_type,
            title,
            content,
            derive_preview(content),
            content.len() as i64,
            hash(content),
            ctx.project_id,
            ctx.project_name,
            ctx.workspace_name,
            now_millis(),
        ],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    item_by_id(conn, id)
}

#[tauri::command]
pub fn stash_pin(db: tauri::State<Db>, id: i64, pinned: bool) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE stash_items SET pinned = ?1 WHERE id = ?2",
        params![pinned as i64, id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn stash_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM stash_items WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

/// Record that a clip was copied back out — bumps its usage and arms the echo
/// guard so the capture it triggers isn't stored as a new clip.
#[tauri::command]
pub fn stash_mark_used(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    id: i64,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE stash_items SET used_count = used_count + 1, last_used_at = ?1 WHERE id = ?2",
        params![now_millis(), id],
    )
    .map_err(err)?;
    let h: Option<String> = conn
        .query_row("SELECT hash FROM stash_items WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .ok();
    drop(conn);
    if let (Some(h), Ok(mut echo)) = (h, state.echo.lock()) {
        *echo = Some((h, std::time::Instant::now()));
    }
    Ok(())
}

// ---------- copy / paste ----------

#[derive(Serialize)]
pub struct PasteResult {
    pub copied: bool,
    /// True only when the keystroke actually went to another window. A false
    /// here with `copied: true` means "it's on your clipboard, paste it
    /// yourself" -- never dressed up as a successful paste.
    pub pasted: bool,
}

fn content_of(conn: &rusqlite::Connection, id: i64) -> Result<String, String> {
    let content: Option<String> = conn
        .query_row(
            "SELECT content FROM stash_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(err)?;
    content.ok_or_else(|| {
        "This clip was flagged as a secret, so its value was never stored — there's nothing to \
         copy."
            .to_string()
    })
}

/// Put a clip on the clipboard from the backend. More reliable than the
/// webview's clipboard API, which needs a focused document — and the widget
/// deliberately doesn't take focus.
#[tauri::command]
pub fn stash_copy(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    id: i64,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let text = content_of(&conn, id)?;
    conn.execute(
        "UPDATE stash_items SET used_count = used_count + 1, last_used_at = ?1 WHERE id = ?2",
        params![now_millis(), id],
    )
    .map_err(err)?;
    drop(conn);
    // Arm before writing: the clipboard event fires the moment we set it.
    state.arm_echo(&text);
    #[cfg(windows)]
    if !win::set_clipboard_text(&text) {
        return Err("Couldn't write to the clipboard — another app is holding it.".into());
    }
    Ok(())
}

/// Copy, then paste into the app you came from when auto-paste is enabled.
/// `force` pastes for this one invocation regardless of the setting — that's
/// ⇧⏎, where you asked for a paste explicitly.
#[tauri::command]
pub fn stash_paste(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    id: i64,
    force: bool,
) -> Result<PasteResult, String> {
    stash_copy(db, state.clone(), id)?;
    let wants = force || state.auto_paste.load(Ordering::Relaxed);
    let pasted = if wants {
        #[cfg(windows)]
        {
            win::paste_into_target()
        }
        #[cfg(not(windows))]
        {
            false
        }
    } else {
        false
    };
    Ok(PasteResult {
        copied: true,
        pasted,
    })
}

/// Snapshot the foreground window before DevDeck takes focus, so a later
/// auto-paste knows where to land. Called from the hotkey path in `lib.rs`
/// (while the app you were in is still in front) and exposed to the frontend
/// for anything that summons a window another way.
pub fn remember_target() {
    #[cfg(windows)]
    win::remember_foreground();
}

#[tauri::command]
pub fn stash_remember_target() {
    remember_target();
}

/// The frontend pushes the active workspace/project here whenever it changes.
#[tauri::command]
pub fn stash_set_context(
    state: tauri::State<std::sync::Arc<StashState>>,
    project_id: Option<i64>,
    project_name: String,
    workspace_name: String,
) -> Result<(), String> {
    if let Ok(mut ctx) = state.ctx.lock() {
        *ctx = Ctx {
            project_id,
            project_name,
            workspace_name,
        };
    }
    Ok(())
}

#[derive(Serialize)]
pub struct StashStatus {
    pub enabled: bool,
    /// False = no FTS5 in this SQLite; search is a substring scan. Say so.
    pub fts: bool,
    pub toast: bool,
    pub auto_paste: bool,
    /// Days an untouched clip is kept; 0 = forever.
    pub retention_days: i64,
}

#[tauri::command]
pub fn stash_status(state: tauri::State<std::sync::Arc<StashState>>) -> StashStatus {
    StashStatus {
        enabled: state.enabled.load(Ordering::Relaxed),
        fts: fts_available(),
        toast: state.toast.load(Ordering::Relaxed),
        auto_paste: state.auto_paste.load(Ordering::Relaxed),
        retention_days: state.retention_days.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn stash_set_enabled(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    enabled: bool,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Relaxed);
    let conn = db.0.lock().unwrap();
    crate::db::setting_set_conn(&conn, "stash_capture", if enabled { "1" } else { "0" })
}

/// One setter for the two toggles that only affect presentation/behaviour,
/// so the Settings page doesn't need a command each.
#[tauri::command]
pub fn stash_set_option(
    db: tauri::State<Db>,
    state: tauri::State<std::sync::Arc<StashState>>,
    key: String,
    value: bool,
) -> Result<(), String> {
    let setting = match key.as_str() {
        "toast" => {
            state.toast.store(value, Ordering::Relaxed);
            "stash_toast"
        }
        "auto_paste" => {
            state.auto_paste.store(value, Ordering::Relaxed);
            "stash_auto_paste"
        }
        other => return Err(format!("unknown stash option: {other}")),
    };
    let conn = db.0.lock().unwrap();
    crate::db::setting_set_conn(&conn, setting, if value { "1" } else { "0" })
}

/// The project the UI is sitting in right now, so other capture sources
/// (screenshots) can stamp their rows with the same context clips get.
pub fn current_context(app: &tauri::AppHandle) -> Ctx {
    app.try_state::<std::sync::Arc<StashState>>()
        .map(|s| s.context())
        .unwrap_or_default()
}

/// Show a Tauri window without taking focus. Used for the capture toast: it
/// appears while you're mid-keystroke in another app, so activating would be
/// actively harmful.
pub fn show_window_without_focus(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        if let Ok(hwnd) = window.hwnd() {
            win::show_without_focus(hwnd.0 as _);
            return;
        }
    }
    let _ = window.show();
}

/// Counterpart to `show_window_without_focus` — see `win::hide_raw`.
pub fn hide_window(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        if let Ok(hwnd) = window.hwnd() {
            win::hide_raw(hwnd.0 as _);
            return;
        }
    }
    let _ = window.hide();
}

// ---------- the clipboard listener ----------

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Start the clipboard listener on its own thread. Safe to call once.
pub fn spawn(app: tauri::AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    #[cfg(windows)]
    std::thread::spawn(win::message_loop);
}

#[cfg(windows)]
mod win {
    use super::{record, Captured, APP};
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::DataExchange::{
        AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
        GetClipboardOwner, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
        SetClipboardData,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GMEM_MOVEABLE};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetForegroundWindow, GetMessageW,
        GetWindowThreadProcessId, IsWindow, RegisterClassW, SetForegroundWindow, ShowWindow,
        TranslateMessage, HWND_MESSAGE, MSG, SW_HIDE, SW_SHOWNOACTIVATE, WM_CLIPBOARDUPDATE,
        WNDCLASSW,
    };

    const CF_UNICODETEXT: u32 = 13;
    const VK_CONTROL: u16 = 0x11;
    const VK_V: u16 = 0x56;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The two formats a password manager sets to say "don't remember this".
    /// Honouring them is not optional — it's the whole reason it's safe to
    /// leave capture on.
    fn exclusion_formats() -> (u32, u32) {
        unsafe {
            (
                RegisterClipboardFormatW(wide("ExcludeClipboardContentFromMonitorProcessing").as_ptr()),
                RegisterClipboardFormatW(wide("CanIncludeInClipboardHistory").as_ptr()),
            )
        }
    }

    /// Executable name of whichever app owns the current clipboard contents.
    unsafe fn owner_app() -> String {
        let hwnd = GetClipboardOwner();
        if hwnd.is_null() {
            return String::new();
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return String::new();
        }
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or_default()
            .to_string()
    }

    /// Read the clipboard's Unicode text, or None when there's nothing for us:
    /// a password manager excluded it, it isn't text, or it's oversized.
    unsafe fn read_clipboard() -> Option<Captured> {
        let (exclude_fmt, history_fmt) = exclusion_formats();

        // Another app may hold the clipboard for a moment; a few short retries
        // are normal, and giving up is better than blocking.
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        if !opened {
            return None;
        }

        let result = (|| {
            if exclude_fmt != 0 && IsClipboardFormatAvailable(exclude_fmt) != 0 {
                return None;
            }
            if history_fmt != 0 && IsClipboardFormatAvailable(history_fmt) != 0 {
                // A DWORD: 0 means "keep this out of clipboard history".
                let h = GetClipboardData(history_fmt);
                if !h.is_null() {
                    let p = GlobalLock(h as HGLOBAL) as *const u32;
                    let allow = if p.is_null() { 1 } else { *p };
                    GlobalUnlock(h as HGLOBAL);
                    if allow == 0 {
                        return None;
                    }
                }
            }
            if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
                return None;
            }
            let h = GetClipboardData(CF_UNICODETEXT);
            if h.is_null() {
                return None;
            }
            let hg = h as HGLOBAL;
            let size = GlobalSize(hg);
            if size == 0 || size > super::MAX_BYTES * 2 {
                return None;
            }
            let ptr = GlobalLock(hg) as *const u16;
            if ptr.is_null() {
                return None;
            }
            let max = size / 2;
            let mut len = 0usize;
            while len < max && *ptr.add(len) != 0 {
                len += 1;
            }
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            GlobalUnlock(hg);
            Some(text)
        })();

        CloseClipboard();
        // Resolve the owning process only after closing. While the clipboard
        // is open nobody else can write to it, and OpenProcess +
        // QueryFullProcessImageName is far longer than the read itself — that
        // extra hold is enough to make another app's copy fail.
        result.map(|text| Captured {
            text,
            source_app: owner_app(),
        })
    }

    /// Put text on the clipboard. Once SetClipboardData succeeds the system
    /// owns the memory, so the allocation is deliberately not freed here.
    pub fn set_clipboard_text(text: &str) -> bool {
        unsafe {
            let mut wide: Vec<u16> = text.encode_utf16().collect();
            wide.push(0);
            let bytes = wide.len() * 2;

            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(std::ptr::null_mut()) != 0 {
                    opened = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            if !opened {
                return false;
            }
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if handle.is_null() {
                CloseClipboard();
                return false;
            }
            let dst = GlobalLock(handle) as *mut u16;
            if dst.is_null() {
                CloseClipboard();
                return false;
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
            GlobalUnlock(handle);

            EmptyClipboard();
            let ok = !SetClipboardData(CF_UNICODETEXT, handle as HANDLE).is_null();
            CloseClipboard();
            ok
        }
    }

    /// The window that had focus before DevDeck took it — where an auto-paste
    /// should land. Stored as a raw isize because HWND isn't Send.
    static PASTE_TARGET: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

    /// Snapshot the foreground window. Called just before we summon a window,
    /// while the app you were actually working in is still in front.
    pub fn remember_foreground() {
        unsafe {
            let hwnd = GetForegroundWindow();
            // Ignore our own windows, or ⇧⏎ would paste back into DevDeck.
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if !hwnd.is_null() && pid != std::process::id() {
                PASTE_TARGET.store(hwnd as isize, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    /// Restore the remembered window and send it Ctrl+V. Returns false when
    /// there's nothing to paste into or Windows refuses the foreground change
    /// -- the caller reports that honestly rather than claiming a paste.
    pub fn paste_into_target() -> bool {
        unsafe {
            let raw = PASTE_TARGET.load(std::sync::atomic::Ordering::Relaxed);
            if raw == 0 {
                return false;
            }
            let target = raw as HWND;
            if IsWindow(target) == 0 {
                return false;
            }
            if SetForegroundWindow(target) == 0 {
                return false;
            }
            // Let the target finish activating before the keystroke lands.
            std::thread::sleep(std::time::Duration::from_millis(90));

            let key = |vk: u16, up: bool| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            let mut inputs = [
                key(VK_CONTROL, false),
                key(VK_V, false),
                key(VK_V, true),
                key(VK_CONTROL, true),
            ];
            let sent = SendInput(
                inputs.len() as u32,
                inputs.as_mut_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
            sent == inputs.len() as u32
        }
    }

    /// Show a window without pulling focus from whatever you're typing in.
    /// Tauri's `show()` activates; a toast that steals focus mid-keystroke is
    /// worse than no toast at all.
    pub fn show_without_focus(hwnd: HWND) {
        unsafe {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }

    /// Hide the same way we showed. Tauri caches its own idea of visibility,
    /// and it never saw the raw ShowWindow above — so `hide()` can decide the
    /// window is already hidden and do nothing, leaving the toast stuck.
    pub fn hide_raw(hwnd: HWND) {
        unsafe {
            ShowWindow(hwnd, SW_HIDE);
        }
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_CLIPBOARDUPDATE {
            if let Some(app) = APP.get() {
                if let Some(cap) = read_clipboard() {
                    record(app, cap);
                }
            }
            return 0;
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    /// Create the message-only window and pump its queue forever. This thread
    /// does nothing else, so doing the (small) capture work inline in the
    /// wndproc keeps clips strictly in order.
    pub fn message_loop() {
        unsafe {
            let class = wide("DevDeckStashClipboard");
            let hinstance = GetModuleHandleW(std::ptr::null());
            let mut wc: WNDCLASSW = std::mem::zeroed();
            wc.lpfnWndProc = Some(wndproc);
            wc.hInstance = hinstance;
            wc.lpszClassName = class.as_ptr();
            if RegisterClassW(&wc) == 0 {
                return;
            }
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null::<c_void>(),
            );
            if hwnd.is_null() {
                return;
            }
            if AddClipboardFormatListener(hwnd) == 0 {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_the_common_shapes() {
        assert_eq!(classify("{\"a\": 1}"), "json");
        assert_eq!(classify("https://localhost:3000/orders?status=failed"), "url");
        assert_eq!(classify("select id from orders where total > 10"), "sql");
        assert_eq!(classify("C:\\Work\\devdeck\\src\\main.rs"), "path");
        assert_eq!(classify("f47ac10b-58cc-4372-a567-0e02b2c3d479"), "uuid");
        assert_eq!(classify("deadbeefcafe"), "hex");
        assert_eq!(
            classify("TypeError: x is undefined\n    at Orders (src/Orders.tsx:42:19)"),
            "stacktrace"
        );
        assert_eq!(classify("pnpm dlx shadcn-ui@latest add dialog"), "text");
    }

    #[test]
    fn flags_secrets_but_not_ordinary_clips() {
        assert!(secret_reason("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345").is_some());
        assert!(secret_reason("AKIAIOSFODNN7EXAMPLE").is_some());
        assert!(secret_reason("password: hunter2isaverylongone").is_some());
        assert!(secret_reason("postgres://app:s3cr3tpassword@db.acme.io:5432/app").is_some());
        assert!(secret_reason("-----BEGIN RSA PRIVATE KEY-----\nabc\n").is_some());

        assert!(secret_reason("select id from orders").is_none());
        assert!(secret_reason("https://localhost:3000/orders").is_none());
        assert!(secret_reason("f47ac10b-58cc-4372-a567-0e02b2c3d479").is_none());
        assert!(secret_reason("password: ${DB_PASSWORD}").is_none());
        // A git SHA is high-entropy but not a credential.
        assert!(secret_reason("9f2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d").is_none());
    }

    /// A database with the real schema, holding the clips below.
    fn seeded() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        // stash_items references nodes(id), and foreign keys are on by default.
        conn.execute_batch(
            "CREATE TABLE nodes (id INTEGER PRIMARY KEY);
             INSERT INTO nodes (id) VALUES (1), (2);",
        )
        .unwrap();
        conn.execute_batch(crate::db::STASH_SCHEMA).unwrap();
        // If this fails, the shipped SQLite has no FTS5 and search silently
        // degrades — the whole reason `fts_available()` exists.
        conn.execute_batch(crate::db::STASH_FTS_SCHEMA)
            .expect("FTS5 must be available in the bundled SQLite");
        set_fts_available(true);

        let rows: &[(&str, &str, Option<&str>, i64, i64, Option<i64>, &str)] = &[
            // item_type, title, content, is_secret, pinned, project_id, project_name
            ("json", "staging db config", Some(r#"{"host":"db.staging.acme.io"}"#), 0, 1, Some(1), "storefront"),
            ("sql", "top orders", Some("select id from orders"), 0, 0, Some(1), "storefront"),
            ("url", "failed orders", Some("http://localhost:3000/orders"), 0, 0, Some(2), "api-gateway"),
            // Captured outside any project, and flagged: content was never stored.
            ("text", "looks like an API key", None, 1, 0, None, ""),
        ];
        for (i, (item_type, title, content, is_secret, pinned, project_id, project)) in
            rows.iter().enumerate()
        {
            conn.execute(
                "INSERT INTO stash_items
                    (item_type, title, content, preview, is_secret, pinned, project_id,
                     project_name, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    item_type,
                    title,
                    content,
                    content.unwrap_or("••••"),
                    is_secret,
                    pinned,
                    project_id,
                    project,
                    1000 + i as i64
                ],
            )
            .unwrap();
        }
        conn
    }

    fn q(f: &str) -> StashQuery {
        StashQuery {
            filter: f.into(),
            ..Default::default()
        }
    }

    #[test]
    fn full_text_search_finds_clips_by_content() {
        let conn = seeded();
        let found = list_query(
            &conn,
            &StashQuery {
                query: "staging".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].item_type, "json");

        // Prefix matching: half a word still finds it.
        let partial = list_query(
            &conn,
            &StashQuery {
                query: "order".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(partial.len(), 2);
    }

    #[test]
    fn deleting_a_clip_drops_it_from_the_index() {
        let conn = seeded();
        conn.execute("DELETE FROM stash_items WHERE item_type = 'sql'", [])
            .unwrap();
        let found = list_query(
            &conn,
            &StashQuery {
                query: "orders".into(),
                ..Default::default()
            },
        )
        .unwrap();
        // Only the url clip is left — a stale index would still return the sql one.
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].item_type, "url");
    }

    #[test]
    fn filters_narrow_the_list() {
        let conn = seeded();
        assert_eq!(list_query(&conn, &q("all")).unwrap().len(), 4);
        assert_eq!(list_query(&conn, &q("pinned")).unwrap().len(), 1);
        assert_eq!(list_query(&conn, &q("code")).unwrap().len(), 2);
        assert_eq!(list_query(&conn, &q("links")).unwrap().len(), 1);

        let secrets = list_query(&conn, &q("secrets")).unwrap();
        assert_eq!(secrets.len(), 1);
        // The list never carries content, and a secret has none to carry.
        assert!(secrets[0].content.is_none());

        // "clips" is the catch-all group and must exclude flagged secrets --
        // as must the `text` smart tag they're stored under.
        assert!(list_query(&conn, &q("clips")).unwrap().is_empty());
        assert!(list_query(
            &conn,
            &StashQuery {
                item_type: "text".into(),
                ..Default::default()
            }
        )
        .unwrap()
        .is_empty());

        let in_storefront = list_query(
            &conn,
            &StashQuery {
                project_id: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(in_storefront.len(), 2);

        let outside = list_query(
            &conn,
            &StashQuery {
                no_project: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(outside.len(), 1);
        assert!(outside[0].is_secret);
    }

    #[test]
    fn pinned_clips_sort_first() {
        let conn = seeded();
        let all = list_query(&conn, &q("all")).unwrap();
        assert!(all[0].pinned, "the pinned clip should lead the list");
    }

    #[test]
    fn tags_attach_detach_and_filter() {
        let conn = seeded();
        let tags = tag_add(&conn, 2, &["slow query, tyrex bug".into()]).unwrap();
        assert_eq!(tags, vec!["slow query", "tyrex bug"]);
        tag_add(&conn, 3, &["tyrex bug".into()]).unwrap();

        // Two items share the tag, and it exists exactly once.
        let counts = tag_counts(&conn).unwrap();
        assert_eq!(counts.iter().filter(|t| t.name == "tyrex bug").count(), 1);
        assert_eq!(counts.iter().find(|t| t.name == "tyrex bug").unwrap().n, 2);

        let tagged = list_query(
            &conn,
            &StashQuery {
                tag: "tyrex bug".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(tagged.len(), 2);
        // Tags ride along on list rows, so cards can show them.
        assert!(tagged.iter().all(|i| i.tags.contains(&"tyrex bug".into())));

        // Case doesn't fork the tag.
        tag_add(&conn, 1, &["TYREX BUG".into()]).unwrap();
        assert_eq!(
            tag_counts(&conn)
                .unwrap()
                .iter()
                .filter(|t| t.name.eq_ignore_ascii_case("tyrex bug"))
                .count(),
            1
        );

        // Removing the last use prunes the tag rather than leaving a dead one.
        tag_remove(&conn, 2, "slow query").unwrap();
        assert!(!tag_counts(&conn).unwrap().iter().any(|t| t.name == "slow query"));
    }

    #[test]
    fn search_also_matches_tag_names() {
        let conn = seeded();
        tag_add(&conn, 3, &["tyrex".into()]).unwrap();
        let found = list_query(
            &conn,
            &StashQuery {
                query: "tyrex".into(),
                ..Default::default()
            },
        )
        .unwrap();
        // "tyrex" appears in no clip's text — only as a tag.
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, 3);
    }

    #[test]
    fn notes_are_searchable_and_editable() {
        let conn = seeded();
        let edited = update_item(
            &conn,
            &StashEdit {
                id: 3,
                title: Some("orders that failed".into()),
                note: Some("the repro for the tyrex ticket".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(edited.title, "orders that failed");
        assert_eq!(edited.note, "the repro for the tyrex ticket");

        // The note is indexed — this is how you find a clip months later.
        let found = list_query(
            &conn,
            &StashQuery {
                query: "repro".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, 3);
    }

    #[test]
    fn editing_content_reclassifies_and_clears_a_false_flag() {
        let conn = seeded();
        // #4 is the flagged row: no content, marked secret.
        let before = item_by_id(&conn, 4).unwrap();
        assert!(before.is_secret && before.content.is_none());

        let after = update_item(
            &conn,
            &StashEdit {
                id: 4,
                content: Some("select 1 from dual".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!after.is_secret);
        assert_eq!(after.item_type, "sql");
        assert_eq!(after.secret_reason, "");
        assert_eq!(after.bytes, 18);
    }

    #[test]
    fn a_hand_edit_cannot_write_a_secret_to_disk() {
        let conn = seeded();
        let err = update_item(
            &conn,
            &StashEdit {
                id: 1,
                content: Some("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(err.contains("GitHub token"), "reason should be specific: {err}");

        // The clip is untouched — no partial write.
        let item = item_by_id(&conn, 1).unwrap();
        assert_eq!(item.item_type, "json");
        assert!(item.content.unwrap().contains("db.staging.acme.io"));

        // Same rule for a note written from scratch.
        let note_err = create_note(
            &conn,
            &Ctx::default(),
            "prod db",
            "postgres://app:s3cr3tpassword@db.acme.io:5432/app",
        )
        .unwrap_err();
        assert!(note_err.contains("connection string"));
    }

    #[test]
    fn notes_are_created_classified_and_grouped() {
        let conn = seeded();
        let note = create_note(
            &conn,
            &Ctx {
                project_id: Some(1),
                project_name: "storefront".into(),
                workspace_name: "work".into(),
            },
            "",
            "{ \"retry\": 3 }",
        )
        .unwrap();
        assert_eq!(note.kind, "note");
        assert_eq!(note.item_type, "json"); // typed notes get the same smarts
        assert_eq!(note.title, "{ \"retry\": 3 }"); // derived from the body
        assert_eq!(note.project_name, "storefront");

        let notes = list_query(&conn, &q("notes")).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, note.id);
    }

    #[test]
    fn a_jwt_stays_decodable_but_a_random_token_does_not() {
        // Header {"alg":"HS256"} . payload {"sub":"user-42"} . signature
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTQyIn0.s1gn4tur3_v4lu3_here";
        // Kept, so the decode action has something to work with.
        assert_eq!(secret_reason(jwt), None, "a JWT must not be swallowed by the entropy rule");
        assert_eq!(classify(jwt), "jwt");

        // The same length and entropy, but not JWT-shaped: still flagged.
        let opaque = "k3Jx9QvBn2LpZr7Wt4Ys8Hd1Fg6Mc0Ae5Ui3Ob";
        assert!(secret_reason(opaque).is_some(), "an opaque token must still be flagged");
    }

    #[test]
    fn retention_keeps_anything_you_signalled_you_care_about() {
        let conn = seeded();
        let old_ts = now_millis() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
        conn.execute("UPDATE stash_items SET created_at = ?1", params![old_ts])
            .unwrap();

        // #1 pinned · #2 tagged · #3 has a note · #4 plain and stale
        tag_add(&conn, 2, &["keep me".into()]).unwrap();
        update_item(
            &conn,
            &StashEdit {
                id: 3,
                note: Some("why I kept this".into()),
                ..Default::default()
            },
        )
        .unwrap();
        // A note written by hand, also stale.
        let note = create_note(&conn, &Ctx::default(), "scratch", "just some text").unwrap();
        conn.execute(
            "UPDATE stash_items SET created_at = ?1 WHERE id = ?2",
            params![old_ts, note.id],
        )
        .unwrap();

        let removed = prune(&conn, 30).unwrap();
        assert_eq!(removed, 1, "only the untouched clip should go");

        let left: Vec<i64> = list_query(&conn, &q("all"))
            .unwrap()
            .iter()
            .map(|i| i.id)
            .collect();
        assert!(left.contains(&1), "pinned survives");
        assert!(left.contains(&2), "tagged survives");
        assert!(left.contains(&3), "noted survives");
        assert!(left.contains(&note.id), "a note you wrote survives");
        assert!(!left.contains(&4), "the untouched clip is gone");
    }

    #[test]
    fn ocr_text_from_a_login_screen_is_not_indexed() {
        // Real OCR output: layout is flattened, so the `key: value` shape the
        // clipboard rule relies on is gone. It still must not be stored.
        let scraped = "Open an Account: Acme Ltd. Registration Name: Server:                        Account type: Status: Login: Password: hunter2secret Demo";
        assert!(
            secret_reason(scraped).is_none(),
            "precondition: the clipboard rule misses flattened OCR text"
        );
        assert!(
            ocr_secret_reason(scraped).is_some(),
            "the image rule must catch what the clipboard rule misses"
        );

        // Vendor token shapes still come through the underlying rule.
        assert!(ocr_secret_reason("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8").is_some());
        // And an ordinary screenshot is left alone.
        assert!(ocr_secret_reason("Machine Setup  Search & install  winget scoop").is_none());
    }

    #[test]
    fn stored_ocr_text_is_redacted_retroactively() {
        let conn = seeded();
        conn.execute(
            "INSERT INTO stash_items
                (kind, item_type, title, content, preview, thumb, file_path, created_at)
             VALUES ('screenshot', 'image', 'login.png',
                     'Server: Login: Password: hunter2secret Demo', 'Server: Login:',
                     'data:image/jpeg;base64,AAAA', 'C:/x/login.png', ?1)",
            params![now_millis()],
        )
        .unwrap();
        // A harmless one, to prove the pass is selective.
        conn.execute(
            "INSERT INTO stash_items
                (kind, item_type, title, content, preview, thumb, file_path, created_at)
             VALUES ('screenshot', 'image', 'ok.png', 'Machine Setup winget scoop',
                     'Machine Setup', 'data:image/jpeg;base64,BBBB', 'C:/x/ok.png', ?1)",
            params![now_millis()],
        )
        .unwrap();

        assert_eq!(redact_stored_ocr(&conn).unwrap(), 1);

        // The words are gone from the index, not merely hidden in the UI.
        let found = list_query(
            &conn,
            &StashQuery {
                query: "hunter2secret".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(found.is_empty(), "redacted text must leave the search index");

        let shots = list_query(&conn, &q("screenshots")).unwrap();
        let flagged = shots.iter().find(|i| i.title == "login.png").unwrap();
        assert!(flagged.is_secret);
        assert_eq!(flagged.thumb, "", "the thumbnail is a second copy of the secret");
        let kept = shots.iter().find(|i| i.title == "ok.png").unwrap();
        assert!(!kept.is_secret);
        assert_ne!(kept.thumb, "", "an ordinary screenshot keeps its preview");
    }

    #[test]
    fn retention_never_prunes_screenshots() {
        let conn = seeded();
        let old_ts = now_millis() - 400 * 24 * 60 * 60 * 1000; // over a year old
        conn.execute(
            "INSERT INTO stash_items
                (kind, item_type, title, content, preview, file_path, created_at)
             VALUES ('screenshot', 'image', 'old.png', 'some ocr text', 'ocr',
                     'C:/Users/x/Pictures/Screenshots/old.png', ?1)",
            params![old_ts],
        )
        .unwrap();
        conn.execute("UPDATE stash_items SET created_at = ?1 WHERE kind = 'clip'", params![old_ts])
            .unwrap();

        prune(&conn, 30).unwrap();
        let left = list_query(&conn, &q("screenshots")).unwrap();
        assert_eq!(left.len(), 1, "a linked screenshot must survive any age");
        assert_eq!(left[0].file_path, "C:/Users/x/Pictures/Screenshots/old.png");
    }

    #[test]
    fn retention_of_zero_days_keeps_everything() {
        let conn = seeded();
        conn.execute(
            "UPDATE stash_items SET created_at = ?1",
            params![now_millis() - 365 * 24 * 60 * 60 * 1000],
        )
        .unwrap();
        assert_eq!(prune(&conn, 0).unwrap(), 0, "0 days must mean forever");
        assert_eq!(list_query(&conn, &q("all")).unwrap().len(), 4);
    }

    #[test]
    fn fts_expression_survives_punctuation() {
        assert_eq!(fts_expr("conn string"), Some("\"conn\"* \"string\"*".into()));
        assert_eq!(fts_expr("  "), None);
        // Punctuation-only tokens are dropped and quotes stripped, so no
        // amount of punctuation can escape into FTS5 syntax.
        assert_eq!(fts_expr("\"; drop table --"), Some("\"drop\"* \"table\"*".into()));
    }
}
