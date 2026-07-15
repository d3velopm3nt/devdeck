//! The widget UI: frameless always-on-top window, launcher list,
//! running sessions, and settings.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use egui::{
    pos2, vec2, Align2, Color32, CornerRadius, FontId, Key, Margin, Rect, Sense, Stroke,
    StrokeKind, ViewportCommand,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// Wraps the widget's HWND so rfd can parent its native dialogs to us —
/// otherwise they'd open underneath the always-on-top window.
struct ParentWindow(std::num::NonZeroIsize);

impl raw_window_handle::HasWindowHandle for ParentWindow {
    fn window_handle(
        &self,
    ) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError> {
        let raw = RawWindowHandle::Win32(raw_window_handle::Win32WindowHandle::new(self.0));
        Ok(unsafe { raw_window_handle::WindowHandle::borrow_raw(raw) })
    }
}

impl raw_window_handle::HasDisplayHandle for ParentWindow {
    fn display_handle(
        &self,
    ) -> Result<raw_window_handle::DisplayHandle<'_>, raw_window_handle::HandleError> {
        let raw = raw_window_handle::RawDisplayHandle::Windows(
            raw_window_handle::WindowsDisplayHandle::new(),
        );
        Ok(unsafe { raw_window_handle::DisplayHandle::borrow_raw(raw) })
    }
}

fn file_dialog(hwnd: isize) -> rfd::FileDialog {
    let dlg = rfd::FileDialog::new();
    match std::num::NonZeroIsize::new(hwnd) {
        Some(nz) => dlg.set_parent(&ParentWindow(nz)),
        None => dlg,
    }
}

/// Native "pick a program" dialog. Blocks the UI thread while open.
fn pick_program(hwnd: isize) -> Option<String> {
    file_dialog(hwnd)
        .set_title("Choose a program to launch")
        .add_filter("Programs", &["exe", "bat", "cmd", "com"])
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.display().to_string())
}

/// Native "pick a folder" dialog. Blocks the UI thread while open.
fn pick_folder(hwnd: isize) -> Option<String> {
    file_dialog(hwnd)
        .set_title("Choose the starting folder")
        .pick_folder()
        .map(|p| p.display().to_string())
}


use crate::config::{detect_terminals, name_from_path, Settings, TerminalDef};
use crate::hotkey::{self, HotkeyHandle, VisibilityCtl};
use crate::sessions::{SessionManager, SessionState};
use crate::theme;

#[derive(PartialEq)]
enum View {
    Main,
    Settings,
}

struct Toast {
    text: String,
    at: Instant,
    error: bool,
}

pub struct TermWidgetApp {
    settings: Settings,
    sessions: SessionManager,
    hotkey: Option<HotkeyHandle>,
    hotkey_status: Result<(), String>,
    hotkey_draft: String,
    ctl: VisibilityCtl,
    view: View,
    search: String,
    selected: usize,
    focus_search: bool,
    first_frame: bool,
    toast: Option<Toast>,
}

impl TermWidgetApp {
    pub fn new(cc: &eframe::CreationContext<'_>, settings: Settings) -> Self {
        theme::apply(&cc.egui_ctx);

        let hwnd = cc
            .window_handle()
            .ok()
            .map(|h| match h.as_raw() {
                RawWindowHandle::Win32(w) => w.hwnd.get(),
                _ => 0,
            })
            .unwrap_or(0);
        let ctl = VisibilityCtl::new(hwnd);

        let mut hotkey = HotkeyHandle::new();
        let hotkey_status = match &mut hotkey {
            Some(h) => h.register(&settings.hotkey),
            None => Err("Global hotkeys unavailable on this system".into()),
        };
        hotkey::spawn_listener(cc.egui_ctx.clone(), ctl.clone());

        Self {
            hotkey_draft: settings.hotkey.clone(),
            settings,
            sessions: SessionManager::default(),
            hotkey,
            hotkey_status,
            ctl,
            view: View::Main,
            search: String::new(),
            selected: 0,
            focus_search: true,
            first_frame: true,
            toast: None,
        }
    }

    fn toast(&mut self, text: impl Into<String>, error: bool) {
        self.toast = Some(Toast {
            text: text.into(),
            at: Instant::now(),
            error,
        });
    }

