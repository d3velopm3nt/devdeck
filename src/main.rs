#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod config;
mod hotkey;
mod sessions;
mod theme;

/// Only one copy may run: a second launch summons the existing window
/// and exits, so double-clicking the exe always "opens the app".
#[cfg(windows)]
mod single_instance {
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            attrs: *mut core::ffi::c_void,
            initial_owner: i32,
            name: *const u16,
        ) -> *mut core::ffi::c_void;
        fn GetLastError() -> u32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, title: *const u16) -> isize;
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: isize) -> i32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SW_RESTORE: i32 = 9;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// True when this process is the first instance. When another copy
    /// already holds the mutex, bring its window to the front instead.
    pub fn acquire() -> bool {
        unsafe {
            let name = wide("term-widget-single-instance-mutex");
            // Handle intentionally leaked: the OS releases it on exit.
            let _handle = CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr());
            if GetLastError() != ERROR_ALREADY_EXISTS {
                return true;
            }
            // "Window Class" is winit's window class on Windows.
            let class = wide("Window Class");
            let title = wide("Terminals");
            let hwnd = FindWindowW(class.as_ptr(), title.as_ptr());
            if hwnd != 0 {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
            }
            false
        }
    }
}

fn main() -> eframe::Result<()> {
    #[cfg(windows)]
    if !single_instance::acquire() {
        return Ok(());
    }

    let settings = config::Settings::load();

    let viewport = egui::ViewportBuilder::default()
        .with_inner_size([400.0, 600.0])
        .with_min_inner_size([340.0, 420.0])
        .with_decorations(false)
        .with_transparent(true)
        .with_resizable(true)
        .with_window_level(if settings.always_on_top {
            egui::viewport::WindowLevel::AlwaysOnTop
        } else {
            egui::viewport::WindowLevel::Normal
        })
        .with_title("Terminals");

    let options = eframe::NativeOptions {
        viewport,
        centered: true,
        ..Default::default()
    };

    eframe::run_native(
        "term-widget",
        options,
        Box::new(|cc| Ok(Box::new(app::TermWidgetApp::new(cc, settings)))),
    )
}
