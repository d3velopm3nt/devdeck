//! Time, across every space at once.
//!
//! One query answers "what is happening between these two moments", and
//! everything that has a time in DevDeck answers it: schedules, whether they
//! are rhythms or moments; the wakes and runs that already happened; and work
//! items with a deadline. Four sources, one shape, sorted by when.
//!
//! **A window, not a page.** The views — day, week, month, year — differ only
//! in the window they ask for and how they draw the answer. There is no
//! per-view query, so a day and the month containing it cannot disagree about
//! what is in them.
//!
//! **Expanded, not stored.** A daily reminder is one row that occurs three
//! hundred and sixty-five times a year. Occurrences are computed for the
//! window asked for and thrown away, because writing them down would mean
//! keeping them in step with the rule that made them — and the rule is the
//! truth.
//!
//! **The store split holds.** A deadline on a work item is the project's own,
//! read from `.devdeck` in the vault; a personal reminder belongs to no space
//! and lives in the database beside your other schedules. Both appear here;
//! neither moves house to do it.

use serde::Serialize;

use crate::db::{err, Db};

/// One thing at one time.
#[derive(Serialize, Clone, Debug)]
pub struct Item {
    /// Stable within a window: `kind:source-id:occurrence`.
    pub id: String,
    /// schedule | run | deadline
    pub kind: String,
    /// reminder | command | bot | agent | work — what sort of thing it is,
    /// under its kind.
    pub sort: String,
    pub title: String,
    /// When it starts, unix ms.
    pub at: i64,
    /// When it ends. Equal to `at` for an instant.
    pub end: i64,
    /// The space it belongs to, if any. A personal reminder has none, which is
    /// the difference between your evening and the project's.
    pub node_id: Option<i64>,
    pub space: String,
    /// For a deadline: which feature and item.
    pub feature: String,
    pub work_item: String,
    /// done | blocked | in-progress | unclaimed | ok | failed | missed —
    /// whatever the source says about itself.
    pub status: String,
    /// Whether it has already happened.
    pub past: bool,
    /// The source row, for opening it.
    pub schedule_id: Option<i64>,
}

/// A day, a week, a month, a year — the only thing that differs between views.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Window {
    pub from: i64,
    pub to: i64,
}

fn ms(d: chrono::DateTime<chrono::Local>) -> i64 {
    d.timestamp_millis()
}

/// Every moment a schedule occurs inside a window.
///
/// Bounded by construction: a rhythm is stepped a day at a time and an hourly
/// one an hour at a time, and both stop at `to`. A window is at most a year,
/// so the worst case is a few thousand cheap iterations rather than a
/// surprise.
pub fn occurrences(s: &crate::schedule::Schedule, from: i64, to: i64) -> Vec<i64> {
    use chrono::{Datelike, Duration, TimeZone, Timelike};
    let mut out = Vec::new();
    if !s.enabled {
        return out;
    }

    if s.every == "once" {
        if let Some(at) = s.at_ms {
            if at >= from && at <= to {
                out.push(at);
            }
        }
        return out;
    }

    let Some(start) = chrono::DateTime::from_timestamp_millis(from) else {
        return out;
    };
    let start = start.with_timezone(&chrono::Local);

    if s.every == "hourly" {
        let mut t = start
            .date_naive()
            .and_hms_opt(start.hour(), 0, 0)
            .and_then(|n| chrono::Local.from_local_datetime(&n).single())
            .unwrap_or(start);
        while ms(t) <= to {
            if ms(t) >= from {
                out.push(ms(t));
            }
            t += Duration::hours(1);
        }
        return out;
    }

    let wanted = |d: chrono::DateTime<chrono::Local>| -> bool {
        match s.every.as_str() {
            "daily" => true,
            "weekdays" => d.weekday().num_days_from_monday() < 5,
            "weekly" => {
                let dow = d.weekday().num_days_from_sunday() as i64;
                s.days
                    .split(',')
                    .filter_map(|x| x.trim().parse::<i64>().ok())
                    .any(|x| x == dow)
            }
            _ => false,
        }
    };

    let mut day = start.date_naive();
    let last = chrono::DateTime::from_timestamp_millis(to)
        .map(|d| d.with_timezone(&chrono::Local).date_naive())
        .unwrap_or(day);
    while day <= last {
        let at = day
            .and_hms_opt((s.at_min / 60) as u32, (s.at_min % 60) as u32, 0)
            .and_then(|n| chrono::Local.from_local_datetime(&n).single());
        if let Some(at) = at {
            if wanted(at) && ms(at) >= from && ms(at) <= to {
                out.push(ms(at));
            }
        }
        day += Duration::days(1);
    }
    out
}

