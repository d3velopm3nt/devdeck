//! What a bot knows about *you* — and why none of it is in the vault.
//!
//! `_bot.md` says what the bot is: its goal, its routine, the standards it
//! holds work to. That belongs to the folder, travels with it, and is safe in a
//! pull request. This is the other half, and it is the half that must never be
//! committable: the interview answers, the things it worked out, the
//! corrections you made, the suggestions you turned down. "Daily reminders are
//! why you stopped using the last app" is a sentence about a person, and
//! `PersonalStore` refuses to be created inside a git repository at all.
//!
//! One file per bot, `bots/<node id>/mind.md`, in the same Markdown-with-typed-
//! frontmatter format as everything else here — you can read it, grep it, edit
//! it and delete it without the app.
//!
//! **Beliefs carry a source and a cost.** Every line says whether you said it,
//! it watched it, or you corrected it; how many times it has been used; and
//! when it last was. That is what makes ageing honest rather than a black box
//! quietly forgetting things — and why nothing you *said* is ever dropped
//! automatically, only what it worked out on its own.
//!
//! **Suggestions are derived, not generated.** Every one comes from a signal
//! this file can point at: work that has been blocked, a routine that never
//! wakes, an interview that stopped halfway. There is no model in this path, so
//! a suggestion can always answer "why are you telling me this".

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::aiw::deck::{Doc, WorkItem};
use crate::aiw::personal::PersonalStore;

pub type MindResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

/// The script, in order. Fixed and visible rather than improvised: an open
/// chat gets you a different bot every time and no way to tell whether it has
/// enough to be useful. Six questions you can read means you know what it is
/// about to ask, you can skip one, and "it understands this space" becomes a
/// thing with an answer.
pub const SCRIPT: [&str; 6] = [
    "What is this space for?",
    "What does good look like in three months?",
    "What already happens without me?",
    "When should I speak up, and when should I stay quiet?",
    "What would you rather I never touch?",
    "Anything else I should know before I start?",
];

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Answer {
    #[serde(default)]
    pub step: usize,
    #[serde(default)]
    pub question: String,
    #[serde(default)]
    pub answer: String,
    #[serde(default)]
    pub at: String,
    /// A question you chose not to answer. Kept rather than deleted so the bot
    /// does not ask it again, and so "why don't you know that" has an answer.
    #[serde(default)]
    pub skipped: bool,
}

// ---------------------------------------------------------------------------
// Beliefs
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Belief {
    pub id: String,
    pub text: String,
    /// you | watched | corrected
    #[serde(default)]
    pub source: String,
    /// What it used to say, when you corrected it. Kept because a bot that
    /// silently rewrites what it believed cannot be audited.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub was: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last_used: String,
    #[serde(default)]
    pub uses: i64,
    /// Pinned lines are never offered for ageing, whatever their source.
    #[serde(default)]
    pub pinned: bool,
}

