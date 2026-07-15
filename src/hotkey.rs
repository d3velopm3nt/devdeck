//! Global hotkey registration + background listener.
//!
//! While the window is hidden, eframe delivers no redraw events, so
//! `update()` never runs and viewport commands queued from a background
//! thread would never be processed. The listener therefore toggles
//! visibility directly at the OS level (ShowWindow), which both shows
//! the window and wakes the event loop.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn ShowWindow(hwnd: isize, n_cmd_show: i32) -> i32;
    fn SetForegroundWindow(hwnd: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn IsIconic(hwnd: isize) -> i32;
}

#[cfg(windows)]
const SW_HIDE: i32 = 0;
#[cfg(windows)]
const SW_RESTORE: i32 = 9;

/// Owns the OS-level registration. Must be created (and re-registered)
/// on the thread running the winit event loop — i.e. the main thread.
pub struct HotkeyHandle {
    manager: GlobalHotKeyManager,
    current: Option<HotKey>,
}

impl HotkeyHandle {
    pub fn new() -> Option<Self> {
        GlobalHotKeyManager::new().ok().map(|manager| Self {
            manager,
            current: None,
        })
    }

    /// Parse a spec like "ctrl+shift+Space" and swap the registration.
    pub fn register(&mut self, spec: &str) -> Result<(), String> {
        let hotkey = HotKey::from_str(spec).map_err(|e| e.to_string())?;
        if let Some(old) = self.current.take() {
            let _ = self.manager.unregister(old);
        }
        self.manager.register(hotkey).map_err(|e| e.to_string())?;
        self.current = Some(hotkey);
        Ok(())
    }
}

/// Shared visibility state between the UI and the hotkey thread.
#[derive(Clone)]
pub struct VisibilityCtl {
    /// Native window handle (HWND as isize); 0 when unavailable.
    pub hwnd: isize,
    /// Whether the widget is currently shown (source of truth).
    pub visible: Arc<AtomicBool>,
    /// Set by the listener right after showing; the UI consumes it to
    /// focus the search box and reset the view.
    pub just_shown: Arc<AtomicBool>,
}

impl VisibilityCtl {
    pub fn new(hwnd: isize) -> Self {
        Self {
            hwnd,
            visible: Arc::new(AtomicBool::new(true)),
            just_shown: Arc::new(AtomicBool::new(false)),
        }
    }

    /// OS-level show + focus. Safe to call from any thread.
    pub fn os_show(&self) {
        self.visible.store(true, Ordering::SeqCst);
        self.just_shown.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        if self.hwnd != 0 {
            unsafe {
                ShowWindow(self.hwnd, SW_RESTORE);
                SetForegroundWindow(self.hwnd);
            }
        }
    }

    /// OS-level hide. Safe to call from any thread.
    pub fn os_hide(&self) {
        self.visible.store(false, Ordering::SeqCst);
        #[cfg(windows)]
        if self.hwnd != 0 {
            unsafe {
                ShowWindow(self.hwnd, SW_HIDE);
            }
        }
    }

    /// Ground truth from the OS — the internal flag can drift when the
    /// window is shown/minimized externally (e.g. single-instance summon).
    pub fn is_shown(&self) -> bool {
        #[cfg(windows)]
        if self.hwnd != 0 {
            return unsafe { IsWindowVisible(self.hwnd) != 0 && IsIconic(self.hwnd) == 0 };
        }
        self.visible.load(Ordering::SeqCst)
    }
}

/// Blocks on the global hotkey channel; on each press, toggles the
/// window at the OS level and wakes the egui loop.
pub fn spawn_listener(ctx: egui::Context, ctl: VisibilityCtl) {
    std::thread::spawn(move || {
        let receiver = GlobalHotKeyEvent::receiver();
        while let Ok(event) = receiver.recv() {
            if event.state() == HotKeyState::Pressed {
                if ctl.is_shown() {
                    ctl.os_hide();
                } else {
                    ctl.os_show();
                }
                ctx.request_repaint();
            }
        }
    });
}
