//! Bots, driven the way a person drives them.
//!
//! Not unit tests of one function each — whole lifecycles, against real files
//! in a real temporary vault and a real temporary personal store. Every one of
//! these caught something the first time it ran, and the two stores being
//! genuinely separate is checked rather than assumed.
//!
//! What is deliberately *not* mocked: the `_bot.md` on disk, the `.devdeck`
//! work items, the `schedules` row, and the personal store's own files. A test
//! that mocks all four proves the test harness works.

use super::*;
use crate::aiw::personal::PersonalStore;
use crate::botmind::{self as ops, Mind};

/// One temporary world: a vault, a personal store, and a database, none of
/// which touch the machine's real ones.
struct World {
    conn: Connection,
    root: PathBuf,
    mind: Mind,
    _tmp: PathBuf,
}

impl World {
    /// The folder a node lives in, created on disk.
    fn node(&self, id: i64, parent: Option<i64>, kind: &str, name: &str, rel: &str) {
        self.conn
            .execute(
                "INSERT INTO nodes (id, parent_id, kind, name, path, rel_path, sort) \
                 VALUES (?1, ?2, ?3, ?4, '', ?5, 0)",
                params![id, parent, kind, name, rel],
            )
            .unwrap();
        std::fs::create_dir_all(self.root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)))
            .unwrap();
    }

    fn dir(&self, rel: &str) -> PathBuf {
        self.root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
    }

    fn bot(&self, node_id: i64) -> Bot {
        let n = db::node_by_id(&self.conn, node_id).unwrap();
        let dir = dir_of(&self.conn, &n).unwrap();
        let mut b = read(&dir).expect("a bot on disk");
        b.node_id = node_id;
        if let Some((id, last)) = heartbeat(&self.conn, node_id) {
            b.schedule_id = Some(id);
            b.last_woke = last;
        }
        b
    }

    fn work(&self, node_id: i64) -> Vec<crate::aiw::deck::WorkItem> {
        let (deck, dir) = deck_of(&self.conn, node_id).unwrap();
        let bot = read(&dir);
        let only = bot.map(|b| b.feature).unwrap_or_default();
        let mut out = Vec::new();
        if !deck.exists() {
            return out;
        }
        for slug in deck.feature_slugs() {
            if !only.is_empty() && slug != only {
                continue;
            }
            if let Ok(w) = deck.work(&slug) {
                out.extend(w.meta.items);
            }
        }
        out
    }

    fn set_status(&self, node_id: i64, title: &str, status: &str) {
        let (deck, dir) = deck_of(&self.conn, node_id).unwrap();
        let slug = read(&dir).unwrap().feature;
        let mut w = deck.work(&slug).unwrap().meta;
        let item = w
            .items
            .iter_mut()
            .find(|i| i.title == title)
            .unwrap_or_else(|| panic!("no step called {title}"));
        item.status = status.into();
        deck.save_work(&slug, &w).unwrap();
    }

    /// The suggestions the bot would show right now, answered ones removed.
    fn suggestions(&self, node_id: i64, now_ms: i64) -> Vec<crate::botmind::Suggestion> {
        let bot = self.bot(node_id);
        let work = self.work(node_id);
        let doc = self.mind.read(node_id).unwrap();
        let offers: Vec<crate::botcatalog::ToolOffer> = crate::botcatalog::get(&bot.template)
            .map(|t| t.tools)
            .unwrap_or_default();
        let sig = crate::botmind::Signals {
            goal: bot.goal.clone(),
            every: bot.every.clone(),
            last_woke: bot.last_woke,
            work: &work,
            answered: doc.meta.answers.iter().filter(|a| !a.skipped).count(),
            skipped: doc.meta.answers.iter().filter(|a| a.skipped).count(),
            offers: &offers,
            decided: &doc.meta.tools,
            now_ms,
        };
        crate::botmind::filter_answered(
            crate::botmind::derive(&sig),
            &doc.meta.suggestions,
            now_ms,
        )
    }

    fn has(&self, node_id: i64, id: &str, now_ms: i64) -> bool {
        self.suggestions(node_id, now_ms).iter().any(|s| s.id == id)
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self._tmp);
    }
}

