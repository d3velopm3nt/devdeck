//! Mail — accounts, sync, reading and sending.
//!
//! Local-first, like the rest of DevDeck: messages are fetched to this machine
//! and indexed in SQLite, so search works over everything and mail still opens
//! with the network down. Nothing is sent anywhere on your behalf except the
//! mail you press Send on.
//!
//! Passwords are never here. They live in Windows Credential Manager
//! (`creds.rs`) under `devdeck:mail:<id>`, are read only to open one IMAP or
//! SMTP connection, and are never returned over IPC or written to SQLite.
//!
//! TLS is rustls on every platform on purpose. native-tls would mean SChannel
//! on Windows but OpenSSL headers everywhere else, and the whole point of
//! shipping a mail client is that it builds and runs the same way each time.

use std::net::TcpStream;
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::creds;
use crate::db::{err, Db};
use crate::services::push_log;

/// System log stream for mail, alongside setup (-300k) and git (-400k).
const MAIL_LOG_ID: i64 = -500_000;
/// Messages pulled per mailbox per sync. A mail client is not an archive
/// migration tool; older mail stays on the server until you go looking.
const SYNC_LIMIT: u32 = 200;
/// A body larger than this is stored truncated. Some senders ship a megabyte
/// of inlined CSS, and none of it is worth blocking the UI thread for.
const MAX_BODY: usize = 512 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const IO_TIMEOUT: Duration = Duration::from_secs(45);

/// Credential Manager target for an account's password.
pub fn target_for(account_id: i64) -> String {
    format!("devdeck:mail:{account_id}")
}

/// Where a Google refresh token lives. A separate credential from the
/// password on purpose: switching an account from one to the other must not
/// leave the other still sitting in the vault, and `has_password` must never
/// come back true because a refresh token happens to be stored.
pub fn token_target_for(account_id: i64) -> String {
    format!("devdeck:mail:{account_id}:google")
}

/// An account's auth method, defaulted rather than trusted.
///
/// A UI that forgets the field, or an older row, must mean `password` — the
/// only thing that existed before — rather than an empty string that no branch
/// matches and that would fail as "unknown auth" on a working account.
fn auth_of(a: &MailAccount) -> String {
    match a.auth.trim() {
        "oauth" => "oauth".to_string(),
        _ => "password".to_string(),
    }
}