/// `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` → unix ms, local.
///
/// A date with no time is the end of that day: "due Friday" means by the time
/// Friday is over, not by midnight as it begins — which would make everything
/// a day late the moment it was written down.
pub fn parse_due(s: &str) -> Option<i64> {
    use chrono::TimeZone;
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M") {
        return chrono::Local.from_local_datetime(&dt).single().map(ms);
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M") {
        return chrono::Local.from_local_datetime(&dt).single().map(ms);
    }
    let d = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
    chrono::Local
        .from_local_datetime(&d.and_hms_opt(23, 59, 0)?)
        .single()
        .map(ms)
}

/// Everything between two moments, from every source, sorted by when.
#[tauri::command]
pub fn calendar_range(
    db: tauri::State<Db>,
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
    from: i64,
    to: i64,
) -> Result<Vec<Item>, String> {
    let mut out: Vec<Item> = Vec::new();

    // -- schedules, expanded ------------------------------------------------
    {
        let conn = db.0.lock().unwrap();
        let names: std::collections::HashMap<i64, String> = crate::db::nodes_on(&conn)
            .unwrap_or_default()
            .into_iter()
            .map(|n| (n.id, n.name))
            .collect();
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM schedules ORDER BY at_min, id",
                crate::schedule::COLS
            ))
            .map_err(err)?;
        let rows = stmt
            .query_map([], crate::schedule::row)
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let now = chrono::Local::now().timestamp_millis();
        for s in rows {
            for at in occurrences(&s, from, to) {
                out.push(Item {
                    id: format!("schedule:{}:{at}", s.id),
                    kind: "schedule".into(),
                    sort: s.kind.clone(),
                    title: s.name.clone(),
                    at,
                    end: at + s.duration_min.max(0) * 60_000,
                    node_id: s.node_id,
                    space: s
                        .node_id
                        .and_then(|n| names.get(&n).cloned())
                        .unwrap_or_default(),
                    feature: String::new(),
                    work_item: String::new(),
                    // What a past occurrence did, when it is the one that ran.
                    status: if at > now {
                        "planned".into()
                    } else if s.last_run.is_some_and(|r| (r - at).abs() < 120_000) {
                        if s.last_ok { "ok".into() } else { "failed".into() }
                    } else {
                        "past".into()
                    },
                    past: at <= now,
                    schedule_id: Some(s.id),
                });
            }
        }
    }

    // -- deadlines, from every space's deck ---------------------------------
    {
        let now = chrono::Local::now().timestamp_millis();
        for p in ws.project_ids().into_iter().filter_map(|id| ws.project(&id)) {
            let deck = p.deck();
            for slug in deck.feature_slugs() {
                let Ok(work) = deck.work(&slug) else { continue };
                for item in work.meta.items {
                    let Some(due) = item.due.as_deref().and_then(parse_due) else {
                        continue;
                    };
                    if due < from || due > to {
                        continue;
                    }
                    out.push(Item {
                        id: format!("deadline:{}:{}:{}", p.id, slug, item.id),
                        kind: "deadline".into(),
                        sort: "work".into(),
                        title: item.title.clone(),
                        at: due,
                        end: due,
                        node_id: p.id.parse::<i64>().ok(),
                        space: p.name.clone(),
                        feature: slug.clone(),
                        work_item: item.id.clone(),
                        status: if item.status.trim().is_empty() {
                            "unclaimed".into()
                        } else {
                            item.status.clone()
                        },
                        past: due <= now,
                        schedule_id: None,
                    });
                }
            }
        }
    }

    out.sort_by_key(|i| i.at);
    Ok(out)
}

/// Deadlines that are close, whether or not anyone asked.
///
/// The half of a deadline that makes it worth writing down: it comes and finds
/// you. Called by the clock, once a tick, and it says something only when a
/// deadline is inside the lead time and the item is not done.
///
/// Told once per item per day, tracked in `deadline_pings`. A reminder that
/// arrives every thirty seconds is not a reminder, it is a reason to turn
/// reminders off.
pub const PINGS_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS deadline_pings (
    item TEXT PRIMARY KEY,
    on_day TEXT NOT NULL
);
";

/// How much warning a deadline gives, in hours.
const LEAD_HOURS: i64 = 48;