    fn set_visible(&mut self, ctx: &egui::Context, show: bool) {
        if show {
            self.ctl.os_show();
            ctx.send_viewport_cmd(ViewportCommand::Focus);
            self.focus_search = true;
            self.view = View::Main;
        } else {
            self.ctl.os_hide();
        }
    }

    fn launch(&mut self, ctx: &egui::Context, index: usize) {
        let Some(def) = self.settings.terminals.get(index).cloned() else {
            return;
        };
        match self.sessions.launch(&def) {
            Ok(()) => {
                self.toast(format!("Started {}", def.name), false);
                self.search.clear();
                if self.settings.hide_on_launch {
                    self.set_visible(ctx, false);
                }
            }
            Err(e) => self.toast(e, true),
        }
    }

    /// Quick-run whatever is typed in the search box.
    fn launch_quick(&mut self, ctx: &egui::Context) {
        let input = self.search.trim().to_string();
        if input.is_empty() {
            return;
        }
        match self.sessions.launch_adhoc(&input) {
            Ok(()) => {
                self.toast(format!("Running {input}"), false);
                self.search.clear();
                if self.settings.hide_on_launch {
                    self.set_visible(ctx, false);
                }
            }
            Err(e) => self.toast(e, true),
        }
    }

    fn filtered_indices(&self) -> Vec<usize> {
        let needle = self.search.trim().to_lowercase();
        self.settings
            .terminals
            .iter()
            .enumerate()
            .filter(|(_, t)| needle.is_empty() || t.name.to_lowercase().contains(&needle))
            .map(|(i, _)| i)
            .collect()
    }

    // ----- chrome ---------------------------------------------------------

    fn title_bar(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let height = 44.0;
        let (bar_rect, bar_resp) = ui.allocate_exact_size(
            vec2(ui.available_width(), height),
            Sense::click_and_drag(),
        );
        if bar_resp.drag_started() {
            ctx.send_viewport_cmd(ViewportCommand::StartDrag);
        }

        // App mark + title
        let chip = Rect::from_min_size(bar_rect.min + vec2(14.0, 10.0), vec2(24.0, 24.0));
        let painter = ui.painter().clone();
        painter.rect_filled(chip, CornerRadius::same(6), theme::ACCENT.gamma_multiply(0.2));
        painter.text(
            chip.center(),
            Align2::CENTER_CENTER,
            ">_",
            FontId::monospace(11.0),
            theme::ACCENT,
        );
        painter.text(
            pos2(chip.max.x + 10.0, bar_rect.center().y),
            Align2::LEFT_CENTER,
            "Terminals",
            FontId::proportional(15.0),
            theme::TEXT,
        );

        // Window buttons, right-aligned: settings, minimize, hide.
        let mut x = bar_rect.max.x - 14.0;
        for kind in ["hide", "min", "gear"] {
            let size = 26.0;
            let rect = Rect::from_min_size(
                pos2(x - size, bar_rect.center().y - size / 2.0),
                vec2(size, size),
            );
            x -= size + 6.0;
            let resp = ui.interact(rect, ui.id().with(kind), Sense::click());
            if resp.hovered() {
                let fill = if kind == "hide" {
                    theme::RED.gamma_multiply(0.25)
                } else {
                    theme::SURFACE_HOVER
                };
                painter.rect_filled(rect, CornerRadius::same(6), fill);
            }
            let c = rect.center();
            let stroke = Stroke::new(1.6, if resp.hovered() { theme::TEXT } else { theme::TEXT_MUTED });
            match kind {
                "min" => {
                    painter.line_segment([pos2(c.x - 5.0, c.y), pos2(c.x + 5.0, c.y)], stroke);
                    if resp.clicked() {
                        // Treat minimize like hide: the hotkey restores it.
                        self.ctl.visible.store(false, Ordering::SeqCst);
                        ctx.send_viewport_cmd(ViewportCommand::Minimized(true));
                    }
                    resp.on_hover_text("Minimize");
                }
                "hide" => {
                    painter.line_segment([c + vec2(-4.5, -4.5), c + vec2(4.5, 4.5)], stroke);
                    painter.line_segment([c + vec2(-4.5, 4.5), c + vec2(4.5, -4.5)], stroke);
                    if resp.clicked() {
                        self.set_visible(ctx, false);
                    }
                    resp.on_hover_text(format!("Hide  ·  {} to show", self.settings.hotkey));
                }
                _ => {
                    painter.text(c, Align2::CENTER_CENTER, "⚙", FontId::proportional(14.0), stroke.color);
                    if resp.clicked() {
                        self.view = if self.view == View::Settings {
                            View::Main
                        } else {
                            View::Settings
                        };
                    }
                    resp.on_hover_text("Settings");
                }
            }
        }

        // Hairline under the bar
        painter.line_segment(
            [
                pos2(bar_rect.min.x, bar_rect.max.y),
                pos2(bar_rect.max.x, bar_rect.max.y),
            ],
            Stroke::new(1.0, theme::BORDER),
        );
    }

