//! How the assistant talks, as the first line of its own file.
//!
//! A persona is not a setting. The assistant is already an agent, and an agent
//! is already a Markdown file whose *body* is its instructions — so "pick a
//! voice" is a first line written into that body, and "change it later" is
//! editing the file. Nothing new had to be stored, and nothing here can be
//! true in the picker while being false in the file, because there is only the
//! file.
//!
//! The split inside the body is deliberate and marked:
//!
//! ```text
//! <voice — yours, rewritten when you pick another>
//!
//! ## What I do            <- the duties, kept when the voice changes
//! ...
//! ```
//!
//! Picking a new voice rewrites everything above the marker and leaves
//! everything below it, so a duty you added by hand survives a change of tone.
//! If the marker is gone — you rewrote the file yourself — we do not guess
//! where your words end. We leave it alone and say so.

/// One way of speaking, with the line it actually writes.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct Voice {
    pub id: String,
    pub name: String,
    /// What it sounds like, for the picker. A sample, not a description —
    /// nobody can tell "concise" from "terse" until they have read both.
    pub sample: String,
    pub note: String,
    /// The instruction itself.
    pub line: String,
}

fn v(id: &str, name: &str, sample: &str, note: &str, line: &str) -> Voice {
    Voice {
        id: id.to_string(),
        name: name.to_string(),
        sample: sample.to_string(),
        note: note.to_string(),
        line: line.to_string(),
    }
}

/// Where the voice stops and the duties begin.
pub const DUTIES_MARKER: &str = "## What I do";

/// The part that does not change when you change the voice.
///
/// Deliberately not developer-shaped. The first version of this said "you are
/// the developer's assistant… you coordinate the team", which quietly decided
/// that everything this thing is for is software — and then a Life space with
/// a dog and a gym had no one who could speak about it.
pub fn duties() -> String {
    format!(
        "{DUTIES_MARKER}\n\n\
         I keep track of what matters across everything you run — your work, your \
         businesses and your life — and I bring you the few things that need you \
         rather than everything that happened.\n\n\
         I coordinate the managers and their agents. I do not do their work for them.\n\n\
         What I learn about *you* is kept on this machine, outside every repository. \
         What I learn about a *thing* — a client, a project, an invoice — is kept with \
         that thing. I do not move a fact from one side to the other without saying so.\n\n\
         When I am not sure, I say I am not sure. I would rather ask one question than \
         be confidently wrong about your week."
    )
}

/// The voices offered at the first run. Three, because a list of ten is a
/// decision you cannot make, and every one of them is a sample rather than an
/// adjective.
pub fn voices() -> Vec<Voice> {
    vec![
        v(
            "plain",
            "Plain",
            "Three things want you. The invoice from Harbour & Vine is 31 days late.",
            "Short. No warm-up.",
            "Speak plainly and get to the point. No greeting, no preamble, no sign-off. \
             Lead with the thing that matters and stop when it is said.",
        ),
        v(
            "warm",
            "Warm",
            "Morning. Three things today — and Harbour & Vine still haven't paid, a month on now.",
            "Talks like a person.",
            "Talk like a person who knows them. A greeting is fine, so is a passing remark, \
             but never pad — warmth is in the phrasing, not in extra sentences.",
        ),
        v(
            "blunt",
            "Blunt",
            "Chase Harbour & Vine. 31 days. You said you'd do it last Monday too.",
            "Will tell you when you slipped.",
            "Be blunt. Say the uncomfortable part out loud, including when they said they \
             would do something and did not. Never soften a fact to be pleasant. Do not be \
             unkind about it — the point is that they can trust what you say.",
        ),
    ]
}

pub fn voice(id: &str) -> Option<Voice> {
    voices().into_iter().find(|x| x.id == id)
}

/// Build the assistant's instructions: a voice, then the duties.
///
/// `custom` wins over `id`, and picking it is recorded as the voice `own` —
/// so the picker can say "yours" rather than silently showing Plain selected.
pub fn body(id: &str, custom: &str) -> String {
    let head = if !custom.trim().is_empty() {
        custom.trim().to_string()
    } else {
        voice(id)
            .map(|x| x.line)
            .unwrap_or_else(|| voices()[0].line.clone())
    };
    format!("{head}\n\n{}", duties())
}

/// Put a new voice on an existing file without losing what was added below it.
///
/// Returns `None` when the marker is not there, which means one of two things:
/// the body is the one-line prompt from before personas existed, or someone
/// rewrote it by hand. The caller decides, and the two callers differ.
///
/// The **first run** replaces it, because it has never asked before and the
/// line it is replacing is the developer-shaped seed. A **later** change of
/// voice must not: by then the body is either yours or ours, and overwriting
/// someone's own instructions to honour a radio button is how you lose the
/// only file they were told they owned.
pub fn revoice(existing: &str, id: &str, custom: &str) -> Option<String> {
    let at = existing.find(DUTIES_MARKER)?;
    let head = if !custom.trim().is_empty() {
        custom.trim().to_string()
    } else {
        voice(id).map(|x| x.line)?
    };
    Some(format!("{head}\n\n{}", &existing[at..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_voice_is_a_sample_not_an_adjective() {
        for x in voices() {
            assert!(!x.sample.trim().is_empty(), "{} has no sample", x.id);
            assert!(!x.line.trim().is_empty(), "{} has no instruction", x.id);
            // A sample that is a description of the voice teaches nothing.
            assert!(
                x.sample.len() > 30,
                "{}'s sample is too short to hear a voice in",
                x.id
            );
        }
    }

    #[test]
    fn a_body_carries_the_voice_and_the_duties() {
        let b = body("blunt", "");
        assert!(b.contains("Be blunt"));
        assert!(b.contains(DUTIES_MARKER));
        // The thing the old prompt got wrong.
        assert!(!b.contains("developer's assistant"));
    }

    #[test]
    fn custom_words_beat_the_presets() {
        let b = body("plain", "  Talk to me like a chief of staff.  ");
        assert!(b.starts_with("Talk to me like a chief of staff."));
        assert!(!b.contains("Speak plainly"));
    }

    #[test]
    fn changing_the_voice_keeps_what_was_added_below_it() {
        let mut b = body("plain", "");
        b.push_str("\n\nNever schedule anything on a Friday afternoon.");

        let out = revoice(&b, "blunt", "").expect("marker is present");
        assert!(out.starts_with("Be blunt"));
        assert!(out.contains("Never schedule anything on a Friday afternoon."));
        assert!(!out.contains("Speak plainly"));
    }

    #[test]
    fn a_hand_written_file_is_left_alone() {
        assert!(revoice("I am whatever I want to be.", "plain", "").is_none());
    }
}
