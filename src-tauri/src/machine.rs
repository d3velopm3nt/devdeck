//! Machine Setup: install dev software via winget / scoop, detect what's
//! already installed, and export/import a portable machine manifest so a fresh
//! Windows install can be rebuilt in a couple of clicks.
//!
//! Install output is streamed into the shared log bus (services::push_log), so
//! it shows up in the bottom-bar Logs like any other run.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::Emitter;

use crate::db::{err, Db};
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

/// The scoop shims directory (~/scoop/shims) if it exists.
fn scoop_shims() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join("scoop").join("shims"))
}

/// Scoop is present if its shim exists on disk — checked directly (not via
/// PATH), so it's still detected right after install before PATH refreshes.
fn scoop_present() -> bool {
    scoop_shims()
        .map(|s| s.join("scoop.cmd").exists() || s.join("scoop.ps1").exists())
        .unwrap_or(false)
}

/// A PowerShell snippet prefix that puts scoop's shims on PATH for this process,
/// so `scoop …` resolves even when the app started before scoop was installed.
fn scoop_prefix() -> String {
    "$env:PATH = \"$env:USERPROFILE\\scoop\\shims;$env:PATH\"; ".to_string()
}

/// Installed scoop apps. `scoop export` is a PowerShell function, so it's run
/// through PowerShell; the format has changed across versions, so accept both
/// the newer JSON ({"apps":[{"Name":…}]}) and an older plain name-per-line list.
fn scoop_installed() -> Vec<String> {
    if !scoop_present() {
        return Vec::new();
    }
    let script = format!("{}scoop export", scoop_prefix());
    let text = match capture("powershell", &["-NoProfile", "-Command", &script]) {
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
    let scoop_available = scoop_present();
    MachineStatus {
        winget: if winget_available {
            winget_installed()
        } else {
            Vec::new()
        },
        scoop: if scoop_available {
            scoop_installed()
        } else {
            Vec::new()
        },
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
                ItemEvent {
                    id: item.id.clone(),
                    status: "installing".into(),
                },
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
            // Put scoop's shims on PATH so `scoop install` resolves even when
            // DevDeck was launched before scoop existed.
            if let (Some(shims), Ok(path)) = (scoop_shims(), std::env::var("PATH")) {
                cmd.env("PATH", format!("{};{}", shims.display(), path));
            }
            no_window(&mut cmd);

            let ok = match cmd.spawn() {
                Ok(mut child) => {
                    for (pipe, stream) in [
                        (
                            child
                                .stdout
                                .take()
                                .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                            "stdout",
                        ),
                        (
                            child
                                .stderr
                                .take()
                                .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                            "stderr",
                        ),
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
                    services::push_log(
                        &app,
                        INSTALL_LOG_ID,
                        &item.id,
                        "stderr",
                        format!("failed to launch: {e}"),
                    );
                    false
                }
            };

            services::push_log(
                &app,
                INSTALL_LOG_ID,
                &item.id,
                "system",
                if ok {
                    "done".into()
                } else {
                    "install failed".to_string()
                },
            );
            let _ = app.emit(
                "machine:item",
                ItemEvent {
                    id: item.id,
                    status: if ok { "ok" } else { "failed" }.into(),
                },
            );
        }
        let _ = app.emit("machine:done", ());
    });
    Ok(())
}

/// Install scoop itself (per-user, no admin) via its official one-liner, so the
/// scoop catalog becomes available. Streams to the log bus; emits machine:done
/// so the UI re-checks availability.
#[tauri::command]
pub fn machine_install_scoop(app: tauri::AppHandle) -> Result<(), String> {
    if scoop_present() {
        return Ok(());
    }
    std::thread::spawn(move || {
        let name = "scoop setup";
        services::push_log(
            &app,
            INSTALL_LOG_ID,
            name,
            "system",
            "installing scoop (per-user, no admin) …".into(),
        );
        let script = "Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force; Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression";
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd);
        let ok = match cmd.spawn() {
            Ok(mut child) => {
                for (pipe, stream) in [
                    (
                        child
                            .stdout
                            .take()
                            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                        "stdout",
                    ),
                    (
                        child
                            .stderr
                            .take()
                            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
                        "stderr",
                    ),
                ] {
                    if let Some(pipe) = pipe {
                        let app = app.clone();
                        let stream = stream.to_string();
                        std::thread::spawn(move || {
                            for l in BufReader::new(pipe).lines().map_while(Result::ok) {
                                if !l.trim().is_empty() {
                                    services::push_log(
                                        &app,
                                        INSTALL_LOG_ID,
                                        "scoop setup",
                                        &stream,
                                        l,
                                    );
                                }
                            }
                        });
                    }
                }
                child.wait().map(|s| s.success()).unwrap_or(false)
            }
            Err(e) => {
                services::push_log(
                    &app,
                    INSTALL_LOG_ID,
                    name,
                    "stderr",
                    format!("failed to launch: {e}"),
                );
                false
            }
        };
        // Confirm by disk presence rather than exit code alone.
        let installed = ok && scoop_present();
        services::push_log(
            &app,
            INSTALL_LOG_ID,
            name,
            "system",
            if installed {
                "scoop installed — scoop packages are now available.".into()
            } else {
                "scoop install failed — see the log above.".to_string()
            },
        );
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
            packages.push(ManifestPackage {
                id: k.id.clone(),
                source: k.source.clone(),
                elevate: false,
            });
        }
    }
    Manifest {
        name: if name.trim().is_empty() {
            "dev machine".into()
        } else {
            name
        },
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

/// Live package configuration from the source (winget show / scoop info):
/// version, publisher, homepage, license, description, etc.
#[tauri::command]
pub fn machine_show(id: String, source: String) -> Result<String, String> {
    let mut cmd = match source.as_str() {
        "scoop" => {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-Command", &format!("scoop info {id}")]);
            c
        }
        _ => {
            let mut c = Command::new("winget");
            c.args([
                "show",
                "--id",
                &id,
                "--exact",
                "--disable-interactivity",
                "--accept-source-agreements",
            ]);
            c
        }
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&out.stderr).to_string();
    }
    if text.trim().is_empty() {
        return Err("No details returned — is the id correct and the source available?".into());
    }
    Ok(text)
}

