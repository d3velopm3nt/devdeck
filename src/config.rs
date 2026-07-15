//! Settings schema — designed first, everything else hangs off this.
//!
//! Persisted as JSON at `%APPDATA%\term-widget\settings.json`.
//! Every field has a serde default so old config files keep loading
//! as the schema grows.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// One launchable terminal definition.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TerminalDef {
    pub name: String,
    /// Executable path or name resolvable via PATH.
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Optional working directory ("" = inherit). `~` expands to the home dir.
    #[serde(default)]
    pub working_dir: String,
    /// True for console-subsystem apps (cmd, powershell, wsl) that need
    /// CREATE_NEW_CONSOLE to get their own window. False for GUI wrappers
    /// (git-bash.exe, wt.exe) that create their own window.
    #[serde(default = "default_true")]
    pub new_console: bool,
    /// Accent tint for the list icon, RGB.
    #[serde(default = "default_tint")]
    pub tint: [u8; 3],
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Settings {
    /// Global show/hide hotkey, e.g. "ctrl+shift+Space", "alt+F9".
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    /// Start minimized to background; summon with the hotkey.
    #[serde(default)]
    pub start_hidden: bool,
    /// Hide the widget right after launching a terminal (quake-style).
    /// Off by default: vanishing on click reads as a crash.
    #[serde(default)]
    pub hide_on_launch: bool,
    #[serde(default)]
    pub terminals: Vec<TerminalDef>,
}

fn default_true() -> bool {
    true
}
fn default_hotkey() -> String {
    "ctrl+shift+Space".into()
}
fn default_tint() -> [u8; 3] {
    [139, 148, 166]
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            always_on_top: true,
            start_hidden: false,
            hide_on_launch: false,
            terminals: detect_terminals(),
        }
    }
}

impl Settings {
    pub fn path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("term-widget")
            .join("settings.json")
    }

    pub fn load() -> Self {
        match std::fs::read_to_string(Self::path()) {
            // Tolerate a UTF-8 BOM: PowerShell and some editors prepend
            // one, and serde_json rejects it.
            Ok(text) => serde_json::from_str(text.trim_start_matches('\u{feff}'))
                .unwrap_or_default(),
            Err(_) => {
                let s = Self::default();
                let _ = s.save();
                s
            }
        }
    }

    pub fn save(&self) -> std::io::Result<()> {
        let path = Self::path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap())
    }
}

/// Derive a display name from an executable path ("git-bash.exe" → "git-bash").
pub fn name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Expand `~` and `%VAR%`-free simple paths.
pub fn expand_dir(dir: &str) -> String {
    let dir = dir.trim();
    if let Some(rest) = dir.strip_prefix('~') {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), rest);
        }
    }
    dir.to_string()
}

fn which(exe: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Detect terminals installed on this machine and build sensible defaults.
pub fn detect_terminals() -> Vec<TerminalDef> {
    let mut out = Vec::new();
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();

    // PowerShell 7+
    let pwsh = PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe");
    if pwsh.is_file() || which("pwsh.exe").is_some() {
        let cmd = if pwsh.is_file() { pwsh.display().to_string() } else { "pwsh.exe".into() };
        out.push(TerminalDef {
            name: "PowerShell 7".into(),
            command: cmd,
            args: vec!["-NoLogo".into()],
            working_dir: "~".into(),
            new_console: true,
            tint: [90, 169, 255],
        });
    }

    // Windows PowerShell (always present)
    out.push(TerminalDef {
        name: "Windows PowerShell".into(),
        command: format!(r"{sys_root}\System32\WindowsPowerShell\v1.0\powershell.exe"),
        args: vec!["-NoLogo".into()],
        working_dir: "~".into(),
        new_console: true,
        tint: [61, 121, 217],
    });

    // Command Prompt (always present)
    out.push(TerminalDef {
        name: "Command Prompt".into(),
        command: format!(r"{sys_root}\System32\cmd.exe"),
        args: vec![],
        working_dir: "~".into(),
        new_console: true,
        tint: [160, 168, 184],
    });

    // Windows Terminal
    let wt = PathBuf::from(&local_app).join(r"Microsoft\WindowsApps\wt.exe");
    if !local_app.is_empty() && wt.is_file() {
        out.push(TerminalDef {
            name: "Windows Terminal".into(),
            command: wt.display().to_string(),
            args: vec![],
            working_dir: "".into(),
            new_console: false,
            tint: [76, 201, 240],
        });
    }

    // Git Bash
    for candidate in [
        r"C:\Program Files\Git\git-bash.exe",
        r"C:\Program Files (x86)\Git\git-bash.exe",
    ] {
        if PathBuf::from(candidate).is_file() {
            out.push(TerminalDef {
                name: "Git Bash".into(),
                command: candidate.into(),
                args: vec![],
                working_dir: "~".into(),
                new_console: false,
                tint: [240, 128, 90],
            });
            break;
        }
    }

    // WSL
    let wsl = PathBuf::from(&sys_root).join(r"System32\wsl.exe");
    if wsl.is_file() {
        out.push(TerminalDef {
            name: "WSL".into(),
            command: wsl.display().to_string(),
            args: vec![],
            working_dir: "".into(),
            new_console: true,
            tint: [120, 220, 130],
        });
    }

    out
}
