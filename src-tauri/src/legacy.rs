//! One-time import of the original term-widget launcher configuration
//! (%APPDATA%\term-widget\settings.json) so existing commands and the
//! global hotkey carry over into DevDeck.

use rusqlite::{params, Connection};
use serde::Deserialize;

#[derive(Deserialize)]
struct LegacyTerminal {
    name: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    working_dir: String,
}

#[derive(Deserialize)]
struct LegacySettings {
    #[serde(default)]
    hotkey: String,
    #[serde(default)]
    terminals: Vec<LegacyTerminal>,
}

pub fn import_if_needed(conn: &Connection) {
    let done = crate::db::setting_get_conn(conn, "legacy_imported")
        .ok()
        .flatten()
        .is_some();
    if done {
        return;
    }

    let path = dirs::config_dir()
        .unwrap_or_default()
        .join("term-widget")
        .join("settings.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(legacy) =
            serde_json::from_str::<LegacySettings>(text.trim_start_matches('\u{feff}'))
        {
            for t in &legacy.terminals {
                let cmd = if t.args.is_empty() {
                    format!("\"{}\"", t.command)
                } else {
                    format!("\"{}\" {}", t.command, t.args.join(" "))
                };
                let cwd = if t.working_dir == "~" {
                    dirs::home_dir()
                        .map(|h| h.display().to_string())
                        .unwrap_or_default()
                } else {
                    t.working_dir.clone()
                };
                let _ = conn.execute(
                    "INSERT INTO commands (project_id, group_name, name, command, cwd, shell)
                     VALUES (NULL, 'Imported', ?1, ?2, ?3, '')",
                    params![t.name, cmd, cwd],
                );
            }
            if !legacy.hotkey.is_empty() {
                let _ = crate::db::setting_set_conn(conn, "hotkey", &legacy.hotkey);
            }
        }
    }
    let _ = crate::db::setting_set_conn(conn, "legacy_imported", "1");
}

/// Shells available on this machine, used for the "new terminal" menu.
#[derive(serde::Serialize, Clone)]
pub struct ShellDef {
    pub name: String,
    pub command: String,
}

#[tauri::command]
pub fn shells_detect() -> Vec<ShellDef> {
    let mut out = Vec::new();
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());

    let pwsh = r"C:\Program Files\PowerShell\7\pwsh.exe";
    if std::path::Path::new(pwsh).is_file() {
        out.push(ShellDef {
            name: "PowerShell 7".into(),
            command: pwsh.into(),
        });
    }
    out.push(ShellDef {
        name: "PowerShell".into(),
        command: format!(r"{sys_root}\System32\WindowsPowerShell\v1.0\powershell.exe"),
    });
    out.push(ShellDef {
        name: "CMD".into(),
        command: format!(r"{sys_root}\System32\cmd.exe"),
    });
    for candidate in [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ] {
        if std::path::Path::new(candidate).is_file() {
            out.push(ShellDef {
                name: "Git Bash".into(),
                command: candidate.into(),
            });
            break;
        }
    }
    let wsl = format!(r"{sys_root}\System32\wsl.exe");
    if std::path::Path::new(&wsl).is_file() {
        out.push(ShellDef {
            name: "WSL".into(),
            command: wsl,
        });
    }
    out
}