static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn world() -> World {
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let tmp = std::env::temp_dir().join(format!("devdeck-scn-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let root = tmp.join("vault");
    let personal = tmp.join("personal");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&personal).unwrap();

    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(crate::db::CORE_SCHEMA).unwrap();
    conn.execute_batch(crate::schedule::SCHEMA).unwrap();
    // Migrations too: CORE_SCHEMA alone is the *original* shape, and a test
    // that skips them is testing a database no running copy of DevDeck has.
    crate::db::migrate(&conn);
    crate::db::setting_set_conn(&conn, crate::vault::ROOT_KEY, &root.to_string_lossy()).unwrap();

    let w = World {
        conn,
        root,
        mind: Mind::at(PersonalStore::at(&personal)),
        _tmp: tmp,
    };
    w.node(1, None, "workspace", "Business", "Business");
    w.node(2, Some(1), "folder", "Marketing site", "Business/Marketing site");
    w.node(3, Some(1), "folder", "Ops", "Business/Ops");
    w
}

const NOW: i64 = 1_800_000_000_000;
const THEN: &str = "2026-08-31T09:00:00+00:00";

// ---------------------------------------------------------------------------
// 1. The website bot, cradle to grave
// ---------------------------------------------------------------------------

#[test]
fn the_website_bot_from_nothing_to_deleted() {
    let w = world();

    // -- made from a starter, with its steps ------------------------------
    let bot = create_into(
        &w.conn,
        2,
        "website",
        "Marketing site bot",
        "Ship the site by 30 September",
        "weekdays",
        8 * 60,
        "",
        true,
    )
    .unwrap();

    assert_eq!(bot.template, "website");
    assert!(bot.skills.contains(&"seo".to_string()), "starter skills are written on");
    assert!(!bot.feature.is_empty(), "a plan means a feature");
    assert!(w.dir("Business/Marketing site").join(FILE).is_file());
    assert!(
        bot.body.contains("One page, one job"),
        "standards land in the body, where they can be edited"
    );

    // The heartbeat exists and, unlike a reminder, catches up.
    let (sched, _) = heartbeat(&w.conn, 2).expect("a heartbeat row");
    let catch_up: i64 = w
        .conn
        .query_row("SELECT catch_up FROM schedules WHERE id = ?1", params![sched], |r| r.get(0))
        .unwrap();
    assert_eq!(catch_up, 1, "a wake reads the space at the instant it runs");

    // The steps are real work items in the project's committed context.
    let work = w.work(2);
    assert_eq!(work.len(), 10);
    assert!(work.iter().all(|i| i.status == "unclaimed"));
    assert!(w
        .dir("Business/Marketing site")
        .join(".devdeck")
        .join("features")
        .is_dir());

    // -- what it suggests, before it knows anything -----------------------
    assert!(w.has(2, "interview", NOW), "it has not asked you anything yet");
    assert!(!w.has(2, "plan", NOW), "it already has steps");
    assert!(!w.has(2, "heartbeat", NOW), "it already wakes");
    assert!(!w.has(2, "blocked", NOW), "nothing is stuck yet");

    // The cheapest rung is what it asks for first.
    let tool = w
        .suggestions(2, NOW)
        .into_iter()
        .find(|s| s.kind == "tool")
        .expect("it offers something");
    assert_eq!(tool.tool_id, "skill-seo");

    // -- the interview ----------------------------------------------------
    for step in 0..6 {
        ops::answer_question(&w.mind, 2, step, &format!("answer {step}"), false, THEN).unwrap();
    }
    let iv = ops::interview(&w.mind, 2).unwrap();
    assert!(iv.done);
    assert_eq!(ops::beliefs(&w.mind, 2, NOW).unwrap().len(), 6, "each answer became a belief");
    assert!(!w.has(2, "interview", NOW), "it stopped asking");

    // -- the work moves ---------------------------------------------------
    w.set_status(2, "Build the pages", "in-progress");
    w.set_status(2, "Launch, then check it again from outside", "blocked");

    let blocked = w
        .suggestions(2, NOW)
        .into_iter()
        .find(|s| s.id == "blocked")
        .expect("it noticed");
    assert!(
        blocked.evidence.contains("Launch, then check it again"),
        "it names the step rather than counting: {}",
        blocked.evidence
    );

    // Waking now has something to say, and says exactly that.
    let report = wake_report(&w.conn, 2).expect("something to report");
    assert!(report.contains("1 blocked"), "{report}");
    assert!(report.contains("8 waiting"), "{report}");

    // -- it learns a skill ------------------------------------------------
    ops::record_tool(&w.mind, 2, "skill-a11y", "added", THEN).unwrap();
    assert!(
        !w.suggestions(2, NOW).iter().any(|s| s.tool_id == "skill-a11y"),
        "a decided tool is not offered again"
    );

    // -- everything gets done ---------------------------------------------
    for item in w.work(2) {
        w.set_status(2, &item.title, "done");
    }
    assert!(w.has(2, "finished", NOW), "worth saying once");
    assert!(
        wake_report(&w.conn, 2).is_none(),
        "a heartbeat with nothing to say says nothing"
    );

    // -- deleted ----------------------------------------------------------
    let name = delete_into(&w.conn, &w.mind, 2).unwrap();
    assert_eq!(name, "Marketing site bot");
    assert!(!w.dir("Business/Marketing site").join(FILE).exists(), "the file goes");
    assert!(heartbeat(&w.conn, 2).is_none(), "the clock goes");
    assert!(
        ops::beliefs(&w.mind, 2, NOW).unwrap().is_empty(),
        "what it knew about you goes"
    );
    assert_eq!(w.work(2).len(), 10, "the work items are the project's, and stay");
    assert!(
        w.dir("Business/Marketing site").is_dir(),
        "deleting a bot must never look like deleting a space"
    );
}

// ---------------------------------------------------------------------------
// 2. A bot with no plan, given one by hand
// ---------------------------------------------------------------------------

#[test]
fn a_bot_with_a_goal_and_no_steps_asks_for_a_plan() {
    let w = world();
    create_into(&w.conn, 3, "blank", "Ops bot", "Get the on-call rota sane", "daily", 420, "", false)
        .unwrap();

    assert!(w.work(3).is_empty());
    assert!(w.has(3, "plan", NOW), "a goal with nothing under it");
    assert!(
        wake_report(&w.conn, 3).is_none(),
        "no deck, nothing to report — not an error"
    );

    plan_into(&w.conn, 3, &["Write down who is on call".into(), "Agree the handover".into()])
        .unwrap();
    assert_eq!(w.work(3).len(), 2);
    assert!(!w.has(3, "plan", NOW));

    // Applying the same plan twice does not double it.
    let (_, _, added) =
        plan_into(&w.conn, 3, &["Write down who is on call".into(), "New third thing".into()])
            .unwrap();
    assert_eq!(added, 1, "only the new one");
    assert_eq!(w.work(3).len(), 3);
}

// ---------------------------------------------------------------------------
// 3. Editing a bot keeps what the editor never sends
// ---------------------------------------------------------------------------

#[test]
fn renaming_a_bot_does_not_lose_its_starter_or_its_plan() {
    let w = world();
    let made = create_into(&w.conn, 2, "release", "Ops bot", "Ship 1.0", "weekdays", 420, "", true)
        .unwrap();
    let feature = made.feature.clone();
    assert!(!feature.is_empty());

    // The Settings form sends name, goal, routine, body and skills — and knows
    // nothing about `template` or `feature`.
    let (after, created) = save_into(
        &w.conn,
        2,
        "Release bot",
        "Ship 1.0 without a hotfix",
        "weekly",
        18 * 60,
        "0",
        "my own notes",
        vec!["release-notes".into()],
        "",
        vec![],
        "",
    )
    .unwrap();

    assert!(!created, "it already existed");
    assert_eq!(after.name, "Release bot");
    assert_eq!(after.template, "release", "the starter survived a rename");
    assert_eq!(after.feature, feature, "so did the plan it points at");
    assert_eq!(w.work(2).len(), 7, "and the steps themselves");

    // The routine change reached the clock.
    let (id, _) = heartbeat(&w.conn, 2).unwrap();
    let (every, at, days): (String, i64, String) = w
        .conn
        .query_row(
            "SELECT every, at_min, days FROM schedules WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((every.as_str(), at, days.as_str()), ("weekly", 1080, "0"));
}

#[test]
fn taking_a_bots_heartbeat_away_removes_the_row() {
    let w = world();
    create_into(&w.conn, 2, "blank", "Quiet bot", "Just be there", "daily", 420, "", false).unwrap();
    assert!(heartbeat(&w.conn, 2).is_some());

    save_into(&w.conn, 2, "Quiet bot", "Just be there", "", 420, "", "", vec![], "", vec![], "")
        .unwrap();
    assert!(heartbeat(&w.conn, 2).is_none(), "no routine, no clock");
    assert!(w.has(2, "heartbeat", NOW), "and it says so");
}

#[test]
fn a_folder_gets_one_bot_and_a_bot_needs_a_goal() {
    let w = world();
    create_into(&w.conn, 2, "blank", "First", "A goal", "daily", 420, "", false).unwrap();

    let second = create_into(&w.conn, 2, "blank", "Second", "Another goal", "daily", 420, "", false);
    assert!(second.unwrap_err().contains("already has a bot"));

    let goalless =
        create_into(&w.conn, 3, "blank", "Nameless purpose", "   ", "daily", 420, "", false);
    assert!(goalless.unwrap_err().contains("needs a goal"));

    let nameless = create_into(&w.conn, 3, "blank", "  ", "A goal", "daily", 420, "", false);
    assert!(nameless.unwrap_err().contains("name"));
}

// ---------------------------------------------------------------------------
// 4. Memory: corrections, pins, and what never ages
// ---------------------------------------------------------------------------

#[test]
fn correcting_a_belief_keeps_what_it_used_to_say() {
    let w = world();
    ops::add_belief(&w.mind, 2, "You care about coverage above all else", THEN).unwrap();
    let id = ops::beliefs(&w.mind, 2, NOW).unwrap()[0].belief.id.clone();

    ops::correct_belief(&w.mind, 2, &id, "You care about coverage only before a release").unwrap();

    let b = &ops::beliefs(&w.mind, 2, NOW).unwrap()[0].belief;
    assert_eq!(b.source, "corrected");
    assert_eq!(b.text, "You care about coverage only before a release");
    assert_eq!(b.was, "You care about coverage above all else", "the old text is kept");

    // Correcting twice does not lose the original.
    ops::correct_belief(&w.mind, 2, &id, "Never mention coverage").unwrap();
    assert_eq!(
        ops::beliefs(&w.mind, 2, NOW).unwrap()[0].belief.was,
        "You care about coverage above all else"
    );
}

#[test]
fn ageing_offers_only_what_it_worked_out_itself() {
    let w = world();
    let old = "2020-01-01T00:00:00+00:00";
    let mut doc = w.mind.read(2).unwrap();
    for (id, source, pinned) in [
        ("b1", "you", false),
        ("b2", "watched", false),
        ("b3", "watched", true),
        ("b4", "corrected", false),
    ] {
        doc.meta.beliefs.push(crate::botmind::Belief {
            id: id.into(),
            text: id.into(),
            source: source.into(),
            created_at: old.into(),
            pinned,
            ..Default::default()
        });
    }
    w.mind.write(2, &doc).unwrap();

    let now = chrono::Utc::now().timestamp_millis();
    let offered: Vec<String> = ops::beliefs(&w.mind, 2, now).unwrap()
        .into_iter()
        .filter(|v| v.stale)
        .map(|v| v.belief.id)
        .collect();
    assert_eq!(offered, vec!["b2"], "not yours, not pinned, not corrected");

    let gone = ops::drop_stale(&w.mind, 2, now).unwrap();
    assert_eq!(gone, 1);
    assert_eq!(ops::beliefs(&w.mind, 2, now).unwrap().len(), 3);

    // Pinning is a promise: unpin it and it becomes a candidate again.
    ops::pin_belief(&w.mind, 2, "b3", false).unwrap();
    assert_eq!(ops::drop_stale(&w.mind, 2, now).unwrap(), 1);
}

#[test]
fn asking_again_forgets_only_what_the_interview_took() {
    let w = world();
    ops::answer_question(&w.mind, 2, 0, "Shipping the site", false, THEN).unwrap();
    ops::answer_question(&w.mind, 2, 1, "Live and quiet", false, THEN).unwrap();
    ops::add_belief(&w.mind, 2, "Never ping me on a Friday", THEN).unwrap();
    assert_eq!(ops::beliefs(&w.mind, 2, NOW).unwrap().len(), 3);

    ops::reset_interview(&w.mind, 2).unwrap();

    let left = ops::beliefs(&w.mind, 2, NOW).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].belief.text, "Never ping me on a Friday");
    assert_eq!(ops::interview(&w.mind, 2).unwrap().step, 0, "back to the top");
}

