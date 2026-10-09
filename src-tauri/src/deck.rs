//! The Deck watcher updates only a user-selected, clean Git clone. A dirty or
//! divergent checkout is left alone and reported to the UI for manual repair.
use serde::Serialize;
use std::{
    path::Path,
    process::{Command, Stdio},
};

#[derive(Serialize)]
pub struct DeckPoll {
    pub head: String,
    pub paths: Vec<String>,
    pub status: String,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["-C", root.to_str().ok_or("Invalid repository path")?])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0");
    if args.first() == Some(&"fetch") {
        // Fetch only the branch's selected upstream remote. Authenticate that
        // URL with the same saved account used to clone the state repository.
        if let Some(remote) = args.last().filter(|remote| **remote != ".") {
            let url = git(root, &["remote", "get-url", remote])?;
            crate::github::configure_git_auth(&mut cmd, &url);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let output = cmd
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not run git: {e}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(detail.trim().chars().take(300).collect::<String>());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn poll(path: String) -> Result<DeckPoll, String> {
    let root = Path::new(&path);
    if !root.is_dir() || !root.join(".git").exists() {
        return Err("Choose a local Git clone of your shared state repository.".into());
    }
    let old = git(root, &["rev-parse", "HEAD"])?;
    // Read the upstream before fetching. Never change branch or pick a remote.
    let upstream = git(
        root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .map_err(|_| "This branch has no upstream. Set its tracking branch first.".to_string())?;
    let branch = git(root, &["symbolic-ref", "--short", "HEAD"])?;
    let tracking_remote = git(
        root,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )?;
    git(root, &["fetch", "--quiet", "--", &tracking_remote])?;
    let remote = git(root, &["rev-parse", "@{u}"])?;
    if old == remote {
        return Ok(DeckPoll {
            head: old,
            paths: vec![],
            status: "current".into(),
        });
    }
    if !git(root, &["status", "--porcelain"])?.is_empty() {
        return Ok(DeckPoll {
            head: old,
            paths: vec![],
            status: "local changes need attention".into(),
        });
    }
    if git(root, &["merge-base", "--is-ancestor", "HEAD", "@{u}"]).is_err() {
        return Ok(DeckPoll {
            head: old,
            paths: vec![],
            status: "branches diverged".into(),
        });
    }
    git(root, &["merge", "--ff-only", "@{u}"])?;
    let head = git(root, &["rev-parse", "HEAD"])?;
    let paths = git(root, &["diff", "--name-only", &old, &head])?
        .lines()
        .take(100)
        .map(str::to_owned)
        .collect();
    Ok(DeckPoll {
        head,
        paths,
        status: format!("updated from {upstream}"),
    })
}

#[tauri::command(async)]
pub async fn deck_poll(path: String) -> Result<DeckPoll, String> {
    tauri::async_runtime::spawn_blocking(move || poll(path))
        .await
        .map_err(|e| format!("Update check stopped: {e}"))?
}