pub fn check_deadlines(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(db) = app.try_state::<Db>() else { return };
    let Some(ws) = app.try_state::<std::sync::Arc<crate::aiw::state::Workspace>>() else {
        return;
    };
    let now = chrono::Local::now();
    let now_ms = now.timestamp_millis();
    let today = now.format("%Y-%m-%d").to_string();
    let horizon = now_ms + LEAD_HOURS * 3_600_000;

    for p in ws.project_ids().into_iter().filter_map(|id| ws.project(&id)) {
        let deck = p.deck();
        for slug in deck.feature_slugs() {
            let Ok(work) = deck.work(&slug) else { continue };
            for item in work.meta.items {
                if item.status.trim() == "done" {
                    continue;
                }
                let Some(due) = item.due.as_deref().and_then(parse_due) else {
                    continue;
                };
                if due > horizon {
                    continue;
                }
                let key = format!("{}:{}:{}", p.id, slug, item.id);
                {
                    let Ok(conn) = db.0.lock() else { return };
                    let said: Option<String> = conn
                        .query_row(
                            "SELECT on_day FROM deadline_pings WHERE item = ?1",
                            rusqlite::params![key],
                            |r| r.get(0),
                        )
                        .ok();
                    if said.as_deref() == Some(today.as_str()) {
                        continue;
                    }
                    let _ = conn.execute(
                        "INSERT INTO deadline_pings (item, on_day) VALUES (?1, ?2) \
                         ON CONFLICT(item) DO UPDATE SET on_day = excluded.on_day",
                        rusqlite::params![key, today],
                    );
                }
                let when = if due < now_ms {
                    "overdue".to_string()
                } else {
                    let hours = (due - now_ms) / 3_600_000;
                    if hours < 24 {
                        format!("due in {hours}h")
                    } else {
                        format!("due in {}d", hours / 24)
                    }
                };
                // The same road every reminder takes: the activity feed, which
                // is what the Inbox reads. A deadline that arrived by some
                // other route would not be beside the things it competes with.
                crate::activity::record(
                    app,
                    "schedule",
                    format!("{} — {when}", item.title),
                    format!("{} · {slug} · {}", p.name, item.id),
                    due >= now_ms,
                    None,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        chrono::Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .unwrap()
            .timestamp_millis()
    }

    fn sched(every: &str, at_min: i64) -> crate::schedule::Schedule {
        crate::schedule::Schedule {
            id: 1,
            name: "Stand-up".into(),
            kind: "reminder".into(),
            node_id: None,
            every: every.into(),
            at_min,
            at_ms: None,
            duration_min: 0,
            days: String::new(),
            payload: String::new(),
            enabled: true,
            catch_up: false,
            last_run: None,
            last_ok: true,
            last_note: String::new(),
            next_run: None,
        }
    }

    /// A rhythm occurs once a day inside the window, at its own minute — and
    /// stops at both ends of it. A view that asked for a week and got a
    /// fortnight would draw the fortnight.
    #[test]
    fn a_daily_rhythm_occurs_once_a_day_inside_the_window() {
        let s = sched("daily", 9 * 60 + 30);
        let from = at(2026, 9, 7, 0, 0);
        let to = at(2026, 9, 13, 23, 59);
        let times = occurrences(&s, from, to);
        assert_eq!(times.len(), 7, "one a day across the week");
        assert_eq!(times[0], at(2026, 9, 7, 9, 30), "at half nine, not midnight");
        assert!(times.iter().all(|t| *t >= from && *t <= to));
    }

    /// Weekdays skip the weekend. The obvious property, asserted because the
    /// two day-numbering schemes in this file are one off from each other and
    /// the bug would be invisible until a Saturday.
    #[test]
    fn weekdays_are_five_days_not_seven() {
        let s = sched("weekdays", 8 * 60);
        // Monday 7 September 2026 to Sunday the 13th.
        let times = occurrences(&s, at(2026, 9, 7, 0, 0), at(2026, 9, 13, 23, 59));
        assert_eq!(times.len(), 5, "Monday to Friday: {times:?}");
    }

    /// A moment happens once, in the window that contains it, and nowhere else.
    #[test]
    fn a_moment_lands_in_exactly_one_window() {
        let mut s = sched("once", 0);
        s.at_ms = Some(at(2026, 9, 11, 14, 0));
        s.duration_min = 60;

        assert_eq!(
            occurrences(&s, at(2026, 9, 11, 0, 0), at(2026, 9, 11, 23, 59)).len(),
            1,
            "the day it is on"
        );
        assert!(
            occurrences(&s, at(2026, 9, 12, 0, 0), at(2026, 9, 12, 23, 59)).is_empty(),
            "not the day after"
        );
        assert!(
            occurrences(&s, at(2026, 9, 1, 0, 0), at(2026, 9, 30, 23, 59)).len() == 1,
            "once in the month, not once a day"
        );
    }

    /// A schedule that is switched off is not on the calendar. It is still a
    /// row, and still on the Routines page, and that is where to turn it on.
    #[test]
    fn a_disabled_schedule_does_not_occur() {
        let mut s = sched("daily", 60);
        s.enabled = false;
        assert!(occurrences(&s, at(2026, 9, 7, 0, 0), at(2026, 9, 13, 0, 0)).is_empty());
    }

    /// "Due Friday" means by the end of Friday.
    ///
    /// Midnight-as-it-begins would make everything a day late the moment it
    /// was written down, and every deadline would arrive already overdue.
    #[test]
    fn a_date_with_no_time_is_the_end_of_that_day() {
        assert_eq!(parse_due("2026-09-11"), Some(at(2026, 9, 11, 23, 59)));
        assert_eq!(parse_due("2026-09-11T14:00"), Some(at(2026, 9, 11, 14, 0)));
        assert_eq!(parse_due("2026-09-11 14:00"), Some(at(2026, 9, 11, 14, 0)));
        assert_eq!(parse_due(""), None);
        assert_eq!(parse_due("next Friday"), None, "a guess is worse than none");
    }
}
