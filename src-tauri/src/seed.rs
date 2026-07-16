//! The example workspace: a real, runnable demo a first-time user can load
//! with one click.
//!
//! Everything here is genuine — we write a small project to disk and wire it
//! up with services that actually run on any Windows machine with no extra
//! tooling installed (no node, no python). The web server uses a raw
//! TcpListener rather than HttpListener because the latter needs an admin URL
//! reservation, which would break the demo for normal users.

use crate::db::Db;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEMO_PORT: u16 = 8099;
const WORKSPACE_NAME: &str = "Example Workspace";

/// Where the demo project is written: %USERPROFILE%\DevDeck Demo
pub fn demo_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DevDeck Demo")
}

const README_MD: &str = r#"# DevDeck Demo

This little project was created by DevDeck so you can see how it works with
something real. Nothing here talks to the internet.

- `web/serve.ps1`  — a tiny web server (plain PowerShell, no dependencies)
- `api/worker.ps1` — a fake background worker that prints job output

Both are wired up in DevDeck as **services**. Start them from the Dashboard,
the Explorer, or the floating widget.

Delete this folder and the "Example Workspace" any time — you can always load
it again from Settings.
"#;

const INDEX_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DevDeck Demo</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f131b;
    color: #cbd5e1;
    font: 16px/1.6 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  }
  .card {
    text-align: center; padding: 48px 56px; border-radius: 16px;
    border: 1px solid #1e293b; background: #151923;
    box-shadow: 0 20px 60px rgba(0,0,0,.4);
  }
  h1 { margin: 0 0 8px; font-size: 28px; color: #f1f5f9; }
  .accent { color: #7C8CF8; }
  p { margin: 0; color: #64748b; font-size: 14px; }
  code {
    font-family: ui-monospace, Consolas, monospace; font-size: 13px;
    background: #0f131b; border: 1px solid #1e293b;
    padding: 2px 6px; border-radius: 6px; color: #94a3b8;
  }
  .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: #4ADE80; margin-right: 8px;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: .35 } }
</style>
</head>
<body>
  <div class="card">
    <h1><span class="accent">&#10095;_</span> It works.</h1>
    <p><span class="dot"></span>Served by the DevDeck demo web server</p>
    <p style="margin-top:20px">This page came from <code>web/serve.ps1</code>,
      started as a DevDeck service.</p>
  </div>
</body>
</html>
"#;

/// A dependency-free web server. Uses TcpListener (not HttpListener) so it
/// needs no admin rights or URL ACL reservation.
const SERVE_PS1: &str = r#"# DevDeck demo web server — plain PowerShell, no dependencies.
$ErrorActionPreference = 'Stop'
$port = 8099
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $root 'index.html'

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Output "demo web server listening on http://localhost:$port"
Write-Output "press Stop in DevDeck to shut it down"

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $requestLine = $reader.ReadLine()
      if ($requestLine) { Write-Output $requestLine }

      $html  = [System.IO.File]::ReadAllBytes($indexPath)
      $head  = "HTTP/1.1 200 OK`r`n"
      $head += "Content-Type: text/html; charset=utf-8`r`n"
      $head += "Content-Length: $($html.Length)`r`n"
      $head += "Connection: close`r`n`r`n"
      $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)

      $stream.Write($headBytes, 0, $headBytes.Length)
      $stream.Write($html, 0, $html.Length)
      $stream.Flush()
    } catch {
      Write-Output "request failed: $($_.Exception.Message)"
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
  Write-Output "demo web server stopped"
}
"#;

/// A long-running worker: gives the dashboard real CPU/uptime to show, and
/// real stdout/stderr for the log viewer.
const WORKER_PS1: &str = r#"# DevDeck demo worker — prints job output so you can watch the Logs panel.
$i = 0
Write-Output "demo worker started"
while ($true) {
  $i++
  $items = Get-Random -Minimum 8 -Maximum 40
  Write-Output "[job $i] processed $items items"
  if ($i % 6 -eq 0) {
    Write-Warning "[job $i] queue depth rising - this is a demo warning"
  }
  Start-Sleep -Seconds 3
}
"#;

fn write_demo_files(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir.join("web"))?;
    fs::create_dir_all(dir.join("api"))?;
    fs::write(dir.join("README.md"), README_MD)?;
    fs::write(dir.join("web").join("index.html"), INDEX_HTML)?;
    fs::write(dir.join("web").join("serve.ps1"), SERVE_PS1)?;
    fs::write(dir.join("api").join("worker.ps1"), WORKER_PS1)?;
    Ok(())
}