#[test]
fn a_skipped_question_is_settled_but_still_visible() {
    let w = world();
    for step in 0..6 {
        ops::answer_question(&w.mind, 2, step, "", true, THEN).unwrap();
    }
    let iv = ops::interview(&w.mind, 2).unwrap();
    assert!(iv.done, "it stops asking");
    assert!(iv.answers.iter().all(|a| a.skipped), "and you can see why it knows nothing");
    assert!(ops::beliefs(&w.mind, 2, NOW).unwrap().is_empty(), "a skip teaches it nothing");
}

#[test]
fn changing_an_answer_replaces_the_belief_rather_than_adding_one() {
    let w = world();
    ops::answer_question(&w.mind, 2, 0, "Shipping the site", false, THEN).unwrap();
    ops::answer_question(&w.mind, 2, 0, "Actually, learning Rust", false, THEN).unwrap();

    let b = ops::beliefs(&w.mind, 2, NOW).unwrap();
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].belief.text, "Actually, learning Rust");
    assert_eq!(ops::interview(&w.mind, 2).unwrap().answers.len(), 1);
}

// ---------------------------------------------------------------------------
// 5. Suggestions you have already answered
// ---------------------------------------------------------------------------

#[test]
fn not_now_comes_back_and_wrong_never_does() {
    let w = world();
    create_into(&w.conn, 2, "blank", "Ops bot", "Get the rota sane", "daily", 420, "", false)
        .unwrap();
    assert!(w.has(2, "plan", NOW));

    ops::answer_suggestion(&w.mind, 2, "plan", "snoozed", "", NOW, THEN).unwrap();
    assert!(!w.has(2, "plan", NOW), "put away");
    assert!(!w.has(2, "plan", NOW + 6 * 86_400_000), "still away after six days");
    assert!(w.has(2, "plan", NOW + 8 * 86_400_000), "back after a week");

    ops::answer_suggestion(
        &w.mind,
        2,
        "plan",
        "wrong",
        "This space is a place to think, not a project",
        NOW,
        THEN,
    )
    .unwrap();
    assert!(!w.has(2, "plan", NOW + 400 * 86_400_000), "a refusal is forever");

    // And the reason you gave is now something it knows.
    let told = ops::beliefs(&w.mind, 2, NOW).unwrap();
    assert!(
        told.iter().any(|b| b.belief.text.contains("place to think")
            && b.belief.source == "corrected"),
        "the whole point of asking for a reason"
    );
}

