//! Running somebody else's coding agent.
//!
//! ```text
//! brief → spawn the CLI in the repo → stream what it says → read its verdict
//! ```
//!
//! This is the other half of the seam `provider.rs` describes. A provider
//! *proposes* and DevDeck disposes; a CLI agent **executes**, and hands back a
//! report of what it already did. That asymmetry is why this is not an
//! `LLMProvider` and never can be: there is no turn to intercept, no tool call
//! to permit or refuse. The gate moved to the session boundary, and the caller
//! is the one that holds it.
//!
//! What DevDeck keeps is everything around the run — the plan, the claim, the
//! checkpoint, the context that produced the brief, and the record of what came
//! back. What it gives up is per-call approval inside the run. That trade is
//! the whole point of delegating.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

/// Runner ids. These live in an agent's `provider` field the same way a model
/// provider does, because "what answers for this agent" and "what works for
/// this agent" are the same question asked of a different kind of engine.
pub const CLAUDE_CODE: &str = "claude-code";

/// Does this id name an external CLI rather than a model provider?
///
/// Asked before the provider registry is consulted, because a CLI runner is
/// deliberately *not* registered there — `ProviderRegistry::get` hands back an
/// `LLMProvider`, and this is not one.
pub fn is_cli_runner(id: &str) -> bool {
    id == CLAUDE_CODE
}

/// The runners, as the Providers list sees them: id, label, health.
///
/// Health here is one question — *would a spawn find the program?* — asked the
/// same way the spawn asks it, so Settings cannot say "ready" beside a run
/// that is about to fail with "program not found". An unconfigured runner
/// comes back `configured: false`, which is what greys it out in the agent
/// dropdown and prints "not set up" beside it.
pub fn runners() -> Vec<(String, String, super::provider::ProviderHealth)> {
    vec![(
        CLAUDE_CODE.to_string(),
        "Claude Code (CLI)".to_string(),
        health(CLAUDE_CODE),
    )]
}

pub fn health(runner: &str) -> super::provider::ProviderHealth {
    let program = default_program(runner);
    let present = crate::mcp::program_present(program);
    super::provider::ProviderHealth {
        ok: present,
        configured: present,
        detail: if present {
            format!("`{program}` is on PATH — sessions run in the repository, under its own permissions")
        } else {
            format!("`{program}` is not on PATH. Install the CLI, or put it somewhere this machine can find it.")
        },
    }
}

fn default_program(runner: &str) -> &'static str {
    match runner {
        CLAUDE_CODE => "claude",
        _ => "",
    }
}