    fn section_label(ui: &mut egui::Ui, text: &str) {
        ui.add_space(6.0);
        ui.label(
            egui::RichText::new(text)
                .size(10.5)
                .color(theme::TEXT_MUTED)
                .strong(),
        );
        ui.add_space(2.0);
    }

    // ----- main view ------------------------------------------------------

    fn main_view(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let filtered = self.filtered_indices();
        if self.selected >= filtered.len() {
            self.selected = filtered.len().saturating_sub(1);
        }

        // Keyboard navigation (read before widgets consume anything).
        let (up, down, enter) = ctx.input(|i| {
            (
                i.key_pressed(Key::ArrowUp),
                i.key_pressed(Key::ArrowDown),
                i.key_pressed(Key::Enter),
            )
        });
        if down && !filtered.is_empty() {
            self.selected = (self.selected + 1) % filtered.len();
        }
        if up && !filtered.is_empty() {
            self.selected = (self.selected + filtered.len() - 1) % filtered.len();
        }

        let search_resp = egui::Frame::new()
            .fill(Color32::from_rgb(0x0D, 0x0F, 0x15))
            .stroke(Stroke::new(1.0, theme::BORDER))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(Margin::symmetric(10, 7))
            .show(ui, |ui| {
                ui.add(
                    egui::TextEdit::singleline(&mut self.search)
                        .hint_text("Search or type a command  ·  Enter runs  ·  Esc hides")
                        .frame(false)
                        .desired_width(f32::INFINITY),
                )
            })
            .inner;
        if search_resp.changed() {
            self.selected = 0;
        }
        if self.focus_search {
            search_resp.request_focus();
            self.focus_search = false;
        }

        if enter {
            if let Some(&ti) = filtered.get(self.selected) {
                self.launch(ctx, ti);
            } else {
                self.launch_quick(ctx);
            }
            return;
        }

        egui::ScrollArea::vertical()
            .auto_shrink(false)
            .show(ui, |ui| {
                Self::section_label(ui, "LAUNCH");
                if filtered.is_empty() && self.settings.terminals.is_empty() {
                    ui.label(
                        egui::RichText::new("No terminals configured — add one in Settings (⚙)")
                            .color(theme::TEXT_MUTED),
                    );
                }
                let mut launch_click: Option<usize> = None;
                for (row, &ti) in filtered.iter().enumerate() {
                    let def = &self.settings.terminals[ti];
                    if Self::terminal_row(ui, def, row == self.selected, ti) {
                        launch_click = Some(ti);
                    }
                }
                if let Some(ti) = launch_click {
                    self.launch(ctx, ti);
                }

                // Quick-run row: whatever is typed that matches no terminal
                // can be executed directly (first token = program).
                if filtered.is_empty() && !self.search.trim().is_empty() {
                    if Self::quick_run_row(ui, self.search.trim()) {
                        self.launch_quick(ctx);
                    }
                }

                ui.add_space(4.0);
                let running = self.sessions.running_count();
                Self::section_label(
                    ui,
                    &format!("SESSIONS · {} RUNNING", running),
                );
                if self.sessions.len() == 0 {
                    ui.label(egui::RichText::new("No sessions yet").color(theme::TEXT_MUTED));
                }

                let mut kill: Option<u64> = None;
                let mut remove: Option<u64> = None;
                let mut save_template: Option<u64> = None;
                let time = ui.input(|i| i.time);
                for s in self.sessions.iter() {
                    match Self::session_row(ui, s, time) {
                        SessionAction::None => {}
                        SessionAction::Kill => kill = Some(s.id),
                        SessionAction::Remove => remove = Some(s.id),
                        SessionAction::SaveTemplate => save_template = Some(s.id),
                    }
                }
                if let Some(id) = kill {
                    self.sessions.kill(id);
                }
                if let Some(id) = remove {
                    self.sessions.remove(id);
                }
                if let Some(id) = save_template {
                    if let Some(s) = self.sessions.get(id) {
                        let def = TerminalDef {
                            name: name_from_path(&s.command),
                            command: s.command.clone(),
                            args: s.args.clone(),
                            working_dir: String::new(),
                            new_console: true,
                            tint: s.tint,
                        };
                        let name = def.name.clone();
                        self.settings.terminals.push(def);
                        self.sessions.mark_saved(id);
                        match self.settings.save() {
                            Ok(()) => self.toast(format!("Saved \"{name}\" as template"), false),
                            Err(e) => self.toast(format!("Could not save: {e}"), true),
                        }
                    }
                }
                if self.sessions.any_finished() {
                    ui.add_space(2.0);
                    if ui
                        .button(egui::RichText::new("Clear finished").size(11.5))
                        .clicked()
                    {
                        self.sessions.clear_finished();
                    }
                }
                ui.add_space(10.0);
            });
    }

