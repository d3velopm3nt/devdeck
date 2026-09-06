//! Your managers, above the spaces rather than inside one.
//!
//! A bot used to be `_bot.md` in a folder, which made two things true that we
//! no longer want: a manager could only be responsible for one place, and
//! reporting lines were the directory layout. A marketing manager who covers a
//! DevDeck feature *and* the TrackX site cannot be said at all in that shape.
//!
//! So the model splits in two: **the tree is the work, and the org is the
//! people.** They were only ever conflated because a bot lived in a folder.
//!
//! A manager lives at the vault root — `.devdeck/team/<handle>.md`, one file
//! each. Not in a space, since it belongs to none of them; not in the personal
//! store, which is for things about *you*, and your team is not a preference.
//! Files stay the truth, the team travels with the vault, and nothing lands
//! inside a repository.
//!
//! **A manager owns features, never spaces.** Owning a folder was the trap.
//! Which features it owns is not written down here: the *feature* names its
//! owner, in the deck beside the work. One field cannot hold two values, so
//! "one owner per feature" enforces itself, and "who is accountable for this"
//! is answerable from the feature alone without consulting a roster. The
//! portfolio is therefore derived, and cannot drift from the work it describes.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::db;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// One manager: who they are, when they wake, and who they may put to work.
///
/// Deliberately the same vocabulary a bot already had, minus the node. What is
/// gone is `node_id`, `node_name`, `dir` and `feature` — the first three
/// because a manager is not a place, and the last because ownership belongs on
/// the feature.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Manager {
    /// What people type after the `@`. The file name, and the identity.
    pub handle: String,
    pub name: String,
    /// "marketing manager", "release manager" — a role carries its skills and
    /// its agents, so this is more than a label.
    #[serde(default)]
    pub role: String,
    /// The sentence the whole manager is about.
    pub goal: String,
    /// daily | weekdays | weekly | hourly, or empty for no heartbeat.
    #[serde(default)]
    pub every: String,
    /// Minutes past midnight, local.
    #[serde(default)]
    pub at_min: i64,
    /// For 'weekly': comma-separated 0-6, Sunday first.
    #[serde(default)]
    pub days: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub skills: Vec<String>,
    /// Which role template it came from, empty when made by hand.
    #[serde(default)]
    pub template: String,
    /// The agent its heartbeat wakes. A manager hands off; it does not do the
    /// work. Empty means it can keep a plan and ask questions and nothing
    /// else, which is a vacancy rather than a fault.
    #[serde(default)]
    pub agent: String,
    /// Every agent it may put work on, its lead included.
    #[serde(default)]
    pub team: Vec<String>,
    #[serde(default)]
    pub wake_intent: String,
    #[serde(default)]
    pub stop_at: Vec<String>,
    /// Where this came from, when it came from a `_bot.md`. Kept so the
    /// migration can be read back rather than guessed at.
    #[serde(default)]
    pub was: String,
}

/// `<vault>/.devdeck/team`, or None when no vault has been chosen yet.
pub fn dir(conn: &Connection) -> Option<PathBuf> {
    let root = db::setting_get_conn(conn, "vault_root").ok().flatten()?;
    if root.trim().is_empty() {
        return None;
    }
    Some(PathBuf::from(root).join(".devdeck").join("team"))
}

