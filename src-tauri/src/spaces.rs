//! Making a space, with a first cut already drafted.
//!
//! A new workspace used to be a `window.prompt` for a name: you got an empty
//! folder and worked out the rest later, which mostly meant never. This drafts
//! one instead — folders, a rhythm, and a bot if you want it — and then does
//! *exactly* what you agreed to, nothing more.
//!
//! **The starter chooses what gets drafted and nothing else.** It is not a new
//! kind of node to live with: once made, a space is a folder in the vault like
//! any other, and `vault.rs` still derives kind from depth. Nothing records
//! which starter it came from, because nothing later needs to know.
//!
//! **This command never invents.** The draft is composed and edited in the UI;
//! what arrives here is an explicit list of folders and routines, and it is
//! carried out literally. That is what makes the review screen truthful — it
//! shows the same list this function is about to act on, not a guess at what
//! the backend might do with it.
//!
//! **A partial failure is reported, not rolled back.** If the fourth folder
//! cannot be written, the three before it and the space itself are real and
//! yours; deleting a tree to tidy up a half-finished create is a worse outcome
//! than saying which part did not happen.

use serde::{Deserialize, Serialize};

use crate::db::Db;

/// A folder to make inside the new space, and the line that goes in its note
/// file saying what it is for.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct FolderDraft {
    pub name: String,
    #[serde(default)]
    pub why: String,
}

/// A reminder to put on the clock. Only reminders: a starter that drafted a
/// shell command would be guessing at something that runs on your machine, and
/// a wrong command is worse than one you never had.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RoutineDraft {
    pub name: String,
    /// daily | weekdays | weekly | hourly
    pub every: String,
    /// Minutes past midnight, local.
    pub at_min: i64,
    /// For 'weekly': comma-separated 0-6, Sunday first.
    #[serde(default)]
    pub days: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Starter {
    pub id: String,
    pub name: String,
    pub what: String,
    /// One line naming what it actually brings — kept beside the draft it
    /// produces so the promise and the delivery cannot drift apart.
    pub brings: String,
    /// The tag it suggests. Only a suggestion: the two are not tied, and a
    /// decision you are working out at work is Business.
    pub label: String,
    pub folders: Vec<FolderDraft>,
    pub routines: Vec<RoutineDraft>,
    /// Whether to offer a bot by default. A bot still needs a goal from you
    /// before it is made.
    pub bot: bool,
}

fn s(v: &str) -> String {
    v.to_string()
}

fn folder(name: &str, why: &str) -> FolderDraft {
    FolderDraft {
        name: s(name),
        why: s(why),
    }
}

fn weekly(name: &str, day: u8, at_min: i64) -> RoutineDraft {
    RoutineDraft {
        name: s(name),
        every: s("weekly"),
        at_min,
        days: day.to_string(),
    }
}

pub fn starters() -> Vec<Starter> {
    vec![
        Starter {
            id: s("business"),
            name: s("A business or a client"),
            what: s(
                "The company itself, or someone you work for. Products live inside it as folders.",
            ),
            brings: s("Clients, Money, Marketing · Monday and Friday"),
            label: s("Business"),
            folders: vec![
                folder("Clients", "Who the work is for."),
                folder("Money", "What is owed, and what is out."),
                folder("Marketing", "The site, and what it says."),
            ],
            routines: vec![
                weekly("The week ahead", 1, 9 * 60),
                weekly("Invoices and follow-ups", 5, 16 * 60),
            ],
            bot: true,
        },
        Starter {
            id: s("product"),
            name: s("A product you ship"),
            what: s("One thing with code behind it. Repositories, releases, something that runs."),
            // No folders on purpose: the repositories are yours to add, and
            // guessing their names would mean deleting three wrong ones first.
            brings: s("A release rhythm · a bot · your repositories go in as folders"),
            label: s("Business"),
            folders: vec![],
            routines: vec![weekly("Ready to ship?", 5, 15 * 60)],
            bot: true,
        },
        Starter {
            id: s("practice"),
            name: s("Something you practise"),
            what: s(
                "A thing you do again and again and want to keep at. Fitness, writing, a language.",
            ),
            brings: s("Two folders to rename · an evening rhythm"),
            label: s("Personal"),
            folders: vec![
                folder("Log", "What you actually did."),
                folder("Plan", "What is next."),
            ],
            routines: vec![
                weekly("Plan the week", 0, 18 * 60),
                weekly("How did the week go", 5, 19 * 60),
            ],
            bot: true,
        },
        Starter {
            id: s("subject"),
            name: s("Something you are working out"),
            what: s("A decision to reach or a subject to learn, where the output is an answer."),
            brings: s("Questions, Sources, Decisions · a weekly look back"),
            label: s("Personal"),
            folders: vec![
                folder("Questions", "What you are trying to answer."),
                folder("Sources", "Where the answers came from."),
                folder("Decisions", "What you settled, and what would reverse it."),
            ],
            routines: vec![weekly("What did I learn", 0, 18 * 60)],
            bot: true,
        },
        Starter {
            id: s("empty"),
            name: s("Start empty"),
            what: s("Just the folder. You add the rest."),
            brings: s("Nothing"),
            label: String::new(),
            folders: vec![],
            routines: vec![],
            bot: false,
        },
    ]
}

#[tauri::command]
pub fn space_starters() -> Vec<Starter> {
    starters()
}

