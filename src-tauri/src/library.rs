//! The library — the skills and briefs *you* installed, kept with you.
//!
//! A skill is a folder of instructions; a brief is who a worker should be for
//! a job. Both are words, and that is the whole reason they can be imported
//! from a stranger's repository at all: nothing here runs. Hooks, MCP configs
//! and install scripts are deliberately not importable — a tool that runs
//! comes through Community one at a time, with its own grant.
//!
//! It lives in the personal store, beside your memory rather than inside a
//! vault, because a skill is yours: you read it, you added it, and every
//! space you work in can borrow it. Each item records the repository and the
//! exact commit it came from, so "where did this instruction come from" has an
//! answer a year later.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub const SKILL: &str = "skill";
pub const BRIEF: &str = "brief";

/// How many files one look at a repository will read the headers of. A big
/// library has hundreds; reading every one to draw a list nobody scrolled to
/// the end of is somebody else's bandwidth and your wait.
const HEADERS: usize = 90;

/// How many of those it reads at once. Enough to be quick on a big library,
/// few enough that nobody's server thinks it is being scraped.
const HANDS: usize = 8;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// One thing in the library.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Item {
    /// What a worker names it by. Unique here, and the folder name it came from.
    pub id: String,
    /// skill | brief
    pub kind: String,
    pub name: String,
    /// The one line its own header gives.
    pub what: String,
    /// owner/name it came from.
    pub repo: String,
    /// The commit it was read at. Pinned: the repository can move, this does not.
    pub commit: String,
    pub licence: String,
    /// Where it sat in that repository.
    pub path: String,
    pub added_at: String,
    pub chars: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Index {
    #[serde(default)]
    pub items: Vec<Item>,
}

/// A candidate, as one look at a repository found it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Candidate {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub what: String,
    pub path: String,
    /// Already in the library, at this commit.
    pub have: bool,
}

/// What a repository turned out to hold.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Source {
    pub repo: String,
    pub commit: String,
    pub licence: String,
    pub branch: String,
    pub items: Vec<Candidate>,
    /// The folders it keeps them in, biggest first. Taking one is one decision.
    #[serde(default)]
    pub kits: Vec<Kit>,
    /// Said out loud when the list is not the whole truth.
    pub note: String,
}

pub fn dir() -> Result<PathBuf, String> {
    let store = crate::aiw::personal::PersonalStore::open()?;
    Ok(store.root().join("library"))
}

fn index_path() -> Result<PathBuf, String> {
    Ok(dir()?.join("index.md"))
}

pub fn read_index() -> Result<Index, String> {
    let p = index_path()?;
    if !p.is_file() {
        return Ok(Index::default());
    }
    let raw = std::fs::read_to_string(&p).map_err(err)?;
    Ok(crate::aiw::deck::parse_doc::<Index>(&raw)?.meta)
}

/// The index, written for a module that built one itself.
pub fn write_index_pub(ix: &Index) -> Result<(), String> {
    write_index(ix)
}

fn write_index(ix: &Index) -> Result<(), String> {
    let p = index_path()?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
    let doc = crate::aiw::deck::Doc {
        meta: ix.clone(),
        body: "Skills and briefs you installed. Words only: nothing here runs.\n".into(),
    };
    std::fs::write(&p, crate::aiw::deck::write_doc(&doc)?).map_err(err)
}

/// Where one item's text lives.
pub fn item_path(it: &Item) -> Result<PathBuf, String> {
    let base = dir()?;
    Ok(if it.kind == SKILL {
        base.join("skills").join(&it.id).join("SKILL.md")
    } else {
        base.join("briefs").join(format!("{}.md", it.id))
    })
}

/// A skill's folder, which is what a session gets a copy of.
pub fn skill_dir(id: &str) -> Result<PathBuf, String> {
    Ok(dir()?.join("skills").join(id))
}