// ---------------------------------------------------------------------------
// Decisions you have already made
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ToolDecision {
    pub id: String,
    /// added | declined
    pub response: String,
    #[serde(default)]
    pub at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SuggestionAnswer {
    pub id: String,
    /// done | snoozed | wrong
    pub response: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub why: String,
    #[serde(default)]
    pub at: String,
    /// Snoozes expire; `wrong` never does.
    #[serde(default)]
    pub until: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct MindMeta {
    #[serde(default)]
    pub node_id: i64,
    #[serde(default)]
    pub interview_done: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub answers: Vec<Answer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub beliefs: Vec<Belief>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ToolDecision>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<SuggestionAnswer>,
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

pub struct Mind {
    store: PersonalStore,
}

impl Mind {
    pub fn open() -> MindResult<Self> {
        Ok(Self {
            store: PersonalStore::open()?,
        })
    }

    /// Point at a store directly.
    ///
    /// The scenario tests use this so a whole bot lifecycle can run against a
    /// temporary root; the app always goes through [`open`], which is the
    /// constructor that refuses a root git would pick up.
    #[allow(dead_code)]
    pub fn at(store: PersonalStore) -> Self {
        Self { store }
    }

    fn dir(&self, node_id: i64) -> PathBuf {
        self.store.root().join("bots").join(node_id.to_string())
    }

    fn file(&self, node_id: i64) -> PathBuf {
        self.dir(node_id).join("mind.md")
    }

    /// What the bot knows.
    ///
    /// A bot that has never been interviewed is not an error — no file means an
    /// empty mind. A file that will *not parse* is a very different thing, and
    /// gets an error rather than an empty mind: reading it as "knows nothing"
    /// would hide everything you told it behind a typo, and the next write would
    /// then overwrite the lot. That is data loss reported as a clean slate,
    /// which is the same shape as the update checker mapping "could not reach
    /// the server" to "up to date".
    pub fn read(&self, node_id: i64) -> MindResult<Doc<MindMeta>> {
        let path = self.file(node_id);
        match self.store.read_doc_opt::<MindMeta>(&path) {
            Ok(Some(mut d)) => {
                d.meta.node_id = node_id;
                Ok(d)
            }
            Ok(None) => Ok(Doc {
                meta: MindMeta {
                    node_id,
                    ..Default::default()
                },
                body: String::new(),
            }),
            Err(e) => Err(format!(
                "{} could not be read. Nothing it knows is being shown, and nothing will be \
                 written over it until this is fixed: {e}",
                path.display()
            )),
        }
    }

    pub fn write(&self, node_id: i64, doc: &Doc<MindMeta>) -> MindResult<()> {
        std::fs::create_dir_all(self.dir(node_id)).map_err(|e| e.to_string())?;
        self.store.write_doc_at(&self.file(node_id), doc)
    }

    /// Everything this bot knows about you, gone. Called when the bot is
    /// deleted — leaving it behind would mean a new bot on the same folder
    /// inheriting a stranger's answers.
    pub fn forget(&self, node_id: i64) {
        let _ = std::fs::remove_dir_all(self.dir(node_id));
    }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
//
// Every one of these takes the store rather than opening it, so the whole set
// can be driven against a temporary root in a test. The Tauri commands in
// `bots.rs` are thin wrappers — which is the point: the behaviour worth testing
// should not be reachable only through a running app.

/// The view the UI needs to draw the interview.
#[derive(Serialize, Clone, Debug)]
pub struct InterviewView {
    pub script: Vec<String>,
    pub answers: Vec<Answer>,
    pub step: usize,
    pub done: bool,
}

pub fn interview(mind: &Mind, node_id: i64) -> MindResult<InterviewView> {
    let doc = mind.read(node_id)?;
    let seen: std::collections::HashSet<usize> = doc.meta.answers.iter().map(|a| a.step).collect();
    let step = (0..SCRIPT.len()).find(|i| !seen.contains(i)).unwrap_or(SCRIPT.len());
    Ok(InterviewView {
        script: SCRIPT.iter().map(|s| s.to_string()).collect(),
        answers: doc.meta.answers,
        step,
        done: doc.meta.interview_done || step >= SCRIPT.len(),
    })
}

/// Answer one question, or skip it. Either way the bot stops asking, and either
/// way you can see afterwards which it was.
pub fn answer_question(
    mind: &Mind,
    node_id: i64,
    step: usize,
    answer: &str,
    skipped: bool,
    now_iso: &str,
) -> MindResult<InterviewView> {
    if step >= SCRIPT.len() {
        return Err("There is no such question.".into());
    }
    if !skipped && answer.trim().is_empty() {
        return Err("Say something, or skip it.".into());
    }

    let mut doc = mind.read(node_id)?;
    doc.meta.answers.retain(|a| a.step != step);
    doc.meta.answers.push(Answer {
        step,
        question: SCRIPT[step].to_string(),
        answer: answer.trim().to_string(),
        at: now_iso.to_string(),
        skipped,
    });
    doc.meta.answers.sort_by_key(|a| a.step);

    // What it took from an answer is written the moment you give it. Nothing is
    // accumulated silently and revealed later — you should be able to see, and
    // delete, what it took from what you just said.
    let id = format!("a{step}");
    doc.meta.beliefs.retain(|b| b.id != id);
    if !skipped {
        doc.meta.beliefs.push(Belief {
            id,
            text: answer.trim().to_string(),
            source: "you".into(),
            was: String::new(),
            created_at: now_iso.to_string(),
            last_used: String::new(),
            uses: 0,
            pinned: false,
        });
    }

    doc.meta.interview_done = doc.meta.answers.len() >= SCRIPT.len();
    mind.write(node_id, &doc)?;
    interview(mind, node_id)
}

/// Start the script again, dropping what the last run took. Anything it learned
/// another way stays — you did not ask to forget that.
pub fn reset_interview(mind: &Mind, node_id: i64) -> MindResult<InterviewView> {
    let mut doc = mind.read(node_id)?;
    let from_interview: Vec<String> =
        doc.meta.answers.iter().map(|a| format!("a{}", a.step)).collect();
    doc.meta.answers.clear();
    doc.meta.interview_done = false;
    doc.meta.beliefs.retain(|b| !from_interview.contains(&b.id));
    mind.write(node_id, &doc)?;
    interview(mind, node_id)
}

/// One line of what it knows, plus whether ageing would offer to drop it.
#[derive(Serialize, Clone, Debug)]
pub struct BeliefView {
    #[serde(flatten)]
    pub belief: Belief,
    pub stale: bool,
}

pub fn beliefs(mind: &Mind, node_id: i64, now_ms: i64) -> MindResult<Vec<BeliefView>> {
    let mut out: Vec<BeliefView> = mind
        .read(node_id)?
        .meta
        .beliefs
        .into_iter()
        .map(|b| BeliefView {
            stale: stale(&b, now_ms),
            belief: b,
        })
        .collect();
    // What you said first, then what you corrected, then what it worked out.
    let rank = |s: &str| match s {
        "you" => 0,
        "corrected" => 1,
        _ => 2,
    };
    out.sort_by(|a, b| {
        rank(&a.belief.source)
            .cmp(&rank(&b.belief.source))
            .then(a.belief.id.cmp(&b.belief.id))
    });
    Ok(out)
}

pub fn add_belief(mind: &Mind, node_id: i64, text: &str, now_iso: &str) -> MindResult<()> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Nothing to remember.".into());
    }
    let mut doc = mind.read(node_id)?;
    let mut n = doc.meta.beliefs.len() + 1;
    while doc.meta.beliefs.iter().any(|b| b.id == format!("b{n}")) {
        n += 1;
    }
    doc.meta.beliefs.push(Belief {
        id: format!("b{n}"),
        text: text.to_string(),
        source: "you".into(),
        was: String::new(),
        created_at: now_iso.to_string(),
        last_used: String::new(),
        uses: 0,
        pinned: false,
    });
    mind.write(node_id, &doc)
}

/// Correct a line. The old text is kept rather than overwritten — a bot that
/// silently rewrites what it believed cannot be audited, and "why did you think
/// that" is the question you will actually want answered.
pub fn correct_belief(mind: &Mind, node_id: i64, id: &str, text: &str) -> MindResult<()> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Say what it should be instead.".into());
    }
    let mut doc = mind.read(node_id)?;
    let b = doc
        .meta
        .beliefs
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or("It does not believe that any more.")?;
    if b.was.is_empty() {
        b.was = b.text.clone();
    }
    b.text = text.to_string();
    b.source = "corrected".into();
    mind.write(node_id, &doc)
}

