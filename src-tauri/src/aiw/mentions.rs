//! Who a message is talking to.
//!
//! A thread is the unit of work now, so a message needs a way to say *who it
//! is for*. That is `@name`, and it does exactly two things, deliberately kept
//! apart:
//!
//! - **A mention pulls someone in.** They join the thread and read it from
//!   there on. It costs nothing and nobody has to agree to it.
//! - **A handover moves a claim.** `@dev-a take "Fix dirty_files"` is not a
//!   mention with extra words: it is work changing hands, so it goes through
//!   the same gate as `delegate.start` and can be refused.
//!
//! Keeping the parse here rather than in the assistant loop means both halves
//! of the app — the feature thread and a bot's own thread — read a message the
//! same way. A parser that lived in one of them would eventually disagree with
//! the other about what `@qa` meant.

/// Every `@name` in a message, lowercased, in order, without duplicates.
///
/// An email address is not a mention: `you@example.com` has a word character
/// before the `@`, and treating that as pulling in "example" would be a bug
/// you would only find in front of someone.
pub fn mentions(text: &str) -> Vec<String> {
    let bytes: Vec<char> = text.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != '@' {
            i += 1;
            continue;
        }
        // Preceded by a word character → part of something else.
        if i > 0 && (bytes[i - 1].is_alphanumeric() || bytes[i - 1] == '.') {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut end = start;
        while end < bytes.len() && (bytes[end].is_alphanumeric() || bytes[end] == '-' || bytes[end] == '_') {
            end += 1;
        }
        if end > start {
            let name: String = bytes[start..end].iter().collect::<String>().to_lowercase();
            if !out.iter().any(|x| x == &name) {
                out.push(name);
            }
        }
        i = if end > start { end } else { i + 1 };
    }
    out
}

/// Work changing hands: `@dev-a take "Fix dirty_files"`.
#[derive(Clone, Debug, PartialEq)]
pub struct Handover {
    /// Who is being given it.
    pub agent: String,
    /// The work item, by id or by title. Empty means "the one we are talking
    /// about", which the caller resolves.
    pub what: String,
}

/// Read a handover out of a message, if it is one.
///
/// Only the plain forms, on purpose: `@name take …`, `@name takes …`,
/// `@name pick up …`. Guessing at intent is how a mention silently becomes a
/// claim transfer, and a claim transfer is the thing that needs asking.
pub fn handover(text: &str) -> Option<Handover> {
    let lower = text.to_lowercase();
    for name in mentions(text) {
        let needle = format!("@{name}");
        let mut from = 0usize;
        while let Some(at) = lower[from..].find(&needle) {
            let after = from + at + needle.len();
            let rest = lower[after..].trim_start();
            for verb in ["takes ", "take ", "pick up ", "picks up ", "pick-up "] {
                if let Some(tail) = rest.strip_prefix(verb) {
                    // Map back to the original casing so a work item title
                    // survives being quoted.
                    let offset = text.len() - tail.len();
                    let raw = text.get(offset..).unwrap_or(tail).trim();
                    return Some(Handover {
                        agent: name.clone(),
                        what: title_of(raw),
                    });
                }
            }
            from = after;
        }
    }
    None
}

/// The work item named in `take "..." - and then some prose`.
///
/// A quoted title ends at its closing quote. People say more than the title in
/// the same breath, and taking the whole tail found no work item at all: a
/// correct refusal to a question nobody asked.
fn title_of(raw: &str) -> String {
    let mut chars = raw.chars();
    if let Some(first) = chars.next() {
        let close = match first {
            '"' => Some('"'),
            '\'' => Some('\''),
            '\u{201c}' => Some('\u{201d}'),
            _ => None,
        };
        if let Some(close) = close {
            let rest: String = chars.collect();
            return match rest.find(close) {
                Some(end) => rest[..end].trim().to_string(),
                // An opening quote with no closing one: the rest is the title,
                // which is the reading that loses nothing.
                None => rest.trim().to_string(),
            };
        }
    }
    raw.trim().trim_end_matches(['.', '!']).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mention_is_a_name_after_an_at_sign() {
        assert_eq!(mentions("@qa look at this"), vec!["qa"]);
        assert_eq!(mentions("hey @dev-a and @QA"), vec!["dev-a", "qa"]);
    }

    #[test]
    fn the_same_name_twice_is_one_participant() {
        assert_eq!(mentions("@qa @qa @qa"), vec!["qa"]);
    }

    #[test]
    fn an_email_address_is_not_a_mention() {
        assert!(mentions("mail me at you@example.com").is_empty());
    }

    #[test]
    fn a_bare_at_sign_is_not_a_mention() {
        assert!(mentions("meet @ 5").is_empty());
        assert!(mentions("@").is_empty());
    }

    #[test]
    fn taking_work_is_read_as_a_handover_and_keeps_the_title() {
        let h = handover("@dev-a take \"Fix dirty_files\"").unwrap();
        assert_eq!(h.agent, "dev-a");
        assert_eq!(h.what, "Fix dirty_files");
    }

    #[test]
    fn picking_it_up_counts_too() {
        let h = handover("@qa pick up the failing suite").unwrap();
        assert_eq!(h.agent, "qa");
        assert_eq!(h.what, "the failing suite");
    }

    /// People say more than the title in the same breath.
    #[test]
    fn a_quoted_title_ends_at_its_quote_and_the_rest_is_just_talk() {
        let h = handover("@dev-a take \"Fix dirty_files\" - the one qa trips over").unwrap();
        assert_eq!(h.what, "Fix dirty_files");
    }

    #[test]
    fn an_unquoted_title_is_the_rest_of_the_sentence() {
        let h = handover("@qa take the failing suite.").unwrap();
        assert_eq!(h.what, "the failing suite");
    }

    #[test]
    fn merely_talking_to_someone_is_not_a_handover() {
        assert!(handover("@qa what did you see?").is_none());
        assert!(handover("no mentions here, take this").is_none());
    }
}