/// What actually got made. `problems` is empty on a clean run; anything in it
/// happened *after* the space itself existed, so the space is real either way.
#[derive(Serialize, Clone, Debug, Default)]
pub struct SpaceCreated {
    pub node_id: i64,
    pub name: String,
    pub folders: Vec<String>,
    pub routines: Vec<String>,
    pub bot: bool,
    pub problems: Vec<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn space_create(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    name: String,
    label: String,
    folders: Vec<FolderDraft>,
    routines: Vec<RoutineDraft>,
    bot_name: String,
    bot_goal: String,
) -> Result<SpaceCreated, String> {
    // Fail before anything exists. A name the filesystem will refuse is the one
    // error worth catching up front, because everything after it is a folder.
    let name = crate::vault::valid_name(&name)?;

    let ws = crate::vault::vault_create(db.clone(), None, name.clone())?;
    let mut made = SpaceCreated {
        node_id: ws.id,
        name: name.clone(),
        ..Default::default()
    };

    if !label.trim().is_empty() {
        if let Err(e) = crate::vault::vault_set_meta(
            db.clone(),
            ws.id,
            Some(label.trim().to_string()),
            None,
            None,
            None,
        ) {
            made.problems.push(format!("could not tag it {label}: {e}"));
        }
    }

    for f in &folders {
        let fname = f.name.trim();
        if fname.is_empty() {
            continue;
        }
        match crate::vault::vault_create(db.clone(), Some(ws.id), fname.to_string()) {
            Ok(node) => {
                // The line that says what the folder is for goes in its own note
                // file, so the reason survives outside DevDeck.
                if !f.why.trim().is_empty() {
                    let _ = crate::vault::vault_set_meta(
                        db.clone(),
                        node.id,
                        None,
                        None,
                        None,
                        Some(f.why.trim().to_string()),
                    );
                }
                made.folders.push(fname.to_string());
            }
            Err(e) => made.problems.push(format!("folder “{fname}”: {e}")),
        }
    }

    for r in &routines {
        let rname = r.name.trim();
        if rname.is_empty() {
            continue;
        }
        match crate::schedule::schedule_save(
            db.clone(),
            None,
            rname.to_string(),
            "reminder".into(),
            Some(ws.id),
            r.every.clone(),
            r.at_min,
            r.days.clone(),
            String::new(),
            // A reminder never catches up: being told to plan the week on
            // Tuesday because the app was shut on Sunday is noise.
            false,
        ) {
            Ok(_) => made.routines.push(rname.to_string()),
            Err(e) => made.problems.push(format!("reminder “{rname}”: {e}")),
        }
    }

    // The bot is last and needs a goal. Without one there is nothing for it to
    // judge a suggestion against, so a blank goal means no bot rather than an
    // empty one — and the screen asks for it before letting you get here.
    if !bot_name.trim().is_empty() && !bot_goal.trim().is_empty() {
        match crate::bots::bot_create(
            app.clone(),
            db.clone(),
            ws.id,
            "blank".into(),
            bot_name.trim().to_string(),
            bot_goal.trim().to_string(),
            // It watches on the same rhythm the space keeps, in the morning.
            "weekdays".into(),
            8 * 60,
            String::new(),
            false,
        ) {
            Ok(_) => made.bot = true,
            Err(e) => made.problems.push(format!("its bot: {e}")),
        }
    }

    crate::activity::record(
        &app,
        "space",
        format!("{name} created"),
        format!(
            "{} folder{}, {} reminder{}{}",
            made.folders.len(),
            if made.folders.len() == 1 { "" } else { "s" },
            made.routines.len(),
            if made.routines.len() == 1 { "" } else { "s" },
            if made.bot { ", and a bot" } else { "" }
        ),
        made.problems.is_empty(),
        Some(ws.id),
    );

    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_starter_is_findable_and_says_what_it_brings() {
        for st in starters() {
            assert!(!st.id.trim().is_empty(), "a starter needs an id");
            assert!(!st.brings.trim().is_empty(), "{} does not say what it brings", st.id);
        }
    }

    /// The tag is a suggestion, and only two of them mean anything to the rest
    /// of the app — a starter suggesting "Prodct" would silently give a space
    /// work-hours defaults it never asked for.
    #[test]
    fn a_starter_suggests_a_real_tag_or_none() {
        for st in starters() {
            assert!(
                st.label.is_empty() || st.label == "Business" || st.label == "Personal",
                "{} suggests {:?}",
                st.id,
                st.label
            );
        }
    }

    /// Every drafted routine has to be a shape the scheduler can actually fire.
    #[test]
    fn every_drafted_routine_is_one_the_clock_understands() {
        for st in starters() {
            for r in &st.routines {
                assert!(
                    ["daily", "weekdays", "weekly", "hourly"].contains(&r.every.as_str()),
                    "{} drafts '{}'",
                    st.id,
                    r.every
                );
                assert!((0..1440).contains(&r.at_min), "{} drafts {}", st.id, r.at_min);
                if r.every == "weekly" {
                    let day: i64 = r.days.parse().unwrap_or(-1);
                    assert!((0..7).contains(&day), "{} drafts day {:?}", st.id, r.days);
                }
            }
        }
    }

    /// A folder name the filesystem would refuse is a create that fails half
    /// way through, so the drafts have to be nameable before anyone sees them.
    #[test]
    fn every_drafted_folder_is_a_name_the_vault_will_take() {
        for st in starters() {
            for f in &st.folders {
                assert!(
                    crate::vault::valid_name(&f.name).is_ok(),
                    "{} drafts an unusable folder {:?}",
                    st.id,
                    f.name
                );
                assert!(!f.why.trim().is_empty(), "{}/{} has no reason", st.id, f.name);
            }
        }
    }

    #[test]
    fn starting_empty_brings_nothing() {
        let e = starters().into_iter().find(|x| x.id == "empty").unwrap();
        assert!(e.folders.is_empty() && e.routines.is_empty() && !e.bot);
        assert!(e.label.is_empty(), "and does not decide the tag for you");
    }
}