pub fn pin_belief(mind: &Mind, node_id: i64, id: &str, pinned: bool) -> MindResult<()> {
    let mut doc = mind.read(node_id)?;
    if let Some(b) = doc.meta.beliefs.iter_mut().find(|b| b.id == id) {
        b.pinned = pinned;
    }
    mind.write(node_id, &doc)
}

pub fn drop_belief(mind: &Mind, node_id: i64, id: &str) -> MindResult<()> {
    let mut doc = mind.read(node_id)?;
    doc.meta.beliefs.retain(|b| b.id != id);
    mind.write(node_id, &doc)
}

pub fn drop_stale(mind: &Mind, node_id: i64, now_ms: i64) -> MindResult<usize> {
    let mut doc = mind.read(node_id)?;
    let before = doc.meta.beliefs.len();
    doc.meta.beliefs.retain(|b| !stale(b, now_ms));
    let gone = before - doc.meta.beliefs.len();
    mind.write(node_id, &doc)?;
    Ok(gone)
}

pub fn record_tool(mind: &Mind, node_id: i64, id: &str, response: &str, now_iso: &str) -> MindResult<()> {
    if response != "added" && response != "declined" {
        return Err("A tool is either added or declined.".into());
    }
    let mut doc = mind.read(node_id)?;
    doc.meta.tools.retain(|d| d.id != id);
    doc.meta.tools.push(ToolDecision {
        id: id.to_string(),
        response: response.to_string(),
        at: now_iso.to_string(),
    });
    mind.write(node_id, &doc)
}

