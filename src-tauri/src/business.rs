//! A business: a space tagged Business, what it is, what it sells, who runs it.
//!
//! The record is `business.md` in the space's deck, beside the work, in the
//! vault. It holds what the owner agreed and what is still only a suggestion,
//! and every suggestion keeps where it came from: the site's own words, a
//! suggestion from them, a guess, or the owner typing it. What was agreed is
//! also written as a note in the space's `knowledge/`, which is what the
//! space's managers read. A suggestion nobody agreed to never reaches them.
//!
//! A new business starts clean. Nothing here copies from another business,
//! from Home, or from the personal store.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::aiw::deck::{Deck, Doc};
use crate::aiw::site::{self, SiteLine, SiteText};
use crate::db::{self, Db};

type Ws<'a> = tauri::State<'a, std::sync::Arc<crate::aiw::state::Workspace>>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub const LABEL: &str = "Business";
pub const FILE: &str = "business.md";
const SITE_FILE: &str = "website.json";
const ABOUT_NOTE: &str = "about-the-business.md";

/// The folders every business starts with, and what each is for.
pub const FOLDERS: &[(&str, &str)] = &[
    ("Clients", "Who the business works for."),
    ("Suppliers", "Who it buys from."),
    ("Advisers", "Accountants, lawyers, and anyone it takes advice from."),
    ("Partner firms", "Companies it works alongside."),
    ("Products", "What it builds. Each product holds its projects."),
    ("Services", "Work it does for customers."),
    ("Money", "What is owed, and what is out."),
    ("Marketing", "The website, and what it says."),
];

/// Someone who runs the business. Kept here, with the business, and never in
/// the personal store: a partner is not family.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Director {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    /// The owner of this copy of DevDeck.
    #[serde(default)]
    pub you: bool,
}

/// One thing the business might be, sell or be about, and where it came from.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Suggestion {
    #[serde(default)]
    pub id: String,
    /// what | serves | industry | where | product | service
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub text: String,
    /// quote | suggestion | guess | you
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub source: String,
    /// open | agreed | declined
    #[serde(default)]
    pub state: String,
    /// An agreed product or service's own folder, once made.
    #[serde(default)]
    pub node_id: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct BusinessMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub directors: Vec<Director>,
    #[serde(default)]
    pub items: Vec<Suggestion>,
    /// plain | browser | empty until the site has been read.
    #[serde(default)]
    pub site_how: String,
    #[serde(default)]
    pub site_read_at: String,
    #[serde(default)]
    pub site_chars: i64,
    #[serde(default)]
    pub site_pages: Vec<String>,
    /// business | sells | code | mail | learn | team | done
    #[serde(default)]
    pub step: String,
    /// The team step has been finished.
    #[serde(default)]
    pub made: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct FolderRef {
    pub node_id: i64,
    pub name: String,
}

