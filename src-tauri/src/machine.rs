//! Machine Setup: install dev software via winget / scoop, detect what's
//! already installed, and export/import a portable machine manifest so a fresh
//! Windows install can be rebuilt in a couple of clicks.
//!
//! Install output is streamed into the shared log bus (services::push_log), so
//! it shows up in the bottom-bar Logs like any other run.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::Emitter;

use crate::services;

/// Fixed negative log/service id space for install runs (won't collide with
/// real services, which use their row id, or ephemeral runs, which count down
/// from -1 — installs sit far below that).
const INSTALL_LOG_ID: i64 = -100_000;

#[derive(Serialize, Clone)]
pub struct MachineStatus {
    /// winget PackageIdentifiers currently installed.
    pub winget: Vec<String>,
    /// scoop app names currently installed.
    pub scoop: Vec<String>,
    /// Whether the scoop CLI is available on this machine.
    pub scoop_available: bool,
    /// Whether the winget CLI is available on this machine.
    pub winget_available: bool,
}

#[derive(Deserialize, Clone)]
pub struct InstallItem {
    pub id: String,
    pub source: String, // "winget" | "scoop"
}

#[derive(Serialize, Clone)]
struct ItemEvent {
    id: String,
    status: String, // "installing" | "ok" | "failed"
}

// ---- manifest ----