fn insert_node(
    conn: &Connection,
    parent: Option<i64>,
    kind: &str,
    name: &str,
    path: Option<&str>,
    rel_path: &str,
    color: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO nodes (parent_id, kind, name, path, rel_path, color) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![parent, kind, name, path, rel_path, color],
    )?;
    Ok(conn.last_insert_rowid())
}

/// True when an example workspace is already present, so the UI can hide the
/// "load" affordance instead of creating duplicates.
#[tauri::command]
pub fn example_exists(db: tauri::State<Db>) -> Result<bool, String> {
    let conn = db.0.lock().unwrap();
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM nodes WHERE kind = 'workspace' AND name = ?1",
            params![WORKSPACE_NAME],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Write the demo project to disk and seed it into the tree. Returns the id of
/// the created project so the UI can open its space page.
#[tauri::command]
pub fn seed_example(db: tauri::State<Db>) -> Result<i64, String> {
    let dir = demo_dir();
    write_demo_files(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let base = dir.to_string_lossy().to_string();

    let conn = db.0.lock().unwrap();

    let ws = insert_node(&conn, None, "workspace", WORKSPACE_NAME, None, "", None)
        .map_err(|e| e.to_string())?;
    let project = insert_node(
        &conn,
        Some(ws),
        "project",
        "Demo App",
        Some(&base),
        "",
        Some("#7C8CF8"),
    )
    .map_err(|e| e.to_string())?;
    let web = insert_node(&conn, Some(project), "folder", "web", None, "web", None)
        .map_err(|e| e.to_string())?;
    let api = insert_node(&conn, Some(project), "folder", "api", None, "api", None)
        .map_err(|e| e.to_string())?;

    // Services — both genuinely run with nothing else installed.
    conn.execute(
        "INSERT INTO services (project_id, name, command, cwd, env, auto_restart, health_port)
         VALUES (?1, ?2, ?3, '', '{}', 0, ?4)",
        params![
            web,
            "Web Server",
            "powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1",
            DEMO_PORT
        ],
    )
    .map_err(|e| e.to_string())?;
    let web_svc = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO services (project_id, name, command, cwd, env, auto_restart, health_port)
         VALUES (?1, ?2, ?3, '', '{}', 0, NULL)",
        params![
            api,
            "Worker",
            "powershell -NoProfile -ExecutionPolicy Bypass -File worker.ps1"
        ],
    )
    .map_err(|e| e.to_string())?;
    let worker_svc = conn.last_insert_rowid();

    // Commands — instant, obvious, safe.
    for (owner, name, command) in [
        (project, "Say hello", "echo Hello from DevDeck!"),
        (project, "List project files", "dir"),
    ] {
        conn.execute(
            "INSERT INTO commands (project_id, group_name, name, command, cwd, shell)
             VALUES (?1, '', ?2, ?3, '', '')",
            params![owner, name, command],
        )
        .map_err(|e| e.to_string())?;
    }

    // A profile that boots the whole demo stack at once.
    let steps = format!(
        r#"[{{"type":"service","id":{web_svc}}},{{"type":"service","id":{worker_svc}}}]"#
    );
    conn.execute(
        "INSERT INTO profiles (project_id, name, steps) VALUES (?1, ?2, ?3)",
        params![project, "Boot Demo", steps],
    )
    .map_err(|e| e.to_string())?;

    Ok(project)
}
