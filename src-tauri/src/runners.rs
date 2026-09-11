//! Runners: the things that serve an open model on this machine.
//!
//! The pairing again. Machine installs software for *you*; Community installs
//! for your bots — and a model is no use to a bot without something running
//! it. So this detects the runners that are already here and asks them what
//! they hold, rather than offering a catalogue of models nothing could serve.
//!
//! **Nothing is downloaded from here.** A model is gigabytes, and pulling one
//! is a decision with a disk-space and a bandwidth cost that belongs to the
//! person, in the runner's own words. This page says what is installed, what
//! is running, and what to type — the same honesty the rest of the module
//! keeps: it reports, it does not quietly acquire.

use std::process::{Command, Stdio};

use serde::Serialize;

/// A runner we know how to ask about.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Runner {
    pub id: String,
    pub name: String,
    /// What to run to get it, when it is not here. Machine installs these.
    pub install_hint: String,
    /// Present on PATH.
    pub installed: bool,
    /// Answered when asked. A runner can be installed and not running, which
    /// is a different problem with a different fix.
    pub responding: bool,
    pub version: String,
    pub models: Vec<Model>,
    /// Why we could not ask, when we could not.
    pub note: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Model {
    pub name: String,
    /// As the runner reports it — "4.7 GB". Not parsed into bytes, because the
    /// only thing done with it is showing it, and a parse is a chance to be
    /// wrong about somebody's disk.
    pub size: String,
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

pub fn on_path(binary: &str) -> bool {
    let probe = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = Command::new(probe);
    cmd.arg(binary)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn run(binary: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(binary);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("could not run {binary}: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("{binary} {} failed", args.join(" "))
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Read `ollama list`.
///
/// Tabular output with a header, which is a contract nobody promised — so a
/// line that does not look like a row is skipped rather than turned into a
/// model with a blank name.
pub fn parse_ollama_list(out: &str) -> Vec<Model> {
    out.lines()
        .skip_while(|l| l.trim_start().starts_with("NAME"))
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let name = cols.next()?;
            if name.is_empty() || name.eq_ignore_ascii_case("NAME") {
                return None;
            }
            // NAME  ID  SIZE  MODIFIED — size is two columns, "4.7 GB".
            let _id = cols.next()?;
            let n = cols.next().unwrap_or_default();
            let unit = cols.next().unwrap_or_default();
            Some(Model {
                name: name.to_string(),
                size: format!("{n} {unit}").trim().to_string(),
            })
        })
        .collect()
}

/// The first line of a `--version` output, tidied.
pub fn first_line(out: &str) -> String {
    out.lines().next().unwrap_or_default().trim().to_string()
}

/// Every runner we know about, and what it says about itself.
#[tauri::command]
pub fn community_runners() -> Vec<Runner> {
    let mut out = Vec::new();

    // -- Ollama ------------------------------------------------------------
    let mut ollama = Runner {
        id: "ollama".into(),
        name: "Ollama".into(),
        install_hint: "winget install Ollama.Ollama".into(),
        installed: on_path("ollama"),
        ..Default::default()
    };
    if ollama.installed {
        match run("ollama", &["--version"]) {
            Ok(v) => ollama.version = first_line(&v),
            Err(e) => ollama.note = e,
        }
        match run("ollama", &["list"]) {
            Ok(list) => {
                ollama.responding = true;
                ollama.models = parse_ollama_list(&list);
            }
            Err(e) => {
                // Installed and not answering is its own state, and the fix is
                // different: start it, rather than install it.
                ollama.note = format!("installed, but not answering — {e}");
            }
        }
    }
    out.push(ollama);

    // -- llama.cpp ---------------------------------------------------------
    //
    // No model list: llama-server is given a file, it does not keep a library.
    // Saying so beats an empty Models column that reads as "none installed".
    let llama = Runner {
        id: "llama.cpp".into(),
        name: "llama.cpp".into(),
        install_hint: "winget install ggml.llamacpp".into(),
        installed: on_path("llama-server"),
        responding: false,
        note: "Serves a model file you point it at, so it keeps no library to list.".into(),
        ..Default::default()
    };
    out.push(llama);

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_list_is_read_past_its_header() {
        let out = "NAME                ID              SIZE      MODIFIED\n\
                   llama3.2:3b         a80c4f17acd5    2.0 GB    3 days ago\n\
                   qwen2.5-coder:7b    2b0496514337    4.7 GB    2 weeks ago\n";
        let m = parse_ollama_list(out);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].name, "llama3.2:3b");
        assert_eq!(m[0].size, "2.0 GB");
        assert_eq!(m[1].name, "qwen2.5-coder:7b");
        assert_eq!(m[1].size, "4.7 GB");
    }

    #[test]
    fn a_runner_with_nothing_pulled_yet_has_no_models_and_that_is_not_an_error() {
        // Ollama installed, library empty. "None" is a true answer and must
        // not read the same as "we could not ask".
        assert!(parse_ollama_list("NAME    ID    SIZE    MODIFIED\n").is_empty());
        assert!(parse_ollama_list("").is_empty());
    }

    #[test]
    fn a_line_that_is_not_a_row_is_skipped_rather_than_named() {
        // The tabular format is a contract nobody promised. A warning line
        // must not become a model called "Warning:".
        let out = "NAME    ID    SIZE    MODIFIED\nllama3.2:3b    abc    2.0 GB    now\nonlyonecolumn\n";
        let m = parse_ollama_list(out);
        assert_eq!(m.len(), 1, "{m:?}");
        assert_eq!(m[0].name, "llama3.2:3b");
    }

    #[test]
    fn a_version_is_its_first_line_and_nothing_else() {
        assert_eq!(first_line("ollama version is 0.5.4\n\nwarning: x"), "ollama version is 0.5.4");
        assert_eq!(first_line(""), "");
    }
}