    /// "Run: <input>" row shown when the search matches nothing.
    /// Returns true when clicked.
    fn quick_run_row(ui: &mut egui::Ui, input: &str) -> bool {
        let height = 52.0;
        let (rect, resp) =
            ui.allocate_exact_size(vec2(ui.available_width(), height), Sense::click());
        let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand);
        let painter = ui.painter();

        let fill = if resp.hovered() {
            theme::ACCENT.gamma_multiply(0.22)
        } else {
            theme::ACCENT.gamma_multiply(0.10)
        };
        painter.rect_filled(rect, CornerRadius::same(10), fill);
        painter.rect_stroke(
            rect,
            CornerRadius::same(10),
            Stroke::new(1.0, theme::ACCENT.gamma_multiply(0.55)),
            StrokeKind::Inside,
        );

        let chip = Rect::from_min_size(rect.min + vec2(10.0, (height - 30.0) / 2.0), vec2(30.0, 30.0));
        painter.rect_filled(chip, CornerRadius::same(8), theme::ACCENT.gamma_multiply(0.25));
        // play triangle
        let c = chip.center();
        painter.add(egui::Shape::convex_polygon(
            vec![c + vec2(-3.5, -5.5), c + vec2(6.0, 0.0), c + vec2(-3.5, 5.5)],
            theme::ACCENT,
            Stroke::NONE,
        ));

