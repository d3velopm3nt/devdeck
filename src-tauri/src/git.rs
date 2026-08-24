//! Lightweight, read-only git status for projects. Spawns `git` to read the
//! current branch; never mutates the repo. Kept deliberately small — richer
//! status (ahead/behind, dirty) can grow from here.

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

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

/// Current branch for the repo containing `dir`. Git walks up to the repo
/// root, so a subfolder of a project resolves the same branch. Returns
/// `is_repo = false` when `dir` isn't a repo or git isn't installed.
#[tauri::command]
pub fn git_info(dir: String) -> GitInfo {
    let d = Path::new(&dir);
    if dir.trim().is_empty() || !d.is_dir() {
        return GitInfo::default();
    }
    match run_git(d, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Some(s) if !s.is_empty() => {
            if s == "HEAD" {
                // Detached HEAD — report the short commit instead of a branch.
                let sha = run_git(d, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
                GitInfo { is_repo: true, branch: Some(sha), detached: true }
            } else {
                GitInfo { is_repo: true, branch: Some(s), detached: false }
            }
        }
        _ => GitInfo::default(),
    }
}
