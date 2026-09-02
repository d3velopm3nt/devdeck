//! Read-only-ish git status for projects, plus a fast-forward pull.
//!
//!  * `git_info`   — branch + ahead/behind from *local* refs. No network.
//!  * `git_fetch`  — a quiet, non-interactive `git fetch`, then fresh status.
//!    This is how monitoring learns there are changes to pull.
//!  * `git_pull`   — `git pull --ff-only`, streaming to the Logs bus.
//!
//! Fetch/pull run with `GIT_TERMINAL_PROMPT=0` so a private repo without
//! cached credentials fails fast instead of hanging on a prompt.

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::Emitter;

use crate::services;

const GIT_LOG_ID: i64 = -400_000;

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

#[derive(Serialize, Clone, Default)]
pub struct GitInfo {
    /// True when `dir` is inside a git work tree and git is available.
    pub is_repo: bool,
    /// The current branch name, or the short commit hash when detached.
    pub branch: Option<String>,
    /// True when HEAD is detached (no branch); `branch` then holds the hash.
    pub detached: bool,
    /// The upstream tracking ref (e.g. "origin/main"), if one is configured.
    pub upstream: Option<String>,
    /// Commits the upstream has that we don't — i.e. changes to pull.
    pub ahead: u32,
    /// Commits we have that the upstream doesn't — i.e. changes to push.
    pub behind: u32,
}