/// What `--model` accepts.
///
/// Marked as a fallback rather than a live list, because it is: the CLI has no
/// "list models" call, so these are the aliases its help documents and nothing
/// asked it just now. Saying otherwise would be exactly the stale-list-shown-
/// as-fresh problem the model picker exists to avoid. No prices either — a
/// delegated run bills through whatever account the CLI is signed in to, which
/// is not a figure DevDeck is in any position to state.
pub fn model_catalog(runner: &str) -> super::provider::ModelCatalog {
    if !is_cli_runner(runner) {
        return super::provider::ModelCatalog::fallback(
            Vec::new(),
            format!("'{runner}' is not a CLI runner"),
        );
    }
    let models = ["opus", "sonnet", "haiku", "fable"]
        .iter()
        .map(|id| super::provider::ModelInfo {
            id: (*id).to_string(),
            name: format!("{}{}", id[..1].to_uppercase(), &id[1..]),
            ..Default::default()
        })
        .collect();
    super::provider::ModelCatalog::fallback(
        models,
        "the CLI publishes no model list — these are the aliases it accepts, and a full id works too",
    )
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// How to run one CLI agent.
#[derive(Clone, Debug)]
pub struct RunnerSpec {
    /// The program to spawn. Empty means the runner's default name, looked up
    /// on PATH the same way an MCP server's command is.
    pub program: String,
    /// Passed through to `--model`. Empty leaves the CLI on its own default,
    /// which is the honest thing to do when nobody has chosen.
    pub model: String,
    /// `--permission-mode`. Empty means [`DEFAULT_PERMISSION_MODE`].
    pub permission_mode: String,
    /// Nobody is watching. Kept on the spec though no flag carries it today:
    /// `-p` is already non-interactive, and the next runner added may need to
    /// be told. Read by the callers that decide whether to start at all.
    #[allow(dead_code)]
    pub unattended: bool,
}

/// What a delegated session may do without being asked.
///
/// `acceptEdits` and not `bypassPermissions`: a session started to write code
/// that had to ask before every edit would spend its run asking, and a session
/// allowed to do anything at all is not something to point at a repository on
/// a schedule. Editing files is the job; running arbitrary commands is not,
/// and stays behind the CLI's own gate.
pub const DEFAULT_PERMISSION_MODE: &str = "acceptEdits";

impl RunnerSpec {
    fn program_name(&self) -> &str {
        match self.program.trim() {
            "" => "claude",
            p => p,
        }
    }

    /// The argv, minus the program.
    ///
    /// The prompt goes in `argv` rather than on stdin: `claude -p` reads stdin
    /// as *material for* the prompt, not as the prompt, so a briefing piped in
    /// produces a run with no instruction at all.
    fn args(&self, prompt: &str) -> Vec<String> {
        let mut a: Vec<String> = vec![
            "-p".into(),
            prompt.into(),
            "--output-format".into(),
            "stream-json".into(),
            // stream-json says nothing without it.
            "--verbose".into(),
            "--permission-mode".into(),
            match self.permission_mode.trim() {
                "" => DEFAULT_PERMISSION_MODE.into(),
                m => m.to_string(),
            },
        ];
        if !self.model.trim().is_empty() {
            a.push("--model".into());
            a.push(self.model.trim().into());
        }
        // `unattended` used to add `--permission-prompts none`. That option
        // does not exist in the CLI (2.1.x rejects it outright and exits 1),
        // and it was not needed: `-p` is already non-interactive, so a call
        // the permission mode does not cover is refused rather than asked
        // about. The flag stays on the spec because the question it answers —
        // "what happens at three in the morning" — is still the right one to
        // ask of any runner added later.
        a
    }
}

/// Something the run said, on its way past.
#[derive(Clone, Debug)]
pub struct RunEvent {
    /// `message` · `tool` · `stderr` — the kinds a transcript shows.
    pub kind: &'static str,
    pub text: String,
}

/// What the run reported when it finished.
#[derive(Clone, Debug, Default)]
pub struct RunOutcome {
    pub ok: bool,
    pub summary: String,
    pub turns: u32,
    /// Tool calls the CLI's own permission layer refused. Read from the run's
    /// verdict rather than counted here, because we never saw the calls.
    pub refused: usize,
    /// The CLI's session id, which is what `--resume` takes. Kept so a session
    /// can be picked up again; it is not DevDeck's session id.
    pub runner_session_id: String,
    pub cost_usd: f64,
}

/// One line of the stream, reduced to the little we care about.
enum Line {
    Event(RunEvent),
    /// The run's own verdict. Authoritative — see [`run`].
    Verdict(Box<RunOutcome>),
    /// Everything else. The stream carries a great deal that is none of our
    /// business (the whole slash-command catalogue arrives as one ~10KB line),
    /// and an unknown type is normal rather than an error.
    Ignored,
}

fn parse_line(line: &str) -> Line {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return Line::Ignored;
    };
    match v.get("type").and_then(|t| t.as_str()).unwrap_or_default() {
        "assistant" => {
            let blocks = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array());
            let Some(blocks) = blocks else {
                return Line::Ignored;
            };
            let mut text = String::new();
            let mut tool = String::new();
            for b in blocks {
                match b.get("type").and_then(|t| t.as_str()).unwrap_or_default() {
                    "text" => {
                        if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                    "tool_use" => {
                        if let Some(n) = b.get("name").and_then(|n| n.as_str()) {
                            tool = n.to_string();
                        }
                    }
                    _ => {}
                }
            }
            if !tool.is_empty() {
                return Line::Event(RunEvent {
                    kind: "tool",
                    text: tool,
                });
            }
            let text = text.trim().to_string();
            if text.is_empty() {
                Line::Ignored
            } else {
                Line::Event(RunEvent {
                    kind: "message",
                    text,
                })
            }
        }
        "result" => {
            let denials = v
                .get("permission_denials")
                .and_then(|d| d.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            // `is_error` and `subtype` are the two the CLI sets deliberately;
            // a missing `is_error` is not the same as a successful run, so an
            // absent flag counts as failure rather than as silence.
            let errored = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(true);
            let subtype = v
                .get("subtype")
                .and_then(|s| s.as_str())
                .unwrap_or_default();
            Line::Verdict(Box::new(RunOutcome {
                ok: !errored && subtype == "success",
                summary: v
                    .get("result")
                    .and_then(|r| r.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                turns: v.get("num_turns").and_then(|t| t.as_u64()).unwrap_or(0) as u32,
                refused: denials,
                runner_session_id: v
                    .get("session_id")
                    .and_then(|s| s.as_str())
                    .unwrap_or_default()
                    .to_string(),
                cost_usd: v
                    .get("total_cost_usd")
                    .and_then(|c| c.as_f64())
                    .unwrap_or(0.0),
            }))
        }
        _ => Line::Ignored,
    }
}

/// Run one CLI agent to completion in `cwd`, reporting as it goes.
///
/// **The run's own verdict is the truth, not the exit code.** A CLI that
/// finished its work and a CLI that died before starting can both exit zero on
/// some paths, and a run that reported failure honestly should not be recorded
/// as a success because the process cleaned up tidily. So a missing verdict is
/// a failure even on a zero exit, and it says so with whatever the program
/// wrote to stderr rather than inventing a reason.
pub fn run(
    spec: &RunnerSpec,
    cwd: &std::path::Path,
    prompt: &str,
    on_event: &mut dyn FnMut(RunEvent),
) -> Result<RunOutcome, String> {
    run_watched(spec, cwd, prompt, on_event, &Leash::forever())
}

/// A hand on the run: stop it now, or at a time.
///
/// A delegated session is the one place DevDeck cannot interrupt call by call,
/// so the two things it can still do — stop it, and not let it run all night —
/// are the same thing at different distances.
pub struct Leash {
    stop: std::sync::atomic::AtomicBool,
    until: Option<std::time::Instant>,
}

impl Leash {
    pub fn forever() -> Self {
        Self {
            stop: std::sync::atomic::AtomicBool::new(false),
            until: None,
        }
    }

    /// Stops itself after `minutes`. Zero means no limit.
    pub fn for_minutes(minutes: u64) -> Self {
        Self {
            stop: std::sync::atomic::AtomicBool::new(false),
            until: (minutes > 0)
                .then(|| std::time::Instant::now() + std::time::Duration::from_secs(minutes * 60)),
        }
    }

    /// Ask it to stop. The run ends after the CLI notices, which is quick.
    pub fn pull(&self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn pulled(&self) -> bool {
        self.stop.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn out_of_time(&self) -> bool {
        self.until.is_some_and(|t| std::time::Instant::now() >= t)
    }

    fn done(&self) -> bool {
        self.pulled() || self.out_of_time()
    }
}

/// The same run, with a leash on it.
pub fn run_watched(
    spec: &RunnerSpec,
    cwd: &std::path::Path,
    prompt: &str,
    on_event: &mut dyn FnMut(RunEvent),
    leash: &Leash,
) -> Result<RunOutcome, String> {
    let name = spec.program_name();
    let program = crate::mcp::resolve_program(name);
    let mut cmd = Command::new(&program);
    cmd.args(spec.args(prompt))
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "could not start '{name}' in {}: {e}. Install the CLI, or point this agent at a runner that is on PATH.",
            cwd.display()
        )
    })?;

    // Taken before the child is shared, so the reader below still owns them.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = std::sync::Arc::new(std::sync::Mutex::new(child));
    let stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Drained on its own thread rather than read after the wait: a full stderr
    // pipe blocks the child, and a child blocked writing its complaint never
    // reaches the exit we are waiting for.
    let errors = stderr.map(|e| {
        std::thread::spawn(move || {
            BufReader::new(e)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        })
    });

    // The leash, watched on its own thread: the reader below is blocked on the
    // CLI's stdout, and a run nobody can stop is exactly what a limit is for.
    std::thread::scope(|scope| {
        let watcher = {
            let child = child.clone();
            let stopped = stopped.clone();
            scope.spawn(move || {
                while !leash.done() {
                    if let Ok(mut c) = child.lock() {
                        // Finished on its own: nothing to stop.
                        if matches!(c.try_wait(), Ok(Some(_))) {
                            return;
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                stopped.store(true, std::sync::atomic::Ordering::SeqCst);
                if let Ok(mut c) = child.lock() {
                    let _ = c.kill();
                }
            })
        };

        let mut verdict: Option<RunOutcome> = None;
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                match parse_line(&line) {
                    Line::Event(e) => on_event(e),
                    Line::Verdict(v) => verdict = Some(*v),
                    Line::Ignored => {}
                }
            }
        }

        let status = {
            let mut c = child
                .lock()
                .map_err(|_| "the run's own record was lost".to_string())?;
            c.wait()
                .map_err(|e| format!("'{name}' never finished: {e}"))?
        };
        // The watcher returns on its own once the child is gone.
        let _ = watcher.join();
        let cut_short = stopped.load(std::sync::atomic::Ordering::SeqCst);
        let stderr = errors
            .and_then(|h| h.join().ok())
            .unwrap_or_default()
            .trim()
            .to_string();

        // Reported even when the run succeeded. A CLI that warned on its way to a
        // good result still warned, and swallowing that because the verdict was
        // green is how a problem stays invisible until it is not one any more.
        if !stderr.is_empty() {
            on_event(RunEvent {
                kind: "stderr",
                text: stderr.clone(),
            });
        }

        // Stopped on purpose is not a crash, and it is not a success either: the
        // work that was done stands, and the verdict says it was cut short.
        match verdict {
            Some(mut v) => {
                if cut_short {
                    v.ok = false;
                    v.summary = if v.summary.trim().is_empty() {
                        "Stopped before it finished.".to_string()
                    } else {
                        format!("{} (stopped before it finished)", v.summary.trim())
                    };
                }
                Ok(v)
            }
            None if cut_short => Ok(RunOutcome {
                ok: false,
                summary: "Stopped before it reported anything.".into(),
                ..Default::default()
            }),
            None => Err(if stderr.is_empty() {
                format!("'{name}' exited {status} without reporting a result")
            } else {
                format!("'{name}' exited {status} without reporting a result: {stderr}")
            }),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nothing is passed that the CLI does not have.
    ///
    /// This test used to require `--permission-prompts none` on an unattended
    /// run. The CLI has no such option: it exits 1 with "unknown option", so
    /// every unattended run died before it started while the code looked
    /// careful. `-p` is already non-interactive — a call the permission mode
    /// does not cover is refused, not asked about — so the answer to "what
    /// happens at three in the morning" is the mode, not a flag.
    #[test]
    fn nothing_is_passed_that_the_cli_does_not_have() {
        for unattended in [true, false] {
            let spec = RunnerSpec {
                program: String::new(),
                model: String::new(),
                permission_mode: String::new(),
                unattended,
            };
            let args = spec.args("do the thing");
            assert!(
                !args.iter().any(|a| a == "--permission-prompts"),
                "the CLI rejects that option outright"
            );
            assert!(
                args.iter().any(|a| a == "-p"),
                "print mode is what makes it non-interactive"
            );
            let at = args.iter().position(|a| a == "--permission-mode").unwrap();
            assert_eq!(args[at + 1], DEFAULT_PERMISSION_MODE);
        }
    }

    #[test]
    fn the_prompt_travels_in_argv() {
        let spec = RunnerSpec {
            program: String::new(),
            model: "opus".into(),
            permission_mode: String::new(),
            unattended: false,
        };
        let args = spec.args("fix the login bug");
        let p = args.iter().position(|a| a == "-p").unwrap();
        assert_eq!(args[p + 1], "fix the login bug");
        assert!(args.contains(&"--verbose".into()));
        let m = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(args[m + 1], "opus");
    }

    #[test]
    fn never_bypasses_permissions_by_default() {
        let spec = RunnerSpec {
            program: String::new(),
            model: String::new(),
            permission_mode: String::new(),
            unattended: true,
        };
        let args = spec.args("x");
        let at = args.iter().position(|a| a == "--permission-mode").unwrap();
        assert_eq!(args[at + 1], DEFAULT_PERMISSION_MODE);
        assert!(!args
            .iter()
            .any(|a| a.contains("bypass") || a.contains("dangerously")));
    }

    /// The real shape, captured from `claude --output-format stream-json`.
    #[test]
    fn reads_the_runs_verdict() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"Fixed the off-by-one in paginate().","session_id":"8cfec34f-145e","total_cost_usd":0.039,"permission_denials":[{"tool":"Bash"}]}"#;
        let Line::Verdict(v) = parse_line(line) else {
            panic!("a result line is a verdict");
        };
        assert!(v.ok);
        assert_eq!(v.turns, 3);
        assert_eq!(v.refused, 1);
        assert_eq!(v.runner_session_id, "8cfec34f-145e");
        assert_eq!(v.summary, "Fixed the off-by-one in paginate().");
    }

    #[test]
    fn a_failed_run_is_not_read_as_a_quiet_success() {
        let line = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":1,"result":"","session_id":"x"}"#;
        let Line::Verdict(v) = parse_line(line) else {
            panic!("still a verdict");
        };
        assert!(!v.ok);
    }

    /// An absent flag must not read as a good run — same rule as the update
    /// checker: a thing we could not confirm is not a thing that succeeded.
    #[test]
    fn a_verdict_missing_its_flag_is_a_failure() {
        let Line::Verdict(v) = parse_line(r#"{"type":"result","subtype":"success"}"#) else {
            panic!("still a verdict");
        };
        assert!(!v.ok);
    }

    #[test]
    fn assistant_text_and_tools_become_transcript_lines() {
        let msg = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at the router."}]}}"#;
        let Line::Event(e) = parse_line(msg) else {
            panic!("expected an event");
        };
        assert_eq!(e.kind, "message");
        assert_eq!(e.text, "Looking at the router.");

        let tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{}}]}}"#;
        let Line::Event(e) = parse_line(tool) else {
            panic!("expected an event");
        };
        assert_eq!(e.kind, "tool");
        assert_eq!(e.text, "Edit");
    }

    /// The stream carries a lot that is none of our business — the whole slash
    /// command catalogue arrives as one enormous line. Unknown is normal.
    #[test]
    fn the_noise_in_the_stream_is_ignored_not_failed_on() {
        for line in [
            r#"{"type":"system","subtype":"commands_changed","commands":[]}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{}}"#,
            r#"{"type":"autocompact_state","value":{}}"#,
            r#"{"type":"active_goal","value":null}"#,
            "not json at all",
            "",
        ] {
            assert!(matches!(parse_line(line), Line::Ignored), "{line}");
        }
    }
}