/// Answer a suggestion. "Not now" comes back in a week; "wrong" never does, and
/// the reason you gave becomes something it knows — which is the whole point of
/// asking for one.
pub fn answer_suggestion(
    mind: &Mind,
    node_id: i64,
    id: &str,
    response: &str,
    why: &str,
    now_ms: i64,
    now_iso: &str,
) -> MindResult<()> {
    if !["done", "snoozed", "wrong"].contains(&response) {
        return Err("A suggestion is done, put off, or wrong.".into());
    }
    let mut doc = mind.read(node_id)?;
    doc.meta.suggestions.retain(|s| s.id != id);
    doc.meta.suggestions.push(SuggestionAnswer {
        id: id.to_string(),
        response: response.to_string(),
        why: why.trim().to_string(),
        at: now_iso.to_string(),
        until: if response == "snoozed" { now_ms + 7 * 86_400_000 } else { 0 },
    });

    if response == "wrong" && !why.trim().is_empty() {
        let bid = format!("w-{id}");
        doc.meta.beliefs.retain(|b| b.id != bid);
        doc.meta.beliefs.push(Belief {
            id: bid,
            text: why.trim().to_string(),
            source: "corrected".into(),
            was: String::new(),
            created_at: now_iso.to_string(),
            last_used: String::new(),
            uses: 0,
            pinned: false,
        });
    }
    mind.write(node_id, &doc)
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

/// Whether a belief is a candidate for dropping, and why.
///
/// Nothing you *said* is ever a candidate, whatever its age — you told it that
/// on purpose, and a bot that quietly forgets your instructions is worse than
/// one that remembers too much. Only what it worked out or watched ages, and
/// only after it has gone unused.
pub fn stale(b: &Belief, now_ms: i64) -> bool {
    if b.pinned || b.source == "you" || b.source == "corrected" {
        return false;
    }
    let created = b
        .last_used
        .is_empty()
        .then(|| b.created_at.as_str())
        .unwrap_or(b.last_used.as_str());
    let Ok(t) = chrono::DateTime::parse_from_rfc3339(created) else {
        return false;
    };
    let age_days = (now_ms - t.timestamp_millis()) / 86_400_000;
    // Used a lot, kept longer. Never used at all, six weeks is generous.
    let allowance = 42 + b.uses.clamp(0, 20) * 14;
    age_days > allowance
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/// One thing the bot thinks you should do, and the signal it read.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Suggestion {
    /// Stable across restarts, so a "not now" still applies tomorrow.
    pub id: String,
    pub title: String,
    /// Why this is on screen. Never optional — the rule the inbox already
    /// follows, for the same reason.
    pub evidence: String,
    /// interview | heartbeat | work | tool | goal
    pub kind: String,
    /// Which tool it is about, when it is about one.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub tool_id: String,
}

/// Everything a suggestion needs to know, passed in rather than fetched, so
/// the rules can be tested without a database, a vault or a clock.
pub struct Signals<'a> {
    pub goal: String,
    pub every: String,
    pub last_woke: Option<i64>,
    pub work: &'a [WorkItem],
    pub answered: usize,
    pub skipped: usize,
    pub offers: &'a [crate::botcatalog::ToolOffer],
    pub decided: &'a [ToolDecision],
    pub now_ms: i64,
}

