//! The learn run — the first thing in DevDeck that sends your mail anywhere.
//!
//! Everything up to this point ran on the machine: the sync, the extraction,
//! the ranking. This is the seam, and the whole shape of the module is an
//! argument about that seam:
//!
//! - **The estimate is built from the batch, not beside it.** One function
//!   assembles the corpus; the estimate is that corpus counted and the send is
//!   that corpus posted. An estimate computed by a second query is an estimate
//!   that can disagree with what leaves, and the number you approved would be
//!   a number nothing enforced.
//! - **Exclusions are counted, named and carried.** "1,204 messages from
//!   senders you never replied to" is not a footnote — it is the reason the
//!   batch is small enough to approve at all, and it goes on the receipt
//!   alongside what was sent.
//! - **The receipt is written before the reply arrives.** It records what was
//!   posted. A receipt written on success would be missing for exactly the
//!   runs you most want to audit.
//! - **Nothing is written to the deck or the personal store by this module's
//!   run.** Facts land in `learn_facts` as proposals. A yes writes one file; a
//!   no writes a row saying no, so it is not offered twice. That row is not a
//!   note about you, which is why the decline can live in the cache.
//!
//! The store split (CLAUDE.md) is enforced at the moment of keeping, in
//! `keep`: a `thing` fact goes to the node's deck in the vault, a `you` fact
//! goes to the personal store, and there is no path in this file that writes a
//! `you` fact anywhere near a repository.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::context::estimate_tokens;
use super::provider::AgentRequest;
use crate::db::Db;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// 400000 reads as a typo; 400,000 reads as a number somebody chose.
fn thousands(n: i64) -> String {
    let digits = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

fn now_millis() -> i64 {
    chrono::Local::now().timestamp_millis()
}

/// How many people a run offers to read about, unless you narrow it.
const DEFAULT_PEOPLE: i64 = 12;

/// The most messages one person can contribute to a batch.
///
/// A fourteen-year correspondence with a sibling is not more informative than
/// its last two hundred messages, and it is ten times the cost. The cap is per
/// person rather than overall so one heavy thread cannot crowd out everybody
/// else.
const MESSAGES_PER_PERSON: usize = 200;

/// The most characters of one message body that go in.
///
/// Long enough for a contract discussion, short enough that a mail with a
/// hundred-message quoted tail costs what the new part costs.
const CHARS_PER_MESSAGE: usize = 4_000;

/// The most characters of one attachment's extracted text.
const CHARS_PER_ATTACHMENT: usize = 12_000;

/// The ceiling on one whole run, in characters -- roughly 100,000 tokens.
///
/// Without one, twelve busy correspondents at two hundred messages each build a
/// prompt no model would accept and nobody would approve the cost of. The
/// budget is spent round-robin so it is the busiest person's older mail that
/// goes, not the twelfth person entirely, and whatever it cuts is named on the
/// estimate as an exclusion like any other.
const CHARS_PER_BATCH: usize = 400_000;

// ---------------------------------------------------------------------------
// What a batch is made of
// ---------------------------------------------------------------------------

/// Somebody the run proposes to read about.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LearnPerson {
    pub contact_id: i64,
    pub name: String,
    pub email: String,
    pub domain: String,
    /// The space of the mailbox they write to — the *suggested* destination for
    /// anything learned about them, never a rule.
    pub space: String,
    pub threads: i64,
    pub messages: i64,
    pub attachments: i64,
    pub chars: i64,
    /// Their side and yours, which is why they are on the list at all.
    pub received: i64,
    pub sent: i64,
}

/// Something deliberately left out, and why.
///
/// Both halves matter. A count with no reason is a number nobody can argue
/// with, and the reasons here are the ones somebody would want to argue with.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LearnExclusion {
    pub kind: String,
    pub count: i64,
    pub why: String,
}

/// One message, as it will be sent.
#[derive(Clone, Debug, Default)]
pub struct LearnMessage {
    pub id: i64,
    pub thread_key: String,
    pub mailbox: String,
    pub from_name: String,
    pub from_addr: String,
    pub to_addrs: String,
    pub subject: String,
    pub ts: i64,
    /// Already trimmed to `CHARS_PER_MESSAGE`, already stripped of quoted tail.
    pub body: String,
}

/// One attachment's text, as it will be sent.
#[derive(Clone, Debug, Default)]
pub struct LearnAttachment {
    pub id: i64,
    pub message_id: i64,
    pub filename: String,
    pub text: String,
}

/// The batch. Counted for the estimate, serialised for the send — one object,
/// so the two cannot drift.
#[derive(Clone, Debug, Default)]
pub struct Corpus {
    pub people: Vec<LearnPerson>,
    pub messages: Vec<LearnMessage>,
    pub attachments: Vec<LearnAttachment>,
    pub excluded: Vec<LearnExclusion>,
    pub depth: Depth,
    /// Sentences you have already turned down, carried into the prompt so the
    /// same one is not offered twice.
    pub declined: Vec<String>,
}

/// How much of each message goes.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Depth {
    /// Bodies. The only depth that can learn a client agreed thirty days and
    /// pays at forty-five.
    #[default]
    Full,
    /// Subjects, senders and the last few lines — the signature block, where a
    /// role and a company name usually are. Cheap, and honestly much weaker.
    Headers,
}

impl Depth {
    pub fn as_str(self) -> &'static str {
        match self {
            Depth::Full => "full",
            Depth::Headers => "headers",
        }
    }
    pub fn parse(s: &str) -> Depth {
        match s {
            "headers" => Depth::Headers,
            _ => Depth::Full,
        }
    }
}

impl Corpus {
    /// The size of the prompt that would be posted.
    ///
    /// Measured by rendering it, not by adding up the parts: the rendered form
    /// carries dates, addresses and thread headings that the parts do not, and
    /// an estimate that ignores them is an estimate of a message nobody sends.
    pub fn chars(&self) -> i64 {
        render(self).chars().count() as i64
    }

    /// The prompt and its token estimate, computed once.
    ///
    /// Both the estimate and the run want the same two numbers about the same
    /// string, and rendering it twice to get them is how they drift apart.
    pub fn body(&self) -> (String, i64, i64) {
        let text = render(self);
        let chars = text.chars().count() as i64;
        let tokens = estimate_tokens(&text) as i64;
        (text, chars, tokens)
    }

    pub fn thread_keys(&self) -> Vec<String> {
        let mut out: Vec<String> = self.messages.iter().map(|m| m.thread_key.clone()).collect();
        out.sort();
        out.dedup();
        out
    }

    /// How many things never reached the model at all.
    ///
    /// Deliberately not the sum of every exclusion: at `headers` depth the
    /// bodies are listed as left out, but those messages *did* go — their
    /// subjects and signatures did. Counting them here would make the receipt
    /// say "none of which reached the model" about mail that had.
    pub fn held_back(&self) -> i64 {
        self.excluded.iter().filter(|e| e.kind != "bodies").map(|e| e.count).sum()
    }
}

// ---------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------

/// What one decision buys, in numbers, before anything is sent.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LearnEstimate {
    pub people: Vec<LearnPerson>,
    pub threads: i64,
    pub messages: i64,
    pub attachments: i64,
    pub chars: i64,
    pub tokens: i64,
    /// Dollars, rounded to the cent it will actually cost. Zero when the model
    /// has no published price here — which is said in `price_note` rather than
    /// shown as free.
    pub cost_usd: f64,
    pub price_note: String,
    pub excluded: Vec<LearnExclusion>,
    pub depth: String,
    /// Who would be asked, and whether it can answer.
    pub provider: String,
    pub provider_name: String,
    pub model: String,
    /// False when the run would not actually read anything — no provider, or a
    /// mock. Better as a flag on the estimate than as a failure after approval.
    pub ready: bool,
    /// Why the run cannot happen, when it cannot. Empty when it can.
    pub note: String,
    /// Why the model differs from the assistant's, when it does. Never a
    /// reason the run is blocked -- those go in `note`, and sharing one field
    /// is how an explanation ends up styled as a warning.
    pub model_note: String,
}

/// Per-million-token prices, input and output, for the models we ship.
///
/// A table rather than a lookup because there is no endpoint that returns
/// prices, and a made-up number on the one screen that asks you to spend money
/// would be worse than no number. Anything not here reports no price and says
/// so, which is the failure-honesty rule applied to money.
fn price_per_mtok(model: &str) -> Option<(f64, f64)> {
    let m = model.to_ascii_lowercase();
    if m.contains("haiku") {
        return Some((1.00, 5.00));
    }
    if m.contains("sonnet") {
        return Some((3.00, 15.00));
    }
    if m.contains("opus") {
        return Some((15.00, 75.00));
    }
    None
}

/// What a run of this size costs, assuming the reply is a fraction of the ask.
///
/// The output guess is deliberate and stated: a learn run sends a mailbox and
/// gets back a page of facts, so output is small and input dominates. Pricing
/// it as if the model replied with as much as it read would inflate the one
/// number somebody is deciding on.
fn estimate_cost(model: &str, input_tokens: i64) -> (f64, String) {
    let Some((inp, out)) = price_per_mtok(model) else {
        return (
            0.0,
            format!("no published price for {model} here, so this run is not costed"),
        );
    };
    let output_tokens = (input_tokens / 20).clamp(500, 8_000);
    let cost = (input_tokens as f64 / 1_000_000.0) * inp
        + (output_tokens as f64 / 1_000_000.0) * out;
    (
        (cost * 100.0).round() / 100.0,
        format!("at ${inp:.2}/M in and ${out:.2}/M out, assuming a short reply"),
    )
}

impl Corpus {
    /// The corpus, counted. Everything shown to a person comes from here.
    #[allow(clippy::too_many_arguments)]
    pub fn estimate(
        &self,
        provider: &str,
        provider_name: &str,
        model: &str,
        ready: bool,
        note: &str,
    ) -> LearnEstimate {
        let (_, chars, tokens) = self.body();
        let (cost_usd, price_note) = estimate_cost(model, tokens);
        LearnEstimate {
            threads: self.thread_keys().len() as i64,
            messages: self.messages.len() as i64,
            attachments: self.attachments.len() as i64,
            people: self.people.clone(),
            chars,
            tokens,
            cost_usd,
            price_note,
            excluded: self.excluded.clone(),
            depth: self.depth.as_str().into(),
            provider: provider.into(),
            provider_name: provider_name.into(),
            model: model.into(),
            ready,
            // One field in, two out: a blocked run and a swapped model are not
            // the same message and must not share a colour on screen.
            note: if ready { String::new() } else { note.into() },
            model_note: if ready { note.into() } else { String::new() },
        }
    }
}

// ---------------------------------------------------------------------------
// Building the batch
// ---------------------------------------------------------------------------

/// Strip the quoted tail off a reply.
///
/// A twelve-message thread where each reply quotes the last sends the first
/// message twelve times. Cutting at the attribution line is the difference
/// between a thread costing what it says and costing the square of it.
fn strip_quoted(body: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for line in body.lines() {
        let t = line.trim();
        // The usual attribution lines, in the two shapes nearly every client
        // writes them.
        let attribution = (t.starts_with("On ") && t.ends_with("wrote:"))
            || t.starts_with("-----Original Message-----")
            || t.starts_with("________________________________")
            || (t.starts_with("From:") && out.len() > 2);
        if attribution {
            break;
        }
        out.push(line);
    }
    // A body that is quotation from its first line keeps its first lines
    // rather than becoming empty — an empty message is indistinguishable from
    // a failure to read it.
    if out.iter().all(|l| l.trim().is_empty()) {
        return body.chars().take(CHARS_PER_MESSAGE).collect();
    }
    let joined = out.join("\n");
    let trimmed = joined.trim();
    trimmed.chars().take(CHARS_PER_MESSAGE).collect()
}