/// The name and the one-line description a Claude Code skill or agent file
/// carries in its own header. A file without one is not refused — it keeps its
/// id as its name, and says nothing about itself, which is true.
pub fn header(raw: &str) -> (String, String) {
    let (mut name, mut what) = (String::new(), String::new());
    let Some(after) = raw.strip_prefix("---") else {
        return (name, what);
    };
    let Some(end) = after.find("\n---") else {
        return (name, what);
    };
    let mut key = String::new();
    for line in after[..end].lines() {
        // A description folded over several lines keeps going until the next key.
        if let Some(rest) = line.strip_prefix("  ").filter(|_| key == "description") {
            if !rest.trim().is_empty() && !rest.contains(':') {
                what.push(' ');
                what.push_str(rest.trim());
                continue;
            }
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        key = k.trim().to_string();
        let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
        match key.as_str() {
            "name" => name = v,
            "description" => what = v,
            _ => {}
        }
    }
    (name.trim().to_string(), what.trim().to_string())
}

/// `skills/brand-voice/SKILL.md` is the skill `brand-voice`; `agents/x.md` is
/// the brief `x`. Anything else is not something this library can hold.
pub fn classify(path: &str) -> Option<(String, String)> {
    let p = path.trim_start_matches("./");
    let parts: Vec<&str> = p.split('/').collect();
    if parts.len() >= 2 && parts[parts.len() - 1].eq_ignore_ascii_case("SKILL.md") {
        let folder = parts[parts.len() - 2];
        let inside = parts.contains(&"skills");
        if inside && !folder.is_empty() {
            return Some((SKILL.to_string(), folder.to_string()));
        }
        return None;
    }
    if parts.len() >= 2 && parts[parts.len() - 2] == "agents" && p.ends_with(".md") {
        let stem = parts[parts.len() - 1].trim_end_matches(".md");
        // AGENTS.md and README-ish files are documents about agents, not briefs.
        if !stem.is_empty() && !stem.eq_ignore_ascii_case("readme") {
            return Some((BRIEF.to_string(), stem.to_string()));
        }
    }
    None
}

/// Which copy of `code-reviewer` a repository means, when it holds several.
///
/// A big library keeps the same instruction many times over: once for real,
/// once for another editor under a dotted folder, and once per language it has
/// been translated into. They all classify the same and they all want the same
/// name, so something has to choose — and choosing the first one the tree
/// happens to list gave people the Spanish copy of a skill and the Kiro copy
/// of an agent, silently, because the name on the card was right either way.
/// Lower is better: no dot at the front, not under `docs`, and nearest the top.
fn rank(path: &str) -> usize {
    let parts: Vec<&str> = path.trim_start_matches("./").split('/').collect();
    let dotted = parts.first().is_some_and(|p| p.starts_with('.'));
    let docs = parts.iter().any(|p| p.eq_ignore_ascii_case("docs"));
    parts.len() + if dotted { 8 } else { 0 } + if docs { 4 } else { 0 }
}

/// The folder a skill or a brief belongs to, which is what a kit is made of.
///
/// `agents/x.md` and `skills/x/SKILL.md` belong to `agents` and `skills`;
/// `.kiro/agents/x.md` belongs to `.kiro/agents`. A repository usually keeps
/// one set per tool it serves, and a worker carries one of those sets.
pub fn collection(path: &str) -> Option<String> {
    let p = path.trim_start_matches("./");
    let parts: Vec<&str> = p.split('/').collect();
    let at = parts
        .iter()
        .rposition(|s| *s == "agents" || *s == "skills")?;
    Some(parts[..=at].join("/"))
}

/// A folder of a repository, taken whole.
///
/// The point of a kit is that you are not ticking three hundred boxes: a
/// repository's `agents` folder is a bench of specialists, each one carrying
/// the description Claude Code itself reads to decide who takes a job. Hand a
/// worker the folder and the choosing is done by the thing doing the work.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Kit {
    /// `agents`, `skills`, `.kiro/agents` — the folder, as the repository spells it.
    pub folder: String,
    /// skill | brief. A folder holds one or the other, never both.
    pub kind: String,
    /// Everything in it, in the order the repository lists them.
    pub picks: Vec<Candidate>,
    /// How many of those are already yours, at this commit.
    pub have: usize,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .user_agent("DevDeck (library import)")
        .build()
        .map_err(err)
}