/// The exact install command DevDeck will run for a package — shown in the
/// details panel so there are no surprises.
#[tauri::command]
pub fn machine_install_preview(id: String, source: String) -> String {
    install_command(&InstallItem { id, source })
}

// ---- editable catalog (DB-backed) ----

#[derive(Serialize, Deserialize, Clone)]
pub struct MachinePackage {
    pub id: String,
    pub name: String,
    pub source: String,
    pub category: String,
    #[serde(default)]
    pub blurb: String,
    #[serde(default)]
    pub elevate: bool,
    #[serde(default)]
    pub custom: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub sort: i64,
}

fn row_to_pkg(row: &rusqlite::Row) -> rusqlite::Result<MachinePackage> {
    Ok(MachinePackage {
        id: row.get(0)?,
        name: row.get(1)?,
        source: row.get(2)?,
        category: row.get(3)?,
        blurb: row.get(4)?,
        elevate: row.get::<_, i64>(5)? != 0,
        custom: row.get::<_, i64>(6)? != 0,
        hidden: row.get::<_, i64>(7)? != 0,
        sort: row.get(8)?,
    })
}

/// The whole catalog (curated + custom) as the user has it. Hidden rows are
/// included so the UI can offer "restore"; it filters them from the list.
#[tauri::command]
pub fn machine_packages_list(db: tauri::State<Db>) -> Result<Vec<MachinePackage>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, source, category, blurb, elevate, custom, hidden, sort FROM machine_packages ORDER BY sort, id")
        .map_err(err)?;
    let rows = stmt
        .query_map([], row_to_pkg)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

/// Seed curated packages (INSERT OR IGNORE) — first run populates the table,
/// later runs add any newly-shipped packages while preserving the user's edits,
/// hides and custom entries. Returns how many new rows were added.
#[tauri::command]
pub fn machine_packages_seed(
    db: tauri::State<Db>,
    packages: Vec<MachinePackage>,
) -> Result<usize, String> {
    let conn = db.0.lock().unwrap();
    let mut added = 0usize;
    for (i, p) in packages.iter().enumerate() {
        let n = conn
            .execute(
                "INSERT OR IGNORE INTO machine_packages (id, name, source, category, blurb, elevate, custom, hidden, sort)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7)",
                params![p.id, p.name, p.source, p.category, p.blurb, p.elevate as i64, i as i64],
            )
            .map_err(err)?;
        added += n;
    }
    Ok(added)
}

/// Upsert a package (curated override or new custom). Editing a curated package
/// simply overwrites its row; it stays put until the user resets it.
#[tauri::command]
pub fn machine_package_save(db: tauri::State<Db>, pkg: MachinePackage) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO machine_packages (id, name, source, category, blurb, elevate, custom, hidden, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, source=excluded.source, category=excluded.category,
            blurb=excluded.blurb, elevate=excluded.elevate, hidden=excluded.hidden",
        params![
            pkg.id, pkg.name, pkg.source, pkg.category, pkg.blurb,
            pkg.elevate as i64, pkg.custom as i64, pkg.hidden as i64, pkg.sort
        ],
    )
    .map_err(err)?;
    Ok(())
}

/// Remove a package. Custom entries are deleted outright; curated ones are
/// hidden (so the seed won't bring them back) and can be restored later.
#[tauri::command]
pub fn machine_package_delete(db: tauri::State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let is_custom: bool = conn
        .query_row(
            "SELECT custom FROM machine_packages WHERE id = ?1",
            params![id],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false);
    if is_custom {
        conn.execute("DELETE FROM machine_packages WHERE id = ?1", params![id])
            .map_err(err)?;
    } else {
        conn.execute(
            "UPDATE machine_packages SET hidden = 1 WHERE id = ?1",
            params![id],
        )
        .map_err(err)?;
    }
    Ok(())
}