// ---------------------------------------------------------------------------
// 6. A bot that arrived on disk, not through the app
// ---------------------------------------------------------------------------

#[test]
fn a_hand_written_bot_gets_its_clock_and_a_deleted_one_loses_it() {
    let w = world();
    let dir = w.dir("Business/Ops");
    std::fs::write(
        dir.join(FILE),
        "---\nname: Pulled from a branch\ngoal: Keep the lights on\nevery: weekdays\nat: \"06:30\"\n---\n\nSomeone else wrote this.\n",
    )
    .unwrap();

    assert!(heartbeat(&w.conn, 3).is_none(), "nothing has looked yet");

    // Listing reconciles — otherwise a bot could sit on disk claiming a routine
    // and never once wake.
    let mut seen = Vec::new();
    for n in db::nodes_on(&w.conn).unwrap() {
        let Some(d) = dir_of(&w.conn, &n) else { continue };
        let Some(mut b) = read(&d) else { continue };
        b.node_id = n.id;
        sync_heartbeat(&w.conn, &b).unwrap();
        seen.push(n.id);
    }
    let (id, _) = heartbeat(&w.conn, 3).expect("reconciled");
    let at: i64 = w
        .conn
        .query_row("SELECT at_min FROM schedules WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(at, 390, "06:30, as the file says");

    // And when the file goes, so does the row.
    std::fs::remove_file(dir.join(FILE)).unwrap();
    w.conn
        .execute("DELETE FROM schedules WHERE kind = 'bot' AND node_id NOT IN (2)", [])
        .unwrap();
    assert!(heartbeat(&w.conn, 3).is_none());
}

#[test]
fn a_bot_file_round_trips_everything_it_carries() {
    let w = world();
    let made = create_into(
        &w.conn,
        2,
        "website",
        "Site bot",
        "Ship by winter",
        "weekly",
        18 * 60,
        "0,3",
        true,
    )
    .unwrap();

    let back = w.bot(2);
    assert_eq!(back.name, made.name);
    assert_eq!(back.goal, made.goal);
    assert_eq!(back.every, "weekly");
    assert_eq!(back.at_min, 1080);
    assert_eq!(back.days, "0,3");
    assert_eq!(back.skills, made.skills);
    assert_eq!(back.template, "website");
    assert_eq!(back.feature, made.feature);
    assert!(back.body.contains("One page, one job"));
}

// ---------------------------------------------------------------------------
// 7. The store split, which is the rule everything else rests on
// ---------------------------------------------------------------------------

#[test]
fn nothing_personal_is_ever_written_into_the_vault() {
    let w = world();
    create_into(&w.conn, 2, "website", "Site bot", "Ship it", "weekdays", 480, "", true).unwrap();

    ops::answer_question(
        &w.mind,
        2,
        3,
        "Daily reminders are why I stopped using the last app",
        false,
        THEN,
    )
    .unwrap();

    // Walk everything under the vault and prove that sentence is not in any of
    // it — including `.devdeck`, which is committed.
    let mut checked = 0;
    let mut stack = vec![w.root.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(text) = std::fs::read_to_string(&p) {
                checked += 1;
                assert!(
                    !text.contains("stopped using the last app"),
                    "{} carries something personal",
                    p.display()
                );
            }
        }
    }
    assert!(checked > 5, "the walk actually read files ({checked})");

    // And it really was written — somewhere else.
    assert!(ops::beliefs(&w.mind, 2, NOW).unwrap()
        .iter()
        .any(|b| b.belief.text.contains("stopped using the last app")));
}