/// What the screen needs about the site read, without the whole text.
#[derive(Serialize, Clone, Debug, Default)]
pub struct SiteSummary {
    pub how: String,
    pub chars: i64,
    pub pages: Vec<String>,
    pub title: String,
    pub excerpt: String,
    /// Almost nothing came back: a site drawn by script.
    pub thin: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct BusinessView {
    pub node_id: i64,
    pub meta: BusinessMeta,
    pub folders: Vec<FolderRef>,
    pub site: SiteSummary,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct BusinessSummary {
    pub node_id: i64,
    pub name: String,
    pub website: String,
    /// Set up through the business steps. An old workspace tagged Business
    /// with no record is listed too, so Today can offer to clear it.
    pub set_up: bool,
    pub step: String,
    pub made: bool,
    pub products: usize,
    pub services: usize,
    pub mailboxes: i64,
    pub directors: usize,
}

// ---------------------------------------------------------------------------
// The record on disk
// ---------------------------------------------------------------------------

fn deck_of(conn: &Connection, node_id: i64) -> Result<Deck, String> {
    let node = db::node_by_id(conn, node_id)?;
    let dir = db::node_deck_dir(conn, &node).ok_or("That space has no folder in the vault.")?;
    Ok(Deck::new(dir))
}

fn record_path(deck: &Deck) -> PathBuf {
    deck.dir().join(FILE)
}

pub fn read(conn: &Connection, node_id: i64) -> Result<Option<BusinessMeta>, String> {
    let deck = deck_of(conn, node_id)?;
    Ok(deck.read_doc_opt::<BusinessMeta>(&record_path(&deck))?.map(|d| d.meta))
}

pub fn write(conn: &Connection, node_id: i64, meta: &BusinessMeta) -> Result<(), String> {
    let deck = deck_of(conn, node_id)?;
    deck.write_doc_at(&record_path(&deck), &Doc { meta: meta.clone(), body: String::new() })?;
    let note = about_note(meta);
    let p = deck.knowledge_dir().join(ABOUT_NOTE);
    if note.trim().is_empty() {
        let _ = std::fs::remove_file(&p);
    } else {
        std::fs::create_dir_all(deck.knowledge_dir()).map_err(err)?;
        std::fs::write(&p, note).map_err(err)?;
    }
    Ok(())
}

/// What the managers read about the business: only what was agreed.
pub fn about_note(meta: &BusinessMeta) -> String {
    let agreed = |field: &str| -> Vec<&Suggestion> {
        meta.items
            .iter()
            .filter(|i| i.field == field && (i.state == "agreed" || (i.kind == "you" && i.state != "declined")))
            .collect()
    };
    let mut s = String::new();
    let mut line = |label: &str, v: Vec<&Suggestion>| {
        if !v.is_empty() {
            s.push_str(&format!(
                "{label}: {}\n",
                v.iter().map(|i| i.text.as_str()).collect::<Vec<_>>().join("; ")
            ));
        }
    };
    line("What it does", agreed("what"));
    line("Who it serves", agreed("serves"));
    line("Industry", agreed("industry"));
    line("Where", agreed("where"));
    line("Products", agreed("product"));
    line("Services", agreed("service"));
    if s.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "---\nid: about-the-business\nsource: business setup\n---\n\n# {}\n\n",
        meta.name.trim()
    );
    if !meta.website.trim().is_empty() {
        out.push_str(&format!("Website: {}\n", meta.website.trim()));
    }
    let directors: Vec<String> = meta
        .directors
        .iter()
        .filter(|d| !d.name.trim().is_empty())
        .map(|d| d.name.trim().to_string())
        .collect();
    if !directors.is_empty() {
        out.push_str(&format!("Directors: {}\n", directors.join(", ")));
    }
    out.push_str(&s);
    out
}

fn folders_of(conn: &Connection, node_id: i64) -> Vec<FolderRef> {
    let Ok(mut st) = conn.prepare("SELECT id, name FROM nodes WHERE parent_id = ?1 ORDER BY sort, name")
    else {
        return Vec::new();
    };
    st.query_map(params![node_id], |r| Ok(FolderRef { node_id: r.get(0)?, name: r.get(1)? }))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

fn site_pages(conn: &Connection, node_id: i64) -> Vec<SiteText> {
    let Ok(deck) = deck_of(conn, node_id) else { return Vec::new() };
    std::fs::read_to_string(deck.dir().join(SITE_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn view(conn: &Connection, node_id: i64) -> Result<BusinessView, String> {
    let meta = read(conn, node_id)?.ok_or("That space has not been set up as a business.")?;
    let pages = site_pages(conn, node_id);
    let site = match pages.first() {
        Some(first) => SiteSummary {
            how: meta.site_how.clone(),
            chars: meta.site_chars,
            pages: meta.site_pages.clone(),
            title: first.title.clone(),
            excerpt: first.text.chars().take(600).collect(),
            thin: pages.iter().all(site::is_thin),
        },
        None => SiteSummary::default(),
    };
    Ok(BusinessView { node_id, folders: folders_of(conn, node_id), meta, site })
}

/// A website as a fetchable address: `innotrack.co.za` means https.
pub fn normalise_site(s: &str) -> String {
    let t = s.trim().trim_end_matches('/');
    if t.is_empty() {
        return String::new();
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        t.to_string()
    } else {
        format!("https://{t}")
    }
}

/// A name the vault will accept as a folder: the characters Windows refuses
/// become dashes rather than the whole product failing to exist.
pub fn folder_name(s: &str) -> String {
    let cleaned: String = s
        .trim()
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) { '-' } else { c })
        .collect();
    cleaned.trim_start_matches('.').trim().to_string()
}

/// Fold a fresh site read into what is already there.
///
/// What you agreed, declined or typed stays exactly as it is. Suggestions
/// still open from an earlier read are replaced by the new ones, and a new
/// line that repeats something already there is not added twice.
pub fn merge_lines(items: &mut Vec<Suggestion>, lines: &[SiteLine]) {
    items.retain(|i| i.state != "open" || i.kind == "you");
    for l in lines {
        if items
            .iter()
            .any(|i| i.field == l.field && i.text.eq_ignore_ascii_case(&l.text))
        {
            continue;
        }
        items.push(Suggestion {
            id: crate::aiw::events::new_id("sug"),
            field: l.field.clone(),
            text: l.text.clone(),
            kind: l.kind.clone(),
            source: l.source.clone(),
            state: "open".into(),
            node_id: 0,
        });
    }
}

/// The mailboxes that belong to a business: tied to it by name.
pub fn accounts_of(conn: &Connection, node_id: i64) -> Vec<i64> {
    let Ok(name) = conn.query_row("SELECT name FROM nodes WHERE id = ?1", params![node_id], |r| r.get::<_, String>(0))
    else {
        return Vec::new();
    };
    let Ok(mut st) = conn.prepare("SELECT id FROM mail_accounts WHERE space = ?1 COLLATE NOCASE ORDER BY id") else {
        return Vec::new();
    };
    st.query_map(params![name], |r| r.get::<_, i64>(0))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// What a learn run for this business reads: its mailboxes, its name, and
/// what it sells, so each organisation can say what it has to do with.
pub fn scope_of(conn: &Connection, node_id: i64) -> Result<crate::aiw::learn::Scope, String> {
    if node_id <= 0 {
        return Ok(Default::default());
    }
    let meta = read(conn, node_id)?.ok_or("That space has not been set up as a business.")?;
    let accounts = accounts_of(conn, node_id);
    if accounts.is_empty() {
        return Err(format!("{} has no mailbox yet. Add one in the mail step first.", meta.name));
    }
    let offers = meta
        .items
        .iter()
        .filter(|i| (i.field == "product" || i.field == "service") && (i.state == "agreed" || (i.kind == "you" && i.state != "declined")))
        .map(|i| i.text.clone())
        .collect();
    Ok(crate::aiw::learn::Scope { accounts, business: node_id, name: meta.name, offers })
}

/// Write a note into the business's knowledge, which its managers read.
pub fn knowledge_note(conn: &Connection, node_id: i64, slug: &str, body: &str) -> Result<String, String> {
    let deck = deck_of(conn, node_id)?;
    std::fs::create_dir_all(deck.knowledge_dir()).map_err(err)?;
    let p = deck.knowledge_dir().join(format!("{slug}.md"));
    std::fs::write(&p, body).map_err(err)?;
    Ok(p.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Reading the site
// ---------------------------------------------------------------------------

fn fetch_plain(url: &str) -> Result<SiteText, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) DevDeck")
        .build()
        .map_err(err)?;
    let res = client.get(url).send().map_err(|e| format!("could not reach {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered {}", res.status()));
    }
    let final_url = res.url().to_string();
    let body = res.text().map_err(|e| format!("could not read {url}: {e}"))?;
    let body: String = body.chars().take(2_000_000).collect();
    Ok(site::html_to_text(&body, &final_url))
}

const READER_HOST: &str = "devdeck-reader.invalid";

/// Collects what a person would read once the page has had time to draw
/// itself, then hands it back by navigating to an address that goes nowhere:
/// the navigation handler catches it and refuses the load. A remote page has
/// no way to call the app, and does not need one.
const READER_JS: &str = r#"(function () {
  if (window.__devdeckRead) return;
  window.__devdeckRead = true;
  function send(d) {
    location.href = 'https://devdeck-reader.invalid/?d=' + encodeURIComponent(JSON.stringify(d));
  }
  setTimeout(function () {
    try {
      var links = [];
      document.querySelectorAll('a[href]').forEach(function (a) {
        if (links.length < 80) links.push({ href: a.href, text: (a.innerText || '').trim().slice(0, 80) });
      });
      var desc = document.querySelector('meta[name="description"]');
      var heads = [];
      document.querySelectorAll('h1,h2,h3').forEach(function (h) {
        var t = (h.innerText || '').trim();
        if (t && heads.length < 30) heads.push(t);
      });
      send({
        title: document.title || '',
        description: desc ? desc.getAttribute('content') || '' : '',
        headings: heads,
        text: (document.body ? document.body.innerText : '').slice(0, 20000),
        links: links
      });
    } catch (e) {
      send({ title: '', description: '', headings: [], text: '', links: [], error: String(e) });
    }
  }, 3500);
})();"#;

static READER_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize, Default)]
struct Rendered {
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    headings: Vec<String>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    links: Vec<site::SiteLink>,
    #[serde(default)]
    error: String,
}

