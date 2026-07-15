//! Modern dark theme: indigo accent, soft rounded surfaces, muted hierarchy.

use egui::{Color32, CornerRadius, Stroke, Vec2};

pub const BG: Color32 = Color32::from_rgb(0x12, 0x14, 0x1C);
pub const SURFACE: Color32 = Color32::from_rgb(0x18, 0x1C, 0x27);
pub const SURFACE_HOVER: Color32 = Color32::from_rgb(0x20, 0x25, 0x34);
pub const BORDER: Color32 = Color32::from_rgb(0x2A, 0x30, 0x40);
pub const TEXT: Color32 = Color32::from_rgb(0xE6, 0xE8, 0xEF);
pub const TEXT_MUTED: Color32 = Color32::from_rgb(0x8A, 0x94, 0xA6);
pub const ACCENT: Color32 = Color32::from_rgb(0x8B, 0x7C, 0xFF);
pub const GREEN: Color32 = Color32::from_rgb(0x4A, 0xDE, 0x80);
pub const RED: Color32 = Color32::from_rgb(0xF8, 0x71, 0x71);

pub fn apply(ctx: &egui::Context) {
    // Pin to dark: otherwise egui follows the system theme and swaps in
    // default light visuals on the first frame, clobbering this style.
    ctx.set_theme(egui::Theme::Dark);
    let mut style = (*ctx.style()).clone();
    let v = &mut style.visuals;
    *v = egui::Visuals::dark();

    v.override_text_color = Some(TEXT);
    v.panel_fill = BG;
    v.window_fill = SURFACE;
    v.extreme_bg_color = Color32::from_rgb(0x0D, 0x0F, 0x15); // text edit backgrounds
    v.selection.bg_fill = ACCENT.gamma_multiply(0.35);
    v.selection.stroke = Stroke::new(1.0, ACCENT);
    v.hyperlink_color = ACCENT;

    let r = CornerRadius::same(8);
    v.widgets.noninteractive.corner_radius = r;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, BORDER);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT_MUTED);

    v.widgets.inactive.corner_radius = r;
    v.widgets.inactive.bg_fill = SURFACE_HOVER;
    v.widgets.inactive.weak_bg_fill = SURFACE_HOVER;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    v.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT);

    v.widgets.hovered.corner_radius = r;
    v.widgets.hovered.bg_fill = Color32::from_rgb(0x28, 0x2E, 0x40);
    v.widgets.hovered.weak_bg_fill = Color32::from_rgb(0x28, 0x2E, 0x40);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, ACCENT.gamma_multiply(0.6));
    v.widgets.hovered.fg_stroke = Stroke::new(1.2, TEXT);

    v.widgets.active.corner_radius = r;
    v.widgets.active.bg_fill = ACCENT.gamma_multiply(0.45);
    v.widgets.active.weak_bg_fill = ACCENT.gamma_multiply(0.45);
    v.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
    v.widgets.active.fg_stroke = Stroke::new(1.2, TEXT);

    style.spacing.item_spacing = Vec2::new(8.0, 8.0);
    style.spacing.button_padding = Vec2::new(12.0, 6.0);
    style.spacing.interact_size.y = 30.0;

    ctx.set_style(style);
}
