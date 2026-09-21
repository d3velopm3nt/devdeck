//! Workers — the hands, as against the managers who keep the plan.
//!
//! A worker is yours, not a space's: a name, a brief, the skills it may use,
//! where it is allowed to write, and what it must never do. The same taste
//! reviewer serves every business you run, which is why these live in the
//! personal store beside the library they draw on.
//!
//! One worker doing one job is one **run**: an external CLI, briefed, spawned
//! in exactly one folder, streamed while it works, and stopped by a leash when
//! it goes past its time. The run record is the receipt — what was asked, what
//! it did, what it wrote, what it cost, and what you decided afterwards.
//!
//! The rule the whole thing hangs on: **DevDeck gates the session, not the
//! call.** Inside the run the CLI asks nobody, so everything that decides what
//! it could possibly touch — the folder, the branch, the skills it was given,
//! the limits — is settled before it starts and written down.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::aiw::cli_agent::{Leash, RunnerSpec};
use crate::aiw::deck::Doc;
use crate::db::{self, Db};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn now() -> String {
    crate::aiw::events::now_iso()
}

/// What no worker does, whatever it was asked. Not a setting: a worker that
/// could send, post, pay or push is not a draughtsman, it is an account.
pub const NEVER: [&str; 5] = ["send mail", "post anywhere", "spend money", "push", "merge"];

/// One worker, as its file says it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct WorkerMeta {
    pub handle: String,
    pub name: String,
    /// One line: what it is for.
    #[serde(default)]
    pub what: String,
    /// A library brief id, or empty for "the job is the brief".
    #[serde(default)]
    pub brief: String,
    /// Library skill ids. These, and nothing else in the library.
    #[serde(default)]
    pub skills: Vec<String>,
    /// claude-code today. The runner is a setting because a second CLI is a
    /// setting, not a rewrite.
    #[serde(default)]
    pub runner: String,
    #[serde(default)]
    pub model: String,
    /// folder | branch. A draught needs no repository; code gets a branch of
    /// its own rather than whatever happened to be checked out.
    #[serde(default)]
    pub writes: String,
    /// Minutes, then dollars. Zero means no limit, which is only honest for
    /// something you are watching.
    #[serde(default)]
    pub minutes: i64,
    #[serde(default)]
    pub usd: f64,
    /// Spaces it may work in. Empty means any of yours, which is the point of
    /// owning it rather than a space owning it.
    #[serde(default)]
    pub spaces: Vec<i64>,
    /// May a manager start it while nobody is watching?
    #[serde(default)]
    pub unattended: bool,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Worker {
    #[serde(flatten)]
    pub meta: WorkerMeta,
    /// Anything you want said to it every time, in your words.
    #[serde(default)]
    pub body: String,
}

/// A file the run wrote, as found afterwards.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct FileOut {
    pub path: String,
    pub bytes: u64,
}

/// One thing the run did, as it said it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Step {
    pub at: String,
    /// message | tool | stderr | note
    pub kind: String,
    pub text: String,
}

/// The receipt for one job.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Run {
    pub id: String,
    pub worker: String,
    pub worker_name: String,
    pub node_id: i64,
    pub space: String,
    pub title: String,
    pub intent: String,
    /// running | done | stopped | failed | kept | discarded
    pub status: String,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: String,
    pub folder: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub minutes_limit: i64,
    #[serde(default)]
    pub usd_limit: f64,
    #[serde(default)]
    pub usd: f64,
    #[serde(default)]
    pub seconds: i64,
    #[serde(default)]
    pub files: Vec<FileOut>,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub ok: bool,
    /// What you did with it afterwards, in your words.
    #[serde(default)]
    pub decision: String,
}

/// What starting a worker would mean, before it means it.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Plan {
    pub worker: WorkerMeta,
    pub node_id: i64,
    pub space: String,
    pub title: String,
    pub intent: String,
    pub folder: String,
    pub branch: String,
    pub is_repo: bool,
    /// Library items it will be given, named so they can be read first.
    pub skills: Vec<crate::library::Item>,
    pub brief: Option<crate::library::Item>,
    /// What it will read before it starts: the space's own knowledge.
    pub reads: Vec<String>,
    pub never: Vec<String>,
    pub minutes: i64,
    pub usd: f64,
    pub model: String,
    /// False when it could not start, with `note` saying why.
    pub ready: bool,
    pub note: String,
}