/// Is this account reached with Google's consent rather than a password?
fn is_oauth(a: &MailAccount) -> bool {
    auth_of(a) == "oauth"
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------- types

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailAccount {
    pub id: i64,
    pub name: String,
    pub address: String,
    /// imap | gmail
    pub kind: String,
    pub imap_host: String,
    pub imap_port: i64,
    pub smtp_host: String,
    pub smtp_port: i64,
    pub username: String,
    pub signature: String,
    pub is_default: bool,
    pub sort: i64,
    pub created_at: i64,
    pub last_sync: i64,
    pub last_error: String,
    /// Whether a password is stored. Note what this is *not*: the password.
    #[serde(default)]
    pub has_password: bool,
    /// Which space this mailbox belongs to, by name. Empty until you say.
    ///
    /// A suggestion, not a rule: it becomes the default destination on each
    /// fact card, correctable in one click on the one card that is wrong.
    #[serde(default)]
    pub space: String,
    /// How we prove who we are: `password` | `oauth`.
    ///
    /// Not folded into `kind`. A Gmail account can be reached either way, and
    /// a plain IMAP host can never be reached by Google sign-in, so these are
    /// two questions and collapsing them would make one of the four
    /// combinations unrepresentable.
    #[serde(default)]
    pub auth: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailMessage {
    pub id: i64,
    pub account_id: i64,
    pub uid: i64,
    pub message_id: String,
    pub thread_key: String,
    pub mailbox: String,
    pub from_name: String,
    pub from_addr: String,
    pub to_addrs: String,
    pub cc_addrs: String,
    pub subject: String,
    pub preview: String,
    pub ts: i64,
    pub unread: bool,
    pub flagged: bool,
    pub is_bot: bool,
    pub contact_id: Option<i64>,
    pub node_id: Option<i64>,
    /// Account address this arrived at, for the "to …" line.
    #[serde(default)]
    pub account_address: String,
    #[serde(default)]
    pub attachments: i64,
}

/// A message with everything needed to read it. Split from `MailMessage` so a
/// list of 200 threads does not carry 200 HTML bodies to the webview.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailBody {
    pub id: i64,
    pub body_text: String,
    pub body_html: String,
    pub raw_headers: String,
    pub attachments: Vec<MailAttachment>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailAttachment {
    pub id: i64,
    pub message_id: i64,
    pub filename: String,
    pub mime: String,
    pub bytes: i64,
    pub part_index: i64,
    pub file_path: String,
    /// Whether the bytes are actually on disk.
    ///
    /// Derived rather than stored, from whether a path was recorded. A write
    /// can fail for ordinary reasons — a full disk, a Drive folder that is
    /// offline — and the row still exists so the message still lists the
    /// attachment. Without this the UI would offer to open a file that is not
    /// there, which is the failure-looks-like-success pattern this project has
    /// a rule about.
    #[serde(default)]
    pub saved: bool,
    /// '' not tried | text | withheld | unreadable | missing.
    #[serde(default)]
    pub extract_state: String,
    /// Why, when the state is not `text`. Empty otherwise.
    #[serde(default)]
    pub extract_note: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailContact {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub alt_email: String,
    pub role: String,
    pub company: String,
    pub phone: String,
    pub notes: String,
    /// Comma-separated, like Stash tags.
    pub tags: String,
    pub node_id: Option<i64>,
    pub kind: String,
    pub created_at: i64,
    /// Threads seen from this address. Derived, never stored.
    #[serde(default)]
    pub threads: i64,
    #[serde(default)]
    pub last_ts: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AssistantNote {
    pub id: i64,
    pub thread_key: String,
    pub account_id: i64,
    /// summary | draft | action
    pub kind: String,
    pub body: String,
    /// new | accepted | dismissed | done
    pub status: String,
    pub created_at: i64,
}

/// What the thread list is filtered by. One struct so the UI and the SQL can
/// never drift apart about what a "group" means.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailQuery {
    /// inbox | unread | flagged | clients | projects | bots | sent | drafts | archive
    #[serde(default)]
    pub group: String,
    /// all | unread | flagged | files
    #[serde(default)]
    pub chip: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub account_id: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct MailCounts {
    pub inbox: i64,
    pub unread: i64,
    pub flagged: i64,
    pub clients: i64,
    pub projects: i64,
    pub bots: i64,
    pub sent: i64,
    pub drafts: i64,
    pub archive: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SendRequest {
    pub account_id: i64,
    pub to: String,
    #[serde(default)]
    pub cc: String,
    pub subject: String,
    pub body: String,
    /// Message-ID being replied to, so the thread stays a thread.
    #[serde(default)]
    pub in_reply_to: String,
    /// Files to attach, by absolute path.
    #[serde(default)]
    pub attachments: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TestResult {
    pub imap_ok: bool,
    pub imap_detail: String,
    pub smtp_ok: bool,
    pub smtp_detail: String,
}

// ---------------------------------------------------------------- rows

const ACCOUNT_COLS: &str = "id, name, address, kind, imap_host, imap_port, smtp_host, smtp_port, \
     username, signature, is_default, sort, created_at, last_sync, last_error, auth, space";

fn row_to_account(row: &rusqlite::Row) -> rusqlite::Result<MailAccount> {
    let id: i64 = row.get(0)?;
    Ok(MailAccount {
        id,
        name: row.get(1)?,
        address: row.get(2)?,
        kind: row.get(3)?,
        imap_host: row.get(4)?,
        imap_port: row.get(5)?,
        smtp_host: row.get(6)?,
        smtp_port: row.get(7)?,
        username: row.get(8)?,
        signature: row.get(9)?,
        is_default: row.get::<_, i64>(10)? != 0,
        sort: row.get(11)?,
        created_at: row.get(12)?,
        last_sync: row.get(13)?,
        last_error: row.get(14)?,
        auth: row.get::<_, String>(15).unwrap_or_else(|_| "password".into()),
        space: row.get::<_, String>(16).unwrap_or_default(),
        has_password: creds::exists(&target_for(id)),
    })
}

const MSG_COLS: &str = "m.id, m.account_id, m.uid, m.message_id, m.thread_key, m.mailbox, \
     m.from_name, m.from_addr, m.to_addrs, m.cc_addrs, m.subject, m.preview, m.ts, \
     m.unread, m.flagged, m.is_bot, m.contact_id, m.node_id, \
     COALESCE(a.address, ''), \
     (SELECT COUNT(*) FROM mail_attachments x WHERE x.message_id = m.id)";

fn row_to_msg(row: &rusqlite::Row) -> rusqlite::Result<MailMessage> {
    Ok(MailMessage {
        id: row.get(0)?,
        account_id: row.get(1)?,
        uid: row.get(2)?,
        message_id: row.get(3)?,
        thread_key: row.get(4)?,
        mailbox: row.get(5)?,
        from_name: row.get(6)?,
        from_addr: row.get(7)?,
        to_addrs: row.get(8)?,
        cc_addrs: row.get(9)?,
        subject: row.get(10)?,
        preview: row.get(11)?,
        ts: row.get(12)?,
        unread: row.get::<_, i64>(13)? != 0,
        flagged: row.get::<_, i64>(14)? != 0,
        is_bot: row.get::<_, i64>(15)? != 0,
        contact_id: row.get(16)?,
        node_id: row.get(17)?,
        account_address: row.get(18)?,
        attachments: row.get(19)?,
    })
}

// ---------------------------------------------------------------- accounts

#[tauri::command]
pub fn mail_accounts_list(db: tauri::State<Db>) -> Result<Vec<MailAccount>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!("SELECT {ACCOUNT_COLS} FROM mail_accounts ORDER BY sort, id");
    let mut st = conn.prepare(&sql).map_err(err)?;
    let rows = st.query_map([], row_to_account).map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub fn mail_account_save(db: tauri::State<Db>, def: MailAccount) -> Result<i64, String> {
    if def.address.trim().is_empty() {
        return Err("An account needs an email address.".into());
    }
    let conn = db.0.lock().unwrap();
    let id = if def.id <= 0 {
        conn.execute(
            "INSERT INTO mail_accounts
                (name, address, kind, imap_host, imap_port, smtp_host, smtp_port,
                 username, signature, is_default, sort, created_at, auth, space)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                def.name,
                def.address.trim(),
                def.kind,
                def.imap_host,
                def.imap_port,
                def.smtp_host,
                def.smtp_port,
                def.username,
                def.signature,
                def.is_default as i64,
                def.sort,
                now_millis(),
                auth_of(&def),
                def.space.trim()
            ],
        )
        .map_err(err)?;
        conn.last_insert_rowid()
    } else {
        conn.execute(
            "UPDATE mail_accounts
                SET name=?1, address=?2, kind=?3, imap_host=?4, imap_port=?5,
                    smtp_host=?6, smtp_port=?7, username=?8, signature=?9,
                    is_default=?10, sort=?11, auth=?13, space=?14
              WHERE id=?12",
            params![
                def.name,
                def.address.trim(),
                def.kind,
                def.imap_host,
                def.imap_port,
                def.smtp_host,
                def.smtp_port,
                def.username,
                def.signature,
                def.is_default as i64,
                def.sort,
                def.id,
                auth_of(&def),
                def.space.trim()
            ],
        )
        .map_err(err)?;
        def.id
    };
    // Exactly one default, always — otherwise "send from" is a coin toss.
    if def.is_default {
        conn.execute(
            "UPDATE mail_accounts SET is_default = 0 WHERE id <> ?1",
            params![id],
        )
        .map_err(err)?;
    }
    Ok(id)
}

#[tauri::command]
pub fn mail_account_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    {
        let conn = db.0.lock().unwrap();
        // Cached mail and attachments go with it (ON DELETE CASCADE).
        conn.execute("DELETE FROM mail_accounts WHERE id=?1", params![id])
            .map_err(err)?;
    }
    creds::delete(&target_for(id));
    Ok(())
}

#[tauri::command]
pub fn mail_account_set_password(id: i64, username: String, password: String) -> Result<(), String> {
    if id <= 0 {
        return Err("Save the account before setting its password.".into());
    }
    creds::set(&target_for(id), &username, &password)
}

#[tauri::command]
pub fn mail_account_clear_password(id: i64) -> Result<bool, String> {
    Ok(creds::delete(&target_for(id)))
}

/// Do the whole Google conversation on a worker thread.
///
/// This is not a tidiness measure. A synchronous `#[tauri::command]` runs on
/// the thread that serves the UI's messages, and this one waits minutes for a
/// person to finish in a browser. Calling it directly froze the entire window
/// behind a greyed-out "Waiting for your browser..." that never came back —
/// the app could not even repaint the spinner it was showing.
async fn wait_for_google(hint: String) -> Result<crate::gauth::Tokens, String> {
    tauri::async_runtime::spawn_blocking(move || crate::gauth::sign_in(&hint))
        .await
        .map_err(|e| format!("the sign-in task did not finish: {e}"))?
}

/// Whether this build can offer Google sign-in at all.
///
/// The UI asks before drawing the button, because a button that always
/// answers "there is no client configured" is worse than no button.
/// Read attachments that nobody has tried yet.
///
/// A separate pass rather than part of sync, for two reasons. OCR is slow
/// enough that folding it into a fetch loop would make mail feel broken, and
/// it needs an `AppHandle` for the MTA the Windows OCR engine requires, which
/// a sync worker holding a database lock has no business carrying.
///
/// Every row ends in a state. `pending` never survives a pass, because "we
/// tried and found nothing" and "nobody has looked" are different facts and
/// the UI has to be able to tell them apart.
#[tauri::command]
pub async fn mail_extract(app: tauri::AppHandle, limit: i64) -> Result<i64, String> {
    off_thread(app, move |app, db| extract_pending(app, db, limit)).await
}

fn extract_pending(app: &tauri::AppHandle, db: &Db, limit: i64) -> Result<i64, String> {
    let limit = limit.clamp(1, 500);
    let todo: Vec<(i64, String, String)> = {
        let conn = db.0.lock().unwrap();
        let mut st = conn
            .prepare(
                "SELECT id, file_path, mime FROM mail_attachments
                  WHERE extract_state = '' AND file_path <> ''
                  ORDER BY id DESC LIMIT ?1",
            )
            .map_err(err)?;
        let rows = st
            .query_map(params![limit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
    };

    let mut done = 0i64;
    for (id, path, mime) in todo {
        let file = std::path::PathBuf::from(&path);
        // The file can be gone: a Drive folder that is offline, or someone
        // tidying up. That is not the same as unreadable, and saying so is the
        // difference between "reconnect your drive" and "this type is not
        // supported".
        if !file.is_file() {
            let conn = db.0.lock().unwrap();
            conn.execute(
                "UPDATE mail_attachments SET extract_state='missing', extract_note=?2 WHERE id=?1",
                params![id, "the file is not where the row says it is"],
            )
            .map_err(err)?;
            continue;
        }

        // Extraction happens outside the lock. OCR on a large scan takes
        // seconds, and holding the database for that stalls every other query
        // in the app.
        let out = crate::mailfiles::extract(&app, &file, &mime);

        let (state, note) = match &out {
            crate::mailfiles::Extracted::Text(text) => {
                // The text lands beside the file, not in the database. You can
                // open it and read exactly what the machine read, which is the
                // only way a claim about what was sent to a model is checkable.
                match std::fs::write(crate::mailfiles::text_path(&file), text) {
                    Ok(()) => ("text", String::new()),
                    Err(e) => ("unreadable", format!("could not save the text: {e}")),
                }
            }
            // Withheld keeps the file and never writes the text anywhere. A
            // scanned passport becomes searchable the moment it is written
            // down, and this is the moment it would have been.
            crate::mailfiles::Extracted::Withheld(reason) => ("withheld", (*reason).to_string()),
            crate::mailfiles::Extracted::Unreadable(why) => ("unreadable", why.clone()),
        };

        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE mail_attachments SET extract_state=?2, extract_note=?3 WHERE id=?1",
            params![id, state, note],
        )
        .map_err(err)?;
        done += 1;
    }
    Ok(done)
}

/// What one attachment's text says, for the UI and later for a learn run.
///
/// Returns nothing for anything withheld. The refusal is not a lookup that
/// happens to fail: there is no stored text to return, by design.
#[tauri::command]
pub fn mail_attachment_text(db: tauri::State<Db>, id: i64) -> Result<Option<String>, String> {
    let (path, state): (String, String) = {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT file_path, extract_state FROM mail_attachments WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?
    };
    if state != "text" {
        return Ok(None);
    }
    let p = crate::mailfiles::text_path(std::path::Path::new(&path));
    Ok(std::fs::read_to_string(p).ok())
}

/// Somebody worth learning about, and the evidence for saying so.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Correspondent {
    pub contact_id: i64,
    pub name: String,
    pub email: String,
    /// The company part of the address, which is most of "who is this".
    pub domain: String,
    pub received: i64,
    /// How many times *you* wrote to them. The whole signal.
    pub sent: i64,
    pub threads: i64,
    pub last_ts: i64,
    /// Which account's mailbox this correspondence lives in, and therefore
    /// which space a fact about them would be filed under by default.
    pub account_id: i64,
    pub space: String,
}

/// Who you actually correspond with, most-reciprocal first.
///
/// **Reciprocity, not volume.** A mailbox is mostly noise: Amazon has sent a
/// thousand messages and is not a person. Ranking by how much someone sends
/// you surfaces exactly the senders you never think about, which is the
/// opposite of useful. Having written *back* is the one signal that separates
/// a relationship from a subscription, and it cannot be gamed by a sender.
///
/// **Nothing leaves the machine.** This is a query over the inbox and sent
/// folders, both of which are already synced. It is what makes a later learn
/// run small enough to be worth approving, and it costs nothing to run.
///
/// Sent-to matching is a substring test on the recipient list. A stored
/// `to_addrs` is a display list rather than parsed addresses, so this is the
/// honest tool for it: it can over-count when one address contains another,
/// and that is a rank being slightly wrong rather than a fact being wrong.
#[tauri::command]
pub fn mail_correspondents(db: tauri::State<Db>, limit: i64) -> Result<Vec<Correspondent>, String> {
    let conn = db.0.lock().unwrap();
    rank_correspondents(&conn, limit)
}

/// The ranking itself, over a connection rather than app state.
///
/// Split out so it can be tested against a database built by hand. The claim
/// this makes — that reciprocity beats volume — is the one the whole learn run
/// rests on, and a claim nothing can exercise is a claim nobody has checked.
fn rank_correspondents(conn: &Connection, limit: i64) -> Result<Vec<Correspondent>, String> {
    let limit = limit.clamp(1, 500);

    let mut st = conn
        .prepare(
            "SELECT c.id, c.name, c.email,
                    (SELECT COUNT(*) FROM mail_messages m
                      WHERE m.mailbox='INBOX' AND lower(m.from_addr)=lower(c.email)),
                    (SELECT COUNT(*) FROM mail_messages m
                      WHERE m.mailbox='Sent' AND instr(lower(m.to_addrs), lower(c.email)) > 0),
                    (SELECT COUNT(DISTINCT m.thread_key) FROM mail_messages m
                      WHERE lower(m.from_addr)=lower(c.email)
                         OR instr(lower(m.to_addrs), lower(c.email)) > 0),
                    (SELECT COALESCE(MAX(m.ts), 0) FROM mail_messages m
                      WHERE lower(m.from_addr)=lower(c.email)
                         OR instr(lower(m.to_addrs), lower(c.email)) > 0),
                    (SELECT COALESCE(MAX(m.account_id), 0) FROM mail_messages m
                      WHERE lower(m.from_addr)=lower(c.email))
               FROM mail_contacts c
              WHERE c.email <> '' AND c.kind <> 'bot'",
        )
        .map_err(err)?;

    let rows = st
        .query_map([], |r| {
            let email: String = r.get(2)?;
            Ok(Correspondent {
                contact_id: r.get(0)?,
                name: r.get(1)?,
                domain: email.split('@').nth(1).unwrap_or_default().to_string(),
                email,
                received: r.get(3)?,
                sent: r.get(4)?,
                threads: r.get(5)?,
                last_ts: r.get(6)?,
                account_id: r.get(7)?,
                space: String::new(),
            })
        })
        .map_err(err)?;

    let mut all: Vec<Correspondent> = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .into_iter()
        // Never written back means not a correspondent. This one line is what
        // removes the thousand messages nobody wants read.
        .filter(|c| c.sent > 0)
        .collect();

    // Each mailbox's space, so a fact gets a suggested destination without
    // anyone guessing from the content.
    let spaces: std::collections::HashMap<i64, String> = {
        let mut st = conn
            .prepare("SELECT id, space FROM mail_accounts")
            .map_err(err)?;
        let pairs = st
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        pairs.into_iter().collect()
    };
    for c in &mut all {
        c.space = spaces.get(&c.account_id).cloned().unwrap_or_default();
    }

    // Replies first, then breadth of conversation, then recency. Someone you
    // answered twenty times outranks someone you answered once however
    // recently, because the question is who matters rather than who is new.
    all.sort_by(|a, b| {
        b.sent
            .cmp(&a.sent)
            .then(b.threads.cmp(&a.threads))
            .then(b.last_ts.cmp(&a.last_ts))
    });
    all.truncate(limit as usize);
    Ok(all)
}

#[tauri::command]
pub fn mail_google_available() -> bool {
    crate::gauth::client().is_some()
}

/// Open the browser, wait for consent, and keep the refresh token.
///
/// Ordered so a failure leaves nothing behind: Google first, the credential
/// second, the row last. A sign-in that is cancelled at the browser touches
/// no account at all.
#[tauri::command]
pub async fn mail_google_sign_in(
    db: tauri::State<'_, Db>,
    id: i64,
    address: String,
) -> Result<(), String> {
    if id <= 0 {
        return Err("Save the account before signing in to it.".into());
    }
    let tokens = wait_for_google(address.clone()).await?;

    creds::set(&token_target_for(id), &address, &tokens.refresh)?;
    // An account can arrive here holding an old app password. Leaving it would
    // mean a stale credential in the vault that nothing reads and nobody can
    // see, which is exactly the sort of thing that turns up in an audit.
    creds::delete(&target_for(id));

    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE mail_accounts SET auth='oauth', last_error='' WHERE id=?1",
            params![id],
        )
        .map_err(err)?;
    }
    token_cache().lock().unwrap().insert(id, tokens);
    Ok(())
}

/// Sign in and set the whole account up from what Google reports.
///
/// The onboarding path, where there is no account yet and nothing typed. The
/// address is Google's answer rather than the user's guess, which is what
/// makes this a single click and also what stops an account being built
/// against a mailbox the token cannot open — people have several Google
/// accounts and the chooser remembers a different one than they expect.
///
/// Re-connecting an address that already exists updates that row instead of
/// adding a second one. Two rows for one mailbox would sync it twice and show
/// every message in duplicate.
#[tauri::command]
pub async fn mail_google_connect(db: tauri::State<'_, Db>) -> Result<MailAccount, String> {
    let tokens = wait_for_google(String::new()).await?;
    let address = tokens.email.trim().to_string();
    if address.is_empty() {
        return Err("Google did not say which account signed in, so there is nothing to                     connect. Add the account by hand and sign in from there."
            .into());
    }

    let id = {
        let conn = db.0.lock().unwrap();
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM mail_accounts WHERE lower(address)=lower(?1)",
                params![address],
                |r| r.get(0),
            )
            .ok();

        match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE mail_accounts SET kind='gmail', auth='oauth', imap_host='imap.gmail.com',                      imap_port=993, smtp_host='smtp.gmail.com', smtp_port=465, last_error=''                      WHERE id=?1",
                    params![id],
                )
                .map_err(err)?;
                id
            }
            None => {
                // First account becomes the default, because "send from" with
                // nothing chosen is a dialog that cannot be completed.
                let none_yet: i64 = conn
                    .query_row("SELECT COUNT(*) FROM mail_accounts", [], |r| r.get(0))
                    .unwrap_or(0);
                conn.execute(
                    "INSERT INTO mail_accounts
                        (name, address, kind, imap_host, imap_port, smtp_host, smtp_port,
                         username, signature, is_default, sort, created_at, auth)
                     VALUES (?1,?2,'gmail','imap.gmail.com',993,'smtp.gmail.com',465,'','',?3,0,?4,'oauth')",
                    params![address, address, (none_yet == 0) as i64, now_millis()],
                )
                .map_err(err)?;
                conn.last_insert_rowid()
            }
        }
    };

    creds::set(&token_target_for(id), &address, &tokens.refresh)?;
    creds::delete(&target_for(id));
    token_cache().lock().unwrap().insert(id, tokens);

    let conn = db.0.lock().unwrap();
    load_account(&conn, id)
}

