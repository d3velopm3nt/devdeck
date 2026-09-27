//! What Claude Code already has on this machine.
//!
//! DevDeck does not run its own agent — it spawns the real CLI. So the skills,
//! subagents and plugins you installed yourself are sitting right there, and
//! for a long time this window pretended they did not exist and offered you a
//! GitHub address instead.
//!
//! Reading them is not the same as using them. A worker is **sealed**: it gets
//! what it carries and nothing else, so your own `graphify` does not turn up
//! in a session about a landing page, and three hundred imported skills do not
//! turn up in your terminal. This module is the seeing half. Taking one for a
//! worker copies it into the library, where everything a worker carries lives
//! with a note of where it came from.
//!
//! Nothing here writes to `~/.claude`. Pressing a button in DevDeck must never
//! change what you get when you type `claude`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Where Claude Code keeps a person's own setup.
pub fn claude_home() -> PathBuf {
    if let Ok(set) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !set.trim().is_empty() {
            return PathBuf::from(set);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".claude")
}

/// One thing already installed, wherever it came from.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Local {
    /// The name a worker would call it by.
    pub id: String,
    /// skill | brief
    pub kind: String,
    pub name: String,
    pub what: String,
    /// Where it sits on this machine, in full, because that is the answer to
    /// "where did this come from" for something nobody downloaded through us.
    pub path: String,
    /// yours | plugin. A plugin's items are named by the plugin that brought
    /// them, so uninstalling that plugin explains where they went.
    pub source: String,
    /// The plugin's name, when it came from one.
    #[serde(default)]
    pub plugin: String,
    /// Already copied into the library, so a worker could carry it.
    pub have: bool,
}

/// A plugin as this machine knows it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Plugin {
    pub name: String,
    pub marketplace: String,
    pub what: String,
    /// Switched on in the person's own settings.
    pub enabled: bool,
    /// Whether it brings tools that run, rather than words.
    pub has_mcp: bool,
    pub path: String,
}

/// Everything on this machine, in one answer.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Machine {
    pub home: String,
    pub items: Vec<Local>,
    pub plugins: Vec<Plugin>,
    /// Said out loud when there is nothing to find.
    pub note: String,
}

/// Read the header of a skill or subagent file, the same way a repository's is
/// read — it is the same format, because it is the same kind of file.
fn head(p: &Path) -> (String, String) {
    let raw = std::fs::read_to_string(p).unwrap_or_default();
    crate::library::header(&raw)
}

/// `<dir>/skills/<name>/SKILL.md` and `<dir>/agents/<name>.md`.
fn scan(dir: &Path, source: &str, plugin: &str, out: &mut Vec<Local>) {
    let skills = dir.join("skills");
    if let Ok(entries) = std::fs::read_dir(&skills) {
        for e in entries.flatten() {
            let f = e.path().join("SKILL.md");
            if !f.is_file() {
                continue;
            }
            let id = e.file_name().to_string_lossy().to_string();
            let (name, what) = head(&f);
            out.push(Local {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                kind: crate::library::SKILL.to_string(),
                what,
                path: f.to_string_lossy().to_string(),
                source: source.to_string(),
                plugin: plugin.to_string(),
                have: false,
            });
        }
    }
    let agents = dir.join("agents");
    if let Ok(entries) = std::fs::read_dir(&agents) {
        for e in entries.flatten() {
            let f = e.path();
            if !f.is_file() || f.extension().and_then(|x| x.to_str()) != Some("md") {
                continue;
            }
            let id = f
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if id.eq_ignore_ascii_case("readme") {
                continue;
            }
            let (name, what) = head(&f);
            out.push(Local {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                kind: crate::library::BRIEF.to_string(),
                what,
                path: f.to_string_lossy().to_string(),
                source: source.to_string(),
                plugin: plugin.to_string(),
                have: false,
            });
        }
    }
}

/// Which plugins the person has switched on, from their own settings.
fn enabled_plugins(home: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(home.join("settings.json")).unwrap_or_default();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(map) = v.get("enabledPlugins").and_then(|p| p.as_object()) else {
        return Vec::new();
    };
    map.iter()
        .filter(|(_, on)| on.as_bool().unwrap_or(false))
        .map(|(k, _)| k.to_string())
        .collect()
}