fn get_json(c: &reqwest::blocking::Client, url: &str) -> Result<serde_json::Value, String> {
    let res = c
        .get(url)
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = res.status();
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub is rate limiting this machine. It allows 60 reads an hour without a token; wait, or paste a token in Settings.".into());
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("no repository there. Check the owner and name, and that it is public.".into());
    }
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    res.json()
        .map_err(|e| format!("GitHub sent something unreadable: {e}"))
}

/// `https://github.com/owner/name`, `owner/name`, with or without `.git`.
pub fn repo_name(input: &str) -> Option<String> {
    let t = input
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .replace("https://", "")
        .replace("http://", "");
    let t = t
        .trim_start_matches("www.")
        .trim_start_matches("github.com/");
    let parts: Vec<&str> = t.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    let (o, r) = (parts[0], parts[1]);
    let ok = |s: &str| s.chars().all(|c| c.is_alphanumeric() || "-._".contains(c));
    (ok(o) && ok(r)).then(|| format!("{o}/{r}"))
}

fn raw_url(repo: &str, commit: &str, path: &str) -> String {
    format!("https://raw.githubusercontent.com/{repo}/{commit}/{path}")
}

/// Read a repository: what it is licensed as, where it stands, and everything
/// in it this library could hold.
pub fn look(input: &str) -> Result<Source, String> {
    let repo = repo_name(input).ok_or("that is not a GitHub repository address.")?;
    let c = client()?;
    let meta = get_json(&c, &format!("https://api.github.com/repos/{repo}"))?;
    let branch = meta
        .get("default_branch")
        .and_then(|b| b.as_str())
        .unwrap_or("main")
        .to_string();
    let licence = meta
        .get("license")
        .and_then(|l| l.get("spdx_id"))
        .and_then(|s| s.as_str())
        .filter(|s| *s != "NOASSERTION")
        .unwrap_or("none stated")
        .to_string();

    let head = get_json(
        &c,
        &format!("https://api.github.com/repos/{repo}/commits/{branch}"),
    )?;
    let commit = head
        .get("sha")
        .and_then(|s| s.as_str())
        .ok_or("GitHub did not say where that repository stands")?
        .to_string();

    let tree = get_json(
        &c,
        &format!("https://api.github.com/repos/{repo}/git/trees/{commit}?recursive=1"),
    )?;
    let cut = tree
        .get("truncated")
        .and_then(|t| t.as_bool())
        .unwrap_or(false);
    let files = tree
        .get("tree")
        .and_then(|t| t.as_array())
        .ok_or("that repository has no file list")?;

    let mut all: Vec<(String, String, String)> = Vec::new(); // kind, id, path
    for f in files {
        if f.get("type").and_then(|t| t.as_str()) != Some("blob") {
            continue;
        }
        let Some(path) = f.get("path").and_then(|p| p.as_str()) else {
            continue;
        };
        if let Some((kind, id)) = classify(path) {
            all.push((kind, id, path.to_string()));
        }
    }

    // One name, one file: the best-placed copy wins, not the first one listed.
    let mut found: Vec<(String, String, String)> = Vec::new();
    for item in &all {
        match found.iter_mut().find(|(_, x, _)| x == &item.1) {
            Some(seen) if rank(&item.2) < rank(&seen.2) => seen.2 = item.2.clone(),
            Some(_) => {}
            None => found.push(item.clone()),
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

    let have = read_index()?.items;
    let mine = |id: &str, path: &str| {
        have.iter()
            .any(|h| h.id == id && h.repo == repo && h.commit == commit && h.path == path)
    };

    // The folders, as the repository keeps them. A kit is one of these taken
    // whole, so it is counted over every file rather than over the deduped
    // list — `agents` holds sixty-eight whether or not another folder repeats
    // some of them under the same names.
    let mut kits: Vec<Kit> = Vec::new();
    for (kind, id, path) in &all {
        let Some(folder) = collection(path) else {
            continue;
        };
        let pick = Candidate {
            id: id.clone(),
            kind: kind.clone(),
            name: id.clone(),
            what: String::new(),
            path: path.clone(),
            have: mine(id, path),
        };
        match kits.iter_mut().find(|k| k.folder == folder) {
            Some(k) => k.picks.push(pick),
            None => kits.push(Kit {
                folder,
                kind: kind.clone(),
                picks: vec![pick],
                have: 0,
            }),
        }
    }
    for k in &mut kits {
        k.have = k.picks.iter().filter(|p| p.have).count();
    }
    // Best-placed and biggest first, so the folder a repository actually means
    // is the one being offered rather than a translation of it.
    kits.sort_by(|a, b| {
        rank(&a.folder)
            .cmp(&rank(&b.folder))
            .then(b.picks.len().cmp(&a.picks.len()))
    });
    // A translation of a folder is not another set: ECC keeps its skills in
    // seven languages, which would offer the same bench seven times over and
    // call six of them something you cannot read. The full list still has
    // every one of them.
    //
    // A folder of *one* is still a set, though. That rule was here and it
    // meant a repository holding a single good skill -- which is most of them
    // -- was met with "nothing here is grouped into a set", and the one thing
    // you came for was hidden behind a toggle.
    kits.retain(|k| !k.folder.split('/').any(|p| p.eq_ignore_ascii_case("docs")));
    kits.truncate(6);
    let read_headers = found.len().min(HEADERS);

    // Read the headers a few at a time. One at a time is correct and far too
    // slow: a library of three hundred files spent two minutes on a list
    // nobody could use yet, which reads as a hung window rather than a read.
    let next = std::sync::atomic::AtomicUsize::new(0);
    let heads: Vec<Mutex<Option<(String, String)>>> =
        (0..read_headers).map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..HANDS.min(read_headers.max(1)) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if i >= read_headers {
                    return;
                }
                let (_, _, path) = &found[i];
                if let Ok(text) = c
                    .get(raw_url(&repo, &commit, path))
                    .send()
                    .and_then(|r| r.text())
                {
                    *heads[i].lock().unwrap() = Some(header(&text));
                }
            });
        }
    });

    let mut items: Vec<Candidate> = Vec::with_capacity(found.len());
    for (i, (kind, id, path)) in found.iter().enumerate() {
        let (mut name, mut what) = (id.clone(), String::new());
        if let Some((n, w)) = heads.get(i).and_then(|h| h.lock().unwrap().clone()) {
            if !n.is_empty() {
                name = n;
            }
            what = w;
        }
        items.push(Candidate {
            id: id.clone(),
            kind: kind.clone(),
            name,
            what,
            path: path.clone(),
            have: mine(id, path),
        });
    }

    let mut note = String::new();
    if found.len() > read_headers {
        note = format!(
            "{} of {} read in full; the rest show their file name until you add them.",
            read_headers,
            found.len()
        );
    }
    if cut {
        note.push_str(" The repository is too large for one listing, so this is part of it.");
    }
    if items.is_empty() {
        note = "Nothing here is a skill or an agent brief. A library needs skills/<name>/SKILL.md or agents/<name>.md — this repository has neither, so there is nothing to read.".into();
    }

    Ok(Source {
        repo,
        commit,
        licence,
        branch,
        items,
        kits,
        note,
    })
}