// ---------------------------------------------------------------------------
// 8. Two bots in one workspace do not bleed into each other
// ---------------------------------------------------------------------------

#[test]
fn two_bots_keep_their_own_work_and_their_own_memory() {
    let w = world();
    create_into(&w.conn, 2, "website", "Site bot", "Ship the site", "weekdays", 480, "", true)
        .unwrap();
    create_into(&w.conn, 3, "release", "Ops bot", "Ship 1.0", "weekdays", 420, "", true).unwrap();

    assert_eq!(w.work(2).len(), 10);
    assert_eq!(w.work(3).len(), 7);

    ops::add_belief(&w.mind, 2, "The site launch is in September", THEN).unwrap();
    assert_eq!(ops::beliefs(&w.mind, 2, NOW).unwrap().len(), 1);
    assert!(ops::beliefs(&w.mind, 3, NOW).unwrap().is_empty(), "not a shared memory");

    // Deleting one leaves the other entirely alone.
    delete_into(&w.conn, &w.mind, 2).unwrap();
    assert!(heartbeat(&w.conn, 3).is_some());
    assert_eq!(w.work(3).len(), 7);
    assert!(w.dir("Business/Ops").join(FILE).is_file());
}

// ---------------------------------------------------------------------------
// 9. Replacing a bot on a space that already had one
// ---------------------------------------------------------------------------