// ---------------------------------------------------------------------------
// Where they live
// ---------------------------------------------------------------------------

fn root() -> Result<PathBuf, String> {
    Ok(crate::aiw::personal::PersonalStore::open()?
        .root()
        .to_path_buf())
}

fn workers_dir() -> Result<PathBuf, String> {
    Ok(root()?.join("workers"))
}

fn runs_dir() -> Result<PathBuf, String> {
    Ok(root()?.join("runs"))
}

pub fn read_worker(handle: &str) -> Result<Option<Worker>, String> {
    let p = workers_dir()?.join(format!("{handle}.md"));
    if !p.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&p).map_err(err)?;
    let doc = crate::aiw::deck::parse_doc::<WorkerMeta>(&raw)?;
    Ok(Some(Worker {
        meta: doc.meta,
        body: doc.body,
    }))
}

pub fn all_workers() -> Result<Vec<Worker>, String> {
    let dir = workers_dir()?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let handle = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if let Some(mut w) = read_worker(&handle)? {
            if w.meta.handle.trim().is_empty() {
                w.meta.handle = handle;
            }
            out.push(w);
        }
    }
    out.sort_by_key(|w| w.meta.name.to_lowercase());
    Ok(out)
}

pub fn save_worker(w: &Worker) -> Result<Worker, String> {
    let mut w = w.clone();
    w.meta.handle = crate::managers::handle_from(if w.meta.handle.trim().is_empty() {
        &w.meta.name
    } else {
        &w.meta.handle
    });
    if w.meta.handle.is_empty() {
        return Err("a worker needs a name.".into());
    }
    if w.meta.name.trim().is_empty() {
        w.meta.name = w.meta.handle.clone();
    }
    if w.meta.runner.trim().is_empty() {
        w.meta.runner = crate::aiw::cli_agent::CLAUDE_CODE.into();
    }
    if w.meta.writes.trim().is_empty() {
        w.meta.writes = "folder".into();
    }
    if w.meta.minutes <= 0 {
        w.meta.minutes = 20;
    }
    if w.meta.usd <= 0.0 {
        w.meta.usd = 2.0;
    }
    if w.meta.created_at.trim().is_empty() {
        w.meta.created_at = now();
    }
    let dir = workers_dir()?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let doc = Doc {
        meta: w.meta.clone(),
        body: w.body.clone(),
    };
    std::fs::write(
        dir.join(format!("{}.md", w.meta.handle)),
        crate::aiw::deck::write_doc(&doc)?,
    )
    .map_err(err)?;
    Ok(w)
}

pub fn read_run(id: &str) -> Result<Option<Run>, String> {
    let p = runs_dir()?.join(format!("{id}.md"));
    if !p.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&p).map_err(err)?;
    Ok(Some(crate::aiw::deck::parse_doc::<Run>(&raw)?.meta))
}

pub fn write_run(r: &Run) -> Result<(), String> {
    let dir = runs_dir()?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    let doc = Doc {
        meta: r.clone(),
        body: format!("# {}\n\n{}\n", r.title, r.verdict),
    };
    std::fs::write(
        dir.join(format!("{}.md", r.id)),
        crate::aiw::deck::write_doc(&doc)?,
    )
    .map_err(err)
}

pub fn all_runs() -> Result<Vec<Run>, String> {
    let Ok(entries) = std::fs::read_dir(runs_dir()?) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<Run> = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(doc) = crate::aiw::deck::parse_doc::<Run>(&raw) {
                out.push(doc.meta);
            }
        }
    }
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Starters
// ---------------------------------------------------------------------------