/// Read a page the way a browser shows it, in a window nobody sees.
fn read_rendered(app: &tauri::AppHandle, url: &str) -> Result<SiteText, String> {
    use tauri::webview::PageLoadEvent;
    let target: tauri::Url = url.parse().map_err(|e| format!("{url} is not an address: {e}"))?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx = std::sync::Mutex::new(tx);
    let label = format!("site-reader-{}", READER_SEQ.fetch_add(1, Ordering::SeqCst));

    let window = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(target))
        .title("Reading a website")
        .visible(false)
        .inner_size(1280.0, 900.0)
        .on_navigation(move |u| {
            if u.host_str() == Some(READER_HOST) {
                if let Some((_, d)) = u.query_pairs().find(|(k, _)| k == "d") {
                    if let Ok(tx) = tx.lock() {
                        let _ = tx.send(d.to_string());
                    }
                }
                return false;
            }
            true
        })
        .on_page_load(|w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = w.eval(READER_JS);
            }
        })
        .build()
        .map_err(|e| format!("could not open a window to read {url}: {e}"))?;

    let got = rx.recv_timeout(std::time::Duration::from_secs(40));
    let _ = window.destroy();
    let raw = got.map_err(|_| format!("{url} did not finish drawing in 40 seconds"))?;
    let r: Rendered = serde_json::from_str(&raw).map_err(|e| format!("could not read what {url} drew: {e}"))?;
    if !r.error.is_empty() && r.text.is_empty() {
        return Err(format!("{url}: {}", r.error));
    }
    Ok(SiteText {
        url: url.to_string(),
        title: r.title.trim().to_string(),
        description: r.description.trim().to_string(),
        headings: r.headings,
        text: r.text.split_whitespace().collect::<Vec<_>>().join(" "),
        links: r.links,
    })
}