/// A plugin folder is one with a `.claude-plugin/plugin.json` in it.
fn read_plugin(dir: &Path, marketplace: &str, on: &[String]) -> Option<Plugin> {
    let manifest = dir.join(".claude-plugin").join("plugin.json");
    let raw = std::fs::read_to_string(&manifest).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
        .or_else(|| Some(dir.file_name()?.to_string_lossy().to_string()))?;
    let what = v
        .get("description")
        .and_then(|d| d.as_str())
        .unwrap_or_default()
        .to_string();
    // A plugin that brings an MCP server brings something that runs, which is
    // a different kind of thing from a folder of words and is drawn that way.
    let has_mcp = dir.join(".mcp.json").is_file()
        || v.get("mcpServers").is_some()
        || dir.join("mcp.json").is_file();
    Some(Plugin {
        enabled: on
            .iter()
            .any(|e| e == &name || e.starts_with(&format!("{name}@"))),
        name,
        marketplace: marketplace.to_string(),
        what,
        has_mcp,
        path: dir.to_string_lossy().to_string(),
    })
}

/// Everything Claude Code has here: the person's own, and every plugin their
/// marketplaces hold.
pub fn machine() -> Result<Machine, String> {
    let home = claude_home();
    let mut items: Vec<Local> = Vec::new();
    let mut plugins: Vec<Plugin> = Vec::new();

    scan(&home, "yours", "", &mut items);

    let on = enabled_plugins(&home);
    let markets = home.join("plugins").join("marketplaces");
    if let Ok(entries) = std::fs::read_dir(&markets) {
        for m in entries.flatten() {
            let market = m.file_name().to_string_lossy().to_string();
            // A marketplace holds plugins one level down, sometimes under
            // `plugins/` and sometimes under `external_plugins/`, and
            // sometimes it is itself one plugin.
            for sub in ["plugins", "external_plugins", "."] {
                let base = m.path().join(sub);
                let Ok(inner) = std::fs::read_dir(&base) else {
                    continue;
                };
                for p in inner.flatten() {
                    if !p.path().is_dir() {
                        continue;
                    }
                    if let Some(pl) = read_plugin(&p.path(), &market, &on) {
                        if pl.enabled {
                            scan(&p.path(), "plugin", &pl.name, &mut items);
                        }
                        if !plugins.iter().any(|x| x.name == pl.name) {
                            plugins.push(pl);
                        }
                    }
                }
            }
        }
    }

    let mine = crate::library::read_index()?.items;
    for it in &mut items {
        it.have = mine.iter().any(|m| m.id == it.id && m.kind == it.kind);
    }

    items.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.id.cmp(&b.id)));
    plugins.sort_by(|a, b| b.enabled.cmp(&a.enabled).then(a.name.cmp(&b.name)));

    let note = if items.is_empty() && plugins.is_empty() {
        format!(
            "Nothing is installed in {}. Skills go in skills/<name>/SKILL.md and subagents in agents/<name>.md.",
            home.display()
        )
    } else {
        String::new()
    };

    Ok(Machine {
        home: home.to_string_lossy().to_string(),
        items,
        plugins,
        note,
    })
}

