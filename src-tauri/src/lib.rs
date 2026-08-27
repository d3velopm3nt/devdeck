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

mod activity;
mod conn;
mod creds;
mod db;
mod git;
mod legacy;
mod machine;
mod monitor;
mod pty;
mod scan;
mod seed;
mod services;
mod setup;
mod shots;
mod stash;

use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Show + focus the quick-access widget window (positioning it near the
/// top-right of the primary monitor the first time).
fn show_widget(app: &tauri::AppHandle) {
    // Snapshot where the keyboard was *before* we take it, so ⇧⏎ in the
    // widget can paste back into that window. Must happen first: once our
    // window is up, the app you came from is no longer the foreground one.
    stash::remember_target();
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

/// Bring the widget into view *without* taking the keyboard, and hide it
/// again after a moment. Something you started elsewhere shouldn't yank focus
/// out of whatever you're typing in — that's the whole point of a peek.
///
/// A crash always peeks; a healthy start peeks only until it looks fine.
pub(crate) fn widget_peek(app: &tauri::AppHandle, sticky: bool) {
    let Some(win) = app.get_webview_window("widget") else {
        return;
    };
    // Already up and being used — leave it alone rather than resize or
    // re-place a window you're mid-interaction with.
    if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false) {
        return;
    }
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        if let Ok(w) = win.outer_size().map(|s| s.to_logical::<f64>(scale)) {
            let x = (size.width - w.width - 24.0).max(0.0);
            let _ = win.set_position(tauri::LogicalPosition::new(x, 48.0));
        }
    }
    stash::show_window_without_focus(&win);

    if sticky {
        return;
    }
    // Auto-collapse: a healthy start is worth a glance, not a window that
    // stays in your way. A crash passes sticky = true and stays put.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(6));
        if let Some(win) = app.get_webview_window("widget") {
            // Don't snatch it away if you started interacting with it.
            if !win.is_focused().unwrap_or(false) {
                stash::hide_window(&win);
            }
        }
    });
}

#[tauri::command]
fn widget_peek_cmd(app: tauri::AppHandle, sticky: bool) {
    widget_peek(&app, sticky);
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

/// Park the capture toast just above the tray, at the bottom-right of the
/// primary monitor, and show it *without* stealing focus — it appears while
/// you're typing in another app.
#[tauri::command]
fn toast_show(app: tauri::AppHandle, width: f64, height: f64) {
    place_and_show_toast(&app, width, height);
}

/// The toast's default size. Kept next to the placement so the Rust side can
/// raise the window itself on capture rather than waiting for the hidden
/// webview to ask -- a window that only appears once its JS happens to be
/// subscribed is a toast you can't rely on.
pub(crate) const TOAST_SIZE: (f64, f64) = (340.0, 92.0);

pub(crate) fn place_and_show_toast(app: &tauri::AppHandle, width: f64, height: f64) {
    let Some(win) = app.get_webview_window("toast") else {
        return;
    };
    let _ = win.set_size(tauri::LogicalSize::new(width, height));
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let x = (size.width - width - 18.0).max(0.0);
        // 64px clears a standard taskbar without needing the work-area rect.
        let y = (size.height - height - 64.0).max(0.0);
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
    stash::show_window_without_focus(&win);
}

#[tauri::command]
fn toast_hide(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("toast") {
        stash::hide_window(&win);
    }
}

/// Take focus — only once you've clicked into the toast to configure a clip,
/// which is the one moment you do want it focused.
#[tauri::command]
fn toast_focus(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("toast") {
        let _ = win.set_focus();
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

// ---- self-update ----

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    via_scoop: bool,
    scoop_available: bool,
    /// True only when we actually read a version from the manifest. A failed
    /// check (offline, DNS, timeout, 404) must NOT be reported as "up to
    /// date" — the UI shows "couldn't check" instead.
    ok: bool,
}

fn scoop_present() -> bool {
    dirs::home_dir()
        .map(|h| {
            let shims = h.join("scoop").join("shims");
            shims.join("scoop.cmd").exists() || shims.join("scoop.ps1").exists()
        })
        .unwrap_or(false)
}

fn ps_capture(script: &str) -> Option<String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// True when a > b, comparing dot-separated numeric version parts.
fn ver_gt(a: &str, b: &str) -> bool {
    let pa: Vec<u32> = a.split('.').filter_map(|x| x.trim().parse().ok()).collect();
    let pb: Vec<u32> = b.split('.').filter_map(|x| x.trim().parse().ok()).collect();
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (
            pa.get(i).copied().unwrap_or(0),
            pb.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x > y;
        }
    }
    false
}

fn devdeck_via_scoop() -> bool {
    dirs::home_dir()
        .map(|h| h.join("scoop").join("apps").join("devdeck").exists())
        .unwrap_or(false)
}

/// Check for the latest release and compare to the running version. Reads the
/// updater manifest (latest.json) from the release download URL — a plain CDN
/// URL that isn't subject to GitHub's REST API rate limit — rather than the API.
#[tauri::command]
fn app_update_info() -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let latest = ps_capture(
        "(Invoke-RestMethod -Uri 'https://github.com/d3velopm3nt/devdeck/releases/latest/download/latest.json' -Headers @{'User-Agent'='devdeck'} -TimeoutSec 10).version",
    )
    .map(|s| s.trim().trim_start_matches('v').trim().to_string())
    .unwrap_or_default();
    // A version string is the only proof the check actually reached the
    // manifest; anything else (offline, timeout, 404, garbage) is "unknown".
    let ok = latest.chars().next().is_some_and(|c| c.is_ascii_digit());
    let available = ok && ver_gt(&latest, &current);
    UpdateInfo {
        current,
        latest,
        available,
        via_scoop: devdeck_via_scoop(),
        scoop_available: scoop_present(),
        ok,
    }
}