/// The rules. Each one reads a signal it can name, and none of them involve a
/// model — which is what lets every suggestion answer "why are you telling me
/// this" without hand-waving.
pub fn derive(sig: &Signals) -> Vec<Suggestion> {
    let mut out = Vec::new();

    // 1. An interview that stopped halfway. First, because everything else the
    //    bot does is worse when it does not know the answers.
    let seen = sig.answered + sig.skipped;
    if seen < SCRIPT.len() {
        out.push(Suggestion {
            id: "interview".into(),
            title: format!("Finish telling it about this space — {} left", SCRIPT.len() - seen),
            evidence: format!(
                "It has {} of {} answers. Until it has them it is guessing at when to speak up.",
                sig.answered,
                SCRIPT.len()
            ),
            kind: "interview".into(),
            tool_id: String::new(),
        });
    }

    // 2. A routine that never runs. A bot without a heartbeat is a chat window.
    if sig.every.trim().is_empty() {
        out.push(Suggestion {
            id: "heartbeat".into(),
            title: "Give it a heartbeat".into(),
            evidence: "It has no routine, so it only ever looks at this space when you open it."
                .into(),
            kind: "heartbeat".into(),
            tool_id: String::new(),
        });
    }

    // 3. A goal with no steps. "It manages the work" is not true of a bot with
    //    no work to manage.
    if sig.work.is_empty() && !sig.goal.trim().is_empty() {
        out.push(Suggestion {
            id: "plan".into(),
            title: "Turn the goal into steps".into(),
            evidence: format!(
                "“{}” has nothing under it, so there is nothing to hand to an agent or to watch \
                 finish.",
                sig.goal.trim()
            ),
            kind: "work".into(),
            tool_id: String::new(),
        });
    }

    // 4. Work that is stuck. The one thing on this page that is genuinely
    //    urgent, so it names the item rather than counting.
    let blocked: Vec<&WorkItem> = sig.work.iter().filter(|w| w.status == "blocked").collect();
    if !blocked.is_empty() {
        let names = blocked
            .iter()
            .take(3)
            .map(|w| w.title.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        out.push(Suggestion {
            id: "blocked".into(),
            title: format!(
                "{} step{} blocked",
                blocked.len(),
                if blocked.len() == 1 { "" } else { "s" }
            ),
            evidence: format!("{names}. Nothing behind them moves until one of these does."),
            kind: "work".into(),
            tool_id: String::new(),
        });
    }

    // 5. Everything done. Worth saying once — a bot that never tells you it is
    //    finished is one you keep checking.
    if !sig.work.is_empty() && sig.work.iter().all(|w| w.status == "done") {
        out.push(Suggestion {
            id: "finished".into(),
            title: "Every step is done".into(),
            evidence: format!("All {} of them. Time for a new goal, or a rest.", sig.work.len()),
            kind: "goal".into(),
            tool_id: String::new(),
        });
    }

    // 6. Tools it has not been given and you have not refused. Cheapest rung
    //    first, one at a time — a list of five asks is a list you dismiss.
    let mut offers: Vec<&crate::botcatalog::ToolOffer> = sig
        .offers
        .iter()
        .filter(|o| !sig.decided.iter().any(|d| d.id == o.id))
        .collect();
    let rung = |k: &str| match k {
        "skill" => 0,
        "agent" => 1,
        "software" => 2,
        _ => 3,
    };
    offers.sort_by_key(|o| rung(&o.kind));
    if let Some(o) = offers.first() {
        out.push(Suggestion {
            id: format!("tool:{}", o.id),
            title: format!("It could use {}", o.name),
            evidence: o.because.clone(),
            kind: "tool".into(),
            tool_id: o.id.clone(),
        });
    }

    let _ = sig.last_woke;
    let _ = sig.now_ms;
    out
}

/// Drop what you have already answered. A "not now" comes back in a week; a
/// "wrong" never does — a suggestion turned down for a stated reason is not a
/// suggestion that improves by being repeated.
pub fn filter_answered(
    all: Vec<Suggestion>,
    answers: &[SuggestionAnswer],
    now_ms: i64,
) -> Vec<Suggestion> {
    all.into_iter()
        .filter(|s| match answers.iter().find(|a| a.id == s.id) {
            None => true,
            Some(a) if a.response == "wrong" => false,
            Some(a) if a.response == "snoozed" => now_ms >= a.until,
            // `done` is not permanent: if the same signal comes back, the
            // situation came back with it.
            Some(_) => true,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(title: &str, status: &str) -> WorkItem {
        WorkItem {
            id: title.into(),
            title: title.into(),
            status: status.into(),
            assignee: None,
            areas: vec![],
        }
    }

    fn sig<'a>(work: &'a [WorkItem], decided: &'a [ToolDecision]) -> Signals<'a> {
        Signals {
            goal: "Ship the site".into(),
            every: "weekdays".into(),
            last_woke: None,
            work,
            answered: 6,
            skipped: 0,
            offers: &[],
            decided,
            now_ms: 0,
        }
    }

    #[test]
    fn a_finished_interview_is_not_nagged_about() {
        let s = derive(&sig(&[item("a", "done")], &[]));
        assert!(!s.iter().any(|x| x.id == "interview"));
    }

    #[test]
    fn a_half_finished_interview_says_how_much_is_left() {
        let work = [item("a", "done")];
        let mut g = sig(&work, &[]);
        g.answered = 2;
        let s = derive(&g);
        let found = s.iter().find(|x| x.id == "interview").expect("asked");
        assert!(found.title.contains('4'), "{}", found.title);
    }

    /// A skipped question is answered as far as the bot is concerned — you
    /// declined, and being asked again is how it earns being closed.
    #[test]
    fn skipping_counts_as_settled() {
        let work = [item("a", "done")];
        let mut g = sig(&work, &[]);
        g.answered = 3;
        g.skipped = 3;
        assert!(!derive(&g).iter().any(|x| x.id == "interview"));
    }

    #[test]
    fn blocked_work_names_itself() {
        let work = [item("Sign the installer", "blocked"), item("b", "done")];
        let s = derive(&sig(&work, &[]));
        let found = s.iter().find(|x| x.id == "blocked").expect("raised");
        assert!(found.evidence.contains("Sign the installer"));
    }

    #[test]
    fn no_steps_at_all_asks_for_a_plan() {
        assert!(derive(&sig(&[], &[])).iter().any(|x| x.id == "plan"));
    }

    #[test]
    fn a_bot_with_no_routine_is_told_so() {
        let work = [item("a", "done")];
        let mut g = sig(&work, &[]);
        g.every = String::new();
        assert!(derive(&g).iter().any(|x| x.id == "heartbeat"));
    }

    /// The ladder, enforced where it matters: with a skill and an install both
    /// undecided, it asks for the skill.
    #[test]
    fn it_asks_for_the_cheapest_rung_first() {
        let offers = vec![
            crate::botcatalog::ToolOffer {
                id: "sw".into(),
                name: "Lighthouse".into(),
                kind: "software".into(),
                what: String::new(),
                wants: "an install".into(),
                because: "because".into(),
            },
            crate::botcatalog::ToolOffer {
                id: "sk".into(),
                name: "SEO review".into(),
                kind: "skill".into(),
                what: String::new(),
                wants: String::new(),
                because: "because".into(),
            },
        ];
        let work = [item("a", "done")];
        let mut g = sig(&work, &[]);
        g.offers = &offers;
        let s = derive(&g);
        let tool = s.iter().find(|x| x.kind == "tool").expect("offered");
        assert_eq!(tool.tool_id, "sk");
    }

    #[test]
    fn a_decided_tool_is_not_offered_again() {
        let offers = vec![crate::botcatalog::ToolOffer {
            id: "sk".into(),
            name: "SEO review".into(),
            kind: "skill".into(),
            what: String::new(),
            wants: String::new(),
            because: "because".into(),
        }];
        let decided = vec![ToolDecision {
            id: "sk".into(),
            response: "declined".into(),
            at: String::new(),
        }];
        let work = [item("a", "done")];
        let mut g = sig(&work, &decided);
        g.offers = &offers;
        assert!(!derive(&g).iter().any(|x| x.kind == "tool"));
    }

    #[test]
    fn wrong_is_forever_and_not_now_is_a_week() {
        let all = || {
            vec![
                Suggestion {
                    id: "a".into(),
                    title: String::new(),
                    evidence: String::new(),
                    kind: "work".into(),
                    tool_id: String::new(),
                },
                Suggestion {
                    id: "b".into(),
                    title: String::new(),
                    evidence: String::new(),
                    kind: "work".into(),
                    tool_id: String::new(),
                },
            ]
        };
        let answers = vec![
            SuggestionAnswer {
                id: "a".into(),
                response: "wrong".into(),
                why: "we do not do that here".into(),
                at: String::new(),
                until: 0,
            },
            SuggestionAnswer {
                id: "b".into(),
                response: "snoozed".into(),
                why: String::new(),
                at: String::new(),
                until: 1_000,
            },
        ];

        let now = filter_answered(all(), &answers, 500);
        assert!(now.is_empty(), "both are put away for now");

        let later = filter_answered(all(), &answers, 2_000);
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].id, "b", "the snooze came back; the refusal did not");
    }

    /// The rule that keeps memory honest: it may forget what it noticed, never
    /// what you told it.
    #[test]
    fn ageing_never_touches_what_you_said() {
        let old = "2020-01-01T00:00:00+00:00";
        let now = chrono::Utc::now().timestamp_millis();

        let mine = Belief {
            source: "you".into(),
            created_at: old.into(),
            ..Default::default()
        };
        let corrected = Belief {
            source: "corrected".into(),
            created_at: old.into(),
            ..Default::default()
        };
        let watched = Belief {
            source: "watched".into(),
            created_at: old.into(),
            ..Default::default()
        };
        let pinned = Belief {
            source: "watched".into(),
            created_at: old.into(),
            pinned: true,
            ..Default::default()
        };

        assert!(!stale(&mine, now));
        assert!(!stale(&corrected, now));
        assert!(stale(&watched, now));
        assert!(!stale(&pinned, now));
    }

    #[test]
    fn a_belief_it_leans_on_is_kept_longer() {
        let now = chrono::Utc::now().timestamp_millis();
        let two_months_ago = chrono::Utc::now() - chrono::Duration::days(50);
        let mut b = Belief {
            source: "watched".into(),
            created_at: two_months_ago.to_rfc3339(),
            uses: 0,
            ..Default::default()
        };
        assert!(stale(&b, now), "unused for 50 days");
        b.uses = 5;
        assert!(!stale(&b, now), "leant on five times, keep it");
    }

    /// The store split, enforced where it is easiest to get wrong: a mind is
    /// written under the personal root and nowhere near the vault.
    #[test]
    fn a_mind_round_trips_through_its_own_file() {
        let root = std::env::temp_dir().join(format!("devdeck-mind-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mind = Mind::at(PersonalStore::at(&root));

        let mut doc = mind.read(7).unwrap();
        assert!(doc.meta.beliefs.is_empty(), "a bot starts knowing nothing");

        doc.meta.beliefs.push(Belief {
            id: "a0".into(),
            text: "The demo is on 12 September".into(),
            source: "you".into(),
            created_at: "2026-08-30T09:00:00+00:00".into(),
            ..Default::default()
        });
        doc.meta.answers.push(Answer {
            step: 0,
            question: SCRIPT[0].into(),
            answer: "Shipping the site".into(),
            at: "2026-08-30T09:00:00+00:00".into(),
            skipped: false,
        });
        mind.write(7, &doc).unwrap();

        assert!(root.join("bots").join("7").join("mind.md").is_file());
        let back = mind.read(7).unwrap();
        assert_eq!(back.meta.beliefs.len(), 1);
        assert_eq!(back.meta.beliefs[0].text, "The demo is on 12 September");
        assert_eq!(back.meta.answers[0].answer, "Shipping the site");

        // Another bot on another folder knows nothing about this one.
        assert!(mind.read(8).unwrap().meta.beliefs.is_empty());

        mind.forget(7);
        assert!(mind.read(7).unwrap().meta.beliefs.is_empty(), "deleting a bot forgets you");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// The failure this design exists to prevent: a hand-edited file with one
    /// bad line reading as "the bot knows nothing", and the next write quietly
    /// replacing everything you told it.
    #[test]
    fn a_mind_that_will_not_parse_says_so_rather_than_looking_empty() {
        let root = std::env::temp_dir().join(format!("devdeck-badmind-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mind = Mind::at(PersonalStore::at(&root));

        // A file that never existed is an empty mind, and that is fine.
        assert!(mind.read(9).unwrap().meta.beliefs.is_empty());

        let dir = root.join("bots").join("9");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("mind.md"),
            "---
beliefs:
- id: a0
  text: 'he said 'no' to me'
---
",
        )
        .unwrap();

        let err = mind.read(9).unwrap_err();
        assert!(err.contains("could not be read"), "{err}");
        assert!(err.contains("nothing will be written over it"), "{err}");

        // And every operation refuses rather than overwriting.
        assert!(add_belief(&mind, 9, "something new", "now").is_err());
        assert!(beliefs(&mind, 9, 0).is_err());
        assert!(interview(&mind, 9).is_err());
        assert!(
            std::fs::read_to_string(dir.join("mind.md")).unwrap().contains("he said"),
            "the file on disk is untouched"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
