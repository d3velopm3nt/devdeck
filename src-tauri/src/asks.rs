//! Asking, when a worker is blocked.
//!
//! A sealed worker reaches for a shell and the CLI stops to ask whether it
//! may. Until now nobody could be asked: the spawn passed
//! `--permission-prompts none`, which denies anything that would prompt, so a
//! worker with `writes: branch` got a `Bash` it could see on its wall and
//! never use. Mason wrote three correct files on 24 Sep 2026 and ran no check
//! at all, because every call was refused before anyone heard about it.
//!
//! **The question goes to the room.** The CLI can route a permission request
//! to a tool of ours — that is what `--permission-prompt-tool` is for — so
//! DevDeck answers it, which means the person answers it, in the feature's
//! own thread rather than in a dialog that has to be in front of you.
//!
//! **The contract here was measured, not remembered**, against CLI 2.1.278 on
//! 24 Sep 2026, because the last time these flags were assumed a worker was
//! given a shell it could never use. The request arrives as an ordinary MCP
//! `tools/call`:
//!
//! ```json
//! { "name": "approve",
//!   "arguments": { "tool_name": "Bash",
//!                  "input": { "command": "…", "description": "…" },
//!                  "tool_use_id": "toolu_…" } }
//! ```
//!
//! and the answer is an ordinary tool result whose text is itself JSON —
//! `{"behavior":"allow","updatedInput":{…}}` or
//! `{"behavior":"deny","message":"…"}`. Both were run end to end: the denial
//! came back as the tool's error, and the allow let the command through.
//!
//! **Two processes, one folder.** The CLI spawns this binary again in server
//! mode, so the asking half is not inside the app and cannot share memory
//! with it. They talk the way everything else in DevDeck does — files. The
//! question is written down, the app notices it and posts it, and the answer
//! is written back. Nothing needs a port, a socket, or the app to still be
//! the same process it was when the run started.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

/// How long the worker waits at the question before giving up on an answer.
///
/// Short enough that somebody at the keyboard just answers and the run
/// carries on with no restart; long enough not to be a race. Past it the run
/// ends `blocked` with the question still in the room, because holding a
/// worktree, a leash and a bill open all night waiting for a person who is
/// asleep is the expensive way to be patient.
pub const WAIT: std::time::Duration = std::time::Duration::from_secs(90);

/// The name the CLI is told to call. `mcp__<server>__<tool>`, where the
/// server name is whatever the config file calls it.
pub const SERVER: &str = "devdeck";
pub const TOOL: &str = "approve";

pub fn tool_id() -> String {
    format!("mcp__{SERVER}__{TOOL}")
}

/// One question, as written down for the app to find.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Ask {
    /// The CLI's own id for the call being decided. One question, one file.
    pub id: String,
    pub run: String,
    /// `Bash`, `Write`, whatever it reached for.
    pub tool: String,
    /// What it wanted to do, verbatim. Shown to the person, never edited:
    /// approving something other than what was asked is how an approval
    /// dialog becomes theatre.
    pub input: serde_json::Value,
    pub at: String,
}

/// What a person said back.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Answer {
    pub allow: bool,
    /// Why not, in your words. It is handed to the worker as the refusal's
    /// reason, so it can say something true about why it stopped.
    #[serde(default)]
    pub note: String,
    pub at: String,
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

/// `<personal>/asks/<run>`, made on demand.
pub fn dir_for(run: &str) -> Result<PathBuf, String> {
    let root = crate::aiw::personal::PersonalStore::open()?
        .root()
        .join("asks")
        .join(run);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn ask_file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.ask.json"))
}

fn answer_file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.answer.json"))
}

/// Every question for this run that nobody has answered.
pub fn unanswered(run: &str) -> Vec<Ask> {
    let Ok(dir) = dir_for(run) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if !p.to_string_lossy().ends_with(".ask.json") {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&p) else {
            continue;
        };
        let Ok(ask) = serde_json::from_str::<Ask>(&raw) else {
            continue;
        };
        if !answer_file(&dir, &ask.id).exists() {
            out.push(ask);
        }
    }
    out.sort_by(|a, b| a.at.cmp(&b.at));
    out
}