/// Log id the update bar listens on (see UpdateBar/App.tsx).
const UPDATE_LOG_ID: i64 = -200_000;

/// Run a child process, streaming both pipes to the update log. Returns
/// whether it exited successfully.
fn stream_update_cmd(app: &tauri::AppHandle, mut cmd: std::process::Command) -> bool {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match cmd.spawn() {
        Ok(mut child) => {
            // stderr on its own thread so a chatty pipe can't deadlock the other.
            let err_thread = child.stderr.take().map(|e| {
                let app = app.clone();
                std::thread::spawn(move || {
                    for l in BufReader::new(e).lines().map_while(Result::ok) {
                        if !l.trim().is_empty() {
                            services::push_log(&app, UPDATE_LOG_ID, "devdeck update", "stderr", l);
                        }
                    }
                })
            });
            if let Some(out) = child.stdout.take() {
                for l in BufReader::new(out).lines().map_while(Result::ok) {
                    if !l.trim().is_empty() {
                        services::push_log(app, UPDATE_LOG_ID, "devdeck update", "stdout", l);
                    }
                }
            }
            let ok = child.wait().map(|s| s.success()).unwrap_or(false);
            if let Some(t) = err_thread {
                let _ = t.join();
            }
            ok
        }
        Err(e) => {
            services::push_log(
                &app.clone(),
                UPDATE_LOG_ID,
                "devdeck update",
                "stderr",
                format!("failed to launch: {e}"),
            );
            false
        }
    }
}

/// Download the latest release installer and run it silently. This is the
/// path for every install that scoop doesn't manage -- the NSIS installer is
/// per-user and needs no admin, so DevDeck can update itself in place rather
/// than sending you to a browser to do it by hand.
fn update_via_installer(app: tauri::AppHandle) {
    let script = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $h = @{ 'User-Agent' = 'devdeck' }
  $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/d3velopm3nt/devdeck/releases/latest' -Headers $h -TimeoutSec 20
  $asset = $rel.assets | Where-Object { $_.name -like '*-setup.exe' } | Select-Object -First 1
  if (-not $asset) { throw "the $($rel.tag_name) release has no installer asset" }
  $dst = Join-Path $env:TEMP $asset.name
  Write-Output "downloading $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB) ..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dst -Headers $h -TimeoutSec 600
  Write-Output 'running the installer (per-user, silent, no admin) ...'
  $p = Start-Process -FilePath $dst -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "the installer exited with code $($p.ExitCode)" }
  Remove-Item $dst -ErrorAction SilentlyContinue
  Write-Output 'update finished - restart DevDeck to apply.'
} catch {
  Write-Output "update failed: $_"
  exit 1
}
"#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    no_update_window(&mut cmd);
    // The script reports its own outcome (the UI keys off "finished"/"failed"),
    // so only add a line when it died without saying anything.
    if !stream_update_cmd(&app, cmd) {
        services::push_log(
            &app,
            UPDATE_LOG_ID,
            "devdeck update",
            "system",
            "update failed - see log above.".into(),
        );
    }
}