/// What people type after the `@`, derived from a name the same way a bot's
/// handle always was.
pub fn handle_from(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    // No leading, trailing or doubled dashes, or `@x--platform-bot` becomes a
    // handle nobody can type from memory.
    slug.split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Read one file. Forgiving in the same way `_bot.md` is: someone editing it
/// by hand should not lose a manager to a typo.
fn parse(handle: &str, raw: &str) -> Manager {
    let mut m = Manager {
        handle: handle.to_string(),
        at_min: 420,
        ..Default::default()
    };
    let list = |v: &str| -> Vec<String> {
        v.trim_matches(|c| c == '[' || c == ']')
            .split(',')
            .map(|x| x.trim().trim_matches('"').to_string())
            .filter(|x| !x.is_empty())
            .collect()
    };

    let rest = match raw.strip_prefix("---") {
        Some(after) => match after.find("\n---") {
            Some(end) => {
                for line in after[..end].lines() {
                    let Some((k, v)) = line.split_once(':') else { continue };
                    let v = v.trim().trim_matches('"').to_string();
                    match k.trim() {
                        "name" => m.name = v,
                        "role" => m.role = v,
                        "goal" => m.goal = v,
                        "every" => m.every = v,
                        "at" => m.at_min = crate::bots::parse_at(&v),
                        "days" => m.days = v,
                        "template" => m.template = v,
                        "agent" => m.agent = v,
                        "team" => m.team = list(&v),
                        "wake_intent" => m.wake_intent = v,
                        "stop_at" => m.stop_at = list(&v),
                        "skills" => m.skills = list(&v),
                        "was" => m.was = v,
                        _ => {}
                    }
                }
                &after[end + 4..]
            }
            None => raw,
        },
        None => raw,
    };
    m.body = rest.trim().to_string();
    if m.name.trim().is_empty() {
        m.name = handle.to_string();
    }
    m
}

fn serialise(m: &Manager) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", m.name.trim()));
    if !m.role.trim().is_empty() {
        out.push_str(&format!("role: {}\n", m.role.trim()));
    }
    if !m.goal.trim().is_empty() {
        out.push_str(&format!("goal: {}\n", m.goal.trim()));
    }
    if !m.every.trim().is_empty() {
        out.push_str(&format!("every: {}\n", m.every.trim()));
        out.push_str(&format!("at: \"{}\"\n", crate::bots::fmt_at(m.at_min)));
        if m.every == "weekly" && !m.days.trim().is_empty() {
            out.push_str(&format!("days: {}\n", m.days.trim()));
        }
    }
    if !m.template.trim().is_empty() {
        out.push_str(&format!("template: {}\n", m.template.trim()));
    }
    if !m.skills.is_empty() {
        out.push_str(&format!("skills: [{}]\n", m.skills.join(", ")));
    }
    if !m.agent.trim().is_empty() {
        out.push_str(&format!("agent: {}\n", m.agent.trim()));
    }
    if !m.team.is_empty() {
        out.push_str(&format!("team: [{}]\n", m.team.join(", ")));
    }
    if !m.wake_intent.trim().is_empty() {
        out.push_str(&format!("wake_intent: {}\n", m.wake_intent.trim()));
    }
    if !m.stop_at.is_empty() {
        out.push_str(&format!("stop_at: [{}]\n", m.stop_at.join(", ")));
    }
    if !m.was.trim().is_empty() {
        out.push_str(&format!("was: {}\n", m.was.trim()));
    }
    out.push_str("---\n");
    if !m.body.trim().is_empty() {
        out.push('\n');
        out.push_str(m.body.trim());
        out.push('\n');
    }
    out
}