/// The last few lines of a message — where a signature block lives.
fn tail(body: &str, lines: usize) -> String {
    let all: Vec<&str> = body.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n").chars().take(600).collect()
}

/// Does this message look like it is carrying a one-time code?
///
/// Narrower than the attachment rule on purpose. `mailfiles::sensitive_reason`
/// flags any document mentioning bank or identity words, which is right for a
/// scan and wrong for a mailbox — half of business mail says "invoice". Here
/// the question is only whether a body carries something that is a secret
/// *because it is in this message*: a login code, a reset link, a key.
pub fn message_secret_reason(subject: &str, body: &str) -> Option<&'static str> {
    if let Some(r) = crate::stash::secret_reason(body) {
        return Some(r);
    }
    let hay = format!("{} {}", subject.to_ascii_lowercase(), body.to_ascii_lowercase());
    const CODE_WORDS: &[&str] = &[
        "verification code",
        "one-time code",
        "one time code",
        "one-time passcode",
        "security code",
        "login code",
        "your code is",
        "two-factor",
        "2fa code",
        "otp",
    ];
    if CODE_WORDS.iter().any(|w| hay.contains(w)) && has_code_run(body) {
        return Some("this message carries a one-time code");
    }
    const RESET_WORDS: &[&str] = &["reset your password", "password reset", "set a new password"];
    if RESET_WORDS.iter().any(|w| hay.contains(w)) {
        return Some("this message carries a password reset link");
    }
    None
}

/// A run of 4 to 8 digits standing on its own — what a code looks like.
///
/// Required alongside the wording so that a message *about* two-factor
/// authentication (a support thread, a policy mail) is not mistaken for one
/// carrying a code. The wording alone was flagging conversations.
fn has_code_run(body: &str) -> bool {
    body.split(|c: char| !c.is_ascii_alphanumeric())
        .any(|w| (4..=8).contains(&w.len()) && w.bytes().all(|b| b.is_ascii_digit()))
}

/// Assemble the batch.
///
/// `only` narrows to specific contacts (the "Choose who" path); empty means the
/// top `people` by reciprocity. The same call answers both the estimate and the
/// send, which is the point.
pub fn build_corpus(
    conn: &Connection,
    people: i64,
    only: &[i64],
    depth: Depth,
) -> Result<Corpus, String> {
    let ranked = crate::mail::rank_correspondents_pub(conn, people.max(1).min(100))?;
    let chosen: Vec<crate::mail::Correspondent> = if only.is_empty() {
        ranked
    } else {
        ranked.into_iter().filter(|c| only.contains(&c.contact_id)).collect()
    };
    if chosen.is_empty() {
        return Err(
            "there is nobody to learn about yet — sync a mailbox first, and reply to somebody"
                .into(),
        );
    }

    let mut corpus = Corpus { depth, ..Default::default() };

    // Facts you have already said no to. Carried into the prompt so the same
    // sentence is not offered a second time — which is what "a decline is
    // remembered" has to mean if it is to mean anything.
    {
        let mut st = conn
            .prepare("SELECT text FROM learn_facts WHERE status='declined' ORDER BY decided_at DESC LIMIT 60")
            .map_err(err)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        corpus.declined = rows.flatten().collect();
    }

    // What earlier runs already read: thread key -> when. A message older than
    // that moment was in a batch you paid for and answered; only what arrived
    // since goes again. This is what makes a second run read the *next*
    // mail rather than the same newest mail, and what makes the estimate's
    // "run it again and they are next" a true sentence.
    let already: std::collections::HashMap<String, i64> = {
        let mut st = conn
            .prepare("SELECT thread_keys, started_at FROM learn_runs WHERE status = 'done'")
            .map_err(err)?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        let mut map: std::collections::HashMap<String, i64> = Default::default();
        for (keys, at) in rows.flatten() {
            for k in read_json::<Vec<String>>(&keys) {
                let e = map.entry(k).or_insert(at);
                if at > *e {
                    *e = at;
                }
            }
        }
        map
    };
    let mut read_before = 0i64;

    let mut secret_skipped = 0i64;
    let mut withheld = 0i64;
    let mut unreadable = 0i64;
    let mut pending = 0i64;

    // Gathered per person first, spent second. Taking messages straight into
    // the batch as they are read means the first person on the list spends
    // whatever budget there is and the twelfth gets nothing.
    let mut gathered: Vec<(LearnPerson, Vec<LearnMessage>)> = Vec::new();
    let mut atts: std::collections::HashMap<i64, Vec<LearnAttachment>> = Default::default();

    for c in &chosen {
        let person = LearnPerson {
            contact_id: c.contact_id,
            name: c.name.clone(),
            email: c.email.clone(),
            domain: c.domain.clone(),
            space: c.space.clone(),
            received: c.received,
            sent: c.sent,
            ..Default::default()
        };

        let mut st = conn
            .prepare(
                "SELECT id, thread_key, mailbox, from_name, from_addr, to_addrs,
                        subject, body_text, ts
                   FROM mail_messages
                  WHERE lower(from_addr) = lower(?1)
                     OR instr(lower(to_addrs), lower(?1)) > 0
                  ORDER BY ts DESC
                  LIMIT ?2",
            )
            .map_err(err)?;
        let rows = st
            .query_map(params![c.email, MESSAGES_PER_PERSON as i64], |r| {
                Ok(LearnMessage {
                    id: r.get(0)?,
                    thread_key: r.get(1)?,
                    mailbox: r.get(2)?,
                    from_name: r.get(3)?,
                    from_addr: r.get(4)?,
                    to_addrs: r.get(5)?,
                    subject: r.get(6)?,
                    body: r.get(7)?,
                    ts: r.get(8)?,
                })
            })
            .map_err(err)?;

        let mut mine = Vec::new();
        for mut m in rows.flatten() {
            // The secret check runs on the *whole* body, before any trimming.
            // Checking a truncated body would pass a message whose code sits
            // below the cut, and the cut is arbitrary.
            if message_secret_reason(&m.subject, &m.body).is_some() {
                secret_skipped += 1;
                continue;
            }
            if already.get(&m.thread_key).is_some_and(|at| m.ts <= *at) {
                read_before += 1;
                continue;
            }
            m.body = match depth {
                Depth::Full => strip_quoted(&m.body),
                Depth::Headers => tail(&m.body, 6),
            };
            if depth == Depth::Full && !atts.contains_key(&m.id) {
                let (found, states) = attachments_for(conn, m.id)?;
                withheld += states.0;
                unreadable += states.1;
                pending += states.2;
                if !found.is_empty() {
                    atts.insert(m.id, found);
                }
            }
            mine.push(m);
        }
        if !mine.is_empty() {
            gathered.push((person, mine));
        }
    }

    // Spend the budget fairly: one message each, newest first, round and round
    // until it runs out. Twelve people with wildly different volumes all get
    // their recent mail read, which is what somebody ticking twelve boxes
    // meant. Dropping the tail of the busiest correspondent is the cost, and
    // it is named below rather than hidden.
    let mut budget = CHARS_PER_BATCH;
    let mut dropped = 0i64;
    let mut taken: Vec<Vec<LearnMessage>> = gathered.iter().map(|_| Vec::new()).collect();
    let mut round = 0usize;
    loop {
        let mut moved = false;
        for (i, (_, mine)) in gathered.iter().enumerate() {
            let Some(m) = mine.get(round) else { continue };
            moved = true;
            let cost = m.body.len()
                + m.subject.len()
                + atts.get(&m.id).map(|v| v.iter().map(|a| a.text.len()).sum()).unwrap_or(0);
            if cost > budget {
                dropped += 1;
                continue;
            }
            budget -= cost;
            taken[i].push(m.clone());
        }
        if !moved {
            break;
        }
        round += 1;
    }

    for (i, (mut person, _)) in gathered.into_iter().enumerate() {
        let mine = std::mem::take(&mut taken[i]);
        if mine.is_empty() {
            continue;
        }
        let mut threads: std::collections::HashSet<String> = Default::default();
        for m in &mine {
            threads.insert(m.thread_key.clone());
            person.messages += 1;
            person.chars += (m.body.len() + m.subject.len()) as i64;
            if let Some(found) = atts.get(&m.id) {
                for a in found {
                    person.attachments += 1;
                    person.chars += a.text.len() as i64;
                    corpus.attachments.push(a.clone());
                }
            }
        }
        person.threads = threads.len() as i64;
        corpus.people.push(person);
        corpus.messages.extend(mine);
    }

    if dropped > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "budget".into(),
            count: dropped,
            why: format!(
                "older messages beyond the {} character ceiling one run reads — \
                 run it again afterwards and they are next",
                thousands(CHARS_PER_BATCH as i64)
            ),
        });
    }

    // The exclusion that makes the batch small: everybody you never wrote back
    // to. Counted from the messages themselves, so the number is the real one.
    let strangers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM mail_messages m
              WHERE m.mailbox = 'INBOX'
                AND NOT EXISTS (
                    SELECT 1 FROM mail_contacts c
                     WHERE lower(c.email) = lower(m.from_addr)
                       AND EXISTS (SELECT 1 FROM mail_messages s
                                    WHERE s.mailbox='Sent'
                                      AND instr(lower(s.to_addrs), lower(c.email)) > 0)
                )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if strangers > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "strangers".into(),
            count: strangers,
            why: "from senders you have never replied to — reciprocity, not volume".into(),
        });
    }
    // Codes anywhere in the inbox, not only in the chosen people's mail. Most
    // of them come from senders you never answer, which the ranking already
    // leaves out -- but "skipped whole" on the screen is a promise about the
    // mailbox, and the number has to be the mailbox's.
    let secret_everywhere: i64 = {
        let mut st = conn
            .prepare("SELECT subject, body_text FROM mail_messages WHERE mailbox='INBOX' LIMIT 5000")
            .map_err(err)?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        rows.flatten()
            .filter(|(s, b)| message_secret_reason(s, b).is_some())
            .count() as i64
    };
    let secret_skipped = secret_skipped.max(secret_everywhere);

    if read_before > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "read".into(),
            count: read_before,
            why: "already read by an earlier run -- only what arrived since goes again".into(),
        });
    }
    if secret_skipped > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "secret".into(),
            count: secret_skipped,
            why: "carrying a one-time code, a reset link or a key — skipped whole, not redacted"
                .into(),
        });
    }
    if withheld > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "withheld".into(),
            count: withheld,
            why: "attachments that look like bank or identity documents".into(),
        });
    }
    if unreadable > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "unreadable".into(),
            count: unreadable,
            why: "attachments nothing here could read — scans without a text layer, mostly".into(),
        });
    }
    if pending > 0 {
        corpus.excluded.push(LearnExclusion {
            kind: "pending".into(),
            count: pending,
            why: "attachments nobody has opened yet — they will be in the next run".into(),
        });
    }
    if depth == Depth::Headers {
        corpus.excluded.push(LearnExclusion {
            kind: "bodies".into(),
            count: corpus.messages.len() as i64,
            why: "every message body — only the subject and the last few lines went".into(),
        });
    }

    Ok(corpus)
}