/// Found by driving the real IPC surface, not by reading: work items outlive
/// the bot on purpose, so a second bot for the same goal met
/// "feature already exists" — *after* its `_bot.md` had been written, leaving a
/// half-made bot behind an error message.
#[test]
fn a_replacement_bot_adopts_the_work_the_last_one_left() {
    let w = world();
    create_into(&w.conn, 2, "website", "Site bot", "Ship the site", "weekdays", 480, "", true)
        .unwrap();
    let slug = w.bot(2).feature;
    w.set_status(2, "Build the pages", "done");

    delete_into(&w.conn, &w.mind, 2).unwrap();
    assert_eq!(w.work(2).len(), 10, "the work stayed");

    // Same goal, so the same slug — this used to fail outright.
    let again =
        create_into(&w.conn, 2, "website", "Site bot", "Ship the site", "weekdays", 480, "", true)
            .unwrap();
    assert_eq!(again.feature, slug, "it adopted the feature that was already there");

    let work = w.work(2);
    assert_eq!(work.len(), 10, "and did not duplicate a single step");
    assert_eq!(
        work.iter().find(|i| i.title == "Build the pages").unwrap().status,
        "done",
        "progress the last bot made is still there"
    );
}

/// The other half of the same bug: if the plan cannot be written, you should
/// not be left with a bot beside an error.
#[test]
fn a_failed_plan_leaves_no_half_made_bot() {
    let w = world();
    let dir = w.dir("Business/Marketing site");

    // A file where the deck's features directory needs to be: creating the
    // feature will fail, and nothing else in the flow can recover.
    std::fs::create_dir_all(dir.join(".devdeck")).unwrap();
    std::fs::write(dir.join(".devdeck").join("features"), "not a directory").unwrap();

    let made =
        create_into(&w.conn, 2, "website", "Site bot", "Ship the site", "weekdays", 480, "", true);
    assert!(made.is_err(), "it refused");
    assert!(!dir.join(FILE).exists(), "and left nothing behind");
    assert!(heartbeat(&w.conn, 2).is_none(), "including no orphaned clock");
}