/// Workers worth having before you have written one. Suggestions, not
/// fixtures: each says which library skills it wants, and one you have not
/// installed is offered rather than silently dropped.
pub fn starters() -> Vec<(WorkerMeta, String, &'static str)> {
    let w = |handle: &str,
             name: &str,
             what: &str,
             brief: &str,
             skills: &[&str],
             writes: &str,
             mins: i64,
             usd: f64,
             body: &str,
             needs: &'static str| {
        (
            WorkerMeta {
                handle: handle.into(),
                name: name.into(),
                what: what.into(),
                brief: brief.into(),
                skills: skills.iter().map(|s| s.to_string()).collect(),
                runner: crate::aiw::cli_agent::CLAUDE_CODE.into(),
                model: "sonnet".into(),
                writes: writes.into(),
                minutes: mins,
                usd,
                spaces: Vec::new(),
                unattended: false,
                created_at: String::new(),
            },
            body.to_string(),
            needs,
        )
    };
    vec![
        w("scribe", "Scribe", "Writes a draught in your voice: pages, posts, letters", "marketing-agent",
          &["brand-voice", "marketing-campaign"], "folder", 20, 2.0,
          "Write the draught and nothing else. Mark any claim you could not check, and say where you would check it.", "brand-voice"),
        w("taste", "Taste", "Reviews a page or a screen and says what is wrong with it", "",
          &["taste", "design-system", "accessibility"], "folder", 15, 1.5,
          "Judge what is in front of you. Be specific and ordered: the worst thing first. Never rewrite the thing you are reviewing.", "taste"),
        w("digger", "Digger", "Researches a question and comes back with sources", "",
          &["deep-research", "market-research"], "folder", 25, 3.0,
          "Cite everything. A claim without a source is written as a question, not as a fact.", "deep-research"),
        w("reporter", "Reporter", "Turns what happened into a note the team can read", "",
          &["knowledge-ops"], "folder", 12, 1.0,
          "Short sentences, numbers where there are numbers, and nothing that is not in the material.", ""),
        w("mechanic", "Mechanic", "Fixes a build, a test or a dependency on its own branch", "code-reviewer",
          &["tdd-workflow"], "branch", 30, 4.0,
          "Smallest change that fixes it. Run the tests. Never push, never merge: leave the branch for review.", ""),
    ]
}

// ---------------------------------------------------------------------------
// Planning a run
// ---------------------------------------------------------------------------

fn space_dir(
    conn: &rusqlite::Connection,
    node_id: i64,
) -> Result<(String, PathBuf, Option<PathBuf>), String> {
    let n = db::node_by_id(conn, node_id)?;
    let deck = db::node_deck_dir(conn, &n).ok_or("that space has no folder on disk yet.")?;
    let repo = n.path.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    Ok((n.name, deck, repo))
}

fn knowledge_titles(dir: &Path) -> Vec<String> {
    let k = crate::aiw::deck::Deck::new(dir).knowledge_dir();
    let Ok(entries) = std::fs::read_dir(k) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            (p.extension().and_then(|x| x.to_str()) == Some("md")).then(|| {
                p.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .replace('-', " ")
            })
        })
        .collect();
    out.sort();
    out.truncate(12);
    out
}

pub fn plan(
    conn: &rusqlite::Connection,
    handle: &str,
    node_id: i64,
    title: &str,
    intent: &str,
) -> Result<Plan, String> {
    let w = read_worker(handle)?.ok_or("there is no worker by that name.")?;
    let (space, deck, repo) = space_dir(conn, node_id)?;
    let lib = crate::library::read_index()?.items;
    let skills: Vec<crate::library::Item> = w
        .meta
        .skills
        .iter()
        .filter_map(|id| {
            lib.iter()
                .find(|i| &i.id == id && i.kind == crate::library::SKILL)
                .cloned()
        })
        .collect();
    let brief = lib
        .iter()
        .find(|i| i.id == w.meta.brief && i.kind == crate::library::BRIEF)
        .cloned();

    let wants_branch = w.meta.writes == "branch";
    let folder = if wants_branch {
        repo.clone().unwrap_or_else(|| deck.clone())
    } else {
        deck.clone()
    };
    let missing: Vec<String> = w
        .meta
        .skills
        .iter()
        .filter(|id| !skills.iter().any(|s| &&s.id == id))
        .cloned()
        .collect();

    let health = crate::aiw::cli_agent::health(&w.meta.runner);
    let allowed = w.meta.spaces.is_empty() || w.meta.spaces.contains(&node_id);

    let mut note = String::new();
    let mut ready = true;
    if !health.ok {
        ready = false;
        note = health.detail.clone();
    } else if !allowed {
        ready = false;
        note = format!(
            "{} is not lent to {space}. Lend it on the worker's page.",
            w.meta.name
        );
    } else if wants_branch && repo.is_none() {
        ready = false;
        note = format!(
            "{} writes on a branch, and {space} has no repository.",
            w.meta.name
        );
    } else if !missing.is_empty() {
        note = format!(
            "Not in your library yet, so it will work without: {}.",
            missing.join(", ")
        );
    }

    Ok(Plan {
        branch: if wants_branch && repo.is_some() {
            format!(
                "devdeck/{}-{}",
                crate::managers::handle_from(title),
                chrono::Local::now().format("%m%d")
            )
        } else {
            String::new()
        },
        is_repo: wants_branch && repo.is_some(),
        folder: folder.to_string_lossy().to_string(),
        reads: knowledge_titles(&deck),
        skills,
        brief,
        never: NEVER.iter().map(|s| s.to_string()).collect(),
        minutes: w.meta.minutes,
        usd: w.meta.usd,
        model: w.meta.model.clone(),
        worker: w.meta,
        node_id,
        space,
        title: title.trim().to_string(),
        intent: intent.trim().to_string(),
        ready,
        note,
    })
}