        let text_x = chip.max.x + 10.0;
        painter.text(
            pos2(text_x, rect.center().y - 9.0),
            Align2::LEFT_CENTER,
            format!("Run: {input}"),
            FontId::proportional(13.5),
            theme::TEXT,
        );
        painter.text(
            pos2(text_x, rect.center().y + 9.0),
            Align2::LEFT_CENTER,
            "quick command · save it as a template from its session row",
            FontId::proportional(10.5),
            theme::TEXT_MUTED,
        );
        resp.clicked()
    }

    /// Returns true when the row was clicked.
    fn terminal_row(ui: &mut egui::Ui, def: &TerminalDef, selected: bool, id: usize) -> bool {
        let height = 52.0;
        let (rect, resp) = ui.allocate_exact_size(vec2(ui.available_width(), height), Sense::click());
        let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand);
        let painter = ui.painter();

        let tint = Color32::from_rgb(def.tint[0], def.tint[1], def.tint[2]);
        let fill = if resp.hovered() {
            theme::SURFACE_HOVER
        } else if selected {
            theme::ACCENT.gamma_multiply(0.13)
        } else {
            theme::SURFACE
        };
        painter.rect_filled(rect, CornerRadius::same(10), fill);
        if selected {
            painter.rect_stroke(
                rect,
                CornerRadius::same(10),
                Stroke::new(1.0, theme::ACCENT.gamma_multiply(0.7)),
                StrokeKind::Inside,
            );
        }

        // Icon chip
        let chip = Rect::from_min_size(rect.min + vec2(10.0, (height - 30.0) / 2.0), vec2(30.0, 30.0));
        painter.rect_filled(chip, CornerRadius::same(8), tint.gamma_multiply(0.18));
        painter.text(
            chip.center(),
            Align2::CENTER_CENTER,
            ">_",
            FontId::monospace(11.0),
            tint,
        );

        // Name + command
        let text_x = chip.max.x + 10.0;
        painter.text(
            pos2(text_x, rect.center().y - 9.0),
            Align2::LEFT_CENTER,
            &def.name,
            FontId::proportional(13.5),
            theme::TEXT,
        );
        let sub = std::path::Path::new(&def.command)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| def.command.clone());
        painter.text(
            pos2(text_x, rect.center().y + 9.0),
            Align2::LEFT_CENTER,
            sub,
            FontId::proportional(10.5),
            theme::TEXT_MUTED,
        );

        // Launch affordance
        if resp.hovered() || selected {
            painter.text(
                pos2(rect.max.x - 16.0, rect.center().y),
                Align2::CENTER_CENTER,
                "⏵",
                FontId::proportional(15.0),
                if resp.hovered() { theme::ACCENT } else { theme::TEXT_MUTED },
            );
        }

        let _ = id;
        resp.clicked()
    }

    fn session_row(ui: &mut egui::Ui, s: &crate::sessions::Session, time: f64) -> SessionAction {
        let height = 44.0;
        let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), height), Sense::hover());
        let painter = ui.painter().clone();
        painter.rect_filled(rect, CornerRadius::same(10), theme::SURFACE);

        let running = s.state == SessionState::Running;
        let tint = Color32::from_rgb(s.tint[0], s.tint[1], s.tint[2]);

        // Status dot (pulsing when running)
        let dot_c = pos2(rect.min.x + 18.0, rect.center().y);
        if running {
            let pulse = 0.55 + 0.45 * ((time * 2.4).sin() as f32 * 0.5 + 0.5);
            painter.circle_filled(dot_c, 4.0, theme::GREEN.gamma_multiply(pulse));
            painter.circle_stroke(dot_c, 6.5, Stroke::new(1.0, theme::GREEN.gamma_multiply(pulse * 0.35)));
        } else {
            painter.circle_filled(dot_c, 4.0, theme::TEXT_MUTED.gamma_multiply(0.6));
        }

        // Name + meta
        let text_x = rect.min.x + 34.0;
        painter.text(
            pos2(text_x, rect.center().y - 8.0),
            Align2::LEFT_CENTER,
            &s.name,
            FontId::proportional(12.5),
            if running { theme::TEXT } else { theme::TEXT_MUTED },
        );
        let meta = if running {
            format!("pid {} · up {}", s.pid, s.uptime_label())
        } else {
            match s.state {
                SessionState::Exited(Some(code)) => format!("exited · code {code}"),
                _ => "exited".into(),
            }
        };
        painter.text(
            pos2(text_x, rect.center().y + 8.0),
            Align2::LEFT_CENTER,
            meta,
            FontId::proportional(10.0),
            theme::TEXT_MUTED,
        );

        // Save-as-template button for quick-run sessions
        let size = 24.0;
        let mut action = SessionAction::None;
        if s.adhoc {
            let save_btn = Rect::from_min_size(
                pos2(rect.max.x - size * 2.0 - 16.0, rect.center().y - size / 2.0),
                vec2(size, size),
            );
            let resp = ui.interact(save_btn, ui.id().with(("save", s.id)), Sense::click());
            if resp.hovered() {
                painter.rect_filled(save_btn, CornerRadius::same(6), theme::GREEN.gamma_multiply(0.22));
            }
            let c = save_btn.center();
            let color = if resp.hovered() { theme::GREEN } else { theme::TEXT_MUTED };
            let stroke = Stroke::new(1.6, color);
            painter.line_segment([c + vec2(-4.5, 0.0), c + vec2(4.5, 0.0)], stroke);
            painter.line_segment([c + vec2(0.0, -4.5), c + vec2(0.0, 4.5)], stroke);
            if resp.on_hover_text("Save as template").clicked() {
                action = SessionAction::SaveTemplate;
            }
        }

        // Action button: stop (running) / dismiss (finished)
        let btn = Rect::from_min_size(
            pos2(rect.max.x - size - 10.0, rect.center().y - size / 2.0),
            vec2(size, size),
        );
        let resp = ui.interact(btn, ui.id().with(s.id), Sense::click());
        if resp.hovered() {
            painter.rect_filled(btn, CornerRadius::same(6), theme::RED.gamma_multiply(0.22));
        }
        let c = btn.center();
        let color = if resp.hovered() { theme::RED } else { theme::TEXT_MUTED };
        if running {
            // stop square
            painter.rect_filled(
                Rect::from_center_size(c, vec2(8.0, 8.0)),
                CornerRadius::same(2),
                color,
            );
            let resp = resp.on_hover_text("Stop session");
            if resp.clicked() {
                action = SessionAction::Kill;
            }
        } else {
            let stroke = Stroke::new(1.5, color);
            painter.line_segment([c + vec2(-4.0, -4.0), c + vec2(4.0, 4.0)], stroke);
            painter.line_segment([c + vec2(-4.0, 4.0), c + vec2(4.0, -4.0)], stroke);
            let resp = resp.on_hover_text("Dismiss");
            if resp.clicked() {
                action = SessionAction::Remove;
            }
        }
        let _ = tint;
        action
    }

    // ----- settings view --------------------------------------------------

    fn settings_view(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let mut dirty = false;

        egui::ScrollArea::vertical()
            .auto_shrink(false)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    if ui.button("⏴  Back").clicked() {
                        self.view = View::Main;
                    }
                    ui.label(
                        egui::RichText::new("Settings")
                            .size(15.0)
                            .color(theme::TEXT),
                    );
                });
                ui.add_space(4.0);

                // --- Hotkey card
                Self::card(ui, "GLOBAL HOTKEY", |ui| {
                    ui.horizontal(|ui| {
                        ui.add(
                            egui::TextEdit::singleline(&mut self.hotkey_draft)
                                .desired_width(200.0),
                        );
                        if ui.button("Apply").clicked() {
                            match &mut self.hotkey {
                                Some(h) => {
                                    self.hotkey_status = h.register(&self.hotkey_draft);
                                    if self.hotkey_status.is_ok() {
                                        self.settings.hotkey = self.hotkey_draft.clone();
                                        dirty = true;
                                    }
                                }
                                None => {
                                    self.hotkey_status =
                                        Err("Global hotkeys unavailable".into());
                                }
                            }
                        }
                    });
                    match &self.hotkey_status {
                        Ok(()) => {
                            ui.label(
                                egui::RichText::new(format!(
                                    "Active: {}  — toggles show/hide from anywhere",
                                    self.settings.hotkey
                                ))
                                .size(11.0)
                                .color(theme::GREEN),
                            );
                        }
                        Err(e) => {
                            ui.label(
                                egui::RichText::new(format!("Error: {e}"))
                                    .size(11.0)
                                    .color(theme::RED),
                            );
                        }
                    }
                    ui.label(
                        egui::RichText::new(
                            "Format: modifiers + key code, e.g.  ctrl+shift+Space,  alt+F9,  ctrl+alt+KeyT",
                        )
                        .size(10.5)
                        .color(theme::TEXT_MUTED),
                    );
                });

                // --- Window card
                Self::card(ui, "WINDOW", |ui| {
                    if ui
                        .checkbox(&mut self.settings.always_on_top, "Always on top")
                        .changed()
                    {
                        dirty = true;
                        ctx.send_viewport_cmd(ViewportCommand::WindowLevel(
                            if self.settings.always_on_top {
                                egui::viewport::WindowLevel::AlwaysOnTop
                            } else {
                                egui::viewport::WindowLevel::Normal
                            },
                        ));
                    }
                    dirty |= ui
                        .checkbox(&mut self.settings.start_hidden, "Start hidden (summon with hotkey)")
                        .changed();
                    dirty |= ui
                        .checkbox(&mut self.settings.hide_on_launch, "Hide after launching a terminal")
                        .changed();
                });

                // --- Terminals card
                let hwnd = self.ctl.hwnd;
                Self::card(ui, "TERMINALS", |ui| {
                    let mut remove: Option<usize> = None;
                    let count = self.settings.terminals.len();
                    for i in 0..count {
                        let t = &mut self.settings.terminals[i];
                        ui.push_id(i, |ui| {
                            egui::Frame::new()
                                .fill(theme::BG)
                                .corner_radius(CornerRadius::same(8))
                                .inner_margin(Margin::same(8))
                                .show(ui, |ui| {
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            egui::RichText::new("Name").size(10.5).color(theme::TEXT_MUTED),
                                        );
                                        dirty |= ui
                                            .add(egui::TextEdit::singleline(&mut t.name).desired_width(140.0))
                                            .changed();
                                        ui.with_layout(
                                            egui::Layout::right_to_left(egui::Align::Center),
                                            |ui| {
                                                if ui.button("✖").on_hover_text("Remove").clicked() {
                                                    remove = Some(i);
                                                }
                                            },
                                        );
                                    });
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            egui::RichText::new("Command").size(10.5).color(theme::TEXT_MUTED),
                                        );
                                        ui.with_layout(
                                            egui::Layout::right_to_left(egui::Align::Center),
                                            |ui| {
                                                if ui
                                                    .button("…")
                                                    .on_hover_text("Browse for a program")
                                                    .clicked()
                                                {
                                                    if let Some(path) = pick_program(hwnd) {
                                                        if t.name.trim().is_empty()
                                                            || t.name == "New terminal"
                                                        {
                                                            t.name = name_from_path(&path);
                                                        }
                                                        t.command = path;
                                                        dirty = true;
                                                    }
                                                }
                                                dirty |= ui
                                                    .add(
                                                        egui::TextEdit::singleline(&mut t.command)
                                                            .desired_width(f32::INFINITY),
                                                    )
                                                    .changed();
                                            },
                                        );
                                    });
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            egui::RichText::new("Args").size(10.5).color(theme::TEXT_MUTED),
                                        );
                                        let mut args = t.args.join(" ");
                                        if ui
                                            .add(
                                                egui::TextEdit::singleline(&mut args)
                                                    .desired_width(f32::INFINITY)
                                                    .hint_text("space-separated"),
                                            )
                                            .changed()
                                        {
                                            t.args =
                                                args.split_whitespace().map(String::from).collect();
                                            dirty = true;
                                        }
                                    });
                                    ui.horizontal(|ui| {
                                        ui.label(
                                            egui::RichText::new("Folder").size(10.5).color(theme::TEXT_MUTED),
                                        );
                                        ui.with_layout(
                                            egui::Layout::right_to_left(egui::Align::Center),
                                            |ui| {
                                                if ui
                                                    .button("…")
                                                    .on_hover_text("Browse for a folder")
                                                    .clicked()
                                                {
                                                    if let Some(dir) = pick_folder(hwnd) {
                                                        t.working_dir = dir;
                                                        dirty = true;
                                                    }
                                                }
                                                dirty |= ui
                                                    .add(
                                                        egui::TextEdit::singleline(&mut t.working_dir)
                                                            .desired_width(f32::INFINITY)
                                                            .hint_text("start dir, ~ = home, empty = inherit"),
                                                    )
                                                    .changed();
                                            },
                                        );
                                    });
                                    dirty |= ui
                                        .checkbox(&mut t.new_console, "Console app (open in a new console window)")
                                        .changed();
                                });
                        });
                        ui.add_space(4.0);
                    }
                    if let Some(i) = remove {
                        self.settings.terminals.remove(i);
                        dirty = true;
                    }
                    ui.horizontal(|ui| {
                        if ui
                            .button("＋ Add terminal")
                            .on_hover_text("Pick a program; cancel to add a blank entry")
                            .clicked()
                        {
                            let picked = pick_program(hwnd);
                            let (name, command) = match &picked {
                                Some(path) => (name_from_path(path), path.clone()),
                                None => ("New terminal".into(), String::new()),
                            };
                            self.settings.terminals.push(TerminalDef {
                                name,
                                command,
                                args: vec![],
                                working_dir: String::new(),
                                new_console: true,
                                tint: [139, 148, 166],
                            });
                            dirty = true;
                        }
                        if ui
                            .button("Re-detect installed")
                            .on_hover_text("Add any installed terminals that are missing from the list")
                            .clicked()
                        {
                            for det in detect_terminals() {
                                if !self
                                    .settings
                                    .terminals
                                    .iter()
                                    .any(|t| t.command.eq_ignore_ascii_case(&det.command))
                                {
                                    self.settings.terminals.push(det);
                                    dirty = true;
                                }
                            }
                        }
                    });
                });

                ui.add_space(2.0);
                ui.label(
                    egui::RichText::new(format!(
                        "Changes save automatically → {}",
                        Settings::path().display()
                    ))
                    .size(10.0)
                    .color(theme::TEXT_MUTED),
                );
                ui.add_space(8.0);
                let quit = egui::Button::new(
                    egui::RichText::new("Quit Terminals").color(theme::RED),
                )
                .fill(theme::RED.gamma_multiply(0.12));
                if ui.add(quit).clicked() {
                    let _ = self.settings.save();
                    ctx.send_viewport_cmd(ViewportCommand::Close);
                }
                ui.add_space(10.0);
            });

        if dirty {
            if let Err(e) = self.settings.save() {
                self.toast(format!("Could not save settings: {e}"), true);
            }
        }
    }

    fn card(ui: &mut egui::Ui, title: &str, add: impl FnOnce(&mut egui::Ui)) {
        Self::section_label(ui, title);
        egui::Frame::new()
            .fill(theme::SURFACE)
            .stroke(Stroke::new(1.0, theme::BORDER))
            .corner_radius(CornerRadius::same(10))
            .inner_margin(Margin::same(10))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                add(ui);
            });
        ui.add_space(4.0);
    }

    fn show_toast(&mut self, ctx: &egui::Context) {
        let Some(t) = &self.toast else { return };
        if t.at.elapsed() > Duration::from_secs(3) {
            self.toast = None;
            return;
        }
        let color = if t.error { theme::RED } else { theme::GREEN };
        egui::Area::new(egui::Id::new("toast"))
            .anchor(Align2::CENTER_BOTTOM, vec2(0.0, -16.0))
            .show(ctx, |ui| {
                egui::Frame::new()
                    .fill(theme::BG.gamma_multiply(0.97))
                    .stroke(Stroke::new(1.0, color.gamma_multiply(0.6)))
                    .corner_radius(CornerRadius::same(8))
                    .inner_margin(Margin::symmetric(12, 7))
                    .show(ui, |ui| {
                        ui.label(egui::RichText::new(&t.text).size(11.5).color(color));
                    });
            });
    }
}