/// One message's readable attachments, plus a count of the three ways an
/// attachment can fail to be one.
type AttStates = (i64, i64, i64);
fn attachments_for(conn: &Connection, message_id: i64) -> Result<(Vec<LearnAttachment>, AttStates), String> {
    let mut st = conn
        .prepare(
            "SELECT id, filename, file_path, extract_state
               FROM mail_attachments WHERE message_id = ?1",
        )
        .map_err(err)?;
    let rows = st
        .query_map(params![message_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(err)?;

    let mut out = Vec::new();
    let mut states: AttStates = (0, 0, 0);
    for (id, filename, path, state) in rows.flatten() {
        match state.as_str() {
            "withheld" => states.0 += 1,
            "unreadable" | "missing" => states.1 += 1,
            "text" => {
                let p = crate::mailfiles::text_path(std::path::Path::new(&path));
                match std::fs::read_to_string(&p) {
                    Ok(text) => out.push(LearnAttachment {
                        id,
                        message_id,
                        filename,
                        text: text.chars().take(CHARS_PER_ATTACHMENT).collect(),
                    }),
                    // The row says there is text and the file is gone. That is
                    // an unreadable attachment, not a silent zero.
                    Err(_) => states.1 += 1,
                }
            }
            // Empty: nobody has looked yet.
            _ => states.2 += 1,
        }
    }
    Ok((out, states))
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/// The first words of the learn prompt. The mock provider recognises a learn
/// request by them and answers with scripted facts instead of a scripted
/// developer session.
pub const SYSTEM_MARK: &str = "You are reading somebody's mail";

/// What the model is asked for, and the rule it has to file under.
///
/// The store split is in the prompt because the model is the one deciding
/// `thing` or `you` for each fact, and that decision is the one that puts
/// personal notes in a pull request when it goes wrong. It is checked again on
/// the way in — a fact that arrives with no kind is filed as `you`, the side
/// that never reaches a repository.
pub const SYSTEM: &str = "\
You are reading somebody's mail so their assistant knows who they deal with.

Return ONLY JSON, ONE OBJECT PER LINE. No prose, no code fence, no array
around them.

The FIRST line sums this person up, so the reader can decide about them in one
go instead of fact by fact:

  {\"kind\": \"summary\",
   \"text\": \"two or three sentences: who they are to the mailbox owner, what
            the two of them deal with together, and what is going on between
            them now\",
   \"about\": \"the person\"}

Then the facts, one per line:

  {\"kind\": \"thing\" | \"you\",
   \"text\": \"one specific sentence\",
   \"source\": \"where you saw it, in plain words\",
   \"about\": \"the person or company it concerns, or empty\"}

kind is the store the fact belongs in, and it matters:
  \"thing\" — about a client, a company, a project, an invoice, a supplier.
             It travels with that thing and a colleague may read it.
  \"you\"   — about the person whose mailbox this is: how they work, their
             goals, their family, their friends, their habits. It is private
             and must never end up in a shared repository.
If a fact is about both, split it in two.

What is worth returning:
  - relationships (who works for whom, who handles what)
  - commitments and how they were actually kept (agreed terms versus reality)
  - recurring patterns in how this person works
  - roles, companies and responsibilities stated in signatures or threads
Give the specific sentence, not the category. \"Harbour & Vine agreed 30-day
terms and has paid at 45 days or worse every time\" is a fact. \"The user has
clients\" is not — leave it out.

Never return: a one-time code, a password, a card or account number, or
anything you would not want written to a file. Never invent. If the mail does
not support a claim, do not make it. Ten true sentences beat forty guesses.";

/// The corpus as one prompt body.
pub fn render(corpus: &Corpus) -> String {
    let mut s = String::new();
    if !corpus.declined.is_empty() {
        s.push_str(
            "# Already turned down\n\nThese were offered before and refused. Do not offer them \
             again, in these words or in others that say the same thing.\n\n",
        );
        for d in &corpus.declined {
            s.push_str(&format!("- {d}\n"));
        }
        s.push('\n');
    }
    s.push_str("# The people\n\n");
    for p in &corpus.people {
        s.push_str(&format!(
            "- {} <{}>{} — you have had {} from them and sent {} to them; {} threads{}\n",
            if p.name.trim().is_empty() { &p.email } else { &p.name },
            p.email,
            if p.domain.is_empty() { String::new() } else { format!(" at {}", p.domain) },
            p.received,
            p.sent,
            p.threads,
            if p.space.is_empty() { String::new() } else { format!(" — mailbox belongs to the {} space", p.space) },
        ));
    }

    // Grouped by thread and oldest-first inside it: a conversation read
    // backwards is a conversation the model has to reconstruct, and it does
    // that badly.
    let mut by_thread: std::collections::BTreeMap<&str, Vec<&LearnMessage>> = Default::default();
    for m in &corpus.messages {
        by_thread.entry(&m.thread_key).or_default().push(m);
    }

    s.push_str("\n# The threads\n");
    for (_, mut msgs) in by_thread {
        msgs.sort_by_key(|m| m.ts);
        let subject = msgs.last().map(|m| m.subject.as_str()).unwrap_or_default();
        s.push_str(&format!("\n## {}\n", if subject.is_empty() { "(no subject)" } else { subject }));
        for m in msgs {
            let when = chrono::DateTime::from_timestamp_millis(m.ts)
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            let who = if m.from_name.trim().is_empty() { &m.from_addr } else { &m.from_name };
            s.push_str(&format!("\n[{when}] {who} <{}> → {}\n", m.from_addr, m.to_addrs));
            if !m.body.trim().is_empty() {
                s.push_str(m.body.trim());
                s.push('\n');
            }
            for a in corpus.attachments.iter().filter(|a| a.message_id == m.id) {
                s.push_str(&format!("\n--- attachment: {} ---\n{}\n", a.filename, a.text.trim()));
            }
        }
    }
    s
}

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

/// A fact as the model offered it, before anybody has agreed to it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProposedFact {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub about: String,
}

/// Anything that is not explicitly a thing is filed as personal.
///
/// The two mistakes are not symmetrical: a client note in the personal store
/// is untidy, and a personal note in a repository is somebody's private life
/// in a pull request.
fn normalise(mut f: ProposedFact) -> ProposedFact {
    f.kind = if f.kind.trim().eq_ignore_ascii_case("thing") {
        "thing".into()
    } else {
        "you".into()
    };
    f.text = f.text.trim().to_string();
    f
}

/// One fact from one line, if the line is one.
///
/// The model is asked for one JSON object per line so a fact can be shown the
/// moment its line is finished, before the rest are written. A line of prose,
/// a fence, or half an object is not a fact and yields nothing.
pub fn parse_fact_line(line: &str) -> Option<ProposedFact> {
    let l = line.trim().trim_end_matches(',');
    if !l.starts_with('{') || !l.ends_with('}') {
        return None;
    }
    let f = serde_json::from_str::<ProposedFact>(l).ok()?;
    if f.text.trim().is_empty() || is_summary(&f) {
        return None;
    }
    Some(normalise(f))
}

fn is_summary(f: &ProposedFact) -> bool {
    f.kind.trim().eq_ignore_ascii_case("summary")
}

/// The one line that sums a person up, if this is it.
///
/// Not a fact: it is never filed as one, so a batch's counts are facts and a
/// summary cannot be kept by accident as a sentence about nothing. It is
/// shown at the top of the person's card and written to their record when
/// the card is kept.
pub fn parse_summary_line(line: &str) -> Option<String> {
    let l = line.trim().trim_end_matches(',');
    if !l.starts_with('{') || !l.ends_with('}') {
        return None;
    }
    let f = serde_json::from_str::<ProposedFact>(l).ok()?;
    if !is_summary(&f) || f.text.trim().is_empty() {
        return None;
    }
    Some(f.text.trim().to_string())
}

/// Every fact in a whole reply.
///
/// Line by line first, which is the shape asked for. Then, because "mostly"
/// is not a contract, a JSON array wrapped in prose or a fence is salvaged
/// rather than a run somebody paid for being thrown away because it said
/// "Here you go:" first.
pub fn parse_facts(reply: &str) -> Vec<ProposedFact> {
    let lines: Vec<ProposedFact> = reply.lines().filter_map(parse_fact_line).collect();
    if !lines.is_empty() {
        return lines;
    }
    let salvaged = extract_array(reply).unwrap_or_default();
    let candidates = [reply.trim(), salvaged.as_str()];
    for c in candidates {
        if c.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Vec<ProposedFact>>(c) {
            return v
                .into_iter()
                .filter(|f| !f.text.trim().is_empty())
                .map(normalise)
                .collect();
        }
    }
    Vec::new()
}

fn extract_array(s: &str) -> Option<String> {
    let start = s.find('[')?;
    let end = s.rfind(']')?;
    if end <= start {
        return None;
    }
    Some(s[start..=end].to_string())
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/// A receipt. Written when the batch is posted, closed when the reply lands.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LearnRun {
    pub id: i64,
    pub started_at: i64,
    pub finished_at: i64,
    pub provider: String,
    pub model: String,
    pub status: String,
    pub depth: String,
    pub people: i64,
    pub threads: i64,
    pub messages: i64,
    pub attachments: i64,
    pub chars: i64,
    pub tokens: i64,
    pub held_back: i64,
    pub thread_keys: Vec<String>,
    pub held: Vec<LearnExclusion>,
    pub error: String,
    /// Filled by `runs`: how many facts came back and how many you kept.
    pub facts: i64,
    pub kept: i64,
}

/// A proposal, with everything needed to decide it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LearnFact {
    pub id: i64,
    pub run_id: i64,
    pub kind: String,
    pub text: String,
    pub source: String,
    pub thread_keys: Vec<String>,
    pub contact_id: i64,
    pub space: String,
    pub node_id: i64,
    pub status: String,
    pub written_to: String,
    pub created_at: i64,
    /// Where a yes would put it, in words. Computed, never stored — a path
    /// stored at proposal time is a path that can be wrong by the time you
    /// press Keep.
    pub destination: String,
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(s: &str) -> T {
    serde_json::from_str(s).unwrap_or_default()
}

pub fn runs(conn: &Connection, limit: i64) -> Result<Vec<LearnRun>, String> {
    let mut st = conn
        .prepare(
            "SELECT r.id, r.started_at, r.finished_at, r.provider, r.model, r.status, r.depth,
                    r.people, r.threads, r.messages, r.attachments, r.chars, r.tokens,
                    r.held_back, r.thread_keys, r.held_json, r.error,
                    (SELECT COUNT(*) FROM learn_facts f WHERE f.run_id = r.id),
                    (SELECT COUNT(*) FROM learn_facts f WHERE f.run_id = r.id AND f.status='kept')
               FROM learn_runs r
              ORDER BY r.started_at DESC LIMIT ?1",
        )
        .map_err(err)?;
    let rows = st
        .query_map(params![limit.clamp(1, 200)], |r| {
            Ok(LearnRun {
                id: r.get(0)?,
                started_at: r.get(1)?,
                finished_at: r.get(2)?,
                provider: r.get(3)?,
                model: r.get(4)?,
                status: r.get(5)?,
                depth: r.get(6)?,
                people: r.get(7)?,
                threads: r.get(8)?,
                messages: r.get(9)?,
                attachments: r.get(10)?,
                chars: r.get(11)?,
                tokens: r.get(12)?,
                held_back: r.get(13)?,
                thread_keys: read_json(&r.get::<_, String>(14)?),
                held: read_json(&r.get::<_, String>(15)?),
                error: r.get(16)?,
                facts: r.get(17)?,
                kept: r.get(18)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

/// Proposals, newest run first. `status` empty means every state.
pub fn facts(conn: &Connection, run_id: i64, status: &str) -> Result<Vec<LearnFact>, String> {
    let mut st = conn
        .prepare(
            "SELECT id, run_id, kind, text, source, thread_keys, contact_id, space,
                    node_id, status, written_to, created_at
               FROM learn_facts
              WHERE (?1 = 0 OR run_id = ?1)
                AND (?2 = '' OR status = ?2)
              ORDER BY run_id DESC, id ASC",
        )
        .map_err(err)?;
    let rows = st
        .query_map(params![run_id, status], |r| {
            Ok(LearnFact {
                id: r.get(0)?,
                run_id: r.get(1)?,
                kind: r.get(2)?,
                text: r.get(3)?,
                source: r.get(4)?,
                thread_keys: read_json(&r.get::<_, String>(5)?),
                contact_id: r.get(6)?,
                space: r.get(7)?,
                node_id: r.get(8)?,
                status: r.get(9)?,
                written_to: r.get(10)?,
                created_at: r.get(11)?,
                destination: String::new(),
            })
        })
        .map_err(err)?;
    let mut out = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    for f in &mut out {
        f.destination = describe_destination(conn, f);
    }
    Ok(out)
}

/// Where a yes would put this, said out loud.
///
/// The destination is on the screen next to the Keep button because the store
/// split is the thing most worth getting wrong quietly, and a path you can read
/// before you press the button is the only defence a person has against it.
fn describe_destination(conn: &Connection, f: &LearnFact) -> String {
    if f.kind != "thing" {
        return super::personal::PersonalStore::default_root()
            .join("memory")
            .to_string_lossy()
            .to_string();
    }
    match thing_dir(conn, f.node_id) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(e) => format!("nowhere yet — {e}"),
    }
}

/// The deck folder a `thing` fact is written into.
///
/// `node_deck_dir`, never `node_dir`: the two agree for a folder with no
/// repository and differ for every project, and the wrong one writes knowledge
/// into somebody's repository. That mistake has been made in this codebase
/// before and is why there are two functions.
fn thing_dir(conn: &Connection, node_id: i64) -> Result<std::path::PathBuf, String> {
    if node_id <= 0 {
        return Err("no space chosen for it".into());
    }
    let node = crate::db::node_by_id(conn, node_id).map_err(|_| "that space is gone".to_string())?;
    let dir = crate::db::node_deck_dir(conn, &node)
        .ok_or_else(|| "that space has no folder in the vault".to_string())?;
    Ok(super::deck::Deck::new(dir).knowledge_dir())
}

/// The node a space name refers to, if one does.
fn node_for_space(conn: &Connection, space: &str) -> i64 {
    if space.trim().is_empty() {
        return 0;
    }
    conn.query_row(
        "SELECT id FROM nodes WHERE name = ?1 COLLATE NOCASE ORDER BY
            CASE kind WHEN 'space' THEN 0 WHEN 'project' THEN 1 ELSE 2 END, id LIMIT 1",
        params![space],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/// The model a learn run should read with, given what the assistant is on.
///
/// Reading a mailbox is bulk extraction, not reasoning. Inheriting the
/// assistant's Opus turned a forty-cent job into a two-dollar one for an answer
/// that is no better, so a heavier model is stepped down to the Sonnet of the
/// same generation when the provider actually offers one.
///
/// It steps DOWN and never up, it only moves to a model that exists in the
/// provider's own list, and it leaves anything it does not recognise alone --
/// a local Llama stays exactly what you chose. When it does swap, the estimate
/// says so in words rather than quietly billing you less for something you did
/// not pick.
pub fn read_model(
    chosen: &str,
    available: &[super::provider::ModelInfo],
) -> (String, String) {
    let low = chosen.to_ascii_lowercase();
    if !low.contains("opus") {
        return (chosen.to_string(), String::new());
    }
    // Same generation first: opus-5 wants sonnet-5, not last year's sonnet.
    //
    // Compared as the WHOLE suffix after the family name, not with `ends_with`.
    // "claude-sonnet-4-5" ends with "5" and with "-5", so a looser test called
    // Sonnet 4.5 the same generation as Opus 5 and picked it while Sonnet 5 was
    // sitting in the same list.
    let gen = low.split("opus").nth(1).unwrap_or_default().to_string();
    let pick = available
        .iter()
        .find(|m| {
            let id = m.id.to_ascii_lowercase();
            id.split("sonnet").nth(1).map(|s| s == gen).unwrap_or(false)
        })
        .or_else(|| available.iter().find(|m| m.id.to_ascii_lowercase().contains("sonnet")));
    match pick {
        Some(m) => {
            let note = format!(
                "Reading with {} rather than your assistant's {chosen}: this is bulk reading, not reasoning, and the heavier model costs about five times as much for an answer that is no better.",
                m.id
            );
            (m.id.clone(), note)
        }
        None => (chosen.to_string(), String::new()),
    }
}

/// Which provider and model a run would use, and whether it can read anything.
///
/// The learn run borrows the assistant's own provider rather than having a
/// setting of its own: this *is* the assistant learning, and a second place to
/// put an API key is a second place for it to be wrong. The *model* is picked
/// for the job -- see `read_model` -- because the right model for a chat is
/// not the right model for reading three hundred messages.
pub fn destination_model(ws: &super::state::Workspace) -> (String, String, String, bool, String) {
    let Some(agent) = ws.agent(super::assistant::ASSISTANT_ID) else {
        return (
            String::new(),
            String::new(),
            String::new(),
            false,
            "there is no assistant configured to read them".into(),
        );
    };
    let (name, model, ready, note) = {
        let providers = ws.providers.lock().unwrap();
        match providers.get(&agent.provider) {
            None => (
                agent.provider.clone(),
                agent.model.clone(),
                false,
                format!("'{}' is not set up — add a key under Providers first", agent.provider),
            ),
            Some(p) if p.id() == super::provider::MockProvider::ID => (
                p.name().to_string(),
                agent.model.clone(),
                // Ready: the mock is a provider, not a bypass. It reads the
                // batch and answers with scripted facts, and says so, so the
                // whole run works with no key and nothing leaving the machine.
                true,
                "The mock provider answers with scripted facts drawn from the batch. Nothing is sent and nothing is learned from your mail. For the real thing: \
                 Point it at Anthropic under Providers and pick a model."
                    .into(),
            ),
            Some(p) => {
                let (model, why) = read_model(&agent.model, &p.list_models());
                (p.name().to_string(), model, true, why)
            }
        }
    };
    (agent.provider, name, model, ready, note)
}

/// Post the batch, write the receipt, keep what comes back as proposals.
///
/// Blocking on purpose — the caller puts it on the blocking pool. The receipt
/// is written before the call so a run that fails mid-flight still has a row
/// saying what left.
pub fn run(
    app: &tauri::AppHandle,
    ws: &super::state::Workspace,
    db: &Db,
    people: i64,
    only: &[i64],
    depth: Depth,
) -> Result<LearnRun, String> {
    let (provider_id, _provider_name, model, ready, note) = destination_model(ws);
    if !ready {
        return Err(note);
    }

    let corpus = {
        let conn = db.0.lock().unwrap();
        build_corpus(&conn, people, only, depth)?
    };
    if corpus.messages.is_empty() {
        return Err("nothing to read — every message for these people was held back".into());
    }

    // The one rendering. What is measured for the receipt is the string that
    // is posted, not a second opinion about it.
    let (prompt, chars, tokens) = corpus.body();
    let thread_keys = corpus.thread_keys();

    // The receipt, first. What left the machine is recorded before it leaves,
    // because the run that crashes on the wire is the one you most want a row
    // for.
    let run_id = {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO learn_runs
                (started_at, provider, model, status, depth, people, threads, messages,
                 attachments, chars, tokens, held_back, thread_keys, held_json)
             VALUES (?1,?2,?3,'sent',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                now_millis(),
                provider_id,
                model,
                depth.as_str(),
                corpus.people.len() as i64,
                thread_keys.len() as i64,
                corpus.messages.len() as i64,
                corpus.attachments.len() as i64,
                chars,
                tokens,
                corpus.held_back(),
                serde_json::to_string(&thread_keys).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&corpus.excluded).unwrap_or_else(|_| "[]".into()),
            ],
        )
        .map_err(err)?;
        conn.last_insert_rowid()
    };

    crate::services::push_log(
        app,
        crate::mail::MAIL_LOG_ID,
        "mail",
        "system",
        format!(
            "learn run {run_id}: sending {} messages in {} threads ({tokens} tokens) to {model}",
            corpus.messages.len(),
            thread_keys.len()
        ),
    );

    let request = AgentRequest {
        agent_id: super::assistant::ASSISTANT_ID.into(),
        role: "assistant".into(),
        model: model.clone(),
        system: SYSTEM.into(),
        context: prompt,
        goal: "Read this mail and return what is worth remembering, as JSON.".into(),
        ..Default::default()
    };

    let provider = {
        let providers = ws.providers.lock().unwrap();
        providers.get(&provider_id)
    }
    .ok_or_else(|| format!("'{provider_id}' is not configured"))?;

    let outcome = provider.run(&request);

    let reply = match outcome {
        Ok(r) => r,
        Err(e) => {
            let conn = db.0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE learn_runs SET status='failed', finished_at=?2, error=?3 WHERE id=?1",
                params![run_id, now_millis(), e.clone()],
            );
            crate::services::push_log(
                app,
                crate::mail::MAIL_LOG_ID,
                "mail",
                "system",
                format!("learn run {run_id} failed: {e}"),
            );
            return Err(e);
        }
    };

    let proposed = parse_facts(&reply.message);

    {
        let conn = db.0.lock().unwrap();
        for f in &proposed {
            // The person the fact names, so a "thing" fact gets a suggested
            // space. Matched on the corpus rather than on the whole address
            // book: a fact can only be about somebody who was in the batch.
            let person = corpus.people.iter().find(|p| {
                let a = f.about.to_ascii_lowercase();
                !a.is_empty()
                    && (a.contains(&p.email.to_ascii_lowercase())
                        || (!p.domain.is_empty() && a.contains(&p.domain.to_ascii_lowercase()))
                        || (!p.name.is_empty() && a.contains(&p.name.to_ascii_lowercase())))
            });
            let space = person.map(|p| p.space.clone()).unwrap_or_default();
            let node_id = if f.kind == "thing" { node_for_space(&conn, &space) } else { 0 };
            let _ = conn.execute(
                "INSERT INTO learn_facts
                    (run_id, kind, text, source, thread_keys, contact_id, space, node_id,
                     status, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'proposed',?9)",
                params![
                    run_id,
                    f.kind,
                    f.text,
                    f.source,
                    serde_json::to_string(&thread_keys).unwrap_or_else(|_| "[]".into()),
                    person.map(|p| p.contact_id).unwrap_or(0),
                    space,
                    node_id,
                    now_millis(),
                ],
            );
        }

        let usage_tokens = reply.usage.map(|u| (u.input + u.output) as i64).unwrap_or(tokens);
        let _ = conn.execute(
            "UPDATE learn_runs SET status='done', finished_at=?2, tokens=?3 WHERE id=?1",
            params![run_id, now_millis(), usage_tokens],
        );
    }

    crate::activity::record(
        app,
        "mail",
        "Read your mail".to_string(),
        format!(
            "{} message{} in {} thread{} · {} fact{} proposed",
            corpus.messages.len(),
            if corpus.messages.len() == 1 { "" } else { "s" },
            thread_keys.len(),
            if thread_keys.len() == 1 { "" } else { "s" },
            proposed.len(),
            if proposed.len() == 1 { "" } else { "s" },
        ),
        true,
        None,
    );

    let conn = db.0.lock().unwrap();
    runs(&conn, 1)?
        .into_iter()
        .find(|r| r.id == run_id)
        .ok_or_else(|| "the receipt is missing".to_string())
}

// ---------------------------------------------------------------------------
// The live run: one person at a time, facts as they are written
// ---------------------------------------------------------------------------

/// Set by `learn_stop`, read between people and between facts. A stopped run
/// keeps everything that came back: the receipt was written before the first
/// send and each person's facts are filed as they arrive.
static STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Somebody in the plan, as the screen lists them.
#[derive(Serialize, Clone, Debug, Default)]
pub struct LivePerson {
    pub contact_id: i64,
    pub name: String,
    pub email: String,
    pub threads: i64,
    pub messages: i64,
}

fn live_person(p: &LearnPerson) -> LivePerson {
    LivePerson {
        contact_id: p.contact_id,
        name: if p.name.trim().is_empty() { p.email.clone() } else { p.name.clone() },
        email: p.email.clone(),
        threads: p.threads,
        messages: p.messages,
    }
}

/// File one proposed fact and hand back the row, so the screen can show it
/// with the destination a yes would give it.
fn file_fact(
    conn: &Connection,
    run_id: i64,
    f: &ProposedFact,
    people: &[LearnPerson],
    thread_keys: &[String],
    fallback_contact: i64,
) -> Option<LearnFact> {
    let person = people
        .iter()
        .find(|p| {
            let a = f.about.to_ascii_lowercase();
            !a.is_empty()
                && (a.contains(&p.email.to_ascii_lowercase())
                    || (!p.domain.is_empty() && a.contains(&p.domain.to_ascii_lowercase()))
                    || (!p.name.is_empty() && a.contains(&p.name.to_ascii_lowercase())))
        })
        // A live run asks about one person at a time, so a fact whose
        // `about` says "her sister" still belongs on that person's card.
        .or_else(|| people.iter().find(|p| p.contact_id == fallback_contact));
    let space = person.map(|p| p.space.clone()).unwrap_or_default();
    let node_id = if f.kind == "thing" { node_for_space(conn, &space) } else { 0 };
    conn.execute(
        "INSERT INTO learn_facts
            (run_id, kind, text, source, thread_keys, contact_id, space, node_id, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'proposed',?9)",
        params![
            run_id,
            f.kind,
            f.text,
            f.source,
            serde_json::to_string(thread_keys).unwrap_or_else(|_| "[]".into()),
            person.map(|p| p.contact_id).unwrap_or(0),
            space,
            node_id,
            now_millis(),
        ],
    )
    .ok()?;
    let id = conn.last_insert_rowid();
    facts(conn, run_id, "").ok()?.into_iter().find(|x| x.id == id)
}

/// The run, one person at a time, telling the window as it goes.
///
/// Four events, all under `learn:`: `plan` once, then for each person every
/// `fact` the moment its line is finished and one `person` when they are
/// done, then `done` (or `failed`). One request per person is what makes the
/// progress true -- three of nine is three people actually read -- and one
/// fact per line is what lets a fact show before the rest are written.
///
/// The receipt is written before the first send, as in `run`, and each
/// person's facts are filed as they arrive, so Stop at any point loses
/// nothing that came back.
pub fn run_live(
    app: &tauri::AppHandle,
    ws: &super::state::Workspace,
    db: &Db,
    people: i64,
    only: &[i64],
    depth: Depth,
) -> Result<LearnRun, String> {
    use tauri::Emitter;
    STOP.store(false, std::sync::atomic::Ordering::SeqCst);

    let (provider_id, _provider_name, model, ready, note) = destination_model(ws);
    if !ready {
        return Err(note);
    }
    let provider = {
        let providers = ws.providers.lock().unwrap();
        providers.get(&provider_id)
    }
    .ok_or_else(|| format!("'{provider_id}' is not configured"))?;

    // The whole batch first: it is the receipt, and the plan the screen shows.
    let whole = {
        let conn = db.0.lock().unwrap();
        build_corpus(&conn, people, only, depth)?
    };
    if whole.messages.is_empty() {
        return Err("nothing to read -- every message for these people was held back".into());
    }
    let (_, chars, tokens) = whole.body();
    let thread_keys = whole.thread_keys();
    let (cost_usd, _) = estimate_cost(&model, tokens);

    let run_id = {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO learn_runs
                (started_at, provider, model, status, depth, people, threads, messages,
                 attachments, chars, tokens, held_back, thread_keys, held_json)
             VALUES (?1,?2,?3,'sent',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                now_millis(),
                provider_id,
                model,
                depth.as_str(),
                whole.people.len() as i64,
                thread_keys.len() as i64,
                whole.messages.len() as i64,
                whole.attachments.len() as i64,
                chars,
                tokens,
                whole.held_back(),
                serde_json::to_string(&thread_keys).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&whole.excluded).unwrap_or_else(|_| "[]".into()),
            ],
        )
        .map_err(err)?;
        conn.last_insert_rowid()
    };

    let plan: Vec<LivePerson> = whole.people.iter().map(live_person).collect();
    let _ = app.emit(
        "learn:plan",
        serde_json::json!({
            "run_id": run_id,
            "people": plan,
            "threads": thread_keys.len(),
            "messages": whole.messages.len(),
            "tokens": tokens,
            "cost_usd": cost_usd,
            "model": model,
        }),
    );
    crate::services::push_log(
        app,
        crate::mail::MAIL_LOG_ID,
        "mail",
        "system",
        format!(
            "learn run {run_id}: reading {} people, one at a time, with {model}",
            whole.people.len()
        ),
    );

    let total = whole.people.len();
    let mut tokens_so_far: i64 = 0;
    let mut facts_total = 0usize;
    let mut stopped = false;
    // What has actually gone. The row above was written with the whole plan
    // so a crash mid-run leaves a receipt; from here it is corrected after
    // every person, so a Stop after the second of nine says two of nine and
    // the other seven are still unread next time.
    let mut sent_keys: Vec<String> = Vec::new();
    let mut sent_messages: i64 = 0;
    let mut sent_people: i64 = 0;

    for (i, person) in whole.people.iter().enumerate() {
        if STOP.load(std::sync::atomic::Ordering::SeqCst) {
            stopped = true;
            break;
        }
        // This person's slice, built the same way the whole was. Asked for
        // every ranked person so a late name in the ranking is still found.
        let part = {
            let conn = db.0.lock().unwrap();
            build_corpus(&conn, 100, &[person.contact_id], depth)?
        };
        if part.messages.is_empty() {
            continue;
        }
        let (prompt, part_chars, part_tokens) = part.body();
        let _ = part_chars;
        let request = AgentRequest {
            agent_id: super::assistant::ASSISTANT_ID.into(),
            role: "assistant".into(),
            model: model.clone(),
            system: SYSTEM.into(),
            context: prompt,
            goal: format!(
                "Read the mail with {} and return what is worth remembering, one JSON object per line.",
                live_person(person).name
            ),
            ..Default::default()
        };

        // Facts land as their line completes. A line can arrive in pieces, so
        // the tail is kept until its newline; whatever is left when the reply
        // ends is tried once more.
        let buffer = std::cell::RefCell::new(String::new());
        let count = std::cell::Cell::new(0usize);
        let summary = std::cell::RefCell::new(String::new());
        let who = live_person(person);
        let on_line = |line: &str| {
            if let Some(text) = parse_summary_line(line) {
                let _ = app.emit(
                    "learn:summary",
                    serde_json::json!({
                        "run_id": run_id,
                        "index": i,
                        "total": total,
                        "person": who,
                        "text": text,
                    }),
                );
                *summary.borrow_mut() = text;
                return;
            }
            let Some(f) = parse_fact_line(line) else { return };
            let filed = {
                let conn = db.0.lock().unwrap();
                file_fact(&conn, run_id, &f, &whole.people, &part.thread_keys(), person.contact_id)
            };
            if let Some(filed) = filed {
                count.set(count.get() + 1);
                let _ = app.emit(
                    "learn:fact",
                    serde_json::json!({
                        "run_id": run_id,
                        "index": i,
                        "total": total,
                        "person": who,
                        "fact": filed,
                    }),
                );
            }
        };
        let outcome = provider.run_streaming(&request, &|delta: &str| {
            let mut buf = buffer.borrow_mut();
            buf.push_str(delta);
            while let Some(nl) = buf.find('\n') {
                let line = buf[..nl].to_string();
                buf.replace_range(..=nl, "");
                on_line(&line);
            }
        });
        let rest = std::mem::take(&mut *buffer.borrow_mut());
        if !rest.trim().is_empty() {
            on_line(&rest);
        }

        match outcome {
            Ok(r) => {
                tokens_so_far += r
                    .usage
                    .map(|u| (u.input + u.output) as i64)
                    .unwrap_or(part_tokens);
            }
            Err(e) => {
                let _ = app.emit(
                    "learn:failed",
                    serde_json::json!({ "run_id": run_id, "index": i, "person": who, "error": e }),
                );
                let conn = db.0.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE learn_runs SET status='failed', finished_at=?2, error=?3 WHERE id=?1",
                    params![run_id, now_millis(), e.clone()],
                );
                return Err(e);
            }
        }
        facts_total += count.get();
        sent_people += 1;
        sent_messages += part.messages.len() as i64;
        for k in part.thread_keys() {
            if !sent_keys.contains(&k) {
                sent_keys.push(k);
            }
        }
        {
            let conn = db.0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE learn_runs SET people=?2, threads=?3, messages=?4, thread_keys=?5 WHERE id=?1",
                params![
                    run_id,
                    sent_people,
                    sent_keys.len() as i64,
                    sent_messages,
                    serde_json::to_string(&sent_keys).unwrap_or_else(|_| "[]".into()),
                ],
            );
        }
        let (cost_so_far, _) = estimate_cost(&model, tokens_so_far);
        let _ = app.emit(
            "learn:person",
            serde_json::json!({
                "run_id": run_id,
                "index": i,
                "total": total,
                "person": who,
                "facts": count.get(),
                "summary": summary.borrow().clone(),
                "tokens_so_far": tokens_so_far,
                "cost_so_far": cost_so_far,
            }),
        );
    }

    {
        let conn = db.0.lock().unwrap();
        let _ = conn.execute(
            "UPDATE learn_runs SET status='done', finished_at=?2, tokens=?3 WHERE id=?1",
            params![run_id, now_millis(), tokens_so_far.max(1)],
        );
    }
    crate::activity::record(
        app,
        "mail",
        if stopped { "Stopped reading your mail".to_string() } else { "Read your mail".to_string() },
        format!(
            "{} people, {} fact{} proposed",
            whole.people.len(),
            facts_total,
            if facts_total == 1 { "" } else { "s" }
        ),
        true,
        None,
    );
    let run = {
        let conn = db.0.lock().unwrap();
        runs(&conn, 1)?
            .into_iter()
            .find(|r| r.id == run_id)
            .ok_or_else(|| "the receipt is missing".to_string())?
    };
    let _ = app.emit("learn:done", serde_json::json!({ "run": run, "stopped": stopped }));
    Ok(run)
}

// ---------------------------------------------------------------------------
// Deciding a fact
// ---------------------------------------------------------------------------

/// Say yes to one fact. This is where something is finally written.
///
/// `text` and `node_id` are passed back in so an edit made on the screen is
/// what gets stored — the proposal is a draft, and a fact you had to correct
/// is worth more than one you had to reject.
pub fn keep(
    conn: &Connection,
    id: i64,
    text: &str,
    node_id: i64,
) -> Result<String, String> {
    let mut f = facts(conn, 0, "")?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| "that proposal is gone".to_string())?;
    if f.status == "kept" {
        return Err("that one is already kept".into());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("a fact with no words in it is not a fact".into());
    }
    f.text = text.to_string();
    if node_id > 0 {
        f.node_id = node_id;
    }

    let written = if f.kind == "thing" {
        let dir = thing_dir(conn, f.node_id)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("could not open {}: {e}", dir.display()))?;
        let slug = slug(&f.text);
        let path = dir.join(format!("{slug}.md"));
        let body = format!(
            "---\nid: {slug}\nsource: mail\nlearned_at: {}\n---\n\n{}\n\n> {}\n",
            chrono::Local::now().format("%Y-%m-%d"),
            f.text,
            if f.source.trim().is_empty() { "from your mail" } else { f.source.trim() },
        );
        std::fs::write(&path, body).map_err(|e| format!("could not write it: {e}"))?;
        path.to_string_lossy().to_string()
    } else {
        // Personal, and the store refuses to open inside a repository, so this
        // path cannot end in a commit even if a node were pointed at one.
        let store = super::personal::PersonalStore::open().map_err(|e| e.to_string())?;
        let doc = super::deck::Doc {
            meta: super::personal::MemoryMeta {
                id: String::new(),
                title: headline(&f.text),
                created_at: chrono::Local::now().to_rfc3339(),
                project_id: None,
                tags: vec!["mail".into(), "learned".into()],
            },
            body: format!(
                "{}\n\n> {}\n",
                f.text,
                if f.source.trim().is_empty() { "from your mail" } else { f.source.trim() },
            ),
        };
        store
            .save_memory(&doc)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string()
    };

    conn.execute(
        "UPDATE learn_facts SET status='kept', text=?2, node_id=?3, written_to=?4, decided_at=?5
          WHERE id=?1",
        params![id, f.text, f.node_id, written, now_millis()],
    )
    .map_err(err)?;
    Ok(written)
}

/// Say no. Writes a row, not a note.
pub fn decline(conn: &Connection, id: i64) -> Result<(), String> {
    let n = conn
        .execute(
            "UPDATE learn_facts SET status='declined', decided_at=?2 WHERE id=?1",
            params![id, now_millis()],
        )
        .map_err(err)?;
    if n == 0 {
        return Err("that proposal is gone".into());
    }
    Ok(())
}

/// A filename from a sentence. Lowercase, words joined by dashes, short enough
/// to read in a directory listing.
fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= 60 {
            break;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        format!("fact-{}", now_millis())
    } else {
        s
    }
}

