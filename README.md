# Terminals — always-on-top terminal launcher widget

A tiny Rust desktop widget for Windows: summon it from anywhere with a global
hotkey, launch any of your terminals, and keep an eye on the sessions it
started — with live running state, uptime, and one-click stop.

![stack](https://img.shields.io/badge/rust-eframe%2Fegui-informational)

## Run it

```
cargo build --release
.\target\release\term-widget.exe
```

That's it. No installer, no console window, single ~5 MB exe. On first run it
detects the terminals installed on your machine (PowerShell 7, Windows
PowerShell, CMD, Windows Terminal, Git Bash, WSL) and writes a settings file.

Single-instance: running the exe while the app is already open (even hidden)
just summons the existing window — it never opens a duplicate.

## Using it

| Action | How |
|---|---|
| Show / hide from anywhere | `Ctrl+Shift+Space` (configurable) |
| Launch a terminal | Click it, or type to filter → `↑`/`↓` → `Enter` |
| Quick-run any command | Type it in the search box (e.g. `cmd /k npm run dev`) → `Enter` |
| Save a quick-run as a template | `＋` button on its session row |
| Hide | `Esc` or the `✕` button |
| Minimize | `–` button (hotkey restores) |
| Move the window | Drag the title bar |
| Resize | Drag the bottom-right grip |
| Stop / dismiss a session | The button on each session row |
| Settings | `⚙` button |
| Quit | Settings → Quit Terminals |

The window floats on top of everything (toggleable) and hides instead of
closing, so the hotkey always brings it back.

## Settings

Everything is configurable in the in-app Settings screen and saves
automatically to `%APPDATA%\term-widget\settings.json`:

```jsonc
{
  "hotkey": "ctrl+shift+Space",   // modifiers + W3C key code (Space, F9, KeyT…)
  "always_on_top": true,
  "start_hidden": false,          // start in the background, summon via hotkey
  "hide_on_launch": false,        // quake-style: hide right after launching (opt-in)
  "terminals": [
    {
      "name": "PowerShell 7",
      "command": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      "args": ["-NoLogo"],
      "working_dir": "~",         // ~ = home, empty = inherit
      "new_console": true,        // console apps need their own console window
      "tint": [90, 169, 255]      // list icon color
    }
  ]
}
```

### Adding your own terminals

In Settings → Terminals, **＋ Add terminal** opens a native file picker —
choose the program (`.exe`/`.bat`/`.cmd`), and the name fills in
automatically. Use the `…` button next to **Folder** to pick the starting
directory with a native folder dialog, and type any **Args** (space
separated). The `…` next to **Command** re-browses an existing entry.
Everything saves automatically to the local settings file.

Add any tool as a "terminal" — ssh sessions, `wt.exe -p <profile>`, dev
shells, etc. "Re-detect installed" in Settings merges in anything new it
finds without touching your entries.

## Architecture

| Module | Responsibility |
|---|---|
| `src/config.rs` | Settings schema (designed first), persistence, terminal auto-detection |
| `src/sessions.rs` | Spawning terminals (`CREATE_NEW_CONSOLE` for console apps), live state polling, kill |
| `src/hotkey.rs` | Global hotkey registration + OS-level show/hide (works while the window is hidden and egui is asleep) |
| `src/theme.rs` | Dark theme: indigo accent, rounded surfaces, muted hierarchy |
| `src/app.rs` | Frameless always-on-top UI: launcher, sessions, settings |

One subtlety worth knowing: while the window is hidden, eframe delivers no
frames, so the hotkey listener thread toggles visibility directly via
`ShowWindow` instead of queueing viewport commands — that's what makes the
summon reliable.
