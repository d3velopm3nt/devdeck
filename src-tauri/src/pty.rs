//! Interactive terminal sessions backed by the native PTY (ConPTY on
//! Windows). Sessions live in the backend independent of the UI, so
//! they persist across frontend reloads; scrollback is kept here and
//! replayed when a terminal view re-attaches.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

const SCROLLBACK_LIMIT: usize = 400_000; // bytes per session

pub struct PtySession {
    pub id: u64,
    pub title: String,
    pub shell: String,
    pub cwd: String,
    pub pid: Option<u32>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    scrollback: Arc<Mutex<Vec<u8>>>,
    pub alive: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<u64, PtySession>>,
    next_id: AtomicU64,
}

#[derive(Serialize, Clone)]
pub struct PtyInfo {
    pub id: u64,
    pub title: String,
    pub shell: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub alive: bool,
}

#[derive(Serialize, Clone)]
struct PtyOutput<'a> {
    id: u64,
    data: &'a str,
}

#[derive(Serialize, Clone)]
struct PtyExit {
    id: u64,
}

#[tauri::command]
pub fn pty_create(
    app: tauri::AppHandle,
    ptys: tauri::State<Arc<PtyManager>>,
    shell: String,
    cwd: Option<String>,
    title: Option<String>,
) -> Result<PtyInfo, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell);
    let cwd_str = cwd.clone().unwrap_or_default();
    if !cwd_str.trim().is_empty() && std::path::Path::new(&cwd_str).is_dir() {
        cmd.cwd(&cwd_str);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let pid = child.process_id();
    let killer = child.clone_killer();

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = ptys.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let scrollback: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));

    // Reader pump: PTY bytes → scrollback + frontend event.
    {
        let app = app.clone();
        let scrollback = scrollback.clone();
        let alive = alive.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        {
                            let mut sb = scrollback.lock().unwrap();
                            sb.extend_from_slice(&buf[..n]);
                            let len = sb.len();
                            if len > SCROLLBACK_LIMIT {
                                sb.drain(..len - SCROLLBACK_LIMIT);
                            }
                        }
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit("pty:output", PtyOutput { id, data: &text });
                    }
                }
            }
            alive.store(false, Ordering::SeqCst);
            let _ = app.emit("pty:exit", PtyExit { id });
        });
    }

    let title = title.unwrap_or_else(|| {
        std::path::Path::new(&shell)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| shell.clone())
    });

    let info = PtyInfo {
        id,
        title: title.clone(),
        shell: shell.clone(),
        cwd: cwd_str.clone(),
        pid,
        alive: true,
    };

    ptys.sessions.lock().unwrap().insert(
        id,
        PtySession {
            id,
            title,
            shell,
            cwd: cwd_str,
            pid,
            master: pair.master,
            writer,
            killer,
            scrollback,
            alive,
        },
    );

    Ok(info)
}

#[tauri::command]
pub fn pty_write(ptys: tauri::State<Arc<PtyManager>>, id: u64, data: String) -> Result<(), String> {
    let mut sessions = ptys.sessions.lock().unwrap();
    let s = sessions.get_mut(&id).ok_or("no such terminal")?;
    s.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    ptys: tauri::State<Arc<PtyManager>>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = ptys.sessions.lock().unwrap();
    let s = sessions.get(&id).ok_or("no such terminal")?;
    s.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(ptys: tauri::State<Arc<PtyManager>>, id: u64) -> Result<(), String> {
    let mut sessions = ptys.sessions.lock().unwrap();
    if let Some(mut s) = sessions.remove(&id) {
        let _ = s.killer.kill();
    }
    Ok(())
}

/// Replayed scrollback for re-attaching a terminal view to a live session.
#[tauri::command]
pub fn pty_scrollback(ptys: tauri::State<Arc<PtyManager>>, id: u64) -> Result<String, String> {
    let sessions = ptys.sessions.lock().unwrap();
    let s = sessions.get(&id).ok_or("no such terminal")?;
    let sb = s.scrollback.lock().unwrap();
    Ok(String::from_utf8_lossy(&sb).to_string())
}

#[tauri::command]
pub fn pty_list(ptys: tauri::State<Arc<PtyManager>>) -> Vec<PtyInfo> {
    let sessions = ptys.sessions.lock().unwrap();
    let mut list: Vec<PtyInfo> = sessions
        .values()
        .map(|s| PtyInfo {
            id: s.id,
            title: s.title.clone(),
            shell: s.shell.clone(),
            cwd: s.cwd.clone(),
            pid: s.pid,
            alive: s.alive.load(Ordering::SeqCst),
        })
        .collect();
    list.sort_by_key(|s| s.id);
    list
}

/// Pids of all live PTY shells, for the process monitor.
pub fn live_pids(ptys: &PtyManager) -> Vec<(u64, u32)> {
    ptys.sessions
        .lock()
        .unwrap()
        .values()
        .filter(|s| s.alive.load(Ordering::SeqCst))
        .filter_map(|s| s.pid.map(|p| (s.id, p)))
        .collect()
}