/// The first clause of a sentence, for a title.
fn headline(text: &str) -> String {
    let cut = text
        .char_indices()
        .find(|(i, c)| (*c == '.' || *c == ',' || *c == ';') && *i > 12)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    let s: String = text[..cut].chars().take(80).collect();
    s.trim().to_string()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Ws<'a> = tauri::State<'a, std::sync::Arc<super::state::Workspace>>;

/// What one decision would buy. Local only — nothing here leaves the machine.
#[tauri::command]
pub async fn learn_estimate(
    ws: Ws<'_>,
    db: tauri::State<'_, Db>,
    people: i64,
    only: Vec<i64>,
    depth: String,
) -> Result<LearnEstimate, String> {
    let (provider, provider_name, model, ready, note) = destination_model(&ws);
    let conn = db.0.lock().unwrap();
    let corpus = build_corpus(
        &conn,
        if people > 0 { people } else { DEFAULT_PEOPLE },
        &only,
        Depth::parse(&depth),
    )?;
    Ok(corpus.estimate(&provider, &provider_name, &model, ready, &note))
}

/// Everybody the run could read about, so "Choose who" has a list.
#[tauri::command(async)]
pub fn learn_people(db: tauri::State<Db>, limit: i64) -> Result<Vec<crate::mail::Correspondent>, String> {
    let conn = db.0.lock().unwrap();
    crate::mail::rank_correspondents_pub(&conn, if limit > 0 { limit } else { 50 })
}

/// Send it. The one command in DevDeck that puts your mail on the wire.
#[tauri::command]
pub async fn learn_run(
    app: tauri::AppHandle,
    ws: Ws<'_>,
    people: i64,
    only: Vec<i64>,
    depth: String,
) -> Result<LearnRun, String> {
    let ws = (*ws).clone();
    let depth = Depth::parse(&depth);
    let people = if people > 0 { people } else { DEFAULT_PEOPLE };
    // Off the main thread and onto the blocking pool: the provider uses
    // `reqwest::blocking`, which builds and drops a runtime internally and
    // panics if that happens inside an async context.
    tauri::async_runtime::spawn_blocking(move || {
        let db = <tauri::AppHandle as tauri::Manager<tauri::Wry>>::state::<Db>(&app);
        run(&app, &ws, &db, people, &only, depth)
    })
    .await
    .map_err(|e| format!("the run did not finish: {e}"))?
}

/// The same run, told live: one person at a time, facts as they are written.
#[tauri::command]
pub async fn learn_run_live(
    app: tauri::AppHandle,
    ws: Ws<'_>,
    people: i64,
    only: Vec<i64>,
    depth: String,
) -> Result<LearnRun, String> {
    let ws = (*ws).clone();
    let depth = Depth::parse(&depth);
    let people = if people > 0 { people } else { DEFAULT_PEOPLE };
    tauri::async_runtime::spawn_blocking(move || {
        let db = <tauri::AppHandle as tauri::Manager<tauri::Wry>>::state::<Db>(&app);
        run_live(&app, &ws, &db, people, &only, depth)
    })
    .await
    .map_err(|e| format!("the run did not finish: {e}"))?
}

/// Stop after the person being read. Everything that came back stays.
#[tauri::command]
pub fn learn_stop() {
    STOP.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command(async)]
pub fn learn_runs(db: tauri::State<Db>, limit: i64) -> Result<Vec<LearnRun>, String> {
    let conn = db.0.lock().unwrap();
    runs(&conn, if limit > 0 { limit } else { 20 })
}

#[tauri::command(async)]
pub fn learn_facts(db: tauri::State<Db>, run_id: i64, status: String) -> Result<Vec<LearnFact>, String> {
    let conn = db.0.lock().unwrap();
    facts(&conn, run_id, &status)
}

#[tauri::command(async)]
pub fn learn_keep(
    db: tauri::State<Db>,
    id: i64,
    text: String,
    node_id: i64,
) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    keep(&conn, id, &text, node_id)
}