/// Copy one of this machine's own skills or subagents into the library, so a
/// worker can carry it.
///
/// Copied rather than pointed at, on purpose: a worker is sealed, and what it
/// carries must not change underneath it because you edited your own setup
/// this afternoon.
pub fn take(paths: &[String]) -> Result<crate::library::Added, String> {
    let m = machine()?;
    let mut out = crate::library::Added::default();
    let mut ix = crate::library::read_index()?;
    for want in paths {
        let Some(it) = m.items.iter().find(|i| &i.path == want) else {
            out.missed
                .push(format!("{want}: not on this machine any more"));
            continue;
        };
        let text = match std::fs::read_to_string(&it.path) {
            Ok(t) => t,
            Err(e) => {
                out.missed.push(format!("{}: {e}", it.path));
                continue;
            }
        };
        let item = crate::library::Item {
            id: it.id.clone(),
            kind: it.kind.clone(),
            name: it.name.clone(),
            what: it.what.clone(),
            // It came from this machine, and the folder it goes in is the one
            // a kit is grouped by, so it keeps the shape every other item has.
            repo: if it.plugin.is_empty() {
                "this machine".into()
            } else {
                format!("plugin: {}", it.plugin)
            },
            commit: String::new(),
            licence: "yours".into(),
            path: if it.kind == crate::library::SKILL {
                format!("skills/{}/SKILL.md", it.id)
            } else {
                format!("agents/{}.md", it.id)
            },
            added_at: crate::aiw::events::now_iso(),
            chars: text.chars().count() as i64,
        };
        let p = crate::library::item_path(&item)?;
        std::fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
        // A skill is a folder, and the rest of it matters: scripts it refers
        // to, templates it fills in. Taking only SKILL.md takes half a skill.
        if item.kind == crate::library::SKILL {
            if let Some(from) = Path::new(&it.path).parent() {
                copy_tree(from, p.parent().unwrap())?;
            }
        } else {
            std::fs::write(&p, &text).map_err(err)?;
        }
        ix.items
            .retain(|x| !(x.id == item.id && x.kind == item.kind));
        ix.items.push(item.clone());
        out.items.push(item);
    }
    ix.items
        .sort_by(|a, b| a.kind.cmp(&b.kind).then(a.id.cmp(&b.id)));
    crate::library::write_index_pub(&ix)?;
    if out.items.is_empty() && !out.missed.is_empty() {
        return Err(format!("nothing came in. {}", out.missed.join("; ")));
    }
    Ok(out)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(err)?;
    for e in std::fs::read_dir(from).map_err(err)?.flatten() {
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_tree(&p, &dest)?;
        } else if p.is_file() {
            std::fs::copy(&p, &dest).map_err(err)?;
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn machine_installed() -> Result<Machine, String> {
    machine()
}

#[tauri::command(async)]
pub fn machine_take(paths: Vec<String>) -> Result<crate::library::Added, String> {
    take(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_is_a_folder_and_a_subagent_is_a_file() {
        let tmp = std::env::temp_dir().join(format!("devdeck-installed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("skills").join("graphify")).unwrap();
        std::fs::write(
            tmp.join("skills").join("graphify").join("SKILL.md"),
            "---\nname: graphify\ndescription: any input to a knowledge graph\n---\nbody\n",
        )
        .unwrap();
        std::fs::create_dir_all(tmp.join("agents")).unwrap();
        std::fs::write(
            tmp.join("agents").join("reviewer.md"),
            "---\nname: reviewer\ndescription: reads code\n---\n",
        )
        .unwrap();
        // A README beside the subagents is a document about them, not one.
        std::fs::write(tmp.join("agents").join("README.md"), "# agents\n").unwrap();

        let mut out = Vec::new();
        scan(&tmp, "yours", "", &mut out);
        out.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(out.len(), 2, "{out:?}");
        assert_eq!(out[0].id, "graphify");
        assert_eq!(out[0].kind, crate::library::SKILL);
        assert_eq!(out[0].what, "any input to a knowledge graph");
        assert_eq!(out[1].id, "reviewer");
        assert_eq!(out[1].kind, crate::library::BRIEF);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_plugin_nobody_switched_on_is_listed_but_not_read() {
        let on = vec!["github@official".to_string()];
        let tmp = std::env::temp_dir().join(format!("devdeck-plugin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let dir = tmp.join("github");
        std::fs::create_dir_all(dir.join(".claude-plugin")).unwrap();
        std::fs::write(
            dir.join(".claude-plugin").join("plugin.json"),
            r#"{"name":"github","description":"pull requests and issues"}"#,
        )
        .unwrap();
        std::fs::write(dir.join(".mcp.json"), "{}").unwrap();
        let p = read_plugin(&dir, "official", &on).expect("a plugin");
        assert_eq!(p.name, "github");
        assert!(p.enabled, "enabledPlugins names it as github@official");
        assert!(p.has_mcp, "it brings something that runs");

        let off = read_plugin(&dir, "official", &[]).expect("a plugin");
        assert!(!off.enabled);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// What this machine actually holds.
    ///     cargo test --lib installed::tests::what_is_installed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn what_is_installed() {
        let m = machine().expect("read the machine");
        println!("home: {}", m.home);
        println!("{} items, {} plugins", m.items.len(), m.plugins.len());
        for i in &m.items {
            println!("  {} {} ({}) — {}", i.kind, i.id, i.source, i.what);
        }
        for p in &m.plugins {
            println!(
                "  plugin {} [{}]{} — {}",
                p.name,
                if p.enabled { "on" } else { "off" },
                if p.has_mcp { " mcp" } else { "" },
                p.what
            );
        }
    }
}
