//! Long-running managed dev services: start / stop / restart, stdout +
//! stderr capture into the central log bus, status events, optional
//! auto-restart, and one-shot background commands.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

use crate::db::{self, Db, ServiceDef};

const LOG_BUFFER_LIMIT: usize = 20_000; // lines kept in memory

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SvcStatus {
    Running,
    Stopped,
    Crashed,
}

#[derive(Serialize, Clone)]
pub struct SvcState {
    /// Persistent service id (services table), or negative for
    /// ephemeral background runs.
    pub id: i64,
    pub name: String,
    pub pid: Option<u32>,
    pub status: SvcStatus,
    pub exit_code: Option<i32>,
    pub started_at: Option<u64>, // unix seconds
    pub ephemeral: bool,
}

pub struct RunningService {
    pub state: SvcState,
    child: Arc<Mutex<Child>>,
    /// User asked to stop; distinguishes Stopped from Crashed.
    pub stopping: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
pub struct ServiceManager {
    pub running: Mutex<HashMap<i64, RunningService>>,
    next_ephemeral: AtomicI64,
    pub logs: Mutex<Vec<LogEntry>>,
}

#[derive(Serialize, Clone)]
pub struct LogEntry {
    pub seq: u64,
    pub ts: u64, // unix millis
    pub service_id: i64,
    pub service: String,
    pub stream: String, // stdout | stderr | system
    pub level: String,  // info | warn | error | debug
    pub line: String,
}

static LOG_SEQ: AtomicI64 = AtomicI64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Heuristic severity from line content + stream.
fn detect_level(stream: &str, line: &str) -> &'static str {
    let l = line.to_ascii_lowercase();
    if l.contains("error") || l.contains("panic") || l.contains("fatal") || l.contains("exception")
    {
        "error"
    } else if l.contains("warn") {
        "warn"
    } else if l.contains("debug") || l.contains("trace") {
        "debug"
    } else if stream == "stderr" {
        "warn"
    } else {
        "info"
    }
}

pub fn push_log(
    app: &tauri::AppHandle,
    service_id: i64,
    service: &str,
    stream: &str,
    line: String,
) {
    let mgr = app.state::<Arc<ServiceManager>>();
    let entry = LogEntry {
        seq: LOG_SEQ.fetch_add(1, Ordering::SeqCst) as u64,
        ts: now_ms(),
        service_id,
        service: service.to_string(),
        stream: stream.to_string(),
        level: detect_level(stream, &line).to_string(),
        line,
    };
    {
        let mut logs = mgr.logs.lock().unwrap();
        logs.push(entry.clone());
        let len = logs.len();
        if len > LOG_BUFFER_LIMIT {
            logs.drain(..len - LOG_BUFFER_LIMIT);
        }
    }
    let _ = app.emit("svc:log", entry);
}

fn emit_status(app: &tauri::AppHandle, state: &SvcState) {
    let _ = app.emit("svc:status", state.clone());
}

/// Spawn `command` through the shell so pipes/&& work like a terminal.
fn spawn_shell(command: &str, cwd: &str, env: &HashMap<String, String>) -> std::io::Result<Child> {
    let mut c = Command::new("cmd.exe");
    if !cwd.trim().is_empty() && std::path::Path::new(cwd).is_dir() {
        c.current_dir(cwd);
    }
    for (k, v) in env {
        c.env(k, v);
    }
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Pass the command line verbatim. Rust's normal arg escaping is
        // built for the MSVCRT convention and mangles embedded quotes
        // that cmd.exe needs literally (e.g. `node -e "..."`), so build
        // the `/C` line ourselves with raw_arg.
        c.raw_arg("/C");
        c.raw_arg(format!("\"{command}\""));
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        c.args(["-c", command]);
    }
    c.spawn()
}