fn read_site_blocking(
    app: &tauri::AppHandle,
    ws: &crate::aiw::state::Workspace,
    node_id: i64,
    browser: bool,
) -> Result<BusinessView, String> {
    let db = app.state::<Db>();
    let mut meta = {
        let conn = db.0.lock().unwrap();
        read(&conn, node_id)?.ok_or("That space has not been set up as a business.")?
    };
    let url = normalise_site(&meta.website);
    if url.is_empty() {
        return Err("Give the business its website first.".into());
    }

    let mut pages: Vec<SiteText> = Vec::new();
    if browser {
        let first = read_rendered(app, &url)?;
        let more = site::same_site_links(&first, 3);
        pages.push(first);
        for l in more {
            if let Ok(t) = read_rendered(app, &l) {
                pages.push(t);
            }
        }
    } else {
        let first = fetch_plain(&url)?;
        let more = if site::is_thin(&first) { Vec::new() } else { site::same_site_links(&first, 3) };
        pages.push(first);
        for l in more {
            if let Ok(t) = fetch_plain(&l) {
                pages.push(t);
            }
        }
    }

    let all = site::all_text(&pages);
    let (provider_id, _, model, ready, note) = crate::aiw::learn::destination_model(ws);
    if !ready {
        return Err(note);
    }
    let provider = {
        let providers = ws.providers.lock().unwrap();
        providers.get(&provider_id)
    }
    .ok_or_else(|| format!("'{provider_id}' is not configured"))?;
    let request = crate::aiw::provider::AgentRequest {
        agent_id: crate::aiw::assistant::ASSISTANT_ID.into(),
        role: "assistant".into(),
        model,
        system: site::SITE_SYSTEM.into(),
        context: site::render_context(&meta.name, &url, &pages),
        goal: format!("Say what {} is, from its website, one JSON object per line.", meta.name),
        ..Default::default()
    };
    let reply = provider.run(&request)?;
    let lines = site::parse_site_lines(&reply.message, &all);

    merge_lines(&mut meta.items, &lines);
    meta.site_how = if browser { "browser".into() } else { "plain".into() };
    meta.site_read_at = chrono::Local::now().to_rfc3339();
    meta.site_chars = all.chars().count() as i64;
    meta.site_pages = pages.iter().map(|p| p.url.clone()).collect();

    let conn = db.0.lock().unwrap();
    let deck = deck_of(&conn, node_id)?;
    std::fs::create_dir_all(deck.dir()).map_err(err)?;
    std::fs::write(
        deck.dir().join(SITE_FILE),
        serde_json::to_string_pretty(&pages).map_err(err)?,
    )
    .map_err(err)?;
    write(&conn, node_id, &meta)?;
    view(&conn, node_id)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Every workspace tagged Business, set up or not.
#[tauri::command(async)]
pub fn business_list(db: tauri::State<Db>) -> Result<Vec<BusinessSummary>, String> {
    let conn = db.0.lock().unwrap();
    let mut st = conn
        .prepare(
            "SELECT id, name FROM nodes WHERE parent_id IS NULL AND kind = 'workspace'
               AND label = ?1 COLLATE NOCASE ORDER BY sort, name",
        )
        .map_err(err)?;
    let rows: Vec<(i64, String)> = st
        .query_map(params![LABEL], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .flatten()
        .collect();
    let mut out = Vec::new();
    for (id, name) in rows {
        let meta = read(&conn, id).ok().flatten();
        let mailboxes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mail_accounts WHERE space = ?1 COLLATE NOCASE",
                params![name],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let count = |m: &BusinessMeta, f: &str| {
            m.items
                .iter()
                .filter(|i| i.field == f && (i.state == "agreed" || (i.kind == "you" && i.state != "declined")))
                .count()
        };
        out.push(match meta {
            Some(m) => BusinessSummary {
                node_id: id,
                name: name.clone(),
                website: m.website.clone(),
                set_up: true,
                step: m.step.clone(),
                made: m.made,
                products: count(&m, "product"),
                services: count(&m, "service"),
                mailboxes,
                directors: m.directors.len(),
            },
            None => BusinessSummary { node_id: id, name, set_up: false, mailboxes, ..Default::default() },
        });
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn business_get(db: tauri::State<Db>, node_id: i64) -> Result<BusinessView, String> {
    let conn = db.0.lock().unwrap();
    view(&conn, node_id)
}

/// Make the space and its record. Clean: its own folders and nothing else.
#[tauri::command(async)]
pub fn business_create(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    name: String,
    website: String,
) -> Result<BusinessView, String> {
    let name = crate::vault::valid_name(&name)?;
    let ws = crate::vault::vault_create(db.clone(), None, name.clone())?;
    crate::vault::vault_set_meta(db.clone(), ws.id, Some(LABEL.into()), None, None, None)?;
    let mut problems = Vec::new();
    for (f, why) in FOLDERS {
        match crate::vault::vault_create(db.clone(), Some(ws.id), f.to_string()) {
            Ok(n) => {
                let _ = crate::vault::vault_set_meta(db.clone(), n.id, None, None, None, Some(why.to_string()));
            }
            Err(e) => problems.push(format!("{f}: {e}")),
        }
    }
    let meta = BusinessMeta {
        name: name.clone(),
        website: website.trim().to_string(),
        directors: vec![Director { name: "You".into(), email: String::new(), you: true }],
        step: "business".into(),
        ..Default::default()
    };
    let v = {
        let conn = db.0.lock().unwrap();
        write(&conn, ws.id, &meta)?;
        view(&conn, ws.id)?
    };
    crate::activity::record(
        &app,
        "space",
        format!("{name} added as a business"),
        if problems.is_empty() { "its folders are made".to_string() } else { problems.join(" · ") },
        problems.is_empty(),
        Some(ws.id),
    );
    Ok(v)
}

/// Save what the screen changed: directors, agreed and declined suggestions,
/// lines you typed, the step you are on.
#[tauri::command(async)]
pub fn business_save(db: tauri::State<Db>, node_id: i64, meta: BusinessMeta) -> Result<BusinessView, String> {
    let conn = db.0.lock().unwrap();
    let prior = read(&conn, node_id)?.ok_or("That space has not been set up as a business.")?;
    let mut meta = meta;
    // The name is the folder's; renaming happens in Spaces, not by editing a
    // field that would disagree with the tree.
    meta.name = prior.name;
    meta.website = meta.website.trim().to_string();
    meta.directors.retain(|d| d.you || !d.name.trim().is_empty());
    for i in meta.items.iter_mut() {
        if i.id.is_empty() {
            i.id = crate::aiw::events::new_id("sug");
        }
        i.text = i.text.trim().to_string();
        if i.state.is_empty() {
            i.state = if i.kind == "you" { "agreed".into() } else { "open".into() };
        }
    }
    meta.items.retain(|i| !i.text.is_empty());
    write(&conn, node_id, &meta)?;
    view(&conn, node_id)
}

/// Read the business's website and suggest what it is. `browser` reads the
/// pages as drawn, for a site that a plain fetch returns almost nothing of.
#[tauri::command]
pub async fn business_read_site(
    app: tauri::AppHandle,
    ws: Ws<'_>,
    node_id: i64,
    browser: bool,
) -> Result<BusinessView, String> {
    let ws = (*ws).clone();
    tauri::async_runtime::spawn_blocking(move || read_site_blocking(&app, &ws, node_id, browser))
        .await
        .map_err(|e| format!("the read did not finish: {e}"))?
}

/// Give every agreed product and service a folder of its own, under Products
/// or Services. A product's folder is where its projects go.
#[tauri::command(async)]
pub fn business_commit_items(db: tauri::State<Db>, node_id: i64) -> Result<BusinessView, String> {
    let (mut meta, folders) = {
        let conn = db.0.lock().unwrap();
        (
            read(&conn, node_id)?.ok_or("That space has not been set up as a business.")?,
            folders_of(&conn, node_id),
        )
    };
    let parent_of = |f: &str| folders.iter().find(|x| x.name.eq_ignore_ascii_case(f)).map(|x| x.node_id);
    for i in meta.items.iter_mut() {
        let wanted = i.state == "agreed" || (i.kind == "you" && i.state != "declined");
        let (folder, label) = match i.field.as_str() {
            "product" => ("Products", "Product"),
            "service" => ("Services", "Service"),
            _ => continue,
        };
        if !wanted || i.node_id > 0 {
            continue;
        }
        let Some(parent) = parent_of(folder) else { continue };
        let name = folder_name(&i.text);
        if name.is_empty() {
            continue;
        }
        let existing = {
            let conn = db.0.lock().unwrap();
            folders_of(&conn, parent).into_iter().find(|c| c.name.eq_ignore_ascii_case(&name))
        };
        let id = match existing {
            Some(c) => c.node_id,
            None => crate::vault::vault_create(db.clone(), Some(parent), name)?.id,
        };
        let _ = crate::vault::vault_set_meta(db.clone(), id, Some(label.into()), None, None, None);
        i.node_id = id;
    }
    let conn = db.0.lock().unwrap();
    write(&conn, node_id, &meta)?;
    view(&conn, node_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(field: &str, text: &str, kind: &str) -> SiteLine {
        SiteLine { field: field.into(), text: text.into(), kind: kind.into(), source: "the site".into() }
    }

    #[test]
    fn a_new_read_keeps_what_you_decided_and_replaces_what_you_did_not() {
        let mut items = vec![
            Suggestion { id: "a".into(), field: "what".into(), text: "Tags mines".into(), kind: "quote".into(), state: "agreed".into(), ..Default::default() },
            Suggestion { id: "b".into(), field: "serves".into(), text: "Old guess".into(), kind: "guess".into(), state: "open".into(), ..Default::default() },
            Suggestion { id: "c".into(), field: "service".into(), text: "Site surveys".into(), kind: "you".into(), state: "agreed".into(), ..Default::default() },
            Suggestion { id: "d".into(), field: "product".into(), text: "Not ours".into(), kind: "guess".into(), state: "declined".into(), ..Default::default() },
        ];
        merge_lines(
            &mut items,
            &[line("what", "tags mines", "quote"), line("serves", "Mines", "suggestion"), line("product", "Not ours", "guess")],
        );
        let texts: Vec<&str> = items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(texts, vec!["Tags mines", "Site surveys", "Not ours", "Mines"]);
        assert!(!texts.contains(&"Old guess"), "an open suggestion from before is replaced");
        assert_eq!(items[2].state, "declined", "a no stays a no, and is not offered again");
    }

    #[test]
    fn only_what_was_agreed_reaches_the_managers() {
        let meta = BusinessMeta {
            name: "Innotrack".into(),
            website: "innotrack.co.za".into(),
            directors: vec![Director { name: "You".into(), email: String::new(), you: true }],
            items: vec![
                Suggestion { field: "what".into(), text: "RFID Enabled Solutions".into(), kind: "quote".into(), state: "agreed".into(), ..Default::default() },
                Suggestion { field: "serves".into(), text: "Mines".into(), kind: "guess".into(), state: "open".into(), ..Default::default() },
                Suggestion { field: "service".into(), text: "Site surveys".into(), kind: "you".into(), state: "agreed".into(), ..Default::default() },
            ],
            ..Default::default()
        };
        let note = about_note(&meta);
        assert!(note.contains("What it does: RFID Enabled Solutions"));
        assert!(note.contains("Services: Site surveys"));
        assert!(!note.contains("Mines"), "an open guess is not something the business agreed");
        assert!(about_note(&BusinessMeta::default()).is_empty());
    }

    #[test]
    fn names_and_addresses_are_made_usable() {
        assert_eq!(normalise_site("innotrack.co.za/"), "https://innotrack.co.za");
        assert_eq!(normalise_site("http://x.co"), "http://x.co");
        assert_eq!(normalise_site("  "), "");
        assert_eq!(folder_name("Tagging / installation: on site"), "Tagging - installation- on site");
        assert_eq!(folder_name(".hidden"), "hidden");
    }

    #[test]
    fn the_record_survives_a_round_trip_through_its_file() {
        let meta = BusinessMeta {
            name: "Innotrack".into(),
            website: "innotrack.co.za".into(),
            directors: vec![
                Director { name: "You".into(), email: String::new(), you: true },
                Director { name: "Partner".into(), email: "p@innotrack.co.za".into(), you: false },
            ],
            items: vec![Suggestion { id: "s1".into(), field: "product".into(), text: "Asset tracking".into(), kind: "suggestion".into(), source: "title".into(), state: "agreed".into(), node_id: 7 }],
            step: "sells".into(),
            ..Default::default()
        };
        let raw = crate::aiw::deck::write_doc(&Doc { meta: meta.clone(), body: String::new() }).unwrap();
        let back: Doc<BusinessMeta> = crate::aiw::deck::parse_doc(&raw).unwrap();
        assert_eq!(back.meta, meta);
    }
}