/// Forget Google's consent for this account.
///
/// Only the local copy. Google keeps its own record until you remove DevDeck
/// under your account's third-party connections, and saying otherwise would be
/// a claim we cannot honour.
#[tauri::command]
pub fn mail_google_sign_out(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    creds::delete(&token_target_for(id));
    token_cache().lock().unwrap().remove(&id);
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE mail_accounts SET auth='password' WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- IMAP

/// A TLS stream to `host:port`. Split out because both sync and the
/// connection test need exactly this and nothing more.
fn tls_stream(host: &str, port: u16) -> Result<rustls_connector::TlsStream<TcpStream>, String> {
    if host.trim().is_empty() {
        return Err("No host configured.".into());
    }
    let addr = format!("{host}:{port}");
    let sock = addr
        .to_socket_addrs_first()
        .ok_or_else(|| format!("Could not resolve {addr}"))?;
    let tcp = TcpStream::connect_timeout(&sock, CONNECT_TIMEOUT)
        .map_err(|e| format!("Could not reach {addr}: {e}"))?;
    tcp.set_read_timeout(Some(IO_TIMEOUT)).ok();
    tcp.set_write_timeout(Some(IO_TIMEOUT)).ok();
    let connector = rustls_connector::RustlsConnector::new_with_native_certs()
        .map_err(|e| format!("Could not load system certificates: {e}"))?;
    connector
        .connect(host, tcp)
        .map_err(|e| format!("TLS handshake with {host} failed: {e}"))
}

/// `ToSocketAddrs` yields an iterator; every caller here wants the first one
/// and a clear error rather than an empty iterator.
trait FirstAddr {
    fn to_socket_addrs_first(&self) -> Option<std::net::SocketAddr>;
}
impl FirstAddr for String {
    fn to_socket_addrs_first(&self) -> Option<std::net::SocketAddr> {
        use std::net::ToSocketAddrs;
        self.to_socket_addrs().ok()?.next()
    }
}

type ImapSession = imap::Session<rustls_connector::TlsStream<TcpStream>>;

/// Turn a server's refusal into the sentence that fixes it.
///
/// Gmail answers a wrong password and a *right* password that is your Google
/// account password with the same eight words: `[AUTHENTICATIONFAILED]
/// Invalid credentials (Failure)`. One of those you fix by retyping, the other
/// you cannot fix by retyping at all, and the message does not distinguish
/// them — so people retype their Google password until they give up.
///
/// The raw line is always kept, because a translated error that turns out to
/// be about something else is worse than a cryptic one.
fn explain_login(host: &str, raw: &str) -> String {
    let gmail = host.contains("gmail.com") || host.contains("googlemail.com");
    let auth = raw.to_ascii_lowercase();
    let refused = auth.contains("authenticationfailed")
        || auth.contains("invalid credentials")
        || auth.contains("username and password not accepted");

    if gmail && refused {
        return format!(
            "Google refused it. Gmail has not accepted account passwords over IMAP since 2022 —              it needs a 16-character app password, which is a different thing you generate once.              Turn on 2-Step Verification first, or the page that makes them does not exist.              (Server said: {raw})"
        );
    }
    if refused {
        return format!(
            "{host} refused that username and password. If the account has two-factor              authentication, most hosts need an app-specific password here rather than the one              you log in with. (Server said: {raw})"
        );
    }
    format!("IMAP login refused: {raw}")
}

/// The SASL side of XOAUTH2, which the imap crate asks us to supply.
struct XOAuth2 {
    user: String,
    access: String,
}

impl imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> Self::Response {
        // Raw, not base64: the imap crate encodes whatever comes back here.
        crate::gauth::sasl_xoauth2(&self.user, &self.access)
    }
}

fn login_user(acct: &MailAccount) -> String {
    if acct.username.trim().is_empty() {
        acct.address.clone()
    } else {
        acct.username.clone()
    }
}

/// Log in with whichever proof this account carries.
///
/// `secret` is a password or a live access token, and which one it is comes
/// from the account rather than from the caller — there is exactly one place
/// that decides, so an OAuth account can never be sent down the password path
/// and fail with a message about app passwords.
fn imap_login(acct: &MailAccount, secret: &str) -> Result<ImapSession, String> {
    let stream = tls_stream(&acct.imap_host, acct.imap_port as u16)?;
    let client = imap::Client::new(stream);
    let user = login_user(acct);

    if is_oauth(acct) {
        return client
            .authenticate(
                "XOAUTH2",
                &XOAuth2 {
                    user,
                    access: secret.to_string(),
                },
            )
            .map_err(|(e, _)| {
                format!(
                    "Google accepted the sign-in but refused the mailbox: {e}.                      If this persists, remove DevDeck under your Google account's                      third-party connections and sign in again."
                )
            });
    }

    client
        .login(user, secret)
        .map_err(|(e, _)| explain_login(&acct.imap_host, &e.to_string()))
}

/// Live access tokens, by account.
///
/// An access token lasts an hour and a refresh costs a round trip to Google,
/// so refreshing on every IMAP connect would put a network call in front of
/// every sync, send and test. Memory only, deliberately: a token on disk is a
/// second credential to protect for no gain, since the refresh token can
/// always mint another.
static TOKENS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<i64, crate::gauth::Tokens>>> =
    std::sync::OnceLock::new();

fn token_cache() -> &'static std::sync::Mutex<std::collections::HashMap<i64, crate::gauth::Tokens>> {
    TOKENS.get_or_init(Default::default)
}

fn now_ms_epoch() -> i64 {
    now_millis()
}

/// A usable access token for an OAuth account, refreshed only when stale.
fn access_token_for(acct: &MailAccount) -> Result<String, String> {
    if let Some(t) = token_cache().lock().unwrap().get(&acct.id) {
        if t.expires_at_ms > now_ms_epoch() && !t.access.is_empty() {
            return Ok(t.access.clone());
        }
    }

    let client = crate::gauth::client().ok_or_else(crate::gauth::unavailable)?;
    let refresh = creds::get(&token_target_for(acct.id)).ok_or_else(|| {
        format!(
            "{} is set up for Google sign-in but there is no stored consent.              Open the account and sign in again.",
            acct.address
        )
    })?;

    let fresh = crate::gauth::refresh(&client, &refresh)?;
    // Google reissues the refresh token occasionally; keeping the new one is
    // what stops the account dying weeks later for no visible reason.
    if fresh.refresh != refresh {
        let _ = creds::set(&token_target_for(acct.id), &acct.address, &fresh.refresh);
    }
    let access = fresh.access.clone();
    token_cache().lock().unwrap().insert(acct.id, fresh);
    Ok(access)
}

/// Whatever this account proves itself with: a password, or a live token.
fn password_for(acct: &MailAccount) -> Result<String, String> {
    if is_oauth(acct) {
        return access_token_for(acct);
    }
    creds::get(&target_for(acct.id)).ok_or_else(|| {
        format!(
            "No password stored for {}. Add one in Settings → Mail accounts.",
            acct.address
        )
    })
}

#[tauri::command]
pub async fn mail_account_test(app: tauri::AppHandle, id: i64) -> Result<TestResult, String> {
    off_thread(app, move |_app, db| test_account(db, id)).await
}