#[derive(Serialize, Deserialize, Clone)]
pub struct ManifestPackage {
    pub id: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub elevate: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Manifest {
    pub name: String,
    pub version: u32,
    pub packages: Vec<ManifestPackage>,
    #[serde(default)]
    pub steps: Vec<serde_json::Value>,
    #[serde(default)]
    pub repos: Vec<serde_json::Value>,
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// Run a command to completion and capture stdout (best-effort, empty on error).
fn capture(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn exists(program: &str) -> bool {
    // `where <program>` succeeds (exit 0) when it's on PATH.
    let mut cmd = Command::new("where");
    cmd.arg(program).stdout(Stdio::null()).stderr(Stdio::null());
    no_window(&mut cmd);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

/// Installed winget package identifiers, via `winget export` (structured JSON,
/// far more reliable than parsing the columnar `winget list`).
fn winget_installed() -> Vec<String> {
    let tmp = std::env::temp_dir().join("devdeck-winget-export.json");
    let path = tmp.to_string_lossy().to_string();
    let mut cmd = Command::new("winget");
    cmd.args([
        "export",
        "-o",
        &path,
        "--accept-source-agreements",
        "--disable-interactivity",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    no_window(&mut cmd);
    let _ = cmd.status();

    let mut ids = Vec::new();
    if let Ok(text) = std::fs::read_to_string(&tmp) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(sources) = json.get("Sources").and_then(|s| s.as_array()) {
                for src in sources {
                    if let Some(pkgs) = src.get("Packages").and_then(|p| p.as_array()) {
                        for p in pkgs {
                            if let Some(id) = p.get("PackageIdentifier").and_then(|v| v.as_str()) {
                                ids.push(id.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    ids
}

/// Installed scoop apps. `scoop export` is a PowerShell function, so it's run
/// through PowerShell; the format has changed across versions, so accept both
/// the newer JSON ({"apps":[{"Name":…}]}) and an older plain name-per-line list.
fn scoop_installed() -> Vec<String> {
    let text = match capture("powershell", &["-NoProfile", "-Command", "scoop export"]) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(apps) = json.get("apps").and_then(|a| a.as_array()) {
                return apps
                    .iter()
                    .filter_map(|a| a.get("Name").and_then(|n| n.as_str()).map(String::from))
                    .collect();
            }
        }
    }
    // Fallback: one app name (first token) per non-empty line.
    text.lines()
        .filter_map(|l| l.split_whitespace().next())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// What's installed on this machine, for marking the catalog.
#[tauri::command]
pub fn machine_status() -> MachineStatus {
    let winget_available = exists("winget");
    let scoop_available = exists("scoop") || exists("scoop.cmd") || exists("scoop.ps1");
    MachineStatus {
        winget: if winget_available { winget_installed() } else { Vec::new() },
        scoop: if scoop_available { scoop_installed() } else { Vec::new() },
        scoop_available,
        winget_available,
    }
}

/// The argv (through cmd.exe so PATH shims like scoop resolve) for installing
/// one item.
fn install_command(item: &InstallItem) -> String {
    match item.source.as_str() {
        "scoop" => format!("scoop install {}", item.id),
        _ => format!(
            "winget install --id {} --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity",
            item.id
        ),
    }
}

/// Install a batch of packages sequentially in a background thread. Output
/// streams into the log bus (service = the package id); a `machine:item` event
/// fires as each item flips to installing/ok/failed. Returns immediately.
#[tauri::command]
pub fn machine_install(app: tauri::AppHandle, items: Vec<InstallItem>) -> Result<(), String> {
    std::thread::spawn(move || {
        for item in items {
            let _ = app.emit(
                "machine:item",
                ItemEvent { id: item.id.clone(), status: "installing".into() },
            );
            services::push_log(
                &app,
                INSTALL_LOG_ID,
                &item.id,
                "system",
                format!("installing via {} …", item.source),
            );

            let line = install_command(&item);
            let mut cmd = Command::new("cmd");
            {
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
            }
            cmd.stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            no_window(&mut cmd);

            let ok = match cmd.spawn() {
                Ok(mut child) => {
                    for (pipe, stream) in [
                        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), "stdout"),
                        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), "stderr"),
                    ] {
                        if let Some(pipe) = pipe {
                            let app = app.clone();
                            let name = item.id.clone();
                            let stream = stream.to_string();
                            std::thread::spawn(move || {
                                for l in BufReader::new(pipe).lines().map_while(Result::ok) {
                                    if !l.trim().is_empty() {
                                        services::push_log(&app, INSTALL_LOG_ID, &name, &stream, l);
                                    }
                                }
                            });
                        }
                    }
                    child.wait().map(|s| s.success()).unwrap_or(false)
                }
                Err(e) => {
                    services::push_log(&app, INSTALL_LOG_ID, &item.id, "stderr", format!("failed to launch: {e}"));
                    false
                }
            };

            services::push_log(
                &app,
                INSTALL_LOG_ID,
                &item.id,
                "system",
                if ok { "done".into() } else { "install failed".to_string() },
            );
            let _ = app.emit(
                "machine:item",
                ItemEvent { id: item.id, status: if ok { "ok" } else { "failed" }.into() },
            );
        }
        let _ = app.emit("machine:done", ());
    });
    Ok(())
}

/// Build a manifest from what's installed, matched against a caller-supplied
/// catalog (id → source) so we record the right source per package and skip
/// system noise the catalog doesn't know about.
#[tauri::command]
pub fn machine_snapshot(name: String, known: Vec<InstallItem>) -> Manifest {
    let status = machine_status();
    let mut packages = Vec::new();
    for k in &known {
        let installed = match k.source.as_str() {
            "scoop" => status.scoop.iter().any(|s| s.eq_ignore_ascii_case(&k.id)),
            _ => status.winget.iter().any(|s| s.eq_ignore_ascii_case(&k.id)),
        };
        if installed {
            packages.push(ManifestPackage { id: k.id.clone(), source: k.source.clone(), elevate: false });
        }
    }
    Manifest {
        name: if name.trim().is_empty() { "dev machine".into() } else { name },
        version: 1,
        packages,
        steps: Vec::new(),
        repos: Vec::new(),
    }
}

/// Write a manifest to disk (pretty JSON).
#[tauri::command]
pub fn machine_export(path: String, manifest: Manifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Read a manifest file and return it parsed.
#[tauri::command]
pub fn machine_import(path: String) -> Result<Manifest, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Manifest>(&text).map_err(|e| format!("Invalid manifest: {e}"))
}