// ---------------------------------------------------------------------------
// 10. A bot that names an agent
// ---------------------------------------------------------------------------

#[test]
fn naming_an_agent_is_written_down_and_survives_a_save() {
    let w = world();
    create_into(&w.conn, 2, "release", "Ops bot", "Ship 1.0", "weekdays", 420, "", true).unwrap();
    assert_eq!(w.bot(2).agent, "", "a new bot watches; it does not work");

    save_into(
        &w.conn,
        2,
        "Ops bot",
        "Ship 1.0",
        "weekdays",
        420,
        "",
        "",
        vec![],
        "release-checker",
        vec!["release-checker".into()],
        "Check the version files disagree with nothing",
    )
    .unwrap();

    let back = w.bot(2);
    assert_eq!(back.agent, "release-checker");
    assert!(back.wake_intent.contains("version files"));
    assert!(
        std::fs::read_to_string(w.dir("Business/Marketing site").join(FILE))
            .unwrap()
            .contains("agent: release-checker"),
        "it is in the file, so it travels with the folder"
    );

    // And taking it away again puts the bot back to only watching.
    save_into(
        &w.conn, 2, "Ops bot", "Ship 1.0", "weekdays", 420, "", "", vec![], "", vec![], "",
    )
    .unwrap();
    assert_eq!(w.bot(2).agent, "");
    assert!(!std::fs::read_to_string(w.dir("Business/Marketing site").join(FILE))
        .unwrap()
        .contains("agent:"));
}

/// The half-made feature guard has to cover *both* ways a slug is chosen. The
/// first version only checked the one where the bot had no feature yet, so a
/// bot that already named one skipped the check entirely and produced a plan
/// that read fine on screen and failed the moment an agent was asked to work
/// on it.
#[test]
fn a_bot_that_already_names_a_half_made_feature_is_refused_too() {
    let w = world();
    create_into(&w.conn, 2, "blank", "Site bot", "Ship the site", "weekdays", 480, "", false)
        .unwrap();

    // A features directory with no feature.md, named by the bot itself.
    let dir = w.dir("Business/Marketing site");
    std::fs::create_dir_all(dir.join(".devdeck").join("features").join("hand-made")).unwrap();
    save_into(
        &w.conn, 2, "Site bot", "Ship the site", "weekdays", 480, "", "", vec![], "", vec![], "",
    )
    .unwrap();
    // Point the bot at it the way a hand-edited file would.
    let mut b = read(&dir).unwrap();
    b.feature = "hand-made".into();
    write(&dir, &b).unwrap();

    let err = plan_into(&w.conn, 2, &["A step".into()]).unwrap_err();
    assert!(err.contains("no feature.md"), "{err}");
    assert!(err.contains("hand-made"), "it names the directory to deal with: {err}");
}