fn test_account(db: &Db, id: i64) -> Result<TestResult, String> {
    let acct = {
        let conn = db.0.lock().unwrap();
        load_account(&conn, id)?
    };
    let password = password_for(&acct)?;

    let mut out = TestResult::default();
    match imap_login(&acct, &password) {
        Ok(mut session) => {
            match session.list(Some(""), Some("*")) {
                Ok(boxes) => {
                    out.imap_ok = true;
                    out.imap_detail = format!(
                        "connected, {} mailbox{}",
                        boxes.len(),
                        if boxes.len() == 1 { "" } else { "es" }
                    );
                }
                Err(e) => out.imap_detail = format!("logged in but LIST failed: {e}"),
            }
            let _ = session.logout();
        }
        Err(e) => out.imap_detail = e,
    }

    match smtp_transport(&acct, &password) {
        Ok(mailer) => match mailer.test_connection() {
            Ok(true) => {
                out.smtp_ok = true;
                out.smtp_detail = format!("authenticated on {}", acct.smtp_port);
            }
            Ok(false) => out.smtp_detail = "server did not accept the connection".into(),
            Err(e) => out.smtp_detail = format!("{e}"),
        },
        Err(e) => out.smtp_detail = e,
    }
    Ok(out)
}

fn load_account(conn: &Connection, id: i64) -> Result<MailAccount, String> {
    let sql = format!("SELECT {ACCOUNT_COLS} FROM mail_accounts WHERE id=?1");
    conn.query_row(&sql, params![id], row_to_account)
        .map_err(|_| format!("No mail account with id {id}."))
}

/// Which local mailbox name we file a server folder under. Servers disagree
/// wildly ("Sent Items", "[Gmail]/Sent Mail", "INBOX.Sent"), so match loosely
/// and default to leaving it alone.
fn local_mailbox(name: &str, attrs: &[String]) -> Option<&'static str> {
    // SPECIAL-USE attributes first (RFC 6154). Gmail, Outlook and Fastmail all
    // advertise them, and they are unambiguous where a name never is: a folder
    // called "Sent to accountant" is not the Sent folder.
    for a in attrs {
        match a.to_ascii_lowercase().as_str() {
            r"\sent" => return Some("Sent"),
            r"\drafts" => return Some("Drafts"),
            r"\archive" => return Some("Archive"),
            // Deliberately never synced. `\All` is Gmail's All Mail, which is
            // a superset of the entire account — syncing it fetches everything
            // a second time, and it is what put thirty-four thousand messages
            // in front of a sync that should have taken seconds.
            r"\all" | r"\junk" | r"\trash" | r"\flagged" | r"\important" => return None,
            _ => {}
        }
    }

    let l = name.to_ascii_lowercase();
    if l == "inbox" {
        return Some("INBOX");
    }
    // Exact names, for servers that do not advertise SPECIAL-USE. Matching on
    // "contains" is what filed Spam, Trash, Starred and every user label as
    // INBOX: anything unrecognised fell through to it.
    let bare = l
        .trim_start_matches("[gmail]/")
        .trim_start_matches("inbox.")
        .trim_start_matches("inbox/");
    match bare {
        "sent" | "sent mail" | "sent items" | "sent messages" => Some("Sent"),
        "drafts" | "draft" => Some("Drafts"),
        "archive" | "archives" => Some("Archive"),
        // Anything else is a label, a folder of someone's own, or a server
        // special we do not want. Skipped, not guessed at.
        _ => None,
    }
}

/// Threading without server support: strip reply/forward prefixes and use what
/// is left. Crude, and right often enough that a reply lands on its thread.
fn thread_key_for(subject: &str) -> String {
    let mut s = subject.trim();
    loop {
        let l = s.to_ascii_lowercase();
        let cut = ["re:", "fw:", "fwd:", "aw:", "antw:"]
            .iter()
            .find(|p| l.starts_with(**p))
            .map(|p| p.len());
        match cut {
            Some(n) => s = s[n..].trim_start(),
            None => break,
        }
    }
    s.to_ascii_lowercase()
}

/// Mail nobody typed: CI, monitoring, billing. Kept out of the notification
/// path so real mail is not buried, never hidden.
fn looks_automated(from: &str, headers: &str) -> bool {
    let f = from.to_ascii_lowercase();
    let h = headers.to_ascii_lowercase();
    h.contains("auto-submitted: auto-generated")
        || h.contains("precedence: bulk")
        || h.contains("x-auto-response-suppress")
        || ["noreply", "no-reply", "donotreply", "notifications@", "mailer-daemon"]
            .iter()
            .any(|p| f.contains(p))
}

fn addr_display(list: &[mailparse::MailAddr]) -> (String, String) {
    let mut name = String::new();
    let mut addr = String::new();
    for a in list {
        if let mailparse::MailAddr::Single(s) = a {
            name = s.display_name.clone().unwrap_or_default();
            addr = s.addr.clone();
            break;
        }
    }
    (name, addr)
}

fn addr_join(list: &[mailparse::MailAddr]) -> String {
    list.iter()
        .filter_map(|a| match a {
            mailparse::MailAddr::Single(s) => Some(s.addr.clone()),
            mailparse::MailAddr::Group(g) => Some(
                g.addrs
                    .iter()
                    .map(|s| s.addr.clone())
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn truncate(mut s: String, max: usize) -> String {
    if s.len() > max {
        s.truncate(max);
        s.push_str("\n…[truncated]");
    }
    s
}

/// One parsed message, ready to store.
struct Parsed {
    message_id: String,
    from_name: String,
    from_addr: String,
    to_addrs: String,
    cc_addrs: String,
    subject: String,
    body_text: String,
    body_html: String,
    raw_headers: String,
    ts: i64,
    is_bot: bool,
    /// name, mime, part index, and the bytes themselves.
    ///
    /// The parser already had these and threw them away after measuring the
    /// length, which is why an invoice was known to exist and had never been
    /// opened.
    attachments: Vec<(String, String, i64, Vec<u8>)>,
}

fn parse_message(raw: &[u8], fallback_ts: i64) -> Result<Parsed, String> {
    let mail = mailparse::parse_mail(raw).map_err(|e| format!("Could not parse message: {e}"))?;
    let h = &mail.headers;
    use mailparse::MailHeaderMap;

    let get = |k: &str| h.get_first_value(k).unwrap_or_default();
    let (from_name, from_addr) = match mailparse::addrparse(&get("From")) {
        Ok(list) => addr_display(&list),
        Err(_) => (String::new(), String::new()),
    };
    let to_addrs = mailparse::addrparse(&get("To"))
        .map(|l| addr_join(&l))
        .unwrap_or_default();
    let cc_addrs = mailparse::addrparse(&get("Cc"))
        .map(|l| addr_join(&l))
        .unwrap_or_default();

    let ts = mailparse::dateparse(&get("Date"))
        .map(|s| s * 1000)
        .unwrap_or(fallback_ts);

    // Headers only, so the Source tab can show what actually arrived.
    let raw_headers = String::from_utf8_lossy(raw)
        .split("\r\n\r\n")
        .next()
        .unwrap_or_default()
        .replace("\r\n", "\n");

    let mut body_text = String::new();
    let mut body_html = String::new();
    let mut attachments = Vec::new();
    collect_parts(&mail, &mut body_text, &mut body_html, &mut attachments, &mut 0);

    Ok(Parsed {
        message_id: get("Message-ID"),
        from_name,
        is_bot: looks_automated(&from_addr, &raw_headers),
        from_addr,
        to_addrs,
        cc_addrs,
        subject: get("Subject"),
        body_text: truncate(body_text, MAX_BODY),
        body_html: truncate(body_html, MAX_BODY),
        raw_headers: truncate(raw_headers, 16 * 1024),
        ts,
        attachments,
    })
}

/// Walk the MIME tree. Attachments are recorded as metadata only — filename,
/// type and size — never written to disk on sync.
fn collect_parts(
    part: &mailparse::ParsedMail,
    text: &mut String,
    html: &mut String,
    files: &mut Vec<(String, String, i64, Vec<u8>)>,
    index: &mut i64,
) {
    use mailparse::MailHeaderMap;
    let mime = part.ctype.mimetype.to_ascii_lowercase();
    let disposition = part.get_content_disposition();
    let filename = disposition.params.get("filename").cloned().or_else(|| {
        part.headers
            .get_first_value("Content-Type")
            .and_then(|_| part.ctype.params.get("name").cloned())
    });
    let is_attachment = matches!(
        disposition.disposition,
        mailparse::DispositionType::Attachment
    ) || filename.is_some();

    if part.subparts.is_empty() {
        let idx = *index;
        *index += 1;
        if is_attachment {
            let bytes = part.get_body_raw().unwrap_or_default();
            files.push((
                filename.unwrap_or_else(|| format!("part-{idx}")),
                mime,
                idx,
                bytes,
            ));
        } else if mime.starts_with("text/html") {
            if html.is_empty() {
                *html = part.get_body().unwrap_or_default();
            }
        } else if mime.starts_with("text/") && text.is_empty() {
            *text = part.get_body().unwrap_or_default();
        }
        return;
    }
    for sub in &part.subparts {
        collect_parts(sub, text, html, files, index);
    }
}

/// Strip tags for the list preview. Not a sanitiser and not trying to be one —
/// the reader renders HTML in a sandboxed frame; this is one line of plain text.
fn preview_from(text: &str, html: &str) -> String {
    let src = if !text.trim().is_empty() {
        text.to_string()
    } else {
        let mut out = String::with_capacity(html.len());
        let mut depth = 0usize;
        for c in html.chars() {
            match c {
                '<' => depth += 1,
                '>' => depth = depth.saturating_sub(1),
                _ if depth == 0 => out.push(c),
                _ => {}
            }
        }
        out
    };
    let flat = src.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(240).collect()
}

/// Run slow work off the thread that serves the interface.
///
/// A synchronous `#[tauri::command]` runs on the thread Tauri uses to answer
/// the UI, so anything that talks to a network freezes the whole window while
/// it waits. Sync fetches hundreds of messages across four folders; sending
/// opens an SMTP session; testing logs in twice; extraction runs OCR. Every
/// one of those froze the app for as long as it took, and the first symptom is
/// always the same: clicking does nothing and the window greys out.
///
/// The database cannot be moved across threads by value, so the worker asks
/// the app handle for it instead. That is the same managed `Db` the command
/// would have been handed.
async fn off_thread<T, F>(app: tauri::AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&tauri::AppHandle, &Db) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let db = <tauri::AppHandle as tauri::Manager<tauri::Wry>>::state::<Db>(&app);
        f(&app, &db)
    })
    .await
    .map_err(|e| format!("the task did not finish: {e}"))?
}

#[tauri::command]
pub async fn mail_sync(app: tauri::AppHandle, id: i64) -> Result<i64, String> {
    off_thread(app, move |app, db| sync_accounts(app, db, id)).await
}

fn sync_accounts(app: &tauri::AppHandle, db: &Db, id: i64) -> Result<i64, String> {
    let accounts = {
        let conn = db.0.lock().unwrap();
        if id > 0 {
            vec![load_account(&conn, id)?]
        } else {
            let sql = format!("SELECT {ACCOUNT_COLS} FROM mail_accounts ORDER BY sort, id");
            let mut st = conn.prepare(&sql).map_err(err)?;
            let rows = st.query_map([], row_to_account).map_err(err)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?
        }
    };
    if accounts.is_empty() {
        return Err("No mail accounts configured.".into());
    }

    let mut total = 0i64;
    let mut failures: Vec<String> = Vec::new();
    for acct in accounts {
        push_log(
            &app,
            MAIL_LOG_ID,
            "mail",
            "system",
            format!("sync {} …", acct.address),
        );
        // Clear the last failure before trying, not only after succeeding.
        // Clearing on success alone is correct right up until a sync is
        // interrupted -- the app quits, the machine sleeps -- and then an
        // account that has just pulled three hundred messages still wears an
        // error from an attempt that is no longer true. Which is exactly what
        // happened. An error on screen should always describe the most recent
        // attempt, and this makes that true by construction.
        {
            let conn = db.0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE mail_accounts SET last_error='' WHERE id=?1",
                params![acct.id],
            );
        }
        match sync_one(&app, &db, &acct) {
            Ok(n) => {
                total += n;
                // Scoped, and it matters more than it looks. `activity::record`
                // below needs this same lock, and it deliberately gives up
                // rather than waiting forever -- because holding the database
                // across a log call has frozen this app three times before.
                // Leaving the guard alive here meant it gave up every time, so
                // the "synced" event was never emitted, the interface never
                // heard that the sync had finished, and the account went on
                // reading "never synced" over a mailbox with three hundred
                // messages in it.
                {
                    let conn = db.0.lock().unwrap();
                    let _ = conn.execute(
                        "UPDATE mail_accounts SET last_sync=?1, last_error='' WHERE id=?2",
                        params![now_millis(), acct.id],
                    );
                }
                push_log(
                    &app,
                    MAIL_LOG_ID,
                    "mail",
                    "system",
                    format!("{}: {n} new or updated", acct.address),
                );
                crate::activity::record(
                    &app,
                    "mail",
                    format!("Synced {}", acct.address),
                    format!("{n} message{}", if n == 1 { "" } else { "s" }),
                    true,
                    Some(acct.id),
                );
            }
            Err(e) => {
                // Failure honesty: the account keeps the reason, and the UI
                // shows it. A sync that quietly does nothing looks identical
                // to an empty inbox, which is how you miss mail for a week.
                {
                    let conn = db.0.lock().unwrap();
                    let _ = conn.execute(
                        "UPDATE mail_accounts SET last_error=?1 WHERE id=?2",
                        params![e, acct.id],
                    );
                }
                push_log(
                    &app,
                    MAIL_LOG_ID,
                    "mail",
                    "stderr",
                    format!("{}: {e}", acct.address),
                );
                crate::activity::record(
                    &app,
                    "mail",
                    format!("Sync failed for {}", acct.address),
                    e.clone(),
                    false,
                    Some(acct.id),
                );
                failures.push(format!("{}: {e}", acct.address));
            }
        }
    }
    if !failures.is_empty() && total == 0 {
        return Err(failures.join("; "));
    }
    Ok(total)
}

