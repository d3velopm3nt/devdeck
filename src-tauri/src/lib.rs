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
mod seed;
mod services;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Show + focus the quick-access widget window (positioning it near the
/// top-right of the primary monitor the first time).
fn show_widget(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("widget") {
        // Park it near the top-right on show if it's off-screen/unset.
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size().to_logical::<f64>(scale);
            if let Ok(w) = win.outer_size().map(|s| s.to_logical::<f64>(scale)) {
                let x = (size.width - w.width - 24.0).max(0.0);
                let _ = win.set_position(tauri::LogicalPosition::new(x, 48.0));
            }
        }
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn toggle_widget(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("widget") {
        let visible = win.is_visible().unwrap_or(false);
        let minimized = win.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = win.hide();
        } else {
            show_widget(app);
        }
    }
}

#[tauri::command]
fn widget_toggle(app: tauri::AppHandle) {
    toggle_widget(&app);
}

#[tauri::command]
fn widget_show(app: tauri::AppHandle) {
    show_widget(&app);
}

#[tauri::command]
fn widget_hide(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("widget") {
        let _ = win.hide();
    }
}

/// Bring the main IDE window to the front (used when the widget opens a
/// terminal, which renders in the main window's dock).
#[tauri::command]
fn focus_main(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Resize the widget window (used by collapse-to-launcher and density).
#[tauri::command]
fn widget_resize(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(win) = app.get_webview_window("widget") {
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
    }
}

#[tauri::command]
fn hotkey_apply(app: tauri::AppHandle, spec: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if spec.trim().is_empty() {
        return Ok(());
    }
    // The global shortcut summons the quick-access widget.
    gs.on_shortcut(spec.as_str(), |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle_widget(app);
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

/// Open a URL in the system default browser (e.g. a service's localhost).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) URLs can be opened".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer.exe hands http(s) URLs to the default browser.
        std::process::Command::new("explorer.exe")
            .arg(url)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
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
            widget_toggle,
            widget_show,
            widget_hide,
            widget_resize,
            focus_main,
            reveal_in_explorer,
            open_url,
            seed::seed_example,
            seed::example_exists,
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
            db::recent_bump,
            db::recents_list,
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