/// One note in a space's knowledge folder, as the page shows it.
#[derive(Serialize, Clone, Debug, Default)]
pub struct KnownNote {
    pub name: String,
    pub body: String,
}

/// Everything known about a space: the notes in its `knowledge/`.
///
/// Kept facts and setup answers alike. Read through the deck so the page sees
/// exactly what the space's manager sees, and no more.
#[tauri::command(async)]
pub fn learn_notes(db: tauri::State<Db>, node_id: i64) -> Result<Vec<KnownNote>, String> {
    let conn = db.0.lock().unwrap();
    let dir = match thing_dir(&conn, node_id) {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()),
    };
    let deck_dir = dir.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
    let Some(root) = deck_dir else { return Ok(Vec::new()) };
    Ok(super::deck::Deck::new(root)
        .knowledge()
        .into_iter()
        .map(|(name, body)| KnownNote { name: name.replace('-', " "), body })
        .collect())
}

/// Write one note into a space's `knowledge/` by hand.
///
/// What the Home setup's answers become: the address, who works there, that
/// there is a pool. Same folder a kept fact lands in, same shape, so the
/// space's manager reads it the same way.
#[tauri::command(async)]
pub fn learn_note_save(
    db: tauri::State<Db>,
    node_id: i64,
    title: String,
    body: String,
) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let dir = thing_dir(&conn, node_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not open {}: {e}", dir.display()))?;
    let title = title.trim();
    let body = body.trim();
    if title.is_empty() || body.is_empty() {
        return Err("a note needs a title and something in it".into());
    }
    let path = dir.join(format!("{}.md", slug(title)));
    std::fs::write(
        &path,
        format!(
            "---
source: you
learned_at: {}
---

{body}
",
            chrono::Local::now().format("%Y-%m-%d")
        ),
    )
    .map_err(|e| format!("could not write it: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn learn_decline(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    decline(&conn, id)
}

/// One fact, as kept: the id and the words, which may have been edited.
#[derive(Deserialize, Clone, Debug, Default)]
pub struct KeptLine {
    pub id: i64,
    pub text: String,
    #[serde(default)]
    pub node_id: i64,
}

/// A person's card, decided in one go.
///
/// A run proposes a dozen facts per person, and a dozen decisions per person
/// is admin nobody does. The card is the unit instead: keep it and every
/// fact on it is kept and the summary goes on the person's record; change it
/// and the lines you unticked are declined; dismiss it and they all are.
#[derive(Deserialize, Clone, Debug, Default)]
pub struct PersonDecision {
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub keep: Vec<KeptLine>,
    #[serde(default)]
    pub decline: Vec<i64>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct PersonOutcome {
    pub kept: usize,
    pub declined: usize,
    /// The person's file in the personal store, when a summary was written.
    pub person_file: String,
}

#[tauri::command(async)]
pub fn learn_decide_person(db: tauri::State<Db>, decision: PersonDecision) -> Result<PersonOutcome, String> {
    let conn = db.0.lock().unwrap();
    decide_person(&conn, &decision)
}

pub fn decide_person(conn: &Connection, d: &PersonDecision) -> Result<PersonOutcome, String> {
    let mut out = PersonOutcome::default();
    for line in &d.keep {
        match keep(conn, line.id, &line.text, line.node_id) {
            Ok(_) => out.kept += 1,
            // Kept a moment ago from the same card: not a failure.
            Err(e) if e.contains("already kept") => {}
            Err(e) => return Err(e),
        }
    }
    for id in &d.decline {
        decline(conn, *id)?;
        out.declined += 1;
    }
    let summary = d.summary.trim();
    if summary.is_empty() || d.name.trim().is_empty() {
        return Ok(out);
    }
    // The summary goes on the person, not into memory: it is what they are
    // to you, and the Life page reads it from their record.
    let store = super::personal::PersonalStore::open().map_err(|e| e.to_string())?;
    let found = if d.email.trim().is_empty() { None } else { store.person_for(&d.email) }
        .or_else(|| store.person_for(&d.name));
    let mut doc = found.unwrap_or_else(|| super::deck::Doc {
        meta: super::personal::PersonMeta {
            name: d.name.trim().to_string(),
            source: "mail".into(),
            ..Default::default()
        },
        body: String::new(),
    });
    let email = d.email.trim().to_ascii_lowercase();
    if !email.is_empty() && !doc.meta.emails.iter().any(|e| e.eq_ignore_ascii_case(&email)) {
        doc.meta.emails.push(email);
    }
    if doc.body.trim().is_empty() {
        doc.body = summary.to_string();
    } else if !doc.body.contains(summary) {
        doc.body = format!("{}\n\n{summary}", doc.body.trim_end());
    }
    let path = store.save_person(&doc).map_err(|e| e.to_string())?;
    out.person_file = path.to_string_lossy().to_string();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::db::CORE_SCHEMA).unwrap();
        c.execute_batch(crate::db::MAIL_SCHEMA).unwrap();
        // Migrations too, or these run against a shape no installed copy has
        // ever had -- `space` and the extraction state are migration columns.
        crate::db::migrate(&c);
        c
    }

    fn account(c: &Connection, space: &str) -> i64 {
        c.execute(
            "INSERT INTO mail_accounts (name, address, imap_host, imap_port, username, space)
             VALUES ('a','me@example.com','imap.example.com',993,'me',?1)",
            params![space],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn contact(c: &Connection, name: &str, email: &str) -> i64 {
        c.execute(
            "INSERT INTO mail_contacts (name, email, kind) VALUES (?1, ?2, 'person')",
            params![name, email],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    #[allow(clippy::too_many_arguments)]
    fn msg(c: &Connection, acct: i64, uid: i64, mailbox: &str, from: &str, to: &str, subject: &str, body: &str) -> i64 {
        c.execute(
            "INSERT INTO mail_messages
                (account_id, uid, mailbox, thread_key, from_addr, to_addrs, subject, body_text, ts)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![acct, uid, mailbox, format!("t{uid}"), from, to, subject, body, 1_700_000_000_000i64 + uid],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    /// The claim the whole run rests on, at the level that matters: a batch
    /// built from a mailbox with one real correspondent and one shop in it
    /// contains the correspondent and not the shop.
    #[test]
    fn a_sender_you_never_answered_is_not_in_the_batch() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        contact(&c, "Shop", "noreply@shop.example");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "We agreed 30 days.");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Understood.");
        for i in 0..40 {
            msg(&c, a, 100 + i, "INBOX", "noreply@shop.example", "me@example.com", "Sale", "Buy things");
        }

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        assert_eq!(corpus.people.len(), 1, "one of these two is a person");
        assert_eq!(corpus.people[0].email, "sarah@harbourvine.com");
        assert!(
            corpus.messages.iter().all(|m| !m.from_addr.contains("shop.example")),
            "the shop got into the batch"
        );
        let strangers = corpus.excluded.iter().find(|e| e.kind == "strangers").unwrap();
        assert_eq!(strangers.count, 40, "and it is counted, not silently dropped");
    }

    /// A one-time code must never reach a model, and skipping the message whole
    /// is the only honest way: a redacted body is a body somebody has to trust
    /// the redaction of.
    #[test]
    fn a_message_carrying_a_login_code_is_skipped_whole() {
        let c = mem();
        let a = account(&c, "Personal");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "We agreed 30 days.");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Understood.");
        msg(
            &c, a, 3, "INBOX", "sarah@harbourvine.com", "me@example.com",
            "Your verification code",
            "Your verification code is 448210. It expires in ten minutes.",
        );

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        let rendered = render(&corpus);
        assert!(!rendered.contains("448210"), "the code went into the prompt");
        let skipped = corpus.excluded.iter().find(|e| e.kind == "secret").unwrap();
        assert_eq!(skipped.count, 1);
    }

    /// A mail *about* two-factor authentication is a conversation, not a code.
    /// The wording alone used to be enough to drop it.
    #[test]
    fn talking_about_two_factor_is_not_carrying_a_code() {
        assert!(message_secret_reason(
            "Re: rollout",
            "We should turn on two-factor for the whole team before launch."
        )
        .is_none());
        assert!(message_secret_reason("Code", "Your verification code is 928311").is_some());
    }

    /// The number you approved has to be the number that is sent. One function
    /// builds the batch; the estimate is that batch counted.
    #[test]
    fn the_estimate_counts_the_batch_that_would_be_sent() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "We agreed 30 days.");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Understood.");

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        let est = corpus.estimate("anthropic", "Anthropic", "claude-sonnet-5", true, "");
        assert_eq!(est.messages, corpus.messages.len() as i64);
        assert_eq!(est.threads, corpus.thread_keys().len() as i64);
        assert_eq!(est.chars, corpus.chars());
        assert!(est.tokens > 0);
        assert!(est.cost_usd > 0.0, "a priced model must be costed");
    }

    /// An unpriced model reports no price and says why, rather than showing
    /// zero — which would read as free.
    #[test]
    fn a_model_with_no_published_price_is_not_reported_as_free() {
        let (cost, note) = estimate_cost("some-local-llama", 500_000);
        assert_eq!(cost, 0.0);
        assert!(note.contains("not costed"), "{note}");
        let (cost, _) = estimate_cost("claude-sonnet-5", 1_000_000);
        assert!(cost > 3.0, "a million input tokens of Sonnet is at least $3");
    }

    /// The quoted tail is most of a long thread's bytes and none of its
    /// meaning.
    #[test]
    fn a_reply_does_not_carry_the_thread_it_quotes() {
        let body = "Yes, Friday works.\n\nOn Tue, 3 Sep, Sarah wrote:\n> Can we meet?\n> Also the invoice.";
        let out = strip_quoted(body);
        assert!(out.contains("Friday"));
        assert!(!out.contains("invoice"), "the quoted tail survived: {out}");
    }

    /// A reply that is nothing but quotation still has to send something, or a
    /// message reads as unreadable when it was merely terse.
    #[test]
    fn a_message_that_is_all_quotation_is_not_emptied() {
        let body = "On Tue, Sarah wrote:\n> the whole thing";
        assert!(!strip_quoted(body).trim().is_empty());
    }

    /// The asymmetry that protects the personal store: anything not explicitly
    /// a thing is filed as personal, because a client note in the wrong place
    /// is untidy and a personal note in a repository is not.
    #[test]
    fn a_fact_with_no_kind_is_filed_as_personal() {
        let out = parse_facts(r#"[{"text":"You work late","source":"sent times"}]"#);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "you");

        let out = parse_facts(r#"[{"kind":"nonsense","text":"x","source":"y"}]"#);
        assert_eq!(out[0].kind, "you");
    }

    #[test]
    fn a_reply_wrapped_in_prose_or_a_fence_still_parses() {
        let out = parse_facts(
            "Here is what I found:\n```json\n[{\"kind\":\"thing\",\"text\":\"They pay late\"}]\n```\nHope that helps.",
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "thing");
        assert_eq!(out[0].text, "They pay late");
    }

    #[test]
    fn a_reply_that_is_not_json_yields_nothing_rather_than_a_guess() {
        assert!(parse_facts("I could not read that mailbox.").is_empty());
        assert!(parse_facts("").is_empty());
    }

    /// A fact with no text is not a fact, and an empty file in somebody's deck
    /// is worse than no file.
    #[test]
    fn an_empty_fact_is_dropped_on_the_way_in() {
        let out = parse_facts(r#"[{"kind":"thing","text":"   "},{"kind":"thing","text":"real"}]"#);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "real");
    }

    /// The first line sums the person up. It is shown, and kept on the
    /// person, but it is never a fact: a run's counts are facts, and a
    /// summary kept as one would be a sentence about nothing in memory.
    #[test]
    fn a_summary_line_is_a_summary_and_never_a_fact() {
        let line = r#"{"kind":"summary","text":"Anna is your sister. You plan Sunday lunches.","about":"Anna"}"#;
        assert_eq!(
            parse_summary_line(line).as_deref(),
            Some("Anna is your sister. You plan Sunday lunches.")
        );
        assert!(parse_fact_line(line).is_none(), "a summary is not filed as a fact");

        let fact = r#"{"kind":"you","text":"Anna's son is Josh","about":"Anna"}"#;
        assert!(parse_summary_line(fact).is_none());
        assert!(parse_fact_line(fact).is_some());

        // A whole reply: the summary line does not change the fact count.
        let reply = format!("{line}\n{fact}\n");
        assert_eq!(parse_facts(&reply).len(), 1);
    }

    /// Board 5, in code: a `you` fact never gets a deck path, whatever space
    /// it came from.
    #[test]
    fn a_personal_fact_is_never_offered_a_deck_path() {
        let c = mem();
        c.execute(
            "INSERT INTO learn_runs (started_at, provider, model) VALUES (1, 'anthropic', 'm')",
            [],
        )
        .unwrap();
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO learn_facts (run_id, kind, text, space, node_id, created_at)
             VALUES (?1, 'you', 'You answer client mail in the evening', 'Develtech', 7, 2)",
            params![run_id],
        )
        .unwrap();

        let out = facts(&c, run_id, "").unwrap();
        assert_eq!(out.len(), 1);
        assert!(
            out[0].destination.to_lowercase().contains("assistant"),
            "a personal fact was pointed at {}",
            out[0].destination
        );
        assert!(!out[0].destination.contains(".devdeck"));
    }

    /// Declining leaves a "no" behind rather than a note — and the no is what
    /// stops it being offered twice.
    #[test]
    fn a_declined_fact_is_a_row_not_a_note() {
        let c = mem();
        c.execute("INSERT INTO learn_runs (started_at) VALUES (1)", []).unwrap();
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO learn_facts (run_id, kind, text, created_at) VALUES (?1,'you','nope',2)",
            params![run_id],
        )
        .unwrap();
        let id = c.last_insert_rowid();

        decline(&c, id).unwrap();
        let out = facts(&c, run_id, "declined").unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].written_to.is_empty(), "a no wrote something");
        assert!(decline(&c, id + 999).is_err(), "declining nothing is an error");
    }

    /// A `thing` fact with nowhere to go says so instead of writing somewhere
    /// convenient.
    #[test]
    fn a_thing_fact_with_no_space_refuses_rather_than_guessing() {
        let c = mem();
        c.execute("INSERT INTO learn_runs (started_at) VALUES (1)", []).unwrap();
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO learn_facts (run_id, kind, text, node_id, created_at)
             VALUES (?1,'thing','They pay at 45 days',0,2)",
            params![run_id],
        )
        .unwrap();
        let id = c.last_insert_rowid();

        let e = keep(&c, id, "They pay at 45 days", 0).unwrap_err();
        assert!(e.contains("no space"), "{e}");
        let still = facts(&c, run_id, "").unwrap();
        assert_eq!(still[0].status, "proposed", "a failed keep must not mark it kept");
    }

    #[test]
    fn a_fact_you_emptied_is_refused() {
        let c = mem();
        c.execute("INSERT INTO learn_runs (started_at) VALUES (1)", []).unwrap();
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO learn_facts (run_id, kind, text, created_at) VALUES (?1,'you','x',2)",
            params![run_id],
        )
        .unwrap();
        assert!(keep(&c, c.last_insert_rowid(), "   ", 0).is_err());
    }

    #[test]
    fn a_slug_is_readable_and_never_empty() {
        assert_eq!(slug("Harbour & Vine pay at 45 days"), "harbour-vine-pay-at-45-days");
        assert!(!slug("!!!").is_empty());
        assert!(slug(&"a".repeat(500)).len() <= 60);
    }

    #[test]
    fn a_headline_stops_at_the_first_clause() {
        assert_eq!(
            headline("You answer client mail in the evening, almost never before 10am."),
            "You answer client mail in the evening"
        );
    }

    /// Headers depth sends subjects and signatures and says plainly that it
    /// dropped the bodies, rather than quietly sending less than you think.
    #[test]
    fn headers_depth_says_what_it_left_out() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms",
            "Long body here.\nAnother line.\n\n--\nSarah Whitfield\nHead of Ops, Harbour & Vine");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Understood.");

        let corpus = build_corpus(&c, 12, &[], Depth::Headers).unwrap();
        assert!(corpus.excluded.iter().any(|e| e.kind == "bodies"));
        let rendered = render(&corpus);
        assert!(rendered.contains("Head of Ops"), "the signature is the point of this depth");
    }

    /// The estimate has to measure the string that is posted. Adding up the
    /// parts leaves out every date, address and thread heading in the prompt,
    /// which is a real fraction of a short batch.
    #[test]
    fn the_estimate_measures_the_prompt_not_its_ingredients() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "Hi");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Hi");

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        let (prompt, chars, tokens) = corpus.body();
        assert_eq!(chars, prompt.chars().count() as i64);
        assert_eq!(chars, corpus.chars(), "two ways of asking must agree");
        let parts: i64 = corpus
            .messages
            .iter()
            .map(|m| (m.body.len() + m.subject.len()) as i64)
            .sum();
        assert!(chars > parts, "the prompt is bigger than its ingredients");
        assert!(tokens > 0);
    }

    /// At headers depth the bodies are listed as left out, but those messages
    /// did go. Counting them as held back would make the receipt say "none of
    /// which reached the model" about mail that had.
    #[test]
    fn a_trimmed_body_is_not_counted_as_something_that_never_went() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "Long body");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Hi");

        let corpus = build_corpus(&c, 12, &[], Depth::Headers).unwrap();
        let bodies = corpus.excluded.iter().find(|x| x.kind == "bodies").unwrap().count;
        assert!(bodies > 0, "the exclusion is still listed, which is the honest part");
        assert_eq!(corpus.held_back(), 0, "but nothing here failed to reach the model");
    }

    /// The budget must not be eaten by whoever happens to be first.
    ///
    /// A heavy correspondent with hundreds of long messages used to spend the
    /// whole ceiling before the second person was reached, so ticking twelve
    /// boxes quietly read one. Round-robin means everybody gets their recent
    /// mail in, and it is the busiest person's oldest that goes.
    #[test]
    fn one_heavy_correspondent_cannot_starve_the_others() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Heavy", "heavy@example.com");
        contact(&c, "Quiet", "quiet@example.com");
        // Enough to blow the ceiling several times over on their own.
        let long = "x".repeat(CHARS_PER_MESSAGE);
        for i in 0..400 {
            msg(&c, a, 1000 + i, "INBOX", "heavy@example.com", "me@example.com", "Big", &long);
        }
        msg(&c, a, 1, "Sent", "me@example.com", "heavy@example.com", "Re: Big", "ok");
        msg(&c, a, 2, "INBOX", "quiet@example.com", "me@example.com", "Small", "Hello there");
        msg(&c, a, 3, "Sent", "me@example.com", "quiet@example.com", "Re: Small", "Hi");

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        assert!(
            corpus.people.iter().any(|p| p.email == "quiet@example.com"),
            "the quiet one was crowded out: {:?}",
            corpus.people.iter().map(|p| &p.email).collect::<Vec<_>>()
        );
        assert!(
            corpus.chars() < CHARS_PER_BATCH as i64 * 2,
            "the batch blew past the ceiling: {}",
            corpus.chars()
        );
        assert!(
            corpus.excluded.iter().any(|x| x.kind == "budget"),
            "what the ceiling cut has to be named, not silently dropped"
        );
    }

    /// "A decline is remembered" has to mean the model is told, or the same
    /// sentence comes back next run and you say no to it again.
    #[test]
    fn what_you_turned_down_is_carried_into_the_next_prompt() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "Hi");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Hi");
        c.execute("INSERT INTO learn_runs (started_at) VALUES (1)", []).unwrap();
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO learn_facts (run_id, kind, text, status, created_at)
             VALUES (?1,'you','You dislike phone calls','declined',2)",
            params![run_id],
        )
        .unwrap();

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        assert_eq!(corpus.declined, vec!["You dislike phone calls".to_string()]);
        assert!(render(&corpus).contains("You dislike phone calls"));
    }

    /// Reading a mailbox with Opus costs five times what Sonnet costs for an
    /// answer that is no better. Inheriting the assistant's model wholesale
    /// made a real $1.97 estimate out of a $0.40 job.
    #[test]
    fn a_heavy_model_is_stepped_down_for_bulk_reading() {
        use super::super::provider::ModelInfo;
        let have = |ids: &[&str]| -> Vec<ModelInfo> {
            ids.iter()
                .map(|i| ModelInfo { id: (*i).into(), ..Default::default() })
                .collect()
        };

        let list = have(&["claude-opus-5", "claude-sonnet-5", "claude-sonnet-4-5"]);
        let (model, why) = read_model("claude-opus-5", &list);
        assert_eq!(model, "claude-sonnet-5", "the same generation, not last year's");
        assert!(!why.is_empty(), "a swap has to be explained, not silent");

        // Already the right weight: left alone, and nothing to explain.
        let (model, why) = read_model("claude-sonnet-5", &list);
        assert_eq!(model, "claude-sonnet-5");
        assert!(why.is_empty());
    }

    /// The generation trap, which this fell into against the real model list:
    /// "claude-sonnet-4-5" ends with "5", so a loose suffix test called it the
    /// same generation as Opus 5 and picked a year-old model with Sonnet 5 in
    /// the same list.
    #[test]
    fn same_generation_means_the_same_generation() {
        use super::super::provider::ModelInfo;
        let list: Vec<ModelInfo> = ["claude-sonnet-4-5", "claude-sonnet-5"]
            .iter()
            .map(|i| ModelInfo { id: (*i).into(), ..Default::default() })
            .collect();
        assert_eq!(read_model("claude-opus-5", &list).0, "claude-sonnet-5");

        // And the other way: an Opus 4.5 wants the Sonnet beside it.
        assert_eq!(read_model("claude-opus-4-5", &list).0, "claude-sonnet-4-5");

        // No same-generation Sonnet at all: take the one that is there rather
        // than staying on the expensive model out of tidiness.
        let older: Vec<ModelInfo> = [ModelInfo {
            id: "claude-sonnet-4-5".into(),
            ..Default::default()
        }]
        .into();
        assert_eq!(read_model("claude-opus-5", &older).0, "claude-sonnet-4-5");
    }

    /// It steps down, never up, and never onto something that is not there.
    #[test]
    fn a_model_it_does_not_recognise_is_left_exactly_as_chosen() {
        use super::super::provider::ModelInfo;
        let local = vec![ModelInfo { id: "llama-3.3-70b".into(), ..Default::default() }];

        // Nothing to step down to: the choice stands rather than failing or
        // silently picking something else off the list.
        let (model, why) = read_model("claude-opus-5", &local);
        assert_eq!(model, "claude-opus-5");
        assert!(why.is_empty());

        // Not a model this knows anything about: untouched.
        let (model, why) = read_model("llama-3.3-70b", &local);
        assert_eq!(model, "llama-3.3-70b");
        assert!(why.is_empty());

        // A haiku is already cheaper than a sonnet. Never step up.
        let list = vec![ModelInfo { id: "claude-sonnet-5".into(), ..Default::default() }];
        assert_eq!(read_model("claude-haiku-4-5", &list).0, "claude-haiku-4-5");
    }

    /// A second run must not pay for the same mail twice. What an earlier run
    /// read is skipped, and only what arrived since goes again.
    #[test]
    fn a_thread_an_earlier_run_read_is_not_read_again_unless_new_mail_arrived() {
        let c = mem();
        let a = account(&c, "Develtech");
        contact(&c, "Sarah", "sarah@harbourvine.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "old");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "old");
        c.execute(
            "INSERT INTO learn_runs (started_at, status, thread_keys) VALUES (?1, 'done', ?2)",
            params![1_700_000_000_000i64 + 5, serde_json::to_string(&vec!["t1", "t2"]).unwrap()],
        )
        .unwrap();

        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        assert!(corpus.messages.is_empty(), "everything was read before");
        assert_eq!(corpus.excluded.iter().find(|x| x.kind == "read").unwrap().count, 2);

        // A reply arrives in one of those threads: that message goes, the old
        // ones still do not.
        c.execute(
            "INSERT INTO mail_messages (account_id, uid, mailbox, thread_key, from_addr, to_addrs, subject, body_text, ts)
             VALUES (?1, 9, 'INBOX', 't1', 'sarah@harbourvine.com', 'me@example.com', 'Re: Terms', 'new', ?2)",
            params![a, 1_700_000_000_000i64 + 9],
        )
        .unwrap();
        let corpus = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        assert_eq!(corpus.messages.len(), 1);
        assert_eq!(corpus.messages[0].body, "new");
    }

    /// "Choose who" has to actually narrow it.
    #[test]
    fn choosing_who_narrows_the_batch() {
        let c = mem();
        let a = account(&c, "Develtech");
        let sarah = contact(&c, "Sarah", "sarah@harbourvine.com");
        contact(&c, "Tom", "tom@innotrack.com");
        msg(&c, a, 1, "INBOX", "sarah@harbourvine.com", "me@example.com", "Terms", "Hello");
        msg(&c, a, 2, "Sent", "me@example.com", "sarah@harbourvine.com", "Re: Terms", "Hi");
        msg(&c, a, 3, "INBOX", "tom@innotrack.com", "me@example.com", "Spec", "Hello");
        msg(&c, a, 4, "Sent", "me@example.com", "tom@innotrack.com", "Re: Spec", "Hi");

        let all = build_corpus(&c, 12, &[], Depth::Full).unwrap();
        assert_eq!(all.people.len(), 2);
        let one = build_corpus(&c, 12, &[sarah], Depth::Full).unwrap();
        assert_eq!(one.people.len(), 1);
        assert_eq!(one.people[0].email, "sarah@harbourvine.com");
    }
}
