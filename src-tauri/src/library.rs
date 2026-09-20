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

pub const SKILL: &str = "skill";
pub const BRIEF: &str = "brief";

/// How many files one look at a repository will read the headers of. A big
/// library has hundreds; reading every one to draw a list nobody scrolled to
/// the end of is somebody else's bandwidth and your wait.
const HEADERS: usize = 90;

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
        let Some((k, v)) = line.split_once(':') else { continue };
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
        let inside = parts.iter().any(|x| *x == "skills");
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

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .user_agent("DevDeck (library import)")
        .build()
        .map_err(err)
}

fn get_json(c: &reqwest::blocking::Client, url: &str) -> Result<serde_json::Value, String> {
    let res = c.get(url).send().map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = res.status();
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("GitHub is rate limiting this machine. It allows 60 reads an hour without a token; wait, or paste a token in Settings.".into());
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("no repository there. Check the owner and name, and that it is public.".into());
    }
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    res.json().map_err(|e| format!("GitHub sent something unreadable: {e}"))
}

/// `https://github.com/owner/name`, `owner/name`, with or without `.git`.
pub fn repo_name(input: &str) -> Option<String> {
    let t = input
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .replace("https://", "")
        .replace("http://", "");
    let t = t.trim_start_matches("www.").trim_start_matches("github.com/");
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

    let head = get_json(&c, &format!("https://api.github.com/repos/{repo}/commits/{branch}"))?;
    let commit = head
        .get("sha")
        .and_then(|s| s.as_str())
        .ok_or("GitHub did not say where that repository stands")?
        .to_string();

    let tree = get_json(
        &c,
        &format!("https://api.github.com/repos/{repo}/git/trees/{commit}?recursive=1"),
    )?;
    let cut = tree.get("truncated").and_then(|t| t.as_bool()).unwrap_or(false);
    let files = tree
        .get("tree")
        .and_then(|t| t.as_array())
        .ok_or("that repository has no file list")?;

    let mut found: Vec<(String, String, String)> = Vec::new(); // kind, id, path
    for f in files {
        if f.get("type").and_then(|t| t.as_str()) != Some("blob") {
            continue;
        }
        let Some(path) = f.get("path").and_then(|p| p.as_str()) else { continue };
        if let Some((kind, id)) = classify(path) {
            if !found.iter().any(|(_, x, _)| x == &id) {
                found.push((kind, id, path.to_string()));
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

    let have = read_index()?.items;
    let read_headers = found.len().min(HEADERS);
    let mut items: Vec<Candidate> = Vec::with_capacity(found.len());
    for (i, (kind, id, path)) in found.iter().enumerate() {
        let (mut name, mut what) = (id.clone(), String::new());
        if i < read_headers {
            if let Ok(res) = c.get(raw_url(&repo, &commit, path)).send() {
                if let Ok(text) = res.text() {
                    let (n, w) = header(&text);
                    if !n.is_empty() {
                        name = n;
                    }
                    what = w;
                }
            }
        }
        items.push(Candidate {
            id: id.clone(),
            kind: kind.clone(),
            name,
            what,
            path: path.clone(),
            have: have.iter().any(|h| &h.id == id && h.repo == repo && h.commit == commit),
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

    Ok(Source { repo, commit, licence, branch, items, note })
}

/// Fetch the ones you picked and write them into the library.
pub fn install(src: &Source, ids: &[String]) -> Result<Vec<Item>, String> {
    let c = client()?;
    let mut ix = read_index()?;
    let mut added = Vec::new();
    for cand in src.items.iter().filter(|i| ids.contains(&i.id)) {
        let url = raw_url(&src.repo, &src.commit, &cand.path);
        let text = c
            .get(&url)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.text())
            .map_err(|e| format!("could not read {}: {e}", cand.path))?;
        let (name, what) = header(&text);
        let it = Item {
            id: cand.id.clone(),
            kind: cand.kind.clone(),
            name: if name.is_empty() { cand.id.clone() } else { name },
            what,
            repo: src.repo.clone(),
            commit: src.commit.clone(),
            licence: src.licence.clone(),
            path: cand.path.clone(),
            added_at: crate::aiw::events::now_iso(),
            chars: text.chars().count() as i64,
        };
        let p = item_path(&it)?;
        std::fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
        std::fs::write(&p, &text).map_err(err)?;
        ix.items.retain(|x| !(x.id == it.id && x.kind == it.kind));
        ix.items.push(it.clone());
        added.push(it);
    }
    ix.items.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.id.cmp(&b.id)));
    write_index(&ix)?;
    Ok(added)
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

#[tauri::command(async)]
pub fn library_look(repo: String) -> Result<Source, String> {
    look(&repo)
}

#[tauri::command(async)]
pub fn library_install(source: Source, ids: Vec<String>) -> Result<Vec<Item>, String> {
    install(&source, &ids)
}

#[tauri::command(async)]
pub fn library_remove(id: String, kind: String) -> Result<(), String> {
    let mut ix = read_index()?;
    if let Some(it) = ix.items.iter().find(|i| i.id == id && i.kind == kind).cloned() {
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

    #[test]
    fn a_skill_folder_and_an_agent_file_are_the_two_things_a_library_holds() {
        assert_eq!(classify("skills/brand-voice/SKILL.md"), Some((SKILL.into(), "brand-voice".into())));
        assert_eq!(classify(".claude/skills/taste/SKILL.md"), Some((SKILL.into(), "taste".into())));
        assert_eq!(classify("agents/marketing-agent.md"), Some((BRIEF.into(), "marketing-agent".into())));
        assert_eq!(classify(".claude/agents/planner.md"), Some((BRIEF.into(), "planner".into())));
        // Everything that runs, and everything that is prose about the repo.
        assert_eq!(classify("hooks/pre-tool-use.js"), None);
        assert_eq!(classify("install.sh"), None);
        assert_eq!(classify(".mcp.json"), None);
        assert_eq!(classify("agents/README.md"), None);
        assert_eq!(classify("docs/SKILL.md"), None, "a skill lives under skills/");
    }

    #[test]
    fn a_file_says_what_it_is_in_its_own_header() {
        let (name, what) = header("---\nname: brand-voice\ndescription: Build a voice profile\n  from real posts.\nmetadata:\n  origin: ECC\n---\n\n# Brand Voice\n");
        assert_eq!(name, "brand-voice");
        assert_eq!(what, "Build a voice profile from real posts.");
        // No header is not an error: it has no name of its own, and says so.
        assert_eq!(header("# Just a document\n"), (String::new(), String::new()));
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