/// Say yes or no to one question. The worker is waiting on this file.
pub fn answer(run: &str, id: &str, allow: bool, note: &str) -> Result<(), String> {
    let dir = dir_for(run)?;
    if !ask_file(&dir, id).exists() {
        return Err("there is no question by that id".into());
    }
    let a = Answer {
        allow,
        note: note.trim().to_string(),
        at: now(),
    };
    std::fs::write(
        answer_file(&dir, id),
        serde_json::to_string_pretty(&a).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Ask, and wait. Returns what the CLI should be told.
///
/// Split from the transport so a test can run the whole wait without
/// speaking JSON-RPC at it.
pub fn ask_and_wait(run: &str, ask: &Ask, wait: std::time::Duration) -> serde_json::Value {
    let Ok(dir) = dir_for(run) else {
        // No personal store means no way to ask anyone, and proceeding
        // unasked is the one thing this must never do.
        return deny("DevDeck could not write the question down, so nobody was asked.");
    };
    let path = ask_file(&dir, &ask.id);
    if std::fs::write(&path, serde_json::to_string_pretty(ask).unwrap_or_default()).is_err() {
        return deny("DevDeck could not write the question down, so nobody was asked.");
    }

    let until = std::time::Instant::now() + wait;
    let reply = answer_file(&dir, &ask.id);
    while std::time::Instant::now() < until {
        if let Ok(raw) = std::fs::read_to_string(&reply) {
            if let Ok(a) = serde_json::from_str::<Answer>(&raw) {
                return if a.allow {
                    allow(&ask.input)
                } else if a.note.is_empty() {
                    deny("You said no.")
                } else {
                    deny(&format!("You said no: {}", a.note))
                };
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    deny(&format!(
        "Nobody answered in {} seconds. The question is still in the room \u{2014} answering it there lets this be picked up again. Stop now and say what you could not check.",
        wait.as_secs()
    ))
}

pub fn allow(input: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "behavior": "allow", "updatedInput": input })
}

pub fn deny(why: &str) -> serde_json::Value {
    serde_json::json!({ "behavior": "deny", "message": why })
}

/// What it wants to do, in one line a person can judge.
///
/// A command is the command; anything else is its most telling field. Never
/// a summary of our own: approving a paraphrase is how an approval becomes
/// theatre, so what is shown is what was asked.
pub fn one_line(ask: &Ask) -> String {
    for key in ["command", "file_path", "path", "url", "pattern", "prompt"] {
        if let Some(v) = ask.input.get(key).and_then(|v| v.as_str()) {
            if !v.trim().is_empty() {
                return v.trim().to_string();
            }
        }
    }
    let raw = ask.input.to_string();
    if raw.len() > 300 {
        format!("{}…", &raw[..300])
    } else {
        raw
    }
}

/// The MCP config the CLI is pointed at, as a file beside the worktree.
///
/// Its `command` is this very binary: the app asks itself. That is why there
/// is no helper to install and nothing to keep in step with a release.
pub fn write_config(at: &Path, run: &str) -> Result<PathBuf, String> {
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let cfg = serde_json::json!({
        "mcpServers": {
            SERVER: {
                "command": me.to_string_lossy(),
                "args": ["--ask-server", run],
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

// ---------------------------------------------------------------------------
// The server half: this binary, spawned again by the CLI
// ---------------------------------------------------------------------------

/// Speak MCP on stdin/stdout until the CLI closes the pipe.
///
/// Deliberately tiny and dependency-free. It answers exactly three methods,
/// because those are the three the CLI sends — measured, and logged in this
/// module's header.
pub fn serve(run: &str) {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

        let result = match method {
            "initialize" => Some(serde_json::json!({
                // Echo their version back: they pick, we follow.
                "protocolVersion": msg.pointer("/params/protocolVersion")
                    .and_then(|v| v.as_str()).unwrap_or("2025-11-25"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER, "version": env!("CARGO_PKG_VERSION") },
            })),
            "tools/list" => Some(serde_json::json!({ "tools": [ {
                "name": TOOL,
                "description": "Decide whether a tool call a worker wants to make may proceed.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool_name": { "type": "string" },
                        "input": { "type": "object" },
                        "tool_use_id": { "type": "string" },
                    },
                    "required": ["tool_name", "input"],
                },
            } ] })),
            "tools/call" => {
                let args = msg
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_default();
                let ask = Ask {
                    id: args
                        .get("tool_use_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    run: run.to_string(),
                    tool: args
                        .get("tool_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("something")
                        .to_string(),
                    input: args.get("input").cloned().unwrap_or_default(),
                    at: now(),
                };
                let verdict = ask_and_wait(run, &ask, WAIT);
                Some(serde_json::json!({
                    "content": [ { "type": "text", "text": verdict.to_string() } ]
                }))
            }
            // A notification has no id and wants no reply.
            _ if id.is_none() => None,
            _ => Some(serde_json::json!({})),
        };

        if let (Some(id), Some(result)) = (id, result) {
            let reply = serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result });
            if writeln!(out, "{reply}").is_err() || out.flush().is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What is shown is what was asked, never a paraphrase.
    #[test]
    fn a_question_shows_the_command_itself() {
        let ask = Ask {
            id: "x".into(),
            run: "r".into(),
            tool: "Bash".into(),
            input: serde_json::json!({ "command": "cargo test --lib", "description": "Run the tests" }),
            at: now(),
        };
        assert_eq!(one_line(&ask), "cargo test --lib");
    }

    /// The shapes the CLI actually accepts, pinned so a refactor cannot
    /// quietly change them. Both were run against 2.1.278: the denial came
    /// back as the tool's error, the allow let the command through.
    #[test]
    fn the_verdicts_are_the_shapes_the_cli_understands() {
        let a = allow(&serde_json::json!({ "command": "npx tsc -b" }));
        assert_eq!(a["behavior"], "allow");
        assert_eq!(a["updatedInput"]["command"], "npx tsc -b");

        let d = deny("You said no.");
        assert_eq!(d["behavior"], "deny");
        assert_eq!(d["message"], "You said no.");
    }

    /// Nobody there is a denial with a reason, never a silent yes. A worker
    /// that proceeded because the person was asleep is the failure this whole
    /// module exists to avoid.
    #[test]
    fn nobody_answering_is_a_no_that_says_why() {
        let run = format!("test-unanswered-{}", std::process::id());
        let ask = Ask {
            id: "toolu_nobody".into(),
            run: run.clone(),
            tool: "Bash".into(),
            input: serde_json::json!({ "command": "cargo test" }),
            at: now(),
        };
        let v = ask_and_wait(&run, &ask, std::time::Duration::from_millis(250));
        assert_eq!(v["behavior"], "deny");
        let msg = v["message"].as_str().unwrap_or_default();
        assert!(msg.contains("Nobody answered"), "said: {msg}");
        assert!(msg.contains("still in the room"), "said: {msg}");
        if let Ok(d) = dir_for(&run) {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    /// The whole round trip on the files: the question is written where the
    /// app can find it, an answer is taken, and the worker is told yes.
    #[test]
    fn a_question_is_written_down_and_an_answer_is_taken() {
        let run = format!("test-answered-{}", std::process::id());
        let ask = Ask {
            id: "toolu_yes".into(),
            run: run.clone(),
            tool: "Bash".into(),
            input: serde_json::json!({ "command": "npx tsc -b" }),
            at: now(),
        };

        let r = run.clone();
        let waiter =
            std::thread::spawn(move || ask_and_wait(&r, &ask, std::time::Duration::from_secs(5)));

        // The app's side: wait for it to show up, then say yes.
        // Patient on purpose: this runs alongside six hundred other tests, and
        // four seconds of waiting was enough on an idle machine and not enough
        // on a busy one. A test that fails under load teaches you to ignore it.
        let mut seen = Vec::new();
        for _ in 0..200 {
            seen = unanswered(&run);
            if !seen.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert_eq!(seen.len(), 1, "the question was not written down");
        assert_eq!(seen[0].tool, "Bash");
        assert_eq!(seen[0].input["command"], "npx tsc -b");
        answer(&run, "toolu_yes", true, "").unwrap();

        let v = waiter.join().unwrap();
        assert_eq!(v["behavior"], "allow");
        assert_eq!(v["updatedInput"]["command"], "npx tsc -b");
        assert!(
            unanswered(&run).is_empty(),
            "an answered question is not still waiting"
        );
        if let Ok(d) = dir_for(&run) {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
