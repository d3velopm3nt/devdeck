//! DevDeck backend: modular, event-driven, entirely local.
//!
//! Modules own one concern each and communicate with the frontend via
//! typed Tauri commands (request/response) and events (push):
//!   db       — SQLite hierarchy/commands/services/profiles/layouts/settings
//!   pty      — interactive terminal sessions (ConPTY)
//!   services — managed long-running processes + central log bus
//!   monitor  — process stats feed (CPU/mem/uptime/ports)
//!   legacy   — one-time import of term-widget config
//!
//! New capability areas (git, docker, ssh, plugins…) slot in as new
//! modules with their own commands/events without touching existing ones.

mod db;
mod legacy;
mod monitor;
mod pty;
mod services;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[tauri::command]
fn hotkey_apply(app: tauri::AppHandle, spec: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if spec.trim().is_empty() {
        return Ok(());
    }
    gs.on_shortcut(spec.as_str(), |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(win) = app.get_webview_window("main") {
                let visible = win.is_visible().unwrap_or(false);
                let minimized = win.is_minimized().unwrap_or(false);
                if visible && !minimized {
                    let _ = win.hide();
                } else {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        }
    })
    .map_err(|e| e.to_string())
}

/// Open a folder in the system file manager.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("This project has no folder path".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let conn = db::open();
            legacy::import_if_needed(&conn);

            // Re-register the saved global hotkey on startup.
            let hotkey = db::setting_get_conn(&conn, "hotkey")
                .ok()
                .flatten()
                .unwrap_or_else(|| "ctrl+shift+Space".into());

            app.manage(db::Db(Mutex::new(conn)));
            app.manage(Arc::new(pty::PtyManager::default()));
            app.manage(Arc::new(services::ServiceManager::default()));

            monitor::spawn(app.handle().clone());

            let handle = app.handle().clone();
            // Map legacy "ctrl+shift+Space" spec to the plugin's format.
            let spec = hotkey.replace(' ', "");
            let _ = hotkey_apply(handle, spec);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hotkey_apply,
            reveal_in_explorer,
            legacy::shells_detect,
            db::tree_list,
            db::node_create,
            db::node_rename,
            db::node_update,
            db::node_delete,
            db::commands_list,
            db::command_save,
            db::command_delete,
            db::services_list,
            db::service_save,
            db::service_delete,
            db::profiles_list,
            db::profile_save,
            db::profile_delete,
            db::layouts_list,
            db::layout_save,
            db::layout_delete,
            db::setting_get,
            db::setting_set,
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_scrollback,
            pty::pty_list,
            services::svc_start,
            services::svc_stop,
            services::svc_restart,
            services::run_background,
            services::svc_states,
            services::logs_recent,
            services::logs_clear,
            services::logs_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevDeck");
}