enum SessionAction {
    None,
    Kill,
    Remove,
    SaveTemplate,
}

impl eframe::App for TermWidgetApp {
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        [0.0, 0.0, 0.0, 0.0] // transparent behind rounded corners
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.first_frame {
            self.first_frame = false;
            if let Err(e) = &self.hotkey_status {
                self.toast(format!("Hotkey error: {e}"), true);
            }
            if self.settings.start_hidden {
                self.set_visible(ctx, false);
            }
        }

        self.sessions.poll();

        // The hotkey thread just showed the window at the OS level;
        // finish the job UI-side.
        if self.ctl.just_shown.swap(false, Ordering::SeqCst) {
            ctx.send_viewport_cmd(ViewportCommand::Focus);
            self.focus_search = true;
            self.view = View::Main;
        }

        if ctx.input(|i| i.key_pressed(Key::Escape)) {
            match self.view {
                View::Settings => self.view = View::Main,
                View::Main => {
                    if !self.search.is_empty() {
                        self.search.clear();
                    } else {
                        self.set_visible(ctx, false);
                    }
                }
            }
        }

        let panel_frame = egui::Frame::new()
            .fill(theme::BG)
            .stroke(Stroke::new(1.0, theme::BORDER))
            .corner_radius(CornerRadius::same(14));