/// Everyone, by handle. An unreadable file is skipped rather than fatal: one
/// bad manager must not empty the team.
pub fn all(conn: &Connection) -> Vec<Manager> {
    let Some(d) = dir(conn) else { return Vec::new() };
    let Ok(entries) = fs::read_dir(&d) else {
        return Vec::new();
    };
    let mut out: Vec<Manager> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .filter_map(|e| {
            let handle = e.path().file_stem()?.to_string_lossy().to_string();
            let raw = fs::read_to_string(e.path()).ok()?;
            Some(parse(&handle, &raw))
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn get(conn: &Connection, handle: &str) -> Option<Manager> {
    let d = dir(conn)?;
    let raw = fs::read_to_string(d.join(format!("{handle}.md"))).ok()?;
    Some(parse(handle, &raw))
}

pub fn save(conn: &Connection, m: &Manager) -> Result<(), String> {
    let d = dir(conn).ok_or("No vault folder has been chosen yet.")?;
    fs::create_dir_all(&d).map_err(err)?;
    if m.handle.trim().is_empty() {
        return Err("A manager needs a handle.".into());
    }
    fs::write(d.join(format!("{}.md", m.handle.trim())), serialise(m)).map_err(err)
}

pub fn delete(conn: &Connection, handle: &str) -> Result<(), String> {
    let Some(d) = dir(conn) else { return Ok(()) };
    let p = d.join(format!("{handle}.md"));
    if p.is_file() {
        fs::remove_file(&p).map_err(err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Coming from the old shape
// ---------------------------------------------------------------------------

/// Move every `_bot.md` into the team, and stamp the feature it managed with
/// its new owner.
///
/// Runs once. The old files are left exactly where they are: they are yours,
/// they are in your vault, and a migration that deletes a file the first time
/// it runs is one you cannot check afterwards. Nothing reads them once the
/// team exists, and `was:` on each manager says where it came from.
///
/// Returns what it did, so the caller can say so rather than migrate in
/// silence.
pub fn migrate_from_bots(conn: &Connection) -> Vec<String> {
    let mut done = Vec::new();
    let Some(d) = dir(conn) else { return done };
    // Already a team? Then this has happened, or you have built one by hand.
    // Either way it is not ours to overwrite.
    if all(conn).len() > 0 {
        return done;
    }

    for b in crate::bots::all_bots(conn) {
        let handle = crate::bots::handle_of(&b);
        let m = Manager {
            handle: handle.clone(),
            name: b.name.clone(),
            role: String::new(),
            goal: b.goal.clone(),
            every: b.every.clone(),
            at_min: b.at_min,
            days: b.days.clone(),
            body: b.body.clone(),
            skills: b.skills.clone(),
            template: b.template.clone(),
            agent: b.agent.clone(),
            team: b.team.clone(),
            wake_intent: b.wake_intent.clone(),
            stop_at: b.stop_at.clone(),
            was: format!("{}/{}", b.dir.trim_end_matches(['/', '\\']), crate::bots::FILE),
        };
        if fs::create_dir_all(&d).is_err() {
            return done;
        }
        if save(conn, &m).is_err() {
            continue;
        }

        // The feature it managed now says who owns it. This is the half that
        // makes the portfolio derivable — without it the team is a roster of
        // managers responsible for nothing.
        if !b.feature.trim().is_empty() {
            if let Some(deck_dir) = db::node_deck_dir_by_id(conn, b.node_id) {
                let deck = crate::aiw::deck::Deck::new(deck_dir);
                if let Ok(mut doc) = deck.feature(&b.feature) {
                    if doc.meta.owner.trim().is_empty() {
                        doc.meta.owner = handle.clone();
                        let p = deck.feature_md(&b.feature);
                        let _ = deck.write_doc_at(&p, &doc);
                    }
                }
            }
        }
        done.push(handle);
    }
    done
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_handle_is_typeable() {
        assert_eq!(handle_from("Marketing Manager"), "marketing-manager");
        assert_eq!(handle_from("x-platform bot"), "x-platform-bot");
        // No doubled or trailing dashes, whatever the name does.
        assert_eq!(handle_from("  Release // Manager  "), "release-manager");
    }

    #[test]
    fn a_file_survives_a_round_trip() {
        let m = Manager {
            handle: "marketing".into(),
            name: "Marketing manager".into(),
            role: "marketing manager".into(),
            goal: "Launch the SaaS tier".into(),
            every: "weekdays".into(),
            at_min: 9 * 60,
            days: String::new(),
            body: "Writes like a person, not a brochure.".into(),
            skills: vec!["positioning".into(), "launch-checklist".into()],
            template: "marketing".into(),
            agent: "dev-a".into(),
            team: vec!["dev-a".into(), "qa".into()],
            wake_intent: "check the launch plan".into(),
            stop_at: vec!["before any push".into()],
            was: String::new(),
        };
        let back = parse("marketing", &serialise(&m));
        assert_eq!(back.name, m.name);
        assert_eq!(back.role, m.role);
        assert_eq!(back.goal, m.goal);
        assert_eq!(back.every, m.every);
        assert_eq!(back.at_min, m.at_min);
        assert_eq!(back.skills, m.skills);
        assert_eq!(back.team, m.team);
        assert_eq!(back.stop_at, m.stop_at);
        assert_eq!(back.body, m.body);
    }

    #[test]
    fn a_file_with_no_frontmatter_is_still_a_manager() {
        let m = parse("release", "Just some prose someone typed.");
        assert_eq!(m.handle, "release");
        // The handle stands in for a missing name rather than leaving a blank
        // row on screen.
        assert_eq!(m.name, "release");
        assert_eq!(m.body, "Just some prose someone typed.");
    }
}