/// Update via scoop, which owns the install when DevDeck came from the bucket.
fn update_via_scoop(app: tauri::AppHandle) {
    services::push_log(
        &app,
        UPDATE_LOG_ID,
        "devdeck update",
        "system",
        "running: scoop update devdeck".into(),
    );
    let mut cmd = std::process::Command::new("cmd");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg("/C");
        cmd.raw_arg("\"scoop update devdeck\"");
    }
    no_update_window(&mut cmd);
    let ok = stream_update_cmd(&app, cmd);
    services::push_log(
        &app,
        UPDATE_LOG_ID,
        "devdeck update",
        "system",
        if ok {
            "update finished - restart DevDeck to apply.".into()
        } else {
            "update failed - see log above.".to_string()
        },
    );
}

fn no_update_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Update DevDeck in place: `scoop update` when scoop owns the install,
/// otherwise download the latest release installer and run it silently.
/// Both paths stream to the log bus so the update bar can show progress.
#[tauri::command]
fn app_update(app: tauri::AppHandle) -> Result<(), String> {
    let via_scoop = devdeck_via_scoop();
    std::thread::spawn(move || {
        if via_scoop {
            update_via_scoop(app);
        } else {
            update_via_installer(app);
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Open SQLite and read the startup settings *before* building the app, so
    // every piece of state can be handed to `Builder::manage` instead of to
    // `setup`.
    //
    // This ordering is load-bearing, not tidiness. Tauri's own setup creates
    // each configured window -- and its webview -- BEFORE it calls ours
    // (tauri::app::setup → WebviewWindowBuilder::from_config → then the user
    // hook), and wry pumps the Windows message loop while every WebView2
    // controller is created (webview2_com::wait_with_pump runs a full
    // GetMessage/DispatchMessage loop). So while the widget and toast webviews
    // are being built, the main window's very first `invoke` can already be
    // dispatched into the backend -- with our setup hook not yet run.
    //
    // Anything managed inside that hook does not exist yet at that moment, and
    // Tauri answers `tree_list` / `commands_list` / `pty_list` / ... with
    // "state not managed". The frontend's startup load then fails and DevDeck
    // paints an empty deck over a database that still holds every workspace.
    // The window is widest on the first launch after an upgrade: the binary is
    // cold, the WAL left by the killed old process has to be replayed, and the
    // schema migrations below run for real.
    //
    // State registered on the builder is in the AppManager before any window
    // exists (tauri::app::Builder::build passes `self.state` into
    // AppManager::with_handlers), which closes the race outright.
    let conn = db::open();
    legacy::import_if_needed(&conn);

    // Re-register the saved global hotkey on startup.
    let hotkey = db::setting_get_conn(&conn, "hotkey")
        .ok()
        .flatten()
        .unwrap_or_else(|| "ctrl+shift+Space".into());

    // First run (no completed tour) → show the widget with its guided
    // setup tour.
    let first_run = db::setting_get_conn(&conn, "widget_tour_done")
        .ok()
        .flatten()
        .is_none();

    // Stash: capture and the capture toast are on unless turned off;
    // auto-paste is off until you opt in.
    let flag = |key: &str, default: bool| {
        db::setting_get_conn(&conn, key)
            .ok()
            .flatten()
            .map(|v| v != "0")
            .unwrap_or(default)
    };
    let stash_on = flag("stash_capture", true);
    let stash_toast = flag("stash_toast", true);
    let stash_auto_paste = flag("stash_auto_paste", false);
    let stash_retention = db::setting_get_conn(&conn, "stash_retention_days")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(stash::DEFAULT_RETENTION_DAYS);

    let stash_state = Arc::new(stash::StashState::default());
    {
        use std::sync::atomic::Ordering::Relaxed;
        stash_state.enabled.store(stash_on, Relaxed);
        stash_state.toast.store(stash_toast, Relaxed);
        stash_state.auto_paste.store(stash_auto_paste, Relaxed);
        stash_state.retention_days.store(stash_retention, Relaxed);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Managed here, not in `setup` — see the note at the top of `run`.
        .manage(db::Db(Mutex::new(conn)))
        .manage(Arc::new(pty::PtyManager::default()))
        .manage(Arc::new(services::ServiceManager::default()))
        .manage(stash_state)
        .setup(move |app| {
            monitor::spawn(app.handle().clone());
            stash::spawn(app.handle().clone());
            shots::spawn(app.handle().clone());

            // Apply retention once on launch, so an app that's been closed for
            // a month still tidies up the moment it opens -- and re-check
            // stored screenshot text against the image guardrail, which
            // shipped after the OCR that filled those rows.
            if let Some(db) = app.try_state::<db::Db>() {
                if let Ok(conn) = db.0.lock() {
                    let _ = stash::prune(&conn, stash_retention);
                    match stash::redact_stored_ocr(&conn) {
                        Ok(n) if n > 0 => services::push_log(
                            app.handle(),
                            -500_000,
                            "stash",
                            "system",
                            format!("redacted text read out of {n} screenshot(s) that may show credentials"),
                        ),
                        _ => {}
                    }
                }
            }

            let handle = app.handle().clone();
            // Map legacy "ctrl+shift+Space" spec to the plugin's format.
            let spec = hotkey.replace(' ', "");
            let _ = hotkey_apply(handle, spec);

            // System tray. Closing the window hides DevDeck to the tray (so
            // managed services keep running under supervision); the app only
            // really exits via "Quit DevDeck" here, which first stops every
            // running service so none are left orphaned.
            let open_i = MenuItem::with_id(app, "tray_open", "Open DevDeck", true, None::<&str>)?;
            let widget_i =
                MenuItem::with_id(app, "tray_widget", "Show / hide widget", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "tray_quit", "Quit DevDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &widget_i, &sep, &quit_i])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| "no default window icon".to_string())?;
            TrayIconBuilder::with_id("devdeck-tray")
                .icon(icon)
                .tooltip("DevDeck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_open" => focus_main(app.clone()),
                    "tray_widget" => toggle_widget(app),
                    "tray_quit" => {
                        if let Some(mgr) = app.try_state::<Arc<services::ServiceManager>>() {
                            services::stop_all_running(&mgr);
                        }
                        // app.exit does not drop managed state, so the SQLite
                        // connection never gets its close-time checkpoint.
                        // Fold the WAL into devdeck.sqlite ourselves first.
                        db::checkpoint_state(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click restores the main window.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main(tray.app_handle().clone());
                    }
                })
                .build(app)?;

            if first_run {
                show_widget(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept the main window's close: hide to tray instead of
            // exiting, so services and terminals keep running.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    // Closing to the tray is the usual "I'm done" moment, and
                    // the app may be killed from there (PC restart, Task
                    // Manager) without ever reaching Quit. Persist now.
                    db::checkpoint_state(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            hotkey_apply,
            widget_toggle,
            widget_show,
            widget_hide,
            widget_resize,
            widget_peek_cmd,
            focus_main,
            reveal_in_explorer,
            open_url,
            app_update_info,
            app_update,
            scan::scan_project,
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
            machine::machine_status,
            machine::machine_install,
            machine::machine_install_scoop,
            machine::machine_snapshot,
            machine::machine_export,
            machine::machine_import,
            machine::machine_show,
            machine::machine_install_preview,
            machine::machine_packages_list,
            machine::machine_packages_seed,
            machine::machine_package_save,
            machine::machine_package_delete,
            setup::detect_project_setup,
            setup::refresh_path,
            setup::suggest_install,
            setup::run_project_setup,
            setup::clone_repo,
            git::git_info,
            git::git_fetch,
            git::git_pull,
            stash::stash_list,
            stash::stash_get,
            stash::stash_counts,
            stash::stash_update,
            stash::stash_create_note,
            stash::stash_tags_list,
            stash::stash_tag_add,
            stash::stash_tag_remove,
            stash::stash_tag_delete,
            stash::stash_pin,
            stash::stash_delete,
            stash::stash_mark_used,
            stash::stash_set_context,
            stash::stash_status,
            stash::stash_set_enabled,
            stash::stash_set_option,
            stash::stash_copy,
            stash::stash_paste,
            stash::stash_remember_target,
            stash::stash_prune,
            stash::stash_set_retention,
            stash::stash_open_file,
            stash::stash_image,
            conn::conn_list,
            conn::conn_save,
            conn::conn_delete,
            conn::conn_set_password,
            conn::conn_clear_password,
            conn::conn_test,
            conn::conn_run,
            conn::conn_queries_list,
            conn::conn_query_save,
            conn::conn_query_delete,
            conn::conn_runs_list,
            activity::activity_list,
            activity::activity_clear,
            activity::service_runs,
            toast_show,
            toast_hide,
            toast_focus,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevDeck");
}