/// Run `git -C <dir> <args>` and return trimmed stdout, or None on failure.
///
/// Public because the AI Workspace builds its context checkpoints on the same
/// git plumbing; duplicating the no-window / no-prompt handling elsewhere is
/// how one of the two copies ends up hanging on a credential prompt.
pub fn run_git(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Branch + ahead/behind from whatever refs are already local (no network).
fn read_status(d: &Path) -> GitInfo {
    let branch = match run_git(d, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Some(s) if !s.is_empty() => s,
        _ => return GitInfo::default(), // not a repo / git missing
    };

    if branch == "HEAD" {
        // Detached — report the short commit; ahead/behind don't apply.
        let sha = run_git(d, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
        return GitInfo {
            is_repo: true,
            branch: Some(sha),
            detached: true,
            ..Default::default()
        };
    }

    let upstream = run_git(
        d,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .filter(|s| !s.is_empty());

    let (mut ahead, mut behind) = (0u32, 0u32);
    if upstream.is_some() {
        // "<behind>\t<ahead>" — left side is upstream-only (to pull), right is HEAD-only (to push).
        if let Some(counts) = run_git(
            d,
            &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        ) {
            let mut it = counts.split_whitespace();
            behind = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            ahead = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }

    GitInfo {
        is_repo: true,
        branch: Some(branch),
        detached: false,
        upstream,
        ahead,
        behind,
    }
}

/// Current branch + ahead/behind for the repo containing `dir`, computed from
/// local refs only (no network). Cheap enough to call on every tree load.
#[tauri::command]
pub fn git_info(dir: String) -> GitInfo {
    let d = Path::new(&dir);
    if dir.trim().is_empty() || !d.is_dir() {
        return GitInfo::default();
    }
    read_status(d)
}

/// Best-effort quiet fetch (updates remote-tracking refs), then fresh status.
/// Non-interactive: a repo whose credentials aren't cached fails fast and we
/// simply return the pre-fetch status rather than hanging on a prompt.
#[tauri::command]
pub fn git_fetch(dir: String) -> GitInfo {
    let d = Path::new(&dir);
    if dir.trim().is_empty() || !d.is_dir() {
        return GitInfo::default();
    }
    // Only fetch if it's actually a repo with a remote — avoids noisy errors.
    if run_git(d, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return GitInfo::default();
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(d)
        .args(["fetch", "--quiet", "--no-tags"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_window(&mut cmd);
    let _ = cmd.status(); // best-effort — status is still read below either way
    read_status(d)
}

/// Fast-forward pull, streaming output to the Logs bus. Emits `git:done` with
/// `{ ok }` when finished so the UI can refresh the repo's status. `--ff-only`
/// never creates a merge commit: if the branch has diverged, it fails loudly
/// rather than doing something surprising.
#[tauri::command]
pub fn git_pull(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let d = Path::new(&dir);
    if dir.trim().is_empty() || !d.is_dir() {
        return Err("No project directory.".into());
    }
    if run_git(d, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return Err("Not a git repository.".into());
    }
    let dir_owned = dir.clone();
    std::thread::spawn(move || {
        let d = Path::new(&dir_owned);
        services::push_log(
            &app,
            GIT_LOG_ID,
            "git pull",
            "system",
            format!("git pull --ff-only  ({dir_owned})"),
        );

        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(d)
            .args(["pull", "--ff-only"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd);

        let ok = match cmd.spawn() {
            Ok(mut child) => {
                let err = child.stderr.take().map(|e| {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        for line in BufReader::new(e).lines().map_while(Result::ok) {
                            if !line.trim().is_empty() {
                                services::push_log(&app, GIT_LOG_ID, "git pull", "stderr", line);
                            }
                        }
                    })
                });
                if let Some(out) = child.stdout.take() {
                    for line in BufReader::new(out).lines().map_while(Result::ok) {
                        if !line.trim().is_empty() {
                            services::push_log(&app, GIT_LOG_ID, "git pull", "stdout", line);
                        }
                    }
                }
                let ok = child.wait().map(|s| s.success()).unwrap_or(false);
                if let Some(t) = err {
                    let _ = t.join();
                }
                ok
            }
            Err(e) => {
                services::push_log(
                    &app,
                    GIT_LOG_ID,
                    "git pull",
                    "stderr",
                    format!("failed to launch: {e}"),
                );
                false
            }
        };

        services::push_log(
            &app,
            GIT_LOG_ID,
            "git pull",
            "system",
            if ok {
                "pull complete.".into()
            } else {
                "pull failed — see the log (a diverged branch can't fast-forward).".to_string()
            },
        );
        crate::activity::record(
            &app,
            "git",
            if ok { "pulled" } else { "pull failed" },
            String::new(),
            ok,
            None,
        );
        let _ = app.emit("git:done", ok);
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// AI Workspace support: commits as context versions
// ---------------------------------------------------------------------------
//
// The AI Workspace treats a commit as the version of a feature's context. An
// agent records the commit it started from, and "what changed since my
// checkpoint?" is answered by diffing that commit against HEAD. All of it goes
// through `run_git` above so there is one place that knows how to invoke git
// safely.

/// One entry of `git log`, shaped for the Git History screen.
#[derive(Serialize, Clone, Debug, Default)]
pub struct GitCommit {
    pub sha: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub when: String,
    /// Paths touched by this commit, relative to the repo root.
    pub files: Vec<String>,
    /// True when the commit touched anything under `.devdeck` — i.e. it moved
    /// the context, not just the code.
    pub context_updated: bool,
}

/// The commit HEAD points at, full sha. `None` when `dir` is not a repo or has
/// no commits yet — an empty repo is a normal state, not an error.
/// Whether this directory is inside a git repository at all.
///
/// The difference between "nothing changed" and "there is nothing here that
/// could change" — a vault folder with no repository can never answer a
/// question about commits, and answering it with an empty list makes an
/// unanswerable question look like a reassuring one.
/// Whether this repository is shared with anyone: it has a remote.
///
/// The line between a sandbox and a real project. A scripted agent writes
/// fixture files and commits them; in a throwaway repo that is a demo, and
/// in a repository other people pull from it is a mess with someone's name
/// on it. The demo sandbox and every test repository have no remote.
pub fn has_remote(dir: &Path) -> bool {
    run_git(dir, &["remote"])
        .map(|s| s.lines().any(|l| !l.trim().is_empty()))
        .unwrap_or(false)
}

pub fn is_repo(dir: &Path) -> bool {
    run_git(dir, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

pub fn head_commit(dir: &Path) -> Option<String> {
    run_git(dir, &["rev-parse", "HEAD"]).filter(|s| !s.is_empty())
}

pub fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

/// Recent commits, newest first.
pub fn log_entries(dir: &Path, limit: usize) -> Vec<GitCommit> {
    // Unit separator between fields, record separator between commits: commit
    // subjects contain every printable character, so splitting on anything
    // typeable would corrupt the parse.
    let fmt = "--pretty=format:%H\x1f%s\x1f%an\x1f%aI\x1e";
    let n = format!("-{limit}");
    let Some(out) = run_git(dir, &["log", &n, fmt]) else {
        return vec![];
    };
    out.split('\x1e')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .filter_map(|chunk| {
            let mut parts = chunk.split('\x1f');
            let sha = parts.next()?.trim().to_string();
            let subject = parts.next().unwrap_or_default().to_string();
            let author = parts.next().unwrap_or_default().to_string();
            let when = parts.next().unwrap_or_default().to_string();
            let files = files_in_commit(dir, &sha);
            let context_updated = files.iter().any(|f| f.starts_with(".devdeck/"));
            Some(GitCommit {
                short: short_sha(&sha),
                sha,
                subject,
                author,
                when,
                files,
                context_updated,
            })
        })
        .collect()
}

pub fn files_in_commit(dir: &Path, sha: &str) -> Vec<String> {
    run_git(
        dir,
        &[
            "show",
            "--name-only",
            "--pretty=format:",
            "--no-renames",
            sha,
        ],
    )
    .map(|o| {
        o.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    })
    .unwrap_or_default()
}

/// Paths that differ between two commits. This is the primitive the context
/// delta is built on.
pub fn changed_between(dir: &Path, from: &str, to: &str) -> Vec<String> {
    run_git(dir, &["diff", "--name-only", &format!("{from}..{to}")])
        .map(|o| {
            o.lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Uncommitted paths (staged or not), so "changed since checkpoint" still
/// reports work an agent has done but not committed.
pub fn dirty_files(dir: &Path) -> Vec<String> {
    run_git(dir, &["status", "--porcelain"])
        .map(|o| {
            o.lines()
                .filter_map(|l| {
                    // Porcelain v1 is `XY <path>`, two status characters then a
                    // space — but a file that is modified and *not staged* has
                    // a leading space, and `run_git` trims the whole output, so
                    // the first such line arrives one character short. Reading
                    // from a fixed offset then cut the first character off the
                    // path: `a.txt` was reported as `.txt`, which matches
                    // nothing and made uncommitted work invisible to staleness
                    // detection. Skip the status token instead of counting.
                    let rest = l.trim_start();
                    let path = rest[rest.find(' ')?..].trim();
                    // A rename is `old -> new`; the new name is the one that
                    // exists to be read.
                    Some(path.rsplit(" -> ").next().unwrap_or(path).to_string())
                })
                .filter(|p| !p.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// A file's contents at a commit, for comparing context across versions.
pub fn file_at(dir: &Path, sha: &str, rel_path: &str) -> Option<String> {
    run_git(dir, &["show", &format!("{sha}:{rel_path}")])
}

/// Stage everything under `paths` and commit, tagging the commit with who and
/// what it was for. The trailers are how a commit is later attributed back to
/// an agent, feature and session in the Git History screen.
pub fn commit_with_metadata(
    dir: &Path,
    message: &str,
    paths: &[String],
    agent: Option<&str>,
    feature: Option<&str>,
    work_item: Option<&str>,
    session: Option<&str>,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err("nothing to commit".into());
    }
    let mut add: Vec<&str> = vec!["add", "--"];
    for p in paths {
        add.push(p.as_str());
    }
    run_git(dir, &add).ok_or_else(|| "git add failed".to_string())?;

    let mut msg = String::from(message);
    msg.push_str("\n\n");
    if let Some(a) = agent {
        msg.push_str(&format!("DevDeck-Agent: {a}\n"));
    }
    if let Some(f) = feature {
        msg.push_str(&format!("DevDeck-Feature: {f}\n"));
    }
    if let Some(w) = work_item {
        msg.push_str(&format!("DevDeck-Work-Item: {w}\n"));
    }
    if let Some(s) = session {
        msg.push_str(&format!("DevDeck-Session: {s}\n"));
    }

    run_git(dir, &["commit", "-m", &msg])
        .ok_or_else(|| "git commit failed (nothing staged, or hooks refused)".to_string())?;
    head_commit(dir).ok_or_else(|| "commit succeeded but HEAD is unreadable".to_string())
}

/// Trailer values parsed back out of a commit message.
pub fn commit_trailers(dir: &Path, sha: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let Some(body) = run_git(dir, &["log", "-1", "--pretty=format:%B", sha]) else {
        return out;
    };
    for line in body.lines() {
        if let Some((k, v)) = line.split_once(": ") {
            let k = k.trim();
            if let Some(name) = k.strip_prefix("DevDeck-") {
                out.insert(name.to_lowercase(), v.trim().to_string());
            }
        }
    }
    out
}

/// Initialise a repo if there isn't one, so a freshly created fixture project
/// has commits to checkpoint against.
pub fn ensure_repo(dir: &Path) -> Result<(), String> {
    if run_git(dir, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true") {
        return Ok(());
    }
    run_git(dir, &["init"]).ok_or_else(|| "git init failed".to_string())?;
    // Identity is required for a commit and may be absent in CI.
    run_git(dir, &["config", "user.email", "devdeck@local"]);
    run_git(dir, &["config", "user.name", "DevDeck"]);
    Ok(())
}
