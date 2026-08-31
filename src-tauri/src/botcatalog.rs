//! Starter bots: expertise you can drop onto a space.
//!
//! A template is not a new kind of thing and there is no template engine. A
//! bot is already a file in a folder, so "add the website bot to this project"
//! is copying one file in and letting it ask you the rest. That falls out of
//! the decision to keep a bot as a file rather than a row, and it is the whole
//! reason templates cost almost nothing here.
//!
//! **The steps become work items, not prose.** "It manages the work" is only
//! true if the work is a thing with a state, and `deck.rs` has had work items —
//! `unclaimed | claimed | in-progress | blocked | done`, with an assignee —
//! since long before bots existed. Applying a template writes a feature into
//! the project's `.devdeck`, which is a real, committed gesture: the bot's plan
//! becomes something a teammate cloning the repo can see and argue with.
//!
//! **The catalog is curated, and the bot never leaves it.** Letting an agent go
//! and find its own capabilities is a supply-chain problem wearing a helpful
//! face. Everything a bot can ask for is in this file, where it can be read.

use serde::{Deserialize, Serialize};

/// One thing a bot could use, and what it costs you to say yes.
///
/// The rungs are ordered on purpose: a skill is words, an agent is words plus
/// permissions, software is a real install, self-hosted is something that keeps
/// running. A bot proposes the cheapest rung that would work, and every rung
/// above the first says out loud what it wants.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolOffer {
    pub id: String,
    pub name: String,
    /// skill | agent | software | self-hosted
    pub kind: String,
    pub what: String,
    /// What saying yes costs. Empty for a skill, which costs nothing.
    pub wants: String,
    /// Why this bot is asking, in its own words.
    pub because: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub what: String,
    /// The goal, phrased as a prompt rather than filled in — a template that
    /// invents your deadline is a template you have to correct.
    pub goal_hint: String,
    pub every: String,
    pub at_min: i64,
    /// Becomes one work item each, in order.
    pub steps: Vec<String>,
    /// Standards it holds the work to. Written into the bot's body, where you
    /// can edit them, because a standard you cannot change is someone else's.
    pub standards: Vec<String>,
    pub skills: Vec<String>,
    pub tools: Vec<ToolOffer>,
}

fn s(v: &str) -> String {
    v.to_string()
}