/// Fetch the ones you picked and write them into the library.
/// What one install did, including what it could not do.
///
/// A kit is sixty-eight files over somebody else's network. One of them timing
/// out must not lose the other sixty-seven, and must not be swallowed either:
/// what did not arrive is named, and the window says so.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Added {
    pub items: Vec<Item>,
    /// The ones that did not come in, each with the reason.
    #[serde(default)]
    pub missed: Vec<String>,
}

pub fn install(src: &Source, ids: &[String]) -> Result<Added, String> {
    let picks: Vec<Candidate> = src
        .items
        .iter()
        .filter(|i| ids.contains(&i.id))
        .cloned()
        .collect();
    install_cands(&src.repo, &src.commit, &src.licence, &picks)
}

/// Take one folder of a repository whole.
pub fn install_kit(src: &Source, folder: &str) -> Result<Added, String> {
    let kit = src
        .kits
        .iter()
        .find(|k| k.folder == folder)
        .ok_or("that repository has no folder by that name.")?;
    install_cands(&src.repo, &src.commit, &src.licence, &kit.picks)
}

pub fn install_cands(
    repo: &str,
    commit: &str,
    licence: &str,
    picks: &[Candidate],
) -> Result<Added, String> {
    let c = client()?;
    let mut ix = read_index()?;
    let mut out = Added::default();

    // Read them a few at a time, for the same reason the listing does: a kit
    // one file at a time is a minute of a spinner for something that takes ten
    // seconds.
    let next = std::sync::atomic::AtomicUsize::new(0);
    let texts: Vec<Mutex<Option<Result<String, String>>>> =
        (0..picks.len()).map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..HANDS.min(picks.len().max(1)) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if i >= picks.len() {
                    return;
                }
                let got = c
                    .get(raw_url(repo, commit, &picks[i].path))
                    .send()
                    .and_then(|r| r.error_for_status())
                    .and_then(|r| r.text())
                    .map_err(|e| format!("{}: {e}", picks[i].path));
                *texts[i].lock().unwrap() = Some(got);
            });
        }
    });

    for (i, cand) in picks.iter().enumerate() {
        let text = match texts[i].lock().unwrap().clone() {
            Some(Ok(t)) => t,
            Some(Err(e)) => {
                out.missed.push(e);
                continue;
            }
            None => {
                out.missed.push(format!("{}: never read", cand.path));
                continue;
            }
        };
        let (name, what) = header(&text);
        let it = Item {
            id: cand.id.clone(),
            kind: cand.kind.clone(),
            name: if name.is_empty() {
                cand.id.clone()
            } else {
                name
            },
            what,
            repo: repo.to_string(),
            commit: commit.to_string(),
            licence: licence.to_string(),
            path: cand.path.clone(),
            added_at: crate::aiw::events::now_iso(),
            chars: text.chars().count() as i64,
        };
        let p = item_path(&it)?;
        std::fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
        std::fs::write(&p, &text).map_err(err)?;
        ix.items.retain(|x| !(x.id == it.id && x.kind == it.kind));
        ix.items.push(it.clone());
        out.items.push(it);
    }
    ix.items
        .sort_by(|a, b| a.kind.cmp(&b.kind).then(a.id.cmp(&b.id)));
    write_index(&ix)?;
    if out.items.is_empty() && !out.missed.is_empty() {
        return Err(format!("nothing came in. {}", out.missed.join("; ")));
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// What the window calls
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn library_list() -> Result<Vec<Item>, String> {
    Ok(read_index()?.items)
}

/// One item's own words, for reading before it is given to anything.
#[tauri::command(async)]
pub fn library_read(id: String, kind: String) -> Result<String, String> {
    let ix = read_index()?;
    let it = ix
        .items
        .iter()
        .find(|i| i.id == id && i.kind == kind)
        .ok_or("nothing in the library by that name")?;
    std::fs::read_to_string(item_path(it)?).map_err(err)
}

/// Off the async runtime, deliberately.
///
/// `reqwest::blocking` builds and drops a runtime of its own, which panics
/// inside an async context — and a panicked command never answers, so the
/// window sits on "Reading…" for ever. The same trap the mail sync documents.
#[tauri::command]
pub async fn library_look(repo: String) -> Result<Source, String> {
    tauri::async_runtime::spawn_blocking(move || look(&repo))
        .await
        .map_err(|e| format!("the read did not finish: {e}"))?
}

#[tauri::command]
pub async fn library_install(source: Source, ids: Vec<String>) -> Result<Added, String> {
    tauri::async_runtime::spawn_blocking(move || install(&source, &ids))
        .await
        .map_err(|e| format!("the install did not finish: {e}"))?
}

/// Take one folder of a repository whole.
#[tauri::command]
pub async fn library_install_kit(source: Source, folder: String) -> Result<Added, String> {
    tauri::async_runtime::spawn_blocking(move || install_kit(&source, &folder))
        .await
        .map_err(|e| format!("the install did not finish: {e}"))?
}

/// A kit as it sits in *your* library: a repository, one of its folders, and
/// what came in from it. This is what a worker names.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct KitRef {
    /// `owner/name:folder` — what a worker stores.
    pub id: String,
    pub repo: String,
    pub folder: String,
    pub kind: String,
    pub count: usize,
}

