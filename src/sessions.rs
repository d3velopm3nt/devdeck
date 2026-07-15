//! Session tracking: terminals spawned by the widget and their live state.

use std::process::{Child, Command};
use std::time::Instant;

use crate::config::{expand_dir, name_from_path, TerminalDef};

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

#[derive(Clone, Copy, PartialEq)]
pub enum SessionState {
    Running,
    Exited(Option<i32>),
}

pub struct Session {
    pub id: u64,
    pub name: String,
    pub tint: [u8; 3],
    pub pid: u32,
    pub started: Instant,
    pub state: SessionState,
    /// What was actually launched — kept so an ad-hoc run can be saved
    /// as a template later.
    pub command: String,
    pub args: Vec<String>,
    /// True for quick-run sessions not (yet) saved as a terminal template.
    pub adhoc: bool,
    child: Child,
}

impl Session {
    pub fn uptime_label(&self) -> String {
        let secs = self.started.elapsed().as_secs();
        let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
        if h > 0 {
            format!("{h}:{m:02}:{s:02}")
        } else {
            format!("{m}:{s:02}")
        }
    }
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Vec<Session>,
    next_id: u64,
}

impl SessionManager {
    pub fn launch(&mut self, def: &TerminalDef) -> Result<(), String> {
        self.launch_inner(def, false)
    }

    /// Quick-run: first token is the program, the rest are args.
    pub fn launch_adhoc(&mut self, input: &str) -> Result<(), String> {
        let mut tokens = input.split_whitespace();
        let command = tokens
            .next()
            .ok_or_else(|| "Nothing to run".to_string())?
            .to_string();
        let def = TerminalDef {
            name: name_from_path(&command),
            args: tokens.map(String::from).collect(),
            command,
            working_dir: String::new(),
            new_console: true,
            tint: [139, 124, 255],
        };
        self.launch_inner(&def, true)
    }

    fn launch_inner(&mut self, def: &TerminalDef, adhoc: bool) -> Result<(), String> {
        let mut cmd = Command::new(def.command.trim());
        for arg in &def.args {
            cmd.arg(arg);
        }
        let dir = expand_dir(&def.working_dir);
        if !dir.is_empty() {
            if std::path::Path::new(&dir).is_dir() {
                cmd.current_dir(&dir);
            } else {
                return Err(format!("Working dir not found: {dir}"));
            }
        }
        #[cfg(windows)]
        if def.new_console {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NEW_CONSOLE);
        }
        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start {}: {e}", def.name))?;
        self.next_id += 1;
        self.sessions.push(Session {
            id: self.next_id,
            name: def.name.clone(),
            tint: def.tint,
            pid: child.id(),
            started: Instant::now(),
            state: SessionState::Running,
            command: def.command.trim().to_string(),
            args: def.args.clone(),
            adhoc,
            child,
        });
        Ok(())
    }

    pub fn get(&self, id: u64) -> Option<&Session> {
        self.sessions.iter().find(|s| s.id == id)
    }

    /// The ad-hoc run was saved as a template; drop the save affordance.
    pub fn mark_saved(&mut self, id: u64) {
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == id) {
            s.adhoc = false;
        }
    }

    /// Refresh exit states. Cheap; called every frame.
    pub fn poll(&mut self) {
        for s in &mut self.sessions {
            if s.state == SessionState::Running {
                if let Ok(Some(status)) = s.child.try_wait() {
                    s.state = SessionState::Exited(status.code());
                }
            }
        }
    }

    pub fn kill(&mut self, id: u64) {
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == id) {
            let _ = s.child.kill();
            let _ = s.child.wait();
            s.state = SessionState::Exited(None);
        }
    }

    pub fn remove(&mut self, id: u64) {
        self.sessions.retain(|s| s.id != id);
    }

    pub fn clear_finished(&mut self) {
        self.sessions
            .retain(|s| matches!(s.state, SessionState::Running));
    }

    pub fn iter(&self) -> impl Iterator<Item = &Session> {
        self.sessions.iter()
    }

    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    pub fn running_count(&self) -> usize {
        self.sessions
            .iter()
            .filter(|s| s.state == SessionState::Running)
            .count()
    }

    pub fn any_finished(&self) -> bool {
        self.sessions
            .iter()
            .any(|s| matches!(s.state, SessionState::Exited(_)))
    }
}