        egui::CentralPanel::default()
            .frame(panel_frame)
            .show(ctx, |ui| {
                self.title_bar(ui, ctx);
                let content = ui.available_rect_before_wrap().shrink(12.0);
                let mut content_ui = ui.new_child(egui::UiBuilder::new().max_rect(content));
                match self.view {
                    View::Main => self.main_view(&mut content_ui, ctx),
                    View::Settings => self.settings_view(&mut content_ui, ctx),
                }

                // Resize grip, bottom-right corner
                let grip = Rect::from_min_size(
                    ui.max_rect().max - vec2(18.0, 18.0),
                    vec2(18.0, 18.0),
                );
                let resp = ui
                    .interact(grip, ui.id().with("grip"), Sense::drag())
                    .on_hover_cursor(egui::CursorIcon::ResizeSouthEast);
                if resp.drag_started() {
                    ctx.send_viewport_cmd(ViewportCommand::BeginResize(
                        egui::viewport::ResizeDirection::SouthEast,
                    ));
                }
                let gc = if resp.hovered() { theme::TEXT_MUTED } else { theme::BORDER };
                let p = ui.painter();
                let m = grip.max - vec2(5.0, 5.0);
                p.line_segment([m + vec2(-8.0, 0.0), m + vec2(0.0, -8.0)], Stroke::new(1.2, gc));
                p.line_segment([m + vec2(-4.0, 0.0), m + vec2(0.0, -4.0)], Stroke::new(1.2, gc));
            });

        self.show_toast(ctx);

        // Keep ticking: session uptimes, exit detection, toast expiry.
        ctx.request_repaint_after(Duration::from_millis(400));
    }
}
