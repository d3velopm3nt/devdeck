//! What happened at one occurrence.
//!
//! A schedule says a thing recurs. This says what came of it *this time* —
//! whether it happened, and whatever you wrote down about it. One file per
//! occurrence, named by the date it belongs to:
//!
//! ```text
//! %APPDATA%\devdeck\assistant\events\7\2026-09-05.md
//! ```
//!
//! **Personal, and not negotiable about it.** Your Tuesday is yours: entries
//! live in the personal store beside your profile and your memory, never in a
//! repository. A deadline on a work item is the other side of that split and
//! stays in the vault where the item is — which is why a deadline has no entry
//! here. It has a work item, and the work item is the record.
//!
//! **The entry is a file, and the file is the truth.** No table, no index. A
//! week you did not record is a file that does not exist, which is exactly
//! what "I did not record it" should look like — rather than a row saying
//! nothing that has to be told apart from a row saying no.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// What goes in an entry's frontmatter.
///
/// Everything about the occurrence except the words, which are the body. The
/// wire type below carries both, because the interface wants one object —
/// but writing the notes in both places would make two copies of one thing
/// and a question about which wins when somebody edits the file by hand.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct Meta {
    #[serde(default)]
    schedule_id: i64,
    #[serde(default)]
    day: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    done: Option<bool>,
    #[serde(default)]
    updated_at: String,
}

/// One occurrence's record.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Entry {
    /// Which schedule, and which of its occurrences.
    #[serde(default)]
    pub schedule_id: i64,
    /// `YYYY-MM-DD` — the local day the occurrence falls on.
    #[serde(default)]
    pub day: String,
    /// Whether it happened. `None` is "not said yet", which is different from
    /// "no" and must stay different: an unanswered Tuesday is not a missed one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    /// Whatever you wrote. The body of the file, and part of what the
    /// interface is sent.
    #[serde(default)]
    pub notes: String,
    /// When this was last written.
    #[serde(default)]
    pub updated_at: String,
}

fn root() -> PathBuf {
    crate::aiw::personal::PersonalStore::default_root().join("events")
}

fn path_for(schedule_id: i64, day: &str) -> PathBuf {
    root().join(schedule_id.to_string()).join(format!("{day}.md"))
}

/// `YYYY-MM-DD` for a moment, in local time.
///
/// The day an occurrence *belongs to*, which is the local one — a 23:30 gym
/// session is Tuesday's even where UTC has already moved on.
pub fn day_of(at_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(at_ms)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Read one occurrence's entry. A file that is not there is an empty entry,
/// not an error: most occurrences have never been written about.
#[tauri::command]
pub fn event_entry(schedule_id: i64, at: i64) -> Result<Entry, String> {
    let day = day_of(at);
    let path = path_for(schedule_id, &day);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(Entry {
            schedule_id,
            day,
            ..Default::default()
        });
    };
    let doc = crate::aiw::deck::parse_doc::<Meta>(&text).map_err(|e| e.to_string())?;
    Ok(Entry {
        schedule_id,
        day,
        done: doc.meta.done,
        notes: doc.body.trim().to_string(),
        updated_at: doc.meta.updated_at,
    })
}

/// Write it. An entry with nothing said in it is deleted rather than kept as
/// an empty file — a folder of blank records is worse than an empty folder,
/// because it looks like data.
#[tauri::command]
pub fn event_entry_save(
    schedule_id: i64,
    at: i64,
    done: Option<bool>,
    notes: String,
) -> Result<Entry, String> {
    let day = day_of(at);
    let path = path_for(schedule_id, &day);
    let notes = notes.trim().to_string();

    if done.is_none() && notes.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(Entry {
            schedule_id,
            day,
            ..Default::default()
        });
    }

    let entry = Entry {
        schedule_id,
        day: day.clone(),
        done,
        notes: notes.clone(),
        updated_at: chrono::Local::now().to_rfc3339(),
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // The deck's own writer, so an entry is the same shape of file as
    // everything else DevDeck keeps — one frontmatter parser, one set of
    // quirks, and a file you can read in an editor.
    let text = crate::aiw::deck::write_doc(&crate::aiw::deck::Doc {
        meta: Meta {
            schedule_id,
            day: entry.day.clone(),
            done,
            updated_at: entry.updated_at.clone(),
        },
        body: notes,
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(entry)
}

/// Every entry for one schedule, newest first.
///
/// What turns a page into a record: the last time you did this, and the time
/// before that. Bounded — a schedule you have kept for years is still a folder
/// of small files, and the page only ever shows the recent end of it.
#[tauri::command]
pub fn event_history(schedule_id: i64, limit: Option<usize>) -> Result<Vec<Entry>, String> {
    let dir = root().join(schedule_id.to_string());
    let Ok(read) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut days: Vec<String> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.strip_suffix(".md").map(str::to_string)
        })
        .collect();
    days.sort();
    days.reverse();
    days.truncate(limit.unwrap_or(20));

    let mut out = Vec::new();
    for day in days {
        let path = path_for(schedule_id, &day);
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(doc) = crate::aiw::deck::parse_doc::<Meta>(&text) else {
            continue;
        };
        out.push(Entry {
            schedule_id,
            day,
            done: doc.meta.done,
            notes: doc.body.trim().to_string(),
            updated_at: doc.meta.updated_at,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The local day, not UTC's. A late session belongs to the evening it was
    /// part of.
    #[test]
    fn an_occurrence_belongs_to_its_local_day() {
        use chrono::TimeZone;
        let at = chrono::Local
            .with_ymd_and_hms(2026, 9, 5, 23, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        assert_eq!(day_of(at), "2026-09-05");
    }
}