fn sync_one(app: &tauri::AppHandle, db: &Db, acct: &MailAccount) -> Result<i64, String> {
    // Narrate each step. A sync that stalls used to leave exactly one line in
    // the log -- "sync <address> …" -- and then silence, which says only that
    // something started. Saying what it is about to do turns a hang into a
    // sentence naming the thing that hung.
    let say = |line: String| push_log(app, MAIL_LOG_ID, "mail", "system", line);

    if is_oauth(acct) {
        say("asking Google for a fresh access token…".into());
    }
    let password = password_for(acct)?;
    // Read the folder before the network work, under its own short lock, so a
    // slow IMAP session never holds the database open waiting on a socket.
    let root = {
        let conn = db.0.lock().unwrap();
        crate::mailfiles::root(&conn)
    };
    say(format!("connecting to {}…", acct.imap_host));
    let mut session = imap_login(acct, &password)?;
    say("connected. listing folders…".into());

    let mut stored = 0i64;
    let mut folder_errors: Vec<String> = Vec::new();
    // Only the folders the UI has groups for. A mail client that syncs every
    // label on a Gmail account spends its life syncing.
    let wanted = ["INBOX", "Sent", "Drafts", "Archive"];
    let folders: Vec<(String, Vec<String>)> = match session.list(Some(""), Some("*")) {
        Ok(boxes) => boxes
            .iter()
            .map(|b| {
                (
                    b.name().to_string(),
                    b.attributes().iter().map(|a| format!("{a:?}")).collect(),
                )
            })
            .collect(),
        Err(_) => vec![("INBOX".to_string(), Vec::new())],
    };

    for (remote, attrs) in folders {
        let Some(local) = local_mailbox(&remote, &attrs) else {
            continue;
        };
        if !wanted.contains(&local) {
            continue;
        }
        let mailbox = match session.select(&remote) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if mailbox.exists == 0 {
            continue;
        }
        say(format!("{local}: {} on the server", mailbox.exists));
        let hi = mailbox.exists;
        let lo = hi.saturating_sub(SYNC_LIMIT).max(1);
        let set = format!("{lo}:{hi}");
        let fetches = match session.fetch(&set, "(UID FLAGS INTERNALDATE RFC822)") {
            Ok(f) => f,
            // Skip this folder, keep the others. Aborting the whole account
            // here threw away every message already stored from the folders
            // that worked, and left the account wearing an error about one
            // folder as though nothing had synced at all.
            Err(e) => {
                folder_errors.push(format!("{remote}: {e}"));
                continue;
            }
        };

        for f in fetches.iter() {
            let Some(raw) = f.body().or_else(|| f.header()) else {
                continue;
            };
            let internal = f
                .internal_date()
                .map(|d| d.timestamp_millis())
                .unwrap_or_else(now_millis);
            let parsed = match parse_message(raw, internal) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let seen = f.flags().iter().any(|fl| *fl == imap::types::Flag::Seen);
            let flagged = f.flags().iter().any(|fl| *fl == imap::types::Flag::Flagged);
            let uid = f.uid.unwrap_or(0) as i64;

            let conn = db.0.lock().unwrap();
            store_message(&conn, &root, acct, local, uid, &parsed, !seen, flagged)?;
            stored += 1;
        }
    }
    let _ = session.logout();
    say(format!("done. {stored} new or updated."));
    // A folder that failed while others worked is still worth saying out loud,
    // but only when nothing came through at all is it a failed sync. Otherwise
    // one unreadable Archive would mark a perfectly good inbox as broken.
    if !folder_errors.is_empty() && stored == 0 {
        return Err(folder_errors.join("; "));
    }
    Ok(stored)
}

