//! Project Setup: make a project "ready to run".
//!
//!  * detect the tools a project needs (Node, pnpm, Rust…) and its one-time
//!    bootstrap steps (`pnpm install`, `uv sync`…) from the repo,
//!  * install what's missing and run the bootstrap in order,
//!  * refresh the process PATH from the registry so freshly-installed tools
//!    work without restarting DevDeck,
//!  * and map "command not found" errors from a running command to an
//!    installable package.
//!
//! All output streams into the shared log bus so it shows in the bottom Logs.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::Emitter;

use crate::services;

const SETUP_LOG_ID: i64 = -300_000;

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

#[derive(Serialize, Clone)]
pub struct RequiredTool {
    pub binary: String,
    pub name: String,
    pub pkg_id: String,
    pub source: String,
    pub installed: bool,
}

#[derive(Serialize, Clone)]
pub struct SetupStep {
    pub label: String,
    pub run: String,
    pub done: bool,
}

#[derive(Serialize, Clone)]
pub struct ProjectSetup {
    pub tools: Vec<RequiredTool>,
    pub steps: Vec<SetupStep>,
    pub ready: bool,
}

#[derive(Deserialize, Clone)]
pub struct InstallTool {
    pub pkg_id: String,
    pub source: String,
}

/// binary name → (friendly name, catalog package id, source). Empty pkg_id
/// means "no clean installer" (we still report it, but can't auto-install).
fn tool_for(binary: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match binary {
        "node" | "npm" | "npx" => ("Node.js", "OpenJS.NodeJS.LTS", "winget"),
        "pnpm" => ("pnpm", "pnpm.pnpm", "winget"),
        "yarn" => ("Yarn", "Yarn.Yarn", "winget"),
        "bun" | "bunx" => ("Bun", "Oven-sh.Bun", "winget"),
        "python" | "python3" | "py" | "pip" | "pip3" => ("Python", "Python.Python.3.12", "winget"),
        "uv" | "uvx" => ("uv", "astral-sh.uv", "winget"),
        "cargo" | "rustc" | "rustup" => ("Rust", "Rustlang.Rustup", "winget"),
        "go" | "gofmt" => ("Go", "GoLang.Go", "winget"),
        "dotnet" => (".NET SDK", "Microsoft.DotNet.SDK.8", "winget"),
        "ruby" | "bundle" | "bundler" | "gem" => ("Ruby", "RubyInstallerTeam.Ruby.3.3", "winget"),
        "git" => ("Git", "Git.Git", "winget"),
        "docker" => ("Docker Desktop", "Docker.DockerDesktop", "winget"),
        "deno" => ("Deno", "DenoLand.Deno", "winget"),
        "php" | "composer" => ("PHP / Composer", "", "winget"),
        _ => return None,
    })
}