/// Everything a worker may be handed, grouped the way the repository kept it.
pub fn kits_here() -> Result<Vec<KitRef>, String> {
    let mut out: Vec<KitRef> = Vec::new();
    for it in read_index()?.items {
        let Some(folder) = collection(&it.path) else {
            continue;
        };
        let id = format!("{}:{}", it.repo, folder);
        match out.iter_mut().find(|k| k.id == id) {
            Some(k) => k.count += 1,
            None => out.push(KitRef {
                id,
                repo: it.repo.clone(),
                folder,
                kind: it.kind.clone(),
                count: 1,
            }),
        }
    }
    out.sort_by(|a, b| b.count.cmp(&a.count).then(a.id.cmp(&b.id)));
    Ok(out)
}

#[tauri::command(async)]
pub fn library_kits() -> Result<Vec<KitRef>, String> {
    kits_here()
}

#[tauri::command(async)]
pub fn library_remove(id: String, kind: String) -> Result<(), String> {
    let mut ix = read_index()?;
    if let Some(it) = ix
        .items
        .iter()
        .find(|i| i.id == id && i.kind == kind)
        .cloned()
    {
        let p = item_path(&it)?;
        if it.kind == SKILL {
            let _ = std::fs::remove_dir_all(p.parent().unwrap());
        } else {
            let _ = std::fs::remove_file(p);
        }
    }
    ix.items.retain(|i| !(i.id == id && i.kind == kind));
    write_index(&ix)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bug this exists to stop: ECC keeps `code-reviewer` four times over
    /// — once for real, once under `.kiro` for another editor, and once per
    /// language it is translated into. All four want the name, and taking the
    /// first the tree listed handed people the Spanish copy of a skill without
    /// ever saying so, because the card looked identical either way.
    #[test]
    fn the_real_file_beats_a_translation_and_a_copy_for_another_editor() {
        let real = "skills/laravel-tdd/SKILL.md";
        for other in [
            "docs/es/skills/laravel-tdd/SKILL.md",
            "docs/ja-JP/skills/laravel-tdd/SKILL.md",
            ".kiro/skills/laravel-tdd/SKILL.md",
            ".cursor/skills/laravel-tdd/SKILL.md",
        ] {
            assert!(
                rank(real) < rank(other),
                "{real} should win over {other}, ranked {} against {}",
                rank(real),
                rank(other)
            );
        }
        assert!(rank("agents/architect.md") < rank(".kiro/agents/architect.md"));
    }

    #[test]
    fn a_kit_is_the_folder_a_repository_keeps_them_in() {
        assert_eq!(collection("agents/architect.md").as_deref(), Some("agents"));
        assert_eq!(
            collection("skills/brand-voice/SKILL.md").as_deref(),
            Some("skills")
        );
        assert_eq!(
            collection(".kiro/agents/code-reviewer.md").as_deref(),
            Some(".kiro/agents")
        );
        assert_eq!(
            collection("docs/es/skills/laravel-tdd/SKILL.md").as_deref(),
            Some("docs/es/skills")
        );
        // A skill that ships an agent of its own belongs to that inner folder,
        // which is the folder a worker would be handed.
        assert_eq!(
            collection("skills/lead-intelligence/agents/scout.md").as_deref(),
            Some("skills/lead-intelligence/agents")
        );
        assert_eq!(collection("README.md"), None);
    }

    #[test]
    fn a_kit_in_your_library_is_named_by_repository_and_folder() {
        let k = KitRef {
            id: "affaan-m/ECC:agents".into(),
            repo: "affaan-m/ECC".into(),
            folder: "agents".into(),
            kind: BRIEF.into(),
            count: 68,
        };
        assert_eq!(format!("{}:{}", k.repo, k.folder), k.id);
    }

    #[test]
    fn a_skill_folder_and_an_agent_file_are_the_two_things_a_library_holds() {
        assert_eq!(
            classify("skills/brand-voice/SKILL.md"),
            Some((SKILL.into(), "brand-voice".into()))
        );
        assert_eq!(
            classify(".claude/skills/taste/SKILL.md"),
            Some((SKILL.into(), "taste".into()))
        );
        assert_eq!(
            classify("agents/marketing-agent.md"),
            Some((BRIEF.into(), "marketing-agent".into()))
        );
        assert_eq!(
            classify(".claude/agents/planner.md"),
            Some((BRIEF.into(), "planner".into()))
        );
        // Everything that runs, and everything that is prose about the repo.
        assert_eq!(classify("hooks/pre-tool-use.js"), None);
        assert_eq!(classify("install.sh"), None);
        assert_eq!(classify(".mcp.json"), None);
        assert_eq!(classify("agents/README.md"), None);
        assert_eq!(
            classify("docs/SKILL.md"),
            None,
            "a skill lives under skills/"
        );
    }

    #[test]
    fn a_file_says_what_it_is_in_its_own_header() {
        let (name, what) = header("---\nname: brand-voice\ndescription: Build a voice profile\n  from real posts.\nmetadata:\n  origin: ECC\n---\n\n# Brand Voice\n");
        assert_eq!(name, "brand-voice");
        assert_eq!(what, "Build a voice profile from real posts.");
        // No header is not an error: it has no name of its own, and says so.
        assert_eq!(
            header("# Just a document\n"),
            (String::new(), String::new())
        );
    }

    /// Reads a real repository over the network and installs from it, into
    /// whatever `DEVDECK_HOME` points at. Ignored by default: the suite must
    /// not need GitHub to be up, or spend somebody's rate limit on every run.
    ///
    ///     cargo test --lib library::tests::reads_a_real_repository -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reads_a_real_repository() {
        let repo = std::env::var("LIB_REPO").unwrap_or_else(|_| "affaan-m/ECC".into());
        let src = look(&repo).expect("a look at the repository");
        println!("{} @ {} ({})", src.repo, &src.commit[..7], src.licence);
        println!("{} items, note: {}", src.items.len(), src.note);
        assert!(!src.commit.is_empty(), "pinned to a commit");
        assert!(!src.items.is_empty(), "something to hold");
        let want: Vec<String> = std::env::var("LIB_PICK")
            .unwrap_or_else(|_| {
                "brand-voice,taste,deep-research,design-system,marketing-agent,code-reviewer".into()
            })
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| src.items.iter().any(|i| &i.id == s))
            .collect();
        let added = install(&src, &want).expect("install");
        assert!(
            added.missed.is_empty(),
            "did not come in: {:?}",
            added.missed
        );
        for it in &added.items {
            println!(
                "added {} {} — {} ({} chars)",
                it.kind, it.id, it.what, it.chars
            );
            assert!(item_path(it).unwrap().is_file(), "{} landed on disk", it.id);
        }
        assert_eq!(added.items.len(), want.len());
    }

    #[test]
    fn a_repository_is_named_however_you_paste_it() {
        for input in [
            "https://github.com/affaan-m/ECC",
            "github.com/affaan-m/ECC/",
            "affaan-m/ECC",
            "https://github.com/affaan-m/ECC.git",
        ] {
            assert_eq!(repo_name(input).as_deref(), Some("affaan-m/ECC"), "{input}");
        }
        assert_eq!(repo_name("affaan-m"), None);
        assert_eq!(repo_name("not a url"), None);
    }
}