/// Everything the CLI is told, in one string.
///
/// Assembled here rather than left to the runner because this is the only
/// place that knows all of it: who it is, the job, where it may write, what it
/// must never do, and what the space already knows.
pub fn brief_text(p: &Plan, w: &Worker, knowledge: &str) -> String {
    let mut s = String::new();
    if let Some(b) = &p.brief {
        s.push_str(&format!(
            "# Who you are\n\nYou are {}, working for {}.\n\n",
            b.name, p.space
        ));
    } else {
        s.push_str(&format!(
            "# Who you are\n\nYou are {}, working for {}.\n\n",
            w.meta.name, p.space
        ));
    }
    if !w.body.trim().is_empty() {
        s.push_str(w.body.trim());
        s.push_str("\n\n");
    }
    s.push_str(&format!("# The job\n\n{}\n\n{}\n\n", p.title, p.intent));
    s.push_str("# Where you work\n\n");
    s.push_str(&format!(
        "Everything you write goes in this folder: {}\n",
        p.folder
    ));
    if p.is_repo {
        s.push_str(&format!(
            "You are on the branch {}. Commit there.\n",
            p.branch
        ));
    }
    s.push_str("\n# Never\n\n");
    for n in NEVER {
        s.push_str(&format!("- {n}\n"));
    }
    s.push_str("- write anything outside that folder\n\n");
    if !p.skills.is_empty() {
        s.push_str("# Skills you have\n\n");
        for sk in &p.skills {
            s.push_str(&format!("- {} ({}): {}\n", sk.name, sk.id, sk.what));
        }
        s.push_str("\nThey are in .claude/skills. Use them.\n\n");
    }
    if !knowledge.trim().is_empty() {
        s.push_str("# What this space already knows\n\n");
        s.push_str(knowledge.trim());
        s.push_str("\n\n");
    }
    s.push_str("# When you are done\n\nSay in two sentences what you did, and list any claim you could not check.\n");
    s
}

fn knowledge_text(dir: &Path) -> String {
    let k = crate::aiw::deck::Deck::new(dir).knowledge_dir();
    let Ok(entries) = std::fs::read_dir(k) else {
        return String::new();
    };
    let mut s = String::new();
    for e in entries.flatten().take(14) {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&p) {
            let body = text.rsplit("---").next().unwrap_or(&text);
            s.push_str(body.trim());
            s.push_str("\n\n");
        }
        if s.chars().count() > 6000 {
            break;
        }
    }
    s
}

/// Give the session the skills it was granted, and nothing else in the
/// library. Written where Claude Code looks, and kept out of the repository's
/// history: generated, never tracked.
fn lay_out_skills(cwd: &Path, ids: &[String]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let dest = cwd.join(".claude").join("skills");
    std::fs::create_dir_all(&dest).map_err(err)?;
    let mut n = 0;
    for id in ids {
        let from = crate::library::skill_dir(id)?;
        if !from.is_dir() {
            continue;
        }
        let to = dest.join(id);
        std::fs::create_dir_all(&to).map_err(err)?;
        for e in std::fs::read_dir(&from).map_err(err)?.flatten() {
            let p = e.path();
            if p.is_file() {
                let name = p.file_name().unwrap_or_default();
                std::fs::copy(&p, to.join(name)).map_err(err)?;
            }
        }
        n += 1;
    }
    // A repository keeps ours out of its history the local way, so nothing of
    // DevDeck's lands in somebody's pull request.
    let excl = cwd.join(".git").join("info").join("exclude");
    if excl.parent().is_some_and(|p| p.is_dir()) {
        let have = std::fs::read_to_string(&excl).unwrap_or_default();
        if !have.contains(".claude/skills") {
            let _ = std::fs::write(
                &excl,
                format!("{have}\n# DevDeck gives a worker its skills here\n.claude/skills/\n"),
            );
        }
    }
    Ok(n)
}