/// Upsert one message. Read/flag state from the server wins on first sight but
/// never clobbers a local read — marking something read here should not be
/// undone by the next sync.
/// Store one message, and write its attachments under `root`.
///
/// The folder is a parameter rather than read from settings in here, for two
/// reasons that point the same way: a test must never write into the real
/// appdata folder, and a function that quietly reaches for a global setting
/// hides the fact that it touches the disk at all.
fn store_message(
    conn: &Connection,
    root: &std::path::Path,
    acct: &MailAccount,
    mailbox: &str,
    uid: i64,
    p: &Parsed,
    unread: bool,
    flagged: bool,
) -> Result<(), String> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM mail_messages WHERE account_id=?1 AND mailbox=?2 AND uid=?3",
            params![acct.id, mailbox, uid],
            |r| r.get(0),
        )
        .ok();

    let preview = preview_from(&p.body_text, &p.body_html);
    let thread_key = thread_key_for(&p.subject);
    let contact_id = upsert_contact_from_mail(conn, &p.from_name, &p.from_addr, p.is_bot);

    let msg_id = if let Some(id) = existing {
        conn.execute(
            "UPDATE mail_messages
                SET subject=?1, preview=?2, body_text=?3, body_html=?4, raw_headers=?5,
                    ts=?6, flagged=?7, thread_key=?8, contact_id=?9
              WHERE id=?10",
            params![
                p.subject,
                preview,
                p.body_text,
                p.body_html,
                p.raw_headers,
                p.ts,
                flagged as i64,
                thread_key,
                contact_id,
                id
            ],
        )
        .map_err(err)?;
        id
    } else {
        conn.execute(
            "INSERT INTO mail_messages
                (account_id, uid, message_id, thread_key, mailbox, from_name, from_addr,
                 to_addrs, cc_addrs, subject, preview, body_text, body_html, raw_headers,
                 ts, unread, flagged, is_bot, contact_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            params![
                acct.id,
                uid,
                p.message_id,
                thread_key,
                mailbox,
                p.from_name,
                p.from_addr,
                p.to_addrs,
                p.cc_addrs,
                p.subject,
                preview,
                p.body_text,
                p.body_html,
                p.raw_headers,
                p.ts,
                unread as i64,
                flagged as i64,
                p.is_bot as i64,
                contact_id
            ],
        )
        .map_err(err)?;
        conn.last_insert_rowid()
    };

    conn.execute(
        "DELETE FROM mail_attachments WHERE message_id=?1",
        params![msg_id],
    )
    .map_err(err)?;

    for (name, mime, idx, bytes) in &p.attachments {
        // The file is written before the row, so a row never claims a path
        // that is not there. A write that fails costs the file, not the
        // message: the attachment is still listed with its name and size, its
        // path stays empty, and the UI says it is not on disk rather than
        // offering to open something that is not there.
        let path = crate::mailfiles::store(root, msg_id, name, bytes)
            .map(|pth| pth.display().to_string())
            .unwrap_or_default();
        conn.execute(
            "INSERT INTO mail_attachments (message_id, filename, mime, bytes, part_index, file_path)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![msg_id, name, mime, bytes.len() as i64, idx, path],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Everyone who mails you becomes a contact, unlinked, so the address book
/// fills itself. Linking one to a client is the part only you can do.
fn upsert_contact_from_mail(
    conn: &Connection,
    name: &str,
    addr: &str,
    is_bot: bool,
) -> Option<i64> {
    let email = addr.trim().to_ascii_lowercase();
    if email.is_empty() {
        return None;
    }
    if let Ok(id) = conn.query_row(
        "SELECT id FROM mail_contacts WHERE email=?1",
        params![email],
        |r| r.get::<_, i64>(0),
    ) {
        // Fill in a name we did not have; never overwrite one you edited.
        if !name.trim().is_empty() {
            let _ = conn.execute(
                "UPDATE mail_contacts SET name=?1 WHERE id=?2 AND name=''",
                params![name.trim(), id],
            );
        }
        return Some(id);
    }
    conn.execute(
        "INSERT INTO mail_contacts (name, email, kind, created_at) VALUES (?1,?2,?3,?4)",
        params![
            name.trim(),
            email,
            if is_bot { "bot" } else { "person" },
            now_millis()
        ],
    )
    .ok()?;
    Some(conn.last_insert_rowid())
}

// ---------------------------------------------------------------- reading

#[tauri::command]
pub fn mail_list(db: tauri::State<Db>, query: MailQuery) -> Result<Vec<MailMessage>, String> {
    let conn = db.0.lock().unwrap();
    let mut where_sql = String::from("1=1");
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    match query.group.as_str() {
        "unread" => where_sql.push_str(" AND m.mailbox='INBOX' AND m.unread=1"),
        "flagged" => where_sql.push_str(" AND m.flagged=1"),
        "clients" => where_sql
            .push_str(" AND m.mailbox='INBOX' AND m.contact_id IN (SELECT id FROM mail_contacts WHERE node_id IS NOT NULL)"),
        "projects" => where_sql.push_str(" AND m.mailbox='INBOX' AND m.node_id IS NOT NULL"),
        "bots" => where_sql.push_str(" AND m.mailbox='INBOX' AND m.is_bot=1"),
        "sent" => where_sql.push_str(" AND m.mailbox='Sent'"),
        "drafts" => where_sql.push_str(" AND m.mailbox='Drafts'"),
        "archive" => where_sql.push_str(" AND m.mailbox='Archive'"),
        _ => where_sql.push_str(" AND m.mailbox='INBOX'"),
    }
    match query.chip.as_str() {
        "unread" => where_sql.push_str(" AND m.unread=1"),
        "flagged" => where_sql.push_str(" AND m.flagged=1"),
        "files" => where_sql
            .push_str(" AND EXISTS (SELECT 1 FROM mail_attachments x WHERE x.message_id=m.id)"),
        _ => {}
    }
    if let Some(acct) = query.account_id {
        where_sql.push_str(" AND m.account_id=?");
        args.push(Box::new(acct));
    }
    let term = query.search.trim().to_string();
    if !term.is_empty() {
        where_sql.push_str(
            " AND (m.subject LIKE ? OR m.from_name LIKE ? OR m.from_addr LIKE ? OR m.preview LIKE ?)",
        );
        let like = format!("%{term}%");
        for _ in 0..4 {
            args.push(Box::new(like.clone()));
        }
    }

    let limit = query.limit.unwrap_or(300).clamp(1, 1000);
    let sql = format!(
        "SELECT {MSG_COLS} FROM mail_messages m
           LEFT JOIN mail_accounts a ON a.id = m.account_id
          WHERE {where_sql}
          ORDER BY m.ts DESC LIMIT {limit}"
    );
    let mut st = conn.prepare(&sql).map_err(err)?;
    let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = st
        .query_map(rusqlite::params_from_iter(refs), row_to_msg)
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub fn mail_counts(db: tauri::State<Db>) -> Result<MailCounts, String> {
    let conn = db.0.lock().unwrap();
    let one = |sql: &str| -> i64 {
        conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0)
    };
    Ok(MailCounts {
        inbox: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='INBOX'"),
        unread: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='INBOX' AND unread=1"),
        flagged: one("SELECT COUNT(*) FROM mail_messages WHERE flagged=1"),
        clients: one(
            "SELECT COUNT(*) FROM mail_messages WHERE mailbox='INBOX' AND contact_id IN \
             (SELECT id FROM mail_contacts WHERE node_id IS NOT NULL)",
        ),
        projects: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='INBOX' AND node_id IS NOT NULL"),
        bots: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='INBOX' AND is_bot=1"),
        sent: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='Sent'"),
        drafts: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='Drafts'"),
        archive: one("SELECT COUNT(*) FROM mail_messages WHERE mailbox='Archive'"),
    })
}

#[tauri::command]
pub fn mail_body(db: tauri::State<Db>, id: i64) -> Result<MailBody, String> {
    let conn = db.0.lock().unwrap();
    let (body_text, body_html, raw_headers) = conn
        .query_row(
            "SELECT body_text, body_html, raw_headers FROM mail_messages WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| format!("No message with id {id}."))?;

    let mut st = conn
        .prepare(
            "SELECT id, message_id, filename, mime, bytes, part_index, file_path,
                      extract_state, extract_note
               FROM mail_attachments WHERE message_id=?1 ORDER BY part_index",
        )
        .map_err(err)?;
    let rows = st
        .query_map(params![id], |r| {
            Ok(MailAttachment {
                id: r.get(0)?,
                message_id: r.get(1)?,
                filename: r.get(2)?,
                mime: r.get(3)?,
                bytes: r.get(4)?,
                part_index: r.get(5)?,
                file_path: r.get::<_, String>(6)?,
                saved: !r.get::<_, String>(6)?.trim().is_empty(),
                extract_state: r.get::<_, String>(7).unwrap_or_default(),
                extract_note: r.get::<_, String>(8).unwrap_or_default(),
            })
        })
        .map_err(err)?;
    let attachments = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    Ok(MailBody {
        id,
        body_text,
        body_html,
        raw_headers,
        attachments,
    })
}

#[tauri::command]
pub fn mail_mark_read(db: tauri::State<Db>, id: i64, read: bool) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE mail_messages SET unread=?1 WHERE id=?2",
        params![!read as i64, id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn mail_set_flag(db: tauri::State<Db>, id: i64, flagged: bool) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE mail_messages SET flagged=?1 WHERE id=?2",
        params![flagged as i64, id],
    )
    .map_err(err)?;
    Ok(())
}

/// Move to Archive locally. The server copy is untouched: DevDeck is not the
/// only client on this mailbox, and archiving here should not surprise you
/// on your phone.
#[tauri::command]
pub fn mail_archive(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE mail_messages SET mailbox='Archive' WHERE id=?1",
        params![id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn mail_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM mail_messages WHERE id=?1", params![id])
        .map_err(err)?;
    Ok(())
}

/// Link a thread to a project node, so mail, repo and terminal share a subject.
#[tauri::command]
pub fn mail_link_node(
    db: tauri::State<Db>,
    id: i64,
    node_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let thread_key: String = conn
        .query_row(
            "SELECT thread_key FROM mail_messages WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| format!("No message with id {id}."))?;
    conn.execute(
        "UPDATE mail_messages SET node_id=?1 WHERE thread_key=?2",
        params![node_id, thread_key],
    )
    .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- sending

fn smtp_transport(
    acct: &MailAccount,
    password: &str,
) -> Result<lettre::SmtpTransport, String> {
    use lettre::transport::smtp::authentication::Credentials;
    if acct.smtp_host.trim().is_empty() {
        return Err("No SMTP host configured.".into());
    }
    let user = if acct.username.trim().is_empty() {
        acct.address.clone()
    } else {
        acct.username.clone()
    };
    let creds = Credentials::new(user, password.to_string());
    let mechanism = if is_oauth(acct) {
        // lettre defaults to PLAIN/LOGIN, which Google refuses outright for an
        // access token. Naming the mechanism is what makes the token usable.
        vec![lettre::transport::smtp::authentication::Mechanism::Xoauth2]
    } else {
        vec![
            lettre::transport::smtp::authentication::Mechanism::Plain,
            lettre::transport::smtp::authentication::Mechanism::Login,
        ]
    };
    // 587 is STARTTLS by convention, 465 implicit TLS. Guessing wrong here is
    // the single most common "it just hangs" in every mail client ever built.
    let builder = if acct.smtp_port == 587 {
        lettre::SmtpTransport::starttls_relay(&acct.smtp_host)
    } else {
        lettre::SmtpTransport::relay(&acct.smtp_host)
    }
    .map_err(|e| format!("SMTP setup failed: {e}"))?;
    Ok(builder
        .port(acct.smtp_port as u16)
        .credentials(creds)
        .authentication(mechanism)
        .timeout(Some(IO_TIMEOUT))
        .build())
}

#[tauri::command]
pub async fn mail_send(app: tauri::AppHandle, req: SendRequest) -> Result<i64, String> {
    off_thread(app, move |app, db| send_message(app, db, req)).await
}

fn send_message(app: &tauri::AppHandle, db: &Db, req: SendRequest) -> Result<i64, String> {
    use lettre::message::{header, Attachment, MultiPart, SinglePart};
    use lettre::{Message, Transport};

    let acct = {
        let conn = db.0.lock().unwrap();
        load_account(&conn, req.account_id)?
    };
    if req.to.trim().is_empty() {
        return Err("Add at least one recipient.".into());
    }
    let password = password_for(&acct)?;

    let from = format!("{} <{}>", acct.name, acct.address)
        .parse::<lettre::message::Mailbox>()
        .or_else(|_| acct.address.parse())
        .map_err(|e| format!("Your own address is not valid: {e}"))?;

    let mut builder = Message::builder().from(from).subject(&req.subject);
    for a in req.to.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        builder = builder.to(a
            .parse()
            .map_err(|e| format!("Not a valid recipient ({a}): {e}"))?);
    }
    for a in req.cc.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        builder = builder.cc(a
            .parse()
            .map_err(|e| format!("Not a valid Cc ({a}): {e}"))?);
    }
    if !req.in_reply_to.trim().is_empty() {
        builder = builder
            .in_reply_to(req.in_reply_to.clone())
            .references(req.in_reply_to.clone());
    }

    let signed = if acct.signature.trim().is_empty() {
        req.body.clone()
    } else {
        format!("{}\n\n{}", req.body, acct.signature)
    };

    let email = if req.attachments.is_empty() {
        builder
            .header(header::ContentType::TEXT_PLAIN)
            .body(signed.clone())
            .map_err(|e| format!("Could not build the message: {e}"))?
    } else {
        let mut multi = MultiPart::mixed().singlepart(
            SinglePart::builder()
                .header(header::ContentType::TEXT_PLAIN)
                .body(signed.clone()),
        );
        for path in &req.attachments {
            let bytes = std::fs::read(path).map_err(|e| format!("Could not read {path}: {e}"))?;
            let name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "attachment".into());
            let mime: header::ContentType = "application/octet-stream".parse().unwrap();
            multi = multi.singlepart(Attachment::new(name).body(bytes, mime));
        }
        builder
            .multipart(multi)
            .map_err(|e| format!("Could not build the message: {e}"))?
    };

    let mailer = smtp_transport(&acct, &password)?;
    mailer
        .send(&email)
        .map_err(|e| format!("Send failed: {e}"))?;

    push_log(
        &app,
        MAIL_LOG_ID,
        "mail",
        "system",
        format!("sent \"{}\" to {}", req.subject, req.to),
    );
    crate::activity::record(
        &app,
        "mail",
        format!("Sent: {}", req.subject),
        format!("to {}", req.to),
        true,
        Some(acct.id),
    );

    // Keep our own copy: the Sent group should show it now, not after the
    // next sync, and some servers never file an SMTP send into Sent at all.
    let conn = db.0.lock().unwrap();
    let ts = now_millis();
    conn.execute(
        "INSERT INTO mail_messages
            (account_id, uid, message_id, thread_key, mailbox, from_name, from_addr,
             to_addrs, cc_addrs, subject, preview, body_text, ts, unread, flagged, is_bot)
         VALUES (?1,?2,?3,?4,'Sent',?5,?6,?7,?8,?9,?10,?11,?12,0,0,0)",
        params![
            acct.id,
            -ts, // negative: local-only, can never collide with a server UID
            req.in_reply_to,
            thread_key_for(&req.subject),
            acct.name,
            acct.address,
            req.to,
            req.cc,
            req.subject,
            preview_from(&signed, ""),
            signed,
            ts
        ],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

// ---------------------------------------------------------------- contacts

#[tauri::command]
pub fn mail_contacts_list(db: tauri::State<Db>) -> Result<Vec<MailContact>, String> {
    let conn = db.0.lock().unwrap();
    let mut st = conn
        .prepare(
            "SELECT c.id, c.name, c.email, c.alt_email, c.role, c.company, c.phone, c.notes,
                    c.tags, c.node_id, c.kind, c.created_at,
                    (SELECT COUNT(DISTINCT m.thread_key) FROM mail_messages m WHERE m.contact_id=c.id),
                    COALESCE((SELECT MAX(m.ts) FROM mail_messages m WHERE m.contact_id=c.id), 0)
               FROM mail_contacts c
              ORDER BY c.name = '' , c.name COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = st
        .query_map([], |r| {
            Ok(MailContact {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
                alt_email: r.get(3)?,
                role: r.get(4)?,
                company: r.get(5)?,
                phone: r.get(6)?,
                notes: r.get(7)?,
                tags: r.get(8)?,
                node_id: r.get(9)?,
                kind: r.get(10)?,
                created_at: r.get(11)?,
                threads: r.get(12)?,
                last_ts: r.get(13)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub fn mail_contact_save(db: tauri::State<Db>, def: MailContact) -> Result<i64, String> {
    if def.email.trim().is_empty() {
        return Err("A contact needs an email address.".into());
    }
    let conn = db.0.lock().unwrap();
    let email = def.email.trim().to_ascii_lowercase();
    if def.id <= 0 {
        conn.execute(
            "INSERT INTO mail_contacts
                (name, email, alt_email, role, company, phone, notes, tags, node_id, kind, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                def.name.trim(),
                email,
                def.alt_email,
                def.role,
                def.company,
                def.phone,
                def.notes,
                def.tags,
                def.node_id,
                if def.kind.is_empty() { "person".into() } else { def.kind.clone() },
                now_millis()
            ],
        )
        .map_err(err)?;
        let id = conn.last_insert_rowid();
        // Adopt the mail already sitting in the cache from this address.
        let _ = conn.execute(
            "UPDATE mail_messages SET contact_id=?1 WHERE LOWER(from_addr)=?2",
            params![id, email],
        );
        Ok(id)
    } else {
        conn.execute(
            "UPDATE mail_contacts
                SET name=?1, email=?2, alt_email=?3, role=?4, company=?5, phone=?6,
                    notes=?7, tags=?8, node_id=?9, kind=?10
              WHERE id=?11",
            params![
                def.name.trim(),
                email,
                def.alt_email,
                def.role,
                def.company,
                def.phone,
                def.notes,
                def.tags,
                def.node_id,
                def.kind,
                def.id
            ],
        )
        .map_err(err)?;
        Ok(def.id)
    }
}

#[tauri::command]
pub fn mail_contact_delete(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM mail_contacts WHERE id=?1", params![id])
        .map_err(err)?;
    Ok(())
}

/// Link (or unlink) a contact to a node in the project tree — the client.
#[tauri::command]
pub fn mail_contact_link(
    db: tauri::State<Db>,
    id: i64,
    node_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE mail_contacts SET node_id=?1 WHERE id=?2",
        params![node_id, id],
    )
    .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- assistant

#[tauri::command]
pub fn mail_assistant_list(
    db: tauri::State<Db>,
    thread_key: String,
) -> Result<Vec<AssistantNote>, String> {
    let conn = db.0.lock().unwrap();
    let mut st = conn
        .prepare(
            "SELECT id, thread_key, account_id, kind, body, status, created_at
               FROM mail_assistant WHERE thread_key=?1 ORDER BY created_at",
        )
        .map_err(err)?;
    let rows = st
        .query_map(params![thread_key], |r| {
            Ok(AssistantNote {
                id: r.get(0)?,
                thread_key: r.get(1)?,
                account_id: r.get(2)?,
                kind: r.get(3)?,
                body: r.get(4)?,
                status: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

#[tauri::command]
pub fn mail_assistant_add(db: tauri::State<Db>, note: AssistantNote) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO mail_assistant (thread_key, account_id, kind, body, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            note.thread_key,
            note.account_id,
            note.kind,
            note.body,
            if note.status.is_empty() { "new".into() } else { note.status.clone() },
            now_millis()
        ],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn mail_assistant_status(
    db: tauri::State<Db>,
    id: i64,
    status: String,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE mail_assistant SET status=?1 WHERE id=?2",
        params![status, id],
    )
    .map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::db::CORE_SCHEMA).unwrap();
        c.execute_batch(crate::db::MAIL_SCHEMA).unwrap();
        // Migrations too, or these tests run against a shape no installed copy
        // of DevDeck has ever had. Columns added by a migration -- auth, space,
        // the extraction state -- simply would not exist here, and a query
        // that works everywhere would fail only in the test suite.
        crate::db::migrate(&c);
        c
    }

    /// A throwaway attachments folder.
    ///
    /// Storing a message now writes files, so every test that stores one needs
    /// somewhere that is not the real appdata directory. Named per test so two
    /// running at once cannot delete each other's.
    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("devdeck-mail-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn thread_key_strips_reply_prefixes() {
        assert_eq!(thread_key_for("Re: Fwd: Quote"), "quote");
        assert_eq!(thread_key_for("RE: RE: Quote"), "quote");
        assert_eq!(thread_key_for("Quote"), "quote");
        // A subject that merely starts with those letters is not a prefix.
        assert_eq!(thread_key_for("Refund please"), "refund please");
    }

    #[test]
    fn mailbox_names_map_to_local_folders() {
        let none: &[String] = &[];
        assert_eq!(local_mailbox("[Gmail]/Sent Mail", none), Some("Sent"));
        assert_eq!(local_mailbox("INBOX.Drafts", none), Some("Drafts"));
        assert_eq!(local_mailbox("Archive", none), Some("Archive"));
        assert_eq!(local_mailbox("INBOX", none), Some("INBOX"));
    }

    /// The bug this replaces was written down as intended behaviour: the old
    /// test asserted that an unrecognised folder becomes INBOX. On Gmail every
    /// label is a folder, so Spam, Trash, Starred and every label anyone has
    /// ever made were all being filed as Inbox -- which is how a 321-message
    /// inbox became 523 with mail from fourteen years ago in it.
    #[test]
    fn a_folder_we_do_not_recognise_is_skipped_not_called_inbox() {
        let none: &[String] = &[];
        for name in [
            "Some Client Folder",
            "[Gmail]/Spam",
            "[Gmail]/Trash",
            "[Gmail]/Starred",
            "[Gmail]/Important",
            "Receipts 2019",
        ] {
            assert_eq!(local_mailbox(name, none), None, "{name}");
        }
    }

    /// Gmail's All Mail is every message in the account a second time. Syncing
    /// it put 34,840 messages in front of a sync that should take seconds.
    #[test]
    fn gmail_all_mail_is_never_synced() {
        assert_eq!(local_mailbox("[Gmail]/All Mail", &[r"\All".to_string()]), None);
        assert_eq!(local_mailbox("[Gmail]/Spam", &[r"\Junk".to_string()]), None);
        assert_eq!(local_mailbox("[Gmail]/Bin", &[r"\Trash".to_string()]), None);
    }

    /// A server that advertises SPECIAL-USE is believed over its own names,
    /// because a folder called "Sent to accountant" is not the Sent folder.
    #[test]
    fn special_use_attributes_beat_the_name() {
        assert_eq!(
            local_mailbox("Sent to accountant", &[]),
            None,
            "a name that merely contains 'sent' is not the Sent folder"
        );
        assert_eq!(
            local_mailbox("Postvak UIT", &[r"\Sent".to_string()]),
            Some("Sent"),
            "a localised name is still Sent when the server says so"
        );
    }

    #[test]
    fn automated_senders_are_recognised() {
        assert!(looks_automated("noreply@github.com", ""));
        assert!(looks_automated("x@y.com", "Auto-Submitted: auto-generated"));
        assert!(!looks_automated("lerato@example.com", "Subject: hi"));
    }

    #[test]
    fn preview_strips_html_when_there_is_no_text_part() {
        let p = preview_from("", "<div><b>Hello</b> there</div>");
        assert_eq!(p, "Hello there");
    }

    #[test]
    fn parses_a_multipart_message_with_an_attachment() {
        let raw = b"From: Lerato <lerato@example.com>\r\n\
To: me@develtech.co.za\r\n\
Subject: Retainer\r\n\
Date: Mon, 6 Oct 2025 08:15:00 +0200\r\n\
Content-Type: multipart/mixed; boundary=\"b1\"\r\n\
\r\n\
--b1\r\n\
Content-Type: text/plain\r\n\
\r\n\
Signed copy attached.\r\n\
--b1\r\n\
Content-Type: application/pdf\r\n\
Content-Disposition: attachment; filename=\"quote.pdf\"\r\n\
\r\n\
%PDF-1.4\r\n\
--b1--\r\n";
        let p = parse_message(raw, 0).unwrap();
        assert_eq!(p.from_addr, "lerato@example.com");
        assert_eq!(p.from_name, "Lerato");
        assert_eq!(p.subject, "Retainer");
        assert!(p.body_text.contains("Signed copy attached"));
        assert_eq!(p.attachments.len(), 1);
        assert_eq!(p.attachments[0].0, "quote.pdf");
        assert!(p.ts > 0, "Date header should parse");
        assert!(!p.is_bot);
    }

    #[test]
    fn storing_a_message_creates_its_contact_and_upserts_on_resync() {
        let tmp = Tmp::new("contact");
        let c = mem();
        c.execute(
            "INSERT INTO mail_accounts (id, name, address) VALUES (1, 'Me', 'me@develtech.co.za')",
            [],
        )
        .unwrap();
        let acct = MailAccount {
            id: 1,
            address: "me@develtech.co.za".into(),
            ..Default::default()
        };
        let raw = b"From: Lerato <lerato@example.com>\r\nSubject: Re: Retainer\r\n\r\nHi\r\n";
        let p = parse_message(raw, 1_700_000_000_000).unwrap();

        store_message(&c, tmp.path(), &acct, "INBOX", 42, &p, true, false).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM mail_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let contacts: i64 = c
            .query_row("SELECT COUNT(*) FROM mail_contacts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(contacts, 1, "sender becomes a contact");
        let key: String = c
            .query_row("SELECT thread_key FROM mail_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(key, "retainer");

        // Re-syncing the same UID updates rather than duplicating.
        store_message(&c, tmp.path(), &acct, "INBOX", 42, &p, true, true).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM mail_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "same uid must not duplicate");
        let flagged: i64 = c
            .query_row("SELECT flagged FROM mail_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(flagged, 1);
    }

    #[test]
    fn a_local_read_survives_the_next_sync() {
        let tmp = Tmp::new("read");
        let c = mem();
        c.execute(
            "INSERT INTO mail_accounts (id, name, address) VALUES (1, 'Me', 'me@develtech.co.za')",
            [],
        )
        .unwrap();
        let acct = MailAccount {
            id: 1,
            ..Default::default()
        };
        let raw = b"From: a@b.com\r\nSubject: Hi\r\n\r\nx\r\n";
        let p = parse_message(raw, 1).unwrap();
        store_message(&c, tmp.path(), &acct, "INBOX", 7, &p, true, false).unwrap();
        c.execute("UPDATE mail_messages SET unread=0", []).unwrap();
        // Server still reports it unseen; our read must win.
        store_message(&c, tmp.path(), &acct, "INBOX", 7, &p, true, false).unwrap();
        let unread: i64 = c
            .query_row("SELECT unread FROM mail_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(unread, 0, "re-sync must not un-read a message you read");
    }

    #[test]
    fn attachments_are_replaced_not_duplicated_on_resync() {
        let tmp = Tmp::new("atts");
        let c = mem();
        c.execute(
            "INSERT INTO mail_accounts (id, name, address) VALUES (1, 'Me', 'me@d.co')",
            [],
        )
        .unwrap();
        let acct = MailAccount {
            id: 1,
            ..Default::default()
        };
        let raw = b"From: a@b.com\r\nSubject: Files\r\n\
Content-Type: multipart/mixed; boundary=\"z\"\r\n\r\n\
--z\r\nContent-Type: text/plain\r\n\r\nhi\r\n\
--z\r\nContent-Type: text/csv\r\nContent-Disposition: attachment; filename=\"a.csv\"\r\n\r\n1,2\r\n\
--z--\r\n";
        let p = parse_message(raw, 1).unwrap();
        store_message(&c, tmp.path(), &acct, "INBOX", 3, &p, true, false).unwrap();
        store_message(&c, tmp.path(), &acct, "INBOX", 3, &p, true, false).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM mail_attachments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "re-sync must not duplicate attachment rows");
    }

    /// The point of the whole slice: an attachment is now a file you can open.
    /// Before this, `file_path` was a column nothing ever wrote to, so an
    /// invoice was known to exist and had never once been opened.
    #[test]
    fn an_attachment_is_written_to_disk_and_the_row_points_at_it() {
        let tmp = Tmp::new("written");
        let c = mem();
        let acct = MailAccount { id: 1, address: "me@develtech.co.za".into(), ..Default::default() };
        c.execute(
            "INSERT INTO mail_accounts (id, name, address) VALUES (1, 'Me', 'me@develtech.co.za')",
            [],
        )
        .unwrap();

        // One line on purpose: this file is stored CRLF, and a trailing
        // backslash continuation inside a byte string fights that.
        let raw: &[u8] = b"From: Sarah <sarah@harbourvine.com>\r\nSubject: Invoice\r\nContent-Type: multipart/mixed; boundary=\"X\"\r\n\r\n--X\r\nContent-Type: text/plain\r\n\r\nInvoice attached.\r\n--X\r\nContent-Type: text/csv\r\nContent-Disposition: attachment; filename=\"Q3 invoice: final?.csv\"\r\n\r\nitem,amount\r\nwork,1400\r\n--X--\r\n";
        let p = parse_message(raw, 1_700_000_000_000).unwrap();
        store_message(&c, tmp.path(), &acct, "INBOX", 9, &p, true, false).unwrap();

        let path: String = c
            .query_row("SELECT file_path FROM mail_attachments", [], |r| r.get(0))
            .unwrap();
        assert!(!path.is_empty(), "the row must carry a path");

        let on_disk = std::path::Path::new(&path);
        assert!(on_disk.is_file(), "{path} is not a file");
        assert!(
            std::fs::read_to_string(on_disk).unwrap().contains("work,1400"),
            "the bytes that arrived must be the bytes on disk"
        );

        // The colon and the question mark would make this unopenable on Windows.
        let name = on_disk.file_name().unwrap().to_string_lossy().to_string();
        assert!(!name.contains(':') && !name.contains('?'), "{name}");
        assert!(name.ends_with(".csv"), "{name}");
        // Filed by message id, so two invoices with one name coexist.
        assert!(on_disk.parent().unwrap().starts_with(tmp.path()));
    }

    /// Insert one message straight into the table, so a ranking test does not
    /// have to build a MIME document to say "this arrived".
    fn msg(c: &Connection, mailbox: &str, from: &str, to: &str, thread: &str, ts: i64) {
        c.execute(
            "INSERT INTO mail_messages (account_id, uid, mailbox, from_addr, to_addrs, thread_key, ts)
             VALUES (1, abs(random() % 100000), ?1, ?2, ?3, ?4, ?5)",
            params![mailbox, from, to, thread, ts],
        )
        .unwrap();
    }

    fn contact(c: &Connection, name: &str, email: &str) {
        c.execute(
            "INSERT INTO mail_contacts (name, email, kind, created_at) VALUES (?1,?2,'person',0)",
            params![name, email],
        )
        .unwrap();
    }

    /// The claim the whole learn run rests on: a mailbox is mostly noise, and
    /// reciprocity is what separates a person from a subscription.
    #[test]
    fn a_sender_you_never_answered_is_not_a_correspondent() {
        let c = mem();
        c.execute(
            "INSERT INTO mail_accounts (id, name, address, space) VALUES (1,'Me','me@d.co','Develtech')",
            [],
        )
        .unwrap();

        contact(&c, "Amazon", "auto@amazon.com");
        contact(&c, "Sarah", "sarah@harbourvine.com");

        // The noise: hundreds in, never once answered.
        for i in 0..40 {
            msg(&c, "INBOX", "auto@amazon.com", "me@d.co", &format!("order {i}"), 1000 + i);
        }
        // The person: fewer messages, and you wrote back.
        for i in 0..3 {
            msg(&c, "INBOX", "sarah@harbourvine.com", "me@d.co", &format!("invoice {i}"), 2000 + i);
            msg(&c, "Sent", "me@d.co", "sarah@harbourvine.com", &format!("invoice {i}"), 2100 + i);
        }

        let out = rank_correspondents(&c, 50).unwrap();

        assert_eq!(out.len(), 1, "only one of these two is a person");
        let sarah = &out[0];
        assert_eq!(sarah.email, "sarah@harbourvine.com");
        assert_eq!(sarah.sent, 3, "three replies");
        assert_eq!(sarah.received, 3);
        assert_eq!(sarah.domain, "harbourvine.com", "the company, for free");
        // Board 5: the destination comes from the mailbox, not from the content.
        assert_eq!(sarah.space, "Develtech");

        assert!(
            !out.iter().any(|c| c.email.contains("amazon")),
            "forty messages and no reply is still not a correspondent"
        );
    }

    #[test]
    fn the_person_you_answer_most_comes_first() {
        let c = mem();
        c.execute(
            "INSERT INTO mail_accounts (id, name, address) VALUES (1,'Me','me@d.co')",
            [],
        )
        .unwrap();
        contact(&c, "Tom", "tom@innotrack.io");
        contact(&c, "Priya", "priya@harbourvine.com");

        for i in 0..8 {
            msg(&c, "Sent", "me@d.co", "tom@innotrack.io", &format!("t{i}"), 100 + i);
        }
        // More recent, but answered once. Recency must not outrank a
        // relationship, or the list becomes "who emailed this week".
        msg(&c, "Sent", "me@d.co", "priya@harbourvine.com", "p0", 9_999);

        let out = rank_correspondents(&c, 50).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].email, "tom@innotrack.io");
        assert_eq!(out[1].email, "priya@harbourvine.com");
    }

    /// A reply addressed to several people still counts for each of them.
    #[test]
    fn a_reply_to_several_people_counts_for_all_of_them() {
        let c = mem();
        c.execute(
            "INSERT INTO mail_accounts (id, name, address) VALUES (1,'Me','me@d.co')",
            [],
        )
        .unwrap();
        contact(&c, "Sarah", "sarah@harbourvine.com");
        contact(&c, "Priya", "priya@harbourvine.com");

        msg(
            &c,
            "Sent",
            "me@d.co",
            "Sarah <sarah@harbourvine.com>, Priya <priya@harbourvine.com>",
            "terms",
            5_000,
        );

        let out = rank_correspondents(&c, 50).unwrap();
        assert_eq!(out.len(), 2, "both were written to");
        assert!(out.iter().all(|c| c.sent == 1));
    }

    #[test]
    fn credential_target_is_scoped_per_account() {
        assert_eq!(target_for(4), "devdeck:mail:4");
        assert_ne!(target_for(4), crate::creds::target_for(4));
    }

    /// The failure people actually hit, and the one the raw server line cannot
    /// tell them how to fix.
    #[test]
    fn gmail_refusing_a_google_password_says_what_is_wrong() {
        let out = explain_login(
            "imap.gmail.com",
            "[AUTHENTICATIONFAILED] Invalid credentials (Failure)",
        );
        assert!(out.contains("app password"), "must name the actual fix");
        assert!(
            out.contains("2-Step Verification"),
            "the app-password page does not exist without it, which is the second wall"
        );
        // Never swallow what the server said: a translation that guessed wrong
        // is worse than a cryptic line.
        assert!(out.contains("Invalid credentials"));
    }

    #[test]
    fn another_host_gets_the_general_advice_not_the_gmail_one() {
        let out = explain_login("imap.fastmail.com", "[AUTHENTICATIONFAILED] no");
        assert!(out.contains("imap.fastmail.com"));
        assert!(!out.contains("Google"));
        assert!(out.contains("app-specific password"));
    }

    /// A network problem is not a password problem, and telling someone to go
    /// and make an app password because their wifi dropped wastes an evening.
    #[test]
    fn a_failure_that_is_not_about_credentials_is_left_alone() {
        let out = explain_login("imap.gmail.com", "connection reset by peer");
        assert!(out.starts_with("IMAP login refused:"));
        assert!(!out.contains("app password"));
    }
}