fn list(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn tool(id: &str, name: &str, kind: &str, what: &str, wants: &str, because: &str) -> ToolOffer {
    ToolOffer {
        id: s(id),
        name: s(name),
        kind: s(kind),
        what: s(what),
        wants: s(wants),
        because: s(because),
    }
}

pub fn all() -> Vec<Template> {
    vec![
        Template {
            id: s("website"),
            name: s("Website bot"),
            what: s(
                "Runs a site from brief to launch. It does not build the site — it holds the \
                 steps, the standards and the checks, and hands the work to agents.",
            ),
            goal_hint: s("Ship the site by …"),
            every: s("weekdays"),
            at_min: 8 * 60,
            steps: list(&[
                "Agree what the site is for and who it is for",
                "Settle the pages and what each one has to do",
                "Design pass — type, colour, spacing, states",
                "Build the pages",
                "Titles, descriptions and headings that match what each page is about",
                "Structured data and a sitemap that is actually submitted",
                "Every image has alt text, every control reaches keyboard",
                "Measure the load on a real connection, not a fast one",
                "Check links, forms and redirects before it goes live",
                "Launch, then check it again from outside",
            ]),
            standards: list(&[
                "One page, one job. If a page has two, it is two pages.",
                "Every page has a title and description written for a person, not a crawler.",
                "Nothing ships that a keyboard cannot reach.",
                "Largest contentful paint under 2.5s on a mid-range phone.",
                "No redirect chains. One hop or none.",
            ]),
            skills: list(&["seo", "accessibility", "web-performance"]),
            tools: vec![
                tool(
                    "skill-seo",
                    "SEO review",
                    "skill",
                    "A procedure it follows when reading a page: titles, headings, descriptions, \
                     structured data, internal links.",
                    "",
                    "You asked it to catch SEO problems before launch, and it needs to know what \
                     it is looking for.",
                ),
                tool(
                    "skill-a11y",
                    "Accessibility review",
                    "skill",
                    "The checks it runs against markup: alt text, labels, focus order, contrast.",
                    "",
                    "Nothing ships that a keyboard cannot reach — that standard needs a procedure \
                     behind it.",
                ),
                tool(
                    "agent-page-checker",
                    "Page checker",
                    "agent",
                    "Becomes a sub-agent of this bot, with its own state in the list. Reads pages \
                     and reports what breaks the standards.",
                    "read your repo · open a browser",
                    "It can hold a checklist but it cannot look at a page.",
                ),
                tool(
                    "sw-lighthouse",
                    "Lighthouse",
                    "software",
                    "Real measurements from a real browser, through the package manager you \
                     already use.",
                    "an install on this machine",
                    "\"Under 2.5s\" is not a thing you can judge by reading the source.",
                ),
                tool(
                    "host-analytics",
                    "Self-hosted analytics",
                    "self-hosted",
                    "Runs as a service in this space, so what visitors do stays on your machine.",
                    "a port · disk · keeps running",
                    "You will want to know whether the launch worked, and the usual answer to \
                     that sends your visitors somewhere else.",
                ),
            ],
        },
        Template {
            id: s("release"),
            name: s("Release bot"),
            what: s(
                "Holds the shape of a release so the same thing is not remembered differently \
                 each time.",
            ),
            goal_hint: s("Ship … without a hotfix"),
            every: s("weekdays"),
            at_min: 7 * 60,
            steps: list(&[
                "Version bumped everywhere it is written down",
                "Changelog says what changed, for a person",
                "Build is clean from a cold checkout",
                "Artifacts signed",
                "Install it somewhere that is not your machine",
                "Publish",
                "Check the update feed actually serves the new version",
            ]),
            standards: list(&[
                "A version that appears in more than one file is checked in all of them.",
                "Nothing ships that has not been installed from the artifact, not the build tree.",
                "A failed check is never reported as a pass.",
            ]),
            skills: list(&["release-notes"]),
            tools: vec![
                tool(
                    "skill-release-notes",
                    "Release notes",
                    "skill",
                    "How to turn a diff into notes someone would read.",
                    "",
                    "\"Changelog says what changed, for a person\" is a standard nobody meets by \
                     pasting commit subjects.",
                ),
                tool(
                    "agent-release-checker",
                    "Release checker",
                    "agent",
                    "Reads the files that carry a version and says which disagree.",
                    "read your repo",
                    "Version drift is the one thing on this list a machine is better at than you.",
                ),
            ],
        },
        Template {
            id: s("topic"),
            name: s("Topic bot"),
            what: s(
                "For a space that is a subject rather than a codebase — a decision to make, a \
                 thing to learn, something to keep an eye on.",
            ),
            goal_hint: s("Decide … by …"),
            every: s("weekly"),
            at_min: 18 * 60,
            steps: list(&[
                "Write the question in one sentence",
                "List what would change your mind",
                "Gather what is already known",
                "Find the gaps and fill them",
                "Write the answer and what it rests on",
            ]),
            standards: list(&[
                "The question stays in one sentence. If it needs two, it is two questions.",
                "Every claim carries where it came from.",
                "A decision records what would reverse it.",
            ]),
            skills: vec![],
            tools: vec![tool(
                "skill-sources",
                "Source discipline",
                "skill",
                "How it records where a claim came from, and what makes a source worth keeping.",
                "",
                "\"Every claim carries where it came from\" needs a habit, not an intention.",
            )],
        },
        Template {
            id: s("blank"),
            name: s("Start empty"),
            what: s("A goal and a heartbeat. You add the rest."),
            goal_hint: s(""),
            every: s("weekdays"),
            at_min: 7 * 60,
            steps: vec![],
            standards: vec![],
            skills: vec![],
            tools: vec![],
        },
    ]
}

pub fn get(id: &str) -> Option<Template> {
    all().into_iter().find(|t| t.id == id)
}

/// Every tool any template offers, so a bot built by hand can still be told
/// what exists.
pub fn tool_by_id(id: &str) -> Option<ToolOffer> {
    all()
        .into_iter()
        .flat_map(|t| t.tools)
        .find(|t| t.id == id)
}

#[tauri::command]
pub fn bot_catalog() -> Vec<Template> {
    all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_template_is_reachable_by_id() {
        for t in all() {
            assert!(get(&t.id).is_some(), "{} is not findable", t.id);
        }
    }

    /// Tool ids are how a decision is recorded, so two tools sharing one would
    /// make accepting a skill look like accepting an install.
    #[test]
    fn tool_ids_are_unique_across_the_catalog() {
        let mut seen = std::collections::HashSet::new();
        for t in all() {
            for tool in t.tools {
                assert!(seen.insert(tool.id.clone()), "duplicate tool id {}", tool.id);
            }
        }
    }

    /// The ladder is the whole point of the tools list: a bot must never ask
    /// for an install under a name that reads like a skill.
    #[test]
    fn every_tool_sits_on_a_known_rung() {
        for t in all() {
            for tool in t.tools {
                assert!(
                    ["skill", "agent", "software", "self-hosted"].contains(&tool.kind.as_str()),
                    "{} has unknown kind {}",
                    tool.id,
                    tool.kind
                );
                // Anything above the first rung has to say what it wants.
                if tool.kind != "skill" {
                    assert!(!tool.wants.trim().is_empty(), "{} hides its cost", tool.id);
                }
            }
        }
    }

    #[test]
    fn the_blank_one_proposes_nothing() {
        let b = get("blank").unwrap();
        assert!(b.steps.is_empty() && b.tools.is_empty() && b.skills.is_empty());
    }
}
