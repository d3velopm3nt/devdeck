//! The app's side of asking, when a worker is blocked.
//!
//! The protocol itself — the question, the answer, the folder they meet in, and
//! the MCP server the CLI talks to — lives in the `devdeck-ask` crate, because
//! it has to keep working while this binary is being replaced. What is left
//! here is the two things that genuinely need the app: **where** the questions
//! go (the personal store), and **which** binary the CLI should spawn.
//!
//! Why the split exists at all is written up in that crate's header. The short
//! version: the asker used to be `devdeck.exe --ask-server`, so a worker
//! waiting at a question held the app's own executable open and `cargo` could
//! not replace it. A second `[[bin]]` in this package would not have helped —
//! measured, not assumed — because a bin is relinked whenever its package's lib
//! changes, running or not.

use std::path::{Path, PathBuf};

// Re-exported so the rest of the app carries on saying `asks::Ask`. Only what
// is used: anything else lives one name away, in `devdeck_ask` itself.
pub use devdeck_ask::{one_line, tool_id, Ask, Standing, SERVER, WAIT};

/// `<personal>/asks/<run>`, made on demand.
///
/// The one thing the asker cannot work out for itself, which is exactly why it
/// is handed over on the command line instead.
pub fn dir_for(run: &str) -> Result<PathBuf, String> {
    let root = crate::aiw::personal::PersonalStore::open()?
        .root()
        .join("asks")
        .join(run);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

/// Every question for this run that nobody has answered.
pub fn unanswered(run: &str) -> Vec<Ask> {
    match dir_for(run) {
        Ok(dir) => devdeck_ask::unanswered(&dir),
        Err(_) => Vec::new(),
    }
}

/// Say yes or no to one question. The worker is waiting on this file.
pub fn answer(run: &str, id: &str, allow: bool, note: &str) -> Result<(), String> {
    devdeck_ask::answer(&dir_for(run)?, id, allow, note)
}

/// The `devdeck-ask` executable, which `cargo` builds beside this one.
///
/// **This is a new way to have no asker, so the error says what to do about
/// it.** Before the split the asker was the app itself and so was always there;
/// now a checkout where `cargo build -p devdeck-ask` has not run has none.
/// `workers.rs` treats that as the old "nobody to ask" case and logs it rather
/// than refusing the run — which, on the failure-honesty rule, is arguably one
/// step too gentle: with no asker the CLI is given `--permission-prompts none`,
/// which denies anything that would prompt, and that is how Mason wrote three
/// correct files on 24 Sep 2026 and ran no check at all. It is kept as a
/// downgrade for now because refusing would stop every run on a fresh
/// checkout; the build is wired so the binary is there in the first place
/// (`npm run ask` in `package.json`, and CI builds the workspace).
pub fn asker() -> Result<PathBuf, String> {
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = me
        .parent()
        .ok_or("DevDeck could not tell which folder it is running from")?;
    let exe = if cfg!(windows) {
        "devdeck-ask.exe"
    } else {
        "devdeck-ask"
    };
    let path = dir.join(exe);
    if path.exists() {
        return Ok(path);
    }
    Err(format!(
        "{} is not beside the app, so nobody could be asked during a run. \
         Build it with `cargo build -p devdeck-ask`.",
        path.display()
    ))
}

/// The MCP config the CLI is pointed at, as a file beside the worktree.
///
/// The folder is written into the arguments rather than worked out by the
/// asker, which is what lets that binary know nothing about the personal store
/// — and therefore nothing about this crate.
/// Put the permission this run carries where the asker will find it.
///
/// Resolved here, before anything starts, because that is the rule the whole
/// module is built on: what a sealed session may touch is settled before it
/// runs and written down. The asker stays a small program that reads a file
/// and has no idea there is an app.
///
/// An empty list or an unreadable date leaves nothing behind, so the run asks
/// for everything exactly as it did before — the safe direction, and the one a
/// worker with no `allow:` in its file should get.
pub fn set_standing(run: &str, worker: &str, at: &Path, allow: &[String], until: &str) -> bool {
    let Ok(dir) = dir_for(run) else { return false };
    let live = allow.iter().any(|c| !c.trim().is_empty()) && !until.trim().is_empty();
    if !live {
        let _ = devdeck_ask::set_standing(&dir, None);
        return false;
    }
    // A day, written as the end of that day, so "until the 6th" includes it.
    let expires_at = format!("{}T23:59:59{}", until.trim(), local_offset());
    devdeck_ask::set_standing(
        &dir,
        Some(&Standing {
            worker: worker.to_string(),
            at: at.to_string_lossy().to_string(),
            commands: allow
                .iter()
                .map(|c| c.trim().to_string())
                .filter(|c| !c.is_empty())
                .collect(),
            expires_at,
        }),
    )
    .is_ok()
}

/// This machine's UTC offset, as RFC3339 wants it.
fn local_offset() -> String {
    chrono::Local::now().format("%:z").to_string()
}

pub fn write_config(at: &Path, run: &str) -> Result<PathBuf, String> {
    let bin = asker()?;
    let dir = dir_for(run)?;
    let cfg = serde_json::json!({
        "mcpServers": {
            SERVER: {
                "command": bin.to_string_lossy(),
                "args": ["--run", run, "--dir", dir.to_string_lossy()],
            }
        }
    });
    let path = at.join(".claude").join("devdeck-ask.json");
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Serve, for a config written by an older build.
///
/// A run started before this split has `devdeck.exe --ask-server <run>` in its
/// config file, and killing that worker's ability to ask because we tidied up
/// would be a poor trade for five lines. `lib.rs` still honours the flag; this
/// is what it calls.
pub fn serve(run: &str) {
    match dir_for(run) {
        Ok(dir) => devdeck_ask::serve(&dir, run),
        Err(why) => eprintln!("[asks] there is nowhere to write questions for {run}: {why}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The config names the asker and tells it where to write — never this
    /// binary, which is the whole point of the split.
    #[test]
    fn the_config_points_at_the_asker_and_not_at_the_app() {
        // Only the shape is asserted, because whether the binary is built is a
        // property of the checkout, not of this function.
        let Ok(bin) = asker() else {
            return; // `cargo build -p devdeck-ask` has not run; nothing to check.
        };
        let name = bin.file_name().unwrap_or_default().to_string_lossy();
        assert!(
            name.starts_with("devdeck-ask"),
            "the asker should be its own binary, got {name}"
        );
        assert!(
            !name.starts_with("devdeck."),
            "the app must not be its own asker any more: {name}"
        );
    }

    /// The written config is what the asker's own argument parser reads: a
    /// `--run` and a `--dir`. These two are a pair across a process boundary,
    /// and that is the shape of fault this codebase keeps finding — one side
    /// writes, the other reads elsewhere, and nothing complains.
    #[test]
    fn the_config_carries_the_run_and_the_folder() {
        if asker().is_err() {
            return; // `cargo build -p devdeck-ask` has not run.
        }
        let at = std::env::temp_dir().join(format!("devdeck-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&at).expect("a temp worktree");
        let run = format!("cfgtest-{}", std::process::id());

        let path = write_config(&at, &run).expect("the config is written");
        let raw = std::fs::read_to_string(&path).expect("the config is readable");
        let cfg: serde_json::Value = serde_json::from_str(&raw).expect("the config is JSON");

        let server = &cfg["mcpServers"][SERVER];
        let cmd = server["command"].as_str().unwrap_or_default();
        assert!(
            cmd.contains("devdeck-ask"),
            "the CLI is pointed at the wrong thing: {cmd}"
        );

        let args: Vec<String> = server["args"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|v| v.as_str().unwrap_or_default().to_string())
                    .collect()
            })
            .unwrap_or_default();
        let after = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .and_then(|i| args.get(i + 1))
                .cloned()
                .unwrap_or_default()
        };
        assert_eq!(after("--run"), run, "the run is not named: {args:?}");
        let dir = after("--dir");
        assert!(!dir.is_empty(), "no folder was given: {args:?}");
        assert!(
            std::path::Path::new(&dir).is_dir(),
            "the folder does not exist, so the first question would go nowhere: {dir}"
        );

        let _ = std::fs::remove_dir_all(&at);
        let _ = dir_for(&run).map(std::fs::remove_dir_all);
    }
}