fn start_internal(
    app: &tauri::AppHandle,
    def: &ServiceDef,
    ephemeral: bool,
) -> Result<SvcState, String> {
    let mgr = app.state::<Arc<ServiceManager>>().inner().clone();
    let id = if ephemeral {
        mgr.next_ephemeral.fetch_sub(1, Ordering::SeqCst)
    } else {
        def.id
    };

    // Already running?
    if !ephemeral {
        if let Some(existing) = mgr.running.lock().unwrap().get(&id) {
            if existing.state.status == SvcStatus::Running {
                return Err(format!("{} is already running", def.name));
            }
        }
    }

    let env: HashMap<String, String> = serde_json::from_str(&def.env).unwrap_or_default();
    let mut child = spawn_shell(&def.command, &def.cwd, &env).map_err(|e| e.to_string())?;
    let pid = child.id();

    push_log(
        app,
        id,
        &def.name,
        "system",
        format!("started: {} (pid {})", def.command, pid),
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // stdout / stderr pumps
    for (pipe, stream) in [
        (
            stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            "stdout",
        ),
        (
            stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            "stderr",
        ),
    ] {
        if let Some(pipe) = pipe {
            let app = app.clone();
            let name = def.name.clone();
            let stream = stream.to_string();
            std::thread::spawn(move || {
                let reader = BufReader::new(pipe);
                for line in reader.lines() {
                    match line {
                        Ok(l) => push_log(&app, id, &name, &stream, l),
                        Err(_) => break,
                    }
                }
            });
        }
    }

    let state = SvcState {
        id,
        name: def.name.clone(),
        pid: Some(pid),
        status: SvcStatus::Running,
        exit_code: None,
        started_at: Some(now_ms() / 1000),
        ephemeral,
    };
    emit_status(app, &state);

    let child = Arc::new(Mutex::new(child));
    let stopping = Arc::new(std::sync::atomic::AtomicBool::new(false));
    mgr.running.lock().unwrap().insert(
        id,
        RunningService {
            state: state.clone(),
            child: child.clone(),
            stopping: stopping.clone(),
        },
    );

    // Waiter thread: detect exit, update status, optional auto-restart.
    {
        let app = app.clone();
        let def = def.clone();
        let mgr = mgr.clone();
        std::thread::spawn(move || {
            let code = loop {
                {
                    let mut guard = child.lock().unwrap();
                    match guard.try_wait() {
                        Ok(Some(status)) => break status.code(),
                        Ok(None) => {}
                        Err(_) => break None,
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            };
            let was_stopping = stopping.load(Ordering::SeqCst);
            let status = if was_stopping || code == Some(0) {
                SvcStatus::Stopped
            } else {
                SvcStatus::Crashed
            };
            push_log(
                &app,
                id,
                &def.name,
                "system",
                format!("exited with code {:?}", code),
            );
            let new_state = {
                let mut running = mgr.running.lock().unwrap();
                if let Some(rs) = running.get_mut(&id) {
                    rs.state.status = status.clone();
                    rs.state.exit_code = code;
                    rs.state.pid = None;
                    rs.state.clone()
                } else {
                    return;
                }
            };
            emit_status(&app, &new_state);

            if def.auto_restart
                && !was_stopping
                && status == SvcStatus::Crashed
                && !new_state.ephemeral
            {
                push_log(&app, id, &def.name, "system", "auto-restart in 2s".into());
                std::thread::sleep(std::time::Duration::from_secs(2));
                let _ = start_internal(&app, &def, false);
            }
        });
    }

    Ok(state)
}

/// Load a service and fill in an inherited working directory (from its
/// owning project/folder) when it has none of its own.
fn service_with_dir(conn: &rusqlite::Connection, id: i64) -> Result<ServiceDef, String> {
    let mut def = db::service_get(conn, id)?;
    if def.cwd.trim().is_empty() {
        if let Some(node_id) = def.project_id {
            def.cwd = db::resolve_node_dir(conn, node_id);
        }
    }
    Ok(def)
}

#[tauri::command]
pub fn svc_start(app: tauri::AppHandle, db: tauri::State<Db>, id: i64) -> Result<SvcState, String> {
    let def = {
        let conn = db.0.lock().unwrap();
        let _ = db::recent_bump_conn(&conn, "service", id);
        service_with_dir(&conn, id)?
    };
    start_internal(&app, &def, false)
}

#[tauri::command]
pub fn svc_stop(
    app: tauri::AppHandle,
    mgr: tauri::State<Arc<ServiceManager>>,
    id: i64,
) -> Result<(), String> {
    let (child, name) = {
        let running = mgr.running.lock().unwrap();
        let rs = running.get(&id).ok_or("service not running")?;
        rs.stopping.store(true, Ordering::SeqCst);
        (rs.child.clone(), rs.state.name.clone())
    };
    let pid = { child.lock().unwrap().id() };
    // Kill the whole process tree — dev services spawn children
    // (node, cargo, etc.) that must not be orphaned.
    let mut kill = Command::new("taskkill");
    kill.args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        kill.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = kill.status();
    push_log(&app, id, &name, "system", "stop requested".into());
    Ok(())
}

/// Kill every running service's process tree. Best-effort, used on app
/// quit so dev servers aren't left orphaned holding their ports.
pub fn stop_all_running(mgr: &ServiceManager) {
    let pids: Vec<u32> = {
        let running = mgr.running.lock().unwrap();
        running
            .values()
            .map(|rs| {
                rs.stopping.store(true, Ordering::SeqCst);
                rs.child.lock().unwrap().id()
            })
            .collect()
    };
    for pid in pids {
        let mut kill = Command::new("taskkill");
        kill.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            kill.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let _ = kill.status();
    }
}

#[tauri::command]
pub fn svc_restart(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    mgr: tauri::State<Arc<ServiceManager>>,
    id: i64,
) -> Result<(), String> {
    if mgr
        .running
        .lock()
        .unwrap()
        .get(&id)
        .map(|r| r.state.status == SvcStatus::Running)
        .unwrap_or(false)
    {
        svc_stop(app.clone(), mgr.clone(), id)?;
        // Wait briefly for the exit to be observed.
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(150));
            if mgr
                .running
                .lock()
                .unwrap()
                .get(&id)
                .map(|r| r.state.status != SvcStatus::Running)
                .unwrap_or(true)
            {
                break;
            }
        }
    }
    let def = {
        let conn = db.0.lock().unwrap();
        service_with_dir(&conn, id)?
    };
    start_internal(&app, &def, false)?;
    Ok(())
}

/// Run a one-shot command in the background; output lands in the log viewer.
#[tauri::command]
pub fn run_background(
    app: tauri::AppHandle,
    name: String,
    command: String,
    cwd: String,
) -> Result<SvcState, String> {
    let def = ServiceDef {
        id: 0,
        project_id: None,
        name: if name.trim().is_empty() {
            command.clone()
        } else {
            name
        },
        command,
        cwd,
        env: "{}".into(),
        auto_restart: false,
        health_port: None,
    };
    start_internal(&app, &def, true)
}

#[tauri::command]
pub fn svc_states(mgr: tauri::State<Arc<ServiceManager>>) -> Vec<SvcState> {
    let running = mgr.running.lock().unwrap();
    let mut list: Vec<SvcState> = running.values().map(|r| r.state.clone()).collect();
    list.sort_by_key(|s| s.id);
    list
}

// ---------- logs ----------

#[tauri::command]
pub fn logs_recent(mgr: tauri::State<Arc<ServiceManager>>, limit: Option<usize>) -> Vec<LogEntry> {
    let logs = mgr.logs.lock().unwrap();
    let n = limit.unwrap_or(2000).min(logs.len());
    logs[logs.len() - n..].to_vec()
}

#[tauri::command]
pub fn logs_clear(mgr: tauri::State<Arc<ServiceManager>>) {
    mgr.logs.lock().unwrap().clear();
}

#[tauri::command]
pub fn logs_export(mgr: tauri::State<Arc<ServiceManager>>, path: String) -> Result<usize, String> {
    let logs = mgr.logs.lock().unwrap();
    let mut out = String::new();
    for e in logs.iter() {
        let ts = chrono::DateTime::from_timestamp_millis(e.ts as i64)
            .map(|d| d.format("%Y-%m-%d %H:%M:%S%.3f").to_string())
            .unwrap_or_default();
        out.push_str(&format!(
            "[{}] [{}] [{}] [{}] {}\n",
            ts, e.service, e.stream, e.level, e.line
        ));
    }
    std::fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(logs.len())
}

/// (service_id, name, pid) of running services, for the monitor.
pub fn live_pids(mgr: &ServiceManager) -> Vec<(i64, String, u32)> {
    mgr.running
        .lock()
        .unwrap()
        .values()
        .filter(|r| r.state.status == SvcStatus::Running)
        .filter_map(|r| r.state.pid.map(|p| (r.state.id, r.state.name.clone(), p)))
        .collect()
}