fn start_branch(cwd: &Path, branch: &str) -> Result<(), String> {
    let out = std::process::Command::new("git")
        .args(["switch", "-c", branch])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("could not run git: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let msg = String::from_utf8_lossy(&out.stderr);
    if msg.contains("already exists") {
        let again = std::process::Command::new("git")
            .args(["switch", branch])
            .current_dir(cwd)
            .output()
            .map_err(|e| format!("could not run git: {e}"))?;
        if again.status.success() {
            return Ok(());
        }
    }
    Err(format!(
        "could not make the branch {branch}: {}",
        msg.trim()
    ))
}

/// What changed in the folder while it worked. Found by looking, not by
/// believing the run: a session that says it wrote a file and did not is
/// exactly the kind of thing a receipt exists to catch.
fn written_since(cwd: &Path, since: std::time::SystemTime) -> Vec<FileOut> {
    fn walk(
        dir: &Path,
        base: &Path,
        since: std::time::SystemTime,
        out: &mut Vec<FileOut>,
        depth: usize,
    ) {
        if depth > 6 || out.len() > 200 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            if p.is_dir() {
                walk(&p, base, since, out, depth + 1);
            } else if let Ok(meta) = p.metadata() {
                if meta.modified().is_ok_and(|m| m >= since) {
                    out.push(FileOut {
                        path: p
                            .strip_prefix(base)
                            .unwrap_or(&p)
                            .to_string_lossy()
                            .replace('\\', "/"),
                        bytes: meta.len(),
                    });
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(cwd, cwd, since, &mut out, 0);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

type Leashes = Mutex<HashMap<String, Arc<Leash>>>;

fn leashes() -> &'static Leashes {
    static L: OnceLock<Leashes> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashMap::new()))
}

fn new_id() -> String {
    format!(
        "run_{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

fn emit(app: &tauri::AppHandle, event: &str, body: serde_json::Value) {
    use tauri::Emitter;
    let _ = app.emit(event, body);
}

/// Start one run, and report as it goes.
///
/// Spawned on its own thread: a session takes minutes, and the window cannot
/// wait on it. Everything the caller needs back — that it started, and where
/// to watch — is in the record this returns immediately.
pub fn start(app: &tauri::AppHandle, db: &Db, p: Plan) -> Result<Run, String> {
    if !p.ready {
        return Err(if p.note.is_empty() {
            "that worker cannot start here.".into()
        } else {
            p.note.clone()
        });
    }
    let w = read_worker(&p.worker.handle)?.ok_or("there is no worker by that name.")?;
    let cwd = PathBuf::from(&p.folder);
    if !cwd.is_dir() {
        return Err(format!("{} is not a folder on this machine.", p.folder));
    }
    let deck_dir = {
        let conn = db.0.lock().unwrap();
        let (_, deck, _) = space_dir(&conn, p.node_id)?;
        deck
    };

    if p.is_repo && !p.branch.is_empty() {
        start_branch(&cwd, &p.branch)?;
    }
    let laid = lay_out_skills(&cwd, &w.meta.skills)?;
    let brief = brief_text(&p, &w, &knowledge_text(&deck_dir));
    // The brief goes in a file, and the command line stays one plain line.
    //
    // Not tidiness: on Windows the CLI is a `.cmd` wrapper, and Rust refuses
    // to hand a batch file an argument with a newline or a quote in it --
    // "batch file arguments are invalid", which is how a perfectly good run
    // dies before it starts. A brief is prose, so it was always going to hit
    // that. It is better this way regardless: the worker can re-read it, and
    // the brief stays in the folder as part of the receipt.
    let brief_path = cwd.join(".claude").join("devdeck-brief.md");
    std::fs::create_dir_all(brief_path.parent().unwrap()).map_err(err)?;
    std::fs::write(&brief_path, &brief).map_err(err)?;
    let prompt = "Read .claude/devdeck-brief.md and do what it says.".to_string();

    let run = Run {
        id: new_id(),
        worker: w.meta.handle.clone(),
        worker_name: w.meta.name.clone(),
        node_id: p.node_id,
        space: p.space.clone(),
        title: p.title.clone(),
        intent: p.intent.clone(),
        status: "running".into(),
        started_at: now(),
        folder: p.folder.clone(),
        branch: p.branch.clone(),
        skills: w.meta.skills.clone(),
        minutes_limit: p.minutes,
        usd_limit: p.usd,
        steps: vec![Step {
            at: now(),
            kind: "note".into(),
            text: format!(
                "Started in {}{}{}",
                p.folder,
                if p.branch.is_empty() {
                    String::new()
                } else {
                    format!(" on {}", p.branch)
                },
                if laid > 0 {
                    format!(", with {laid} skill{}", if laid == 1 { "" } else { "s" })
                } else {
                    String::new()
                }
            ),
        }],
        ..Default::default()
    };
    write_run(&run)?;

    let leash = Arc::new(Leash::for_minutes(p.minutes.max(0) as u64));
    leashes()
        .lock()
        .unwrap()
        .insert(run.id.clone(), leash.clone());

    let spec = RunnerSpec {
        program: String::new(),
        model: w.meta.model.clone(),
        permission_mode: String::new(),
        unattended: true,
    };
    let app2 = app.clone();
    let mut live = run.clone();
    let started = std::time::SystemTime::now();
    std::thread::spawn(move || {
        let mut last_write = std::time::Instant::now();
        let outcome = crate::aiw::cli_agent::run_watched(
            &spec,
            &cwd,
            &prompt,
            &mut |e| {
                let step = Step {
                    at: now(),
                    kind: e.kind.to_string(),
                    text: e.text.clone(),
                };
                live.steps.push(step.clone());
                emit(
                    &app2,
                    "worker:step",
                    serde_json::json!({ "run": live.id, "step": step }),
                );
                // Written as it goes, so a crash leaves what was said rather than
                // an empty record of a run that plainly happened.
                if last_write.elapsed() > std::time::Duration::from_secs(3) {
                    let _ = write_run(&live);
                    last_write = std::time::Instant::now();
                }
            },
            &leash,
        );

        live.seconds = started.elapsed().map(|d| d.as_secs() as i64).unwrap_or(0);
        live.ended_at = now();
        live.files = written_since(&cwd, started);
        match outcome {
            Ok(o) => {
                live.ok = o.ok;
                live.usd = o.cost_usd;
                live.verdict = o.summary;
                live.status = if leash.pulled() {
                    "stopped".into()
                } else if o.ok {
                    "done".into()
                } else {
                    "failed".into()
                };
            }
            Err(e) => {
                live.ok = false;
                live.status = "failed".into();
                live.verdict = e;
            }
        }
        let _ = write_run(&live);
        leashes().lock().unwrap().remove(&live.id);
        emit(&app2, "worker:done", serde_json::json!({ "run": live }));
        crate::activity::record(
            &app2,
            "worker",
            format!("{} finished {}", live.worker_name, live.title),
            if live.verdict.trim().is_empty() {
                live.status.clone()
            } else {
                live.verdict.clone()
            },
            live.ok,
            Some(live.node_id),
        );
    });

    Ok(run)
}

/// The first thing on a manager's plan that nobody has picked up.
///
/// A manager hands out one job at a time on purpose: a wake that started five
/// sessions at three in the morning is not a manager, it is a bill.
pub fn next_open_item(
    conn: &rusqlite::Connection,
    bot: &crate::bots::Bot,
) -> Option<(String, String)> {
    let n = db::node_by_id(conn, bot.node_id).ok()?;
    let dir = crate::db::node_deck_dir(conn, &n)?;
    let deck = crate::aiw::deck::Deck::new(&dir);
    if !deck.exists() {
        return None;
    }
    let mine: Vec<String> = bot
        .portfolio
        .iter()
        .filter(|o| o.node_id == bot.node_id)
        .map(|o| o.feature.clone())
        .collect();
    for slug in mine {
        let Ok(work) = deck.work(&slug) else { continue };
        for item in work.meta.items {
            if item.status.is_empty() || item.status == "unclaimed" {
                return Some((item.id, item.title));
            }
        }
    }
    None
}

/// What a manager's wake should do about its worker, said in one sentence.
///
/// Three outcomes, and the difference between them is consent: it started
/// one, it wants to start one and is asking, or it has nobody to hand to.
pub enum Handoff {
    /// The worker, the job, and the item it came from.
    Start(String, String, String),
    /// It would start this, but nothing has said it may while you sleep.
    Ask(String, String),
    Nothing,
}

pub fn handoff(conn: &rusqlite::Connection, bot: &crate::bots::Bot) -> Handoff {
    if bot.worker.trim().is_empty() {
        return Handoff::Nothing;
    }
    let Some((id, title)) = next_open_item(conn, bot) else {
        return Handoff::Nothing;
    };
    let Ok(Some(w)) = read_worker(bot.worker.trim()) else {
        return Handoff::Nothing;
    };
    let lent = w.meta.spaces.is_empty() || w.meta.spaces.contains(&bot.node_id);
    if !lent {
        return Handoff::Nothing;
    }
    if w.meta.unattended {
        Handoff::Start(w.meta.handle, title, id)
    } else {
        Handoff::Ask(w.meta.name, title)
    }
}

// ---------------------------------------------------------------------------
// What the window calls
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn workers_list() -> Result<Vec<Worker>, String> {
    all_workers()
}

#[tauri::command(async)]
pub fn worker_save(worker: Worker) -> Result<Worker, String> {
    save_worker(&worker)
}

#[tauri::command(async)]
pub fn worker_delete(handle: String) -> Result<(), String> {
    let p = workers_dir()?.join(format!("{handle}.md"));
    let _ = std::fs::remove_file(p);
    Ok(())
}

/// The workers worth having, minus the ones you already made.
#[tauri::command(async)]
pub fn worker_starters() -> Result<Vec<Worker>, String> {
    let have = all_workers()?;
    Ok(starters()
        .into_iter()
        .filter(|(m, _, _)| !have.iter().any(|w| w.meta.handle == m.handle))
        .map(|(meta, body, _)| Worker { meta, body })
        .collect())
}

#[tauri::command(async)]
pub fn worker_plan(
    db: tauri::State<Db>,
    handle: String,
    node_id: i64,
    title: String,
    intent: String,
) -> Result<Plan, String> {
    let conn = db.0.lock().unwrap();
    plan(&conn, &handle, node_id, &title, &intent)
}

#[tauri::command]
pub async fn worker_start(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    handle: String,
    node_id: i64,
    title: String,
    intent: String,
) -> Result<Run, String> {
    let p = {
        let conn = db.0.lock().unwrap();
        plan(&conn, &handle, node_id, &title, &intent)?
    };
    start(&app, &db, p)
}

#[tauri::command(async)]
pub fn worker_stop(id: String) -> Result<(), String> {
    if let Some(l) = leashes().lock().unwrap().get(&id) {
        l.pull();
    }
    Ok(())
}

#[tauri::command(async)]
pub fn runs_list(node_id: i64) -> Result<Vec<Run>, String> {
    let all = all_runs()?;
    Ok(if node_id > 0 {
        all.into_iter().filter(|r| r.node_id == node_id).collect()
    } else {
        all
    })
}

#[tauri::command(async)]
pub fn run_get(id: String) -> Result<Option<Run>, String> {
    read_run(&id)
}

/// Say what you did with what came back. Kept is the only one that changes
/// anything: it writes a line into the space's knowledge, so the next worker
/// starts from it.
#[tauri::command(async)]
pub fn run_decide(
    db: tauri::State<Db>,
    id: String,
    decision: String,
    note: String,
) -> Result<Run, String> {
    let mut r = read_run(&id)?.ok_or("no run by that id.")?;
    r.decision = note.trim().to_string();
    r.status = match decision.as_str() {
        "keep" => "kept".into(),
        "discard" => "discarded".into(),
        other => other.to_string(),
    };
    write_run(&r)?;
    if r.status == "kept" && r.node_id > 0 {
        let conn = db.0.lock().unwrap();
        let slug = crate::managers::handle_from(&r.title);
        let body = format!(
            "---\nid: {slug}\nsource: worker\nworker: {}\nrun: {}\n---\n\n# {}\n\n{}\n\n{}\n\n> {} wrote {} file{} in {} on {}\n",
            r.worker, r.id, r.title,
            if r.verdict.trim().is_empty() { "Kept." } else { r.verdict.trim() },
            if r.decision.is_empty() { String::new() } else { format!("You said: {}\n", r.decision) },
            r.worker_name,
            r.files.len(),
            if r.files.len() == 1 { "" } else { "s" },
            r.folder,
            r.started_at,
        );
        let _ = crate::business::knowledge_note(&conn, r.node_id, &slug, &body);
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_for(skills: &[&str], is_repo: bool) -> Plan {
        Plan {
            worker: WorkerMeta {
                name: "Scribe".into(),
                ..Default::default()
            },
            space: "Fathomline".into(),
            title: "Landing page".into(),
            intent: "Write the page.".into(),
            folder: "C:/vault/Fathomline/Marketing".into(),
            branch: if is_repo {
                "devdeck/landing-0921".into()
            } else {
                String::new()
            },
            is_repo,
            skills: skills
                .iter()
                .map(|id| crate::library::Item {
                    id: (*id).to_string(),
                    name: (*id).to_string(),
                    what: "does a thing".into(),
                    ..Default::default()
                })
                .collect(),
            never: NEVER.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    /// What a profile on disk actually holds, for a demo run.
    ///     cargo test --lib workers::tests::what_is_on_disk -- --ignored --nocapture
    #[test]
    #[ignore]
    fn what_is_on_disk() {
        println!("root: {:?}", root());
        match all_workers() {
            Ok(w) => {
                println!("{} workers", w.len());
                for x in &w {
                    println!(
                        "  {} ({}) skills={:?} writes={}",
                        x.meta.handle, x.meta.name, x.meta.skills, x.meta.writes
                    );
                }
            }
            Err(e) => println!("workers failed: {e}"),
        }
        match crate::library::read_index() {
            Ok(ix) => println!(
                "{} library items: {:?}",
                ix.items.len(),
                ix.items.iter().map(|i| &i.id).collect::<Vec<_>>()
            ),
            Err(e) => println!("library failed: {e}"),
        }
        match all_runs() {
            Ok(r) => println!(
                "{} runs: {:?}",
                r.len(),
                r.iter().map(|x| (&x.id, &x.status)).collect::<Vec<_>>()
            ),
            Err(e) => println!("runs failed: {e}"),
        }
    }

    #[test]
    fn a_brief_says_the_job_the_folder_and_what_it_must_never_do() {
        let w = Worker {
            meta: WorkerMeta {
                name: "Scribe".into(),
                ..Default::default()
            },
            body: "Mark any claim you could not check.".into(),
        };
        let text = brief_text(
            &plan_for(&["brand-voice"], false),
            &w,
            "Fathomline sells subsea inspection.",
        );
        assert!(text.contains("You are Scribe, working for Fathomline"));
        assert!(text.contains("Mark any claim you could not check."));
        assert!(text.contains("C:/vault/Fathomline/Marketing"));
        assert!(text.contains("brand-voice"));
        assert!(text.contains("Fathomline sells subsea inspection."));
        for n in NEVER {
            assert!(text.contains(n), "the brief has to say '{n}'");
        }
        assert!(
            !text.contains("branch"),
            "no repository, so no branch is mentioned"
        );
    }

    #[test]
    fn work_on_code_is_told_which_branch_it_is_on() {
        let w = Worker {
            meta: WorkerMeta {
                name: "Mechanic".into(),
                ..Default::default()
            },
            body: String::new(),
        };
        let text = brief_text(&plan_for(&[], true), &w, "");
        assert!(text.contains("You are on the branch devdeck/landing-0921"));
    }

    #[test]
    fn a_worker_is_saved_with_the_limits_it_did_not_name() {
        let w = Worker {
            meta: WorkerMeta {
                name: "Taste review".into(),
                ..Default::default()
            },
            body: String::new(),
        };
        // Saving is filesystem work; this checks the shaping that happens first.
        let mut shaped = w.clone();
        shaped.meta.handle = crate::managers::handle_from(&w.meta.name);
        assert_eq!(shaped.meta.handle, "taste-review");
        let starters = starters();
        let mechanic = starters
            .iter()
            .find(|(m, _, _)| m.handle == "mechanic")
            .expect("a mechanic");
        assert_eq!(
            mechanic.0.writes, "branch",
            "code work gets a branch of its own"
        );
        assert!(
            starters
                .iter()
                .all(|(m, _, _)| m.minutes > 0 && m.usd > 0.0),
            "every starter has a limit"
        );
        assert!(
            starters.iter().all(|(m, _, _)| !m.unattended),
            "nothing runs unwatched until you say so"
        );
    }
}