/// scoop shims dir (so newly-installed scoop tools resolve) + registry PATH.
fn resolved_path() -> Option<String> {
    let script = "$m=[Environment]::GetEnvironmentVariable('Path','Machine'); $u=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::ExpandEnvironmentVariables(\"$env:USERPROFILE\\scoop\\shims;$m;$u\")";
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Is `binary` resolvable on the *current* (possibly just-refreshed) PATH?
fn on_path(binary: &str) -> bool {
    let mut cmd = Command::new("where");
    cmd.arg(binary).stdout(Stdio::null()).stderr(Stdio::null());
    no_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn tool(binary: &str) -> Option<RequiredTool> {
    let (name, pkg_id, source) = tool_for(binary)?;
    if pkg_id.is_empty() {
        return None;
    }
    Some(RequiredTool {
        binary: binary.into(),
        name: name.into(),
        pkg_id: pkg_id.into(),
        source: source.into(),
        installed: on_path(binary),
    })
}

fn push_tool(
    tools: &mut Vec<RequiredTool>,
    seen: &mut std::collections::HashSet<String>,
    binary: &str,
) {
    if seen.insert(binary.to_string()) {
        if let Some(t) = tool(binary) {
            tools.push(t);
        }
    }
}

/// Re-read PATH from the registry (+ scoop shims) into this process, so tools
/// installed while DevDeck is running resolve without a restart.
#[tauri::command]
pub fn refresh_path() -> Result<(), String> {
    let path = resolved_path().ok_or("could not read PATH from the registry")?;
    std::env::set_var("PATH", path);
    Ok(())
}

/// Detect a project's required tools + bootstrap steps and their current state.
#[tauri::command]
pub fn detect_project_setup(dir: String) -> ProjectSetup {
    let d = Path::new(&dir);
    let mut tools: Vec<RequiredTool> = Vec::new();
    let mut steps: Vec<SetupStep> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if !dir.trim().is_empty() && d.is_dir() {
        // Node / JS ecosystem
        if d.join("package.json").exists() {
            push_tool(&mut tools, &mut seen, "node");
            let (pm, cmd) = if d.join("pnpm-lock.yaml").exists() {
                ("pnpm", "pnpm install")
            } else if d.join("yarn.lock").exists() {
                ("yarn", "yarn install")
            } else if d.join("bun.lockb").exists() || d.join("bun.lock").exists() {
                ("bun", "bun install")
            } else {
                ("npm", "npm install")
            };
            if pm != "npm" {
                push_tool(&mut tools, &mut seen, pm); // npm ships with Node
            }
            steps.push(SetupStep {
                label: format!("Install dependencies ({pm})"),
                run: cmd.into(),
                done: d.join("node_modules").is_dir(),
            });
        }
        // Rust
        if d.join("Cargo.toml").exists() {
            push_tool(&mut tools, &mut seen, "cargo");
        }
        // Go
        if d.join("go.mod").exists() {
            push_tool(&mut tools, &mut seen, "go");
        }
        // Python
        if d.join("pyproject.toml").exists() {
            push_tool(&mut tools, &mut seen, "python");
            if d.join("uv.lock").exists() {
                push_tool(&mut tools, &mut seen, "uv");
                steps.push(SetupStep {
                    label: "Sync environment (uv)".into(),
                    run: "uv sync".into(),
                    done: d.join(".venv").is_dir(),
                });
            } else if d.join("requirements.txt").exists() {
                steps.push(SetupStep {
                    label: "Install requirements (pip)".into(),
                    run: "pip install -r requirements.txt".into(),
                    done: d.join(".venv").is_dir(),
                });
            }
        } else if d.join("requirements.txt").exists() {
            push_tool(&mut tools, &mut seen, "python");
            steps.push(SetupStep {
                label: "Install requirements (pip)".into(),
                run: "pip install -r requirements.txt".into(),
                done: false,
            });
        }
        // PHP / Ruby
        if d.join("composer.json").exists() {
            push_tool(&mut tools, &mut seen, "composer");
            steps.push(SetupStep {
                label: "Install dependencies (composer)".into(),
                run: "composer install".into(),
                done: d.join("vendor").is_dir(),
            });
        }
        if d.join("Gemfile").exists() {
            push_tool(&mut tools, &mut seen, "bundle");
            steps.push(SetupStep {
                label: "Install gems (bundler)".into(),
                run: "bundle install".into(),
                done: false,
            });
        }
    }

    let ready = tools.iter().all(|t| t.installed) && steps.iter().all(|s| s.done);
    ProjectSetup {
        tools,
        steps,
        ready,
    }
}

/// Given one line of a command's output, suggest an installable tool if it
/// looks like a "command not found" error. Returns null otherwise.
#[tauri::command]
pub fn suggest_install(line: String) -> Option<RequiredTool> {
    let l = line.to_ascii_lowercase();
    // Extract the offending binary name from common shells' phrasings.
    let bin = if let Some(i) = l.find("is not recognized") {
        // cmd.exe: 'pnpm' is not recognized as an internal or external command
        line[..i]
            .trim()
            .trim_matches(|c| c == '\'' || c == '"' || c == ' ')
            .to_string()
    } else if let Some(rest) = l.strip_prefix("command not found: ") {
        rest.split_whitespace().next().unwrap_or("").to_string()
    } else if let Some(i) = l.find(": command not found") {
        // bash: pnpm: command not found
        line[..i]
            .split_whitespace()
            .last()
            .unwrap_or("")
            .to_string()
    } else if let Some(i) = l.find("the term '") {
        // PowerShell: The term 'pnpm' is not recognized...
        let after = &line[i + 10..];
        after.split('\'').next().unwrap_or("").to_string()
    } else if let Some(i) = l.find("no such file or directory") {
        // env: node: No such file or directory
        let before = &line[..i];
        before
            .rsplit(|c| c == ':' || c == ' ')
            .find(|s| !s.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string()
    } else {
        return None;
    };
    let bin = bin.trim().trim_end_matches(".exe").to_ascii_lowercase();
    if bin.is_empty() {
        return None;
    }
    tool(&bin)
}

fn stream(app: &tauri::AppHandle, name: &str, mut cmd: Command) -> bool {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(p) = resolved_path() {
        cmd.env("PATH", p);
    }
    no_window(&mut cmd);
    match cmd.spawn() {
        Ok(mut child) => {
            let err = child.stderr.take().map(|e| {
                let app = app.clone();
                let name = name.to_string();
                std::thread::spawn(move || {
                    for line in BufReader::new(e).lines().map_while(Result::ok) {
                        if !line.trim().is_empty() {
                            services::push_log(&app, SETUP_LOG_ID, &name, "stderr", line);
                        }
                    }
                })
            });
            if let Some(out) = child.stdout.take() {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if !line.trim().is_empty() {
                        services::push_log(app, SETUP_LOG_ID, name, "stdout", line);
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
                app,
                SETUP_LOG_ID,
                name,
                "stderr",
                format!("failed to launch: {e}"),
            );
            false
        }
    }
}

/// Clone a git repository into `parent`/<repo-name> and return the path.
/// Relies on the user's existing git credentials (helper / gh auth) for
/// private repos. Output streams to the log bus.
#[tauri::command]
pub fn clone_repo(app: tauri::AppHandle, url: String, parent: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Enter a repository URL.".into());
    }
    if !on_path("git") {
        return Err("Git isn't installed — install Git, then try again.".into());
    }
    let name = url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .to_string();
    if name.is_empty() {
        return Err("Could not read a repo name from that URL.".into());
    }
    let target = Path::new(&parent).join(&name);
    if target.exists()
        && target
            .read_dir()
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
    {
        return Err(format!(
            "“{}” already exists and isn't empty.",
            target.display()
        ));
    }
    let target_str = target.to_string_lossy().to_string();

    services::push_log(
        &app,
        SETUP_LOG_ID,
        "git clone",
        "system",
        format!("cloning {url} → {target_str}"),
    );
    let mut cmd = Command::new("git");
    cmd.args(["clone", "--progress", &url, &target_str]);
    if !stream(&app, "git clone", cmd) {
        return Err("git clone failed — see the Logs.".into());
    }
    services::push_log(
        &app,
        SETUP_LOG_ID,
        "git clone",
        "system",
        "clone complete.".into(),
    );
    Ok(target_str)
}

/// Install the given tools, refresh PATH, then run the bootstrap steps in the
/// project directory. Emits `setup:done` with `{ ok }` when finished so the UI
/// can start the service it was preparing.
#[tauri::command]
pub fn run_project_setup(
    app: tauri::AppHandle,
    tools: Vec<InstallTool>,
    steps: Vec<String>,
    cwd: String,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let mut ok = true;

        for t in &tools {
            services::push_log(
                &app,
                SETUP_LOG_ID,
                "project setup",
                "system",
                format!("installing {} …", t.pkg_id),
            );
            let line = if t.source == "scoop" {
                format!("scoop install {}", t.pkg_id)
            } else {
                format!(
                    "winget install --id {} --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity",
                    t.pkg_id
                )
            };
            let mut cmd = Command::new("cmd");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.raw_arg("/C");
                cmd.raw_arg(format!("\"{line}\""));
            }
            #[cfg(not(windows))]
            {
                cmd.args(["-c", &line]);
            }
            if !stream(&app, &t.pkg_id, cmd) {
                ok = false;
            }
        }

        // Make freshly-installed tools resolvable for the bootstrap steps below.
        if let Some(p) = resolved_path() {
            std::env::set_var("PATH", p);
        }
        services::push_log(
            &app,
            SETUP_LOG_ID,
            "project setup",
            "system",
            "refreshed PATH".into(),
        );

        for step in &steps {
            services::push_log(
                &app,
                SETUP_LOG_ID,
                "project setup",
                "system",
                format!("running: {step}"),
            );
            let mut cmd = Command::new("cmd");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.raw_arg("/C");
                cmd.raw_arg(format!("\"{step}\""));
            }
            #[cfg(not(windows))]
            {
                cmd.args(["-c", step]);
            }
            if !cwd.trim().is_empty() && Path::new(&cwd).is_dir() {
                cmd.current_dir(&cwd);
            }
            if !stream(&app, "project setup", cmd) {
                ok = false;
            }
        }

        services::push_log(
            &app,
            SETUP_LOG_ID,
            "project setup",
            "system",
            if ok {
                "setup complete.".into()
            } else {
                "setup finished with errors — see the log.".to_string()
            },
        );
        let _ = app.emit("setup:done", ok);
    });
    Ok(())
}
