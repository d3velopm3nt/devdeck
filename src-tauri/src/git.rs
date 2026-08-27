//! Read-only-ish git status for projects, plus a fast-forward pull.
//!
//!  * `git_info`   — branch + ahead/behind from *local* refs. No network.
//!  * `git_fetch`  — a quiet, non-interactive `git fetch`, then fresh status.
//!                   This is how monitoring learns there are changes to pull.
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
fn run_git(dir: &Path, args: &[&str]) -> Option<String> {
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
