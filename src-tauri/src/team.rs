//! The Team board: every goal in every space, in one read.
//!
//! Goals, Features and Work are three views of the same rows, which is why
//! they are one query rather than three. The question they all answer is "what
//! is being worked on, right now, everywhere" — and answering it per space
//! would mean the bot working two folders over is invisible from the folder
//! you happen to have selected.
//!
//! It lives beside `threads.rs` and above `aiw` for the same reason that one
//! does: working out which bot manages a feature needs the database, and `aiw`
//! knows nothing about SQLite.
//!
//! Nothing here is a new stream. Features and work items come from each node's
//! deck, claims and sessions from the runtime, the last thing said from the
//! feature's own thread, and what needs you from the approval queue and the
//! conflict service. A second place that says an agent is waiting is how the
//! first one stops being read.

use std::sync::Arc;

use serde::Serialize;
use tauri::Manager;

use crate::aiw::state::Workspace;
use crate::db::{self, Db};

type Ws<'a> = tauri::State<'a, Arc<Workspace>>;

/// One goal: a feature, wherever it lives, with everyone who is on it.
#[derive(Serialize, Clone, Debug)]
pub struct GoalRow {
    /// The node the feature belongs to. Also its AI Workspace project id.
    pub node_id: i64,
    pub space: String,
    /// The workspace it sits under, because the board spans all of them and
    /// two spaces can share a name.
    pub workspace: String,
    pub feature_id: String,
    pub feature_name: String,
    pub status: String,
    pub goal: Option<String>,
    /// The bot whose plan this is, when one has adopted it. Its *name*, for
    /// reading.
    pub managed_by: Option<String>,
    /// The same manager's handle, which is what anything looking it up needs.
    pub managed_handle: Option<String>,
    pub bot_node: Option<i64>,
    /// Agents holding a live claim on it right now.
    pub on_it: Vec<String>,
    /// Everyone pulled into its thread, in or out of the team.
    pub participants: Vec<String>,
    pub items_total: usize,
    pub items_done: usize,
    pub items_blocked: usize,
    pub items_unclaimed: usize,
    /// The last thing said in its thread, and who said it.
    pub last_said: Option<String>,
    pub last_by: Option<String>,
    pub last_at: Option<String>,
    /// How many things on it are waiting on a person.
    pub waiting: usize,
    pub conflicts: usize,
}

impl GoalRow {
    /// Which of the three groups this belongs in.
    ///
    /// Ranked rather than mixed: anything that needs you sorts above anything
    /// that is merely moving, because a board where a blocked approval sits
    /// under a green progress bar is one that trains you to skim past it.
    pub fn group(&self) -> &'static str {
        if self.waiting > 0 || self.conflicts > 0 {
            "waiting"
        } else if !self.on_it.is_empty() {
            "moving"
        } else {
            "quiet"
        }
    }
}

/// The whole board.
///
/// A space that is not registered is skipped rather than failing the page —
/// but a space whose deck cannot be read is *not* silently skipped as empty:
/// it keeps its row with `status: "unreadable"`, because "no features here"
/// and "I could not look" must never render the same.
#[tauri::command]
pub fn team_board(app: tauri::AppHandle, ws: Ws) -> Result<Vec<GoalRow>, String> {
    let workspace: Arc<Workspace> = (*ws).clone();

    // Everything from the database, under one lock.
    let (names, parents, bots) = {
        let db = app.try_state::<Db>().ok_or("no database")?;
        let conn = db.conn();
        let nodes = db::nodes_on(&conn).map_err(|e| e.to_string())?;
        let names: std::collections::HashMap<i64, String> =
            nodes.iter().map(|n| (n.id, n.name.clone())).collect();
        let parents: std::collections::HashMap<i64, Option<i64>> =
            nodes.iter().map(|n| (n.id, n.parent_id)).collect();
        (names, parents, crate::bots::all_bots(&conn))
    };

    let convs = workspace.convs().ok();
    Ok(board_from(&workspace, convs, &names, &parents, &bots))
}

/// The board itself, given everything it reads.
///
/// Split out from `team_board` so it can be checked. The command above needs a
/// `tauri::AppHandle` to reach the node table, and needing a running Tauri app
/// is why the screen the Team page opens on had one test in it — about sort
/// order — while the assembly underneath, which is where the counts and the
/// claims and the thread previews come from, had none.
pub fn board_from(
    workspace: &Arc<Workspace>,
    // The threads to read previews and participants from. Passed in rather
    // than taken from the workspace, which opens the *real* personal store on
    // first use — a board assembled from a global singleton cannot be checked
    // without reading the developer's own conversation history.
    convs: Option<&crate::aiw::assistant::Conversations>,
    names: &std::collections::HashMap<i64, String>,
    parents: &std::collections::HashMap<i64, Option<i64>>,
    bots: &[crate::bots::Bot],
) -> Vec<GoalRow> {
    let workspace_of = |mut id: i64| -> String {
        let mut guard = 0;
        while let Some(Some(p)) = parents.get(&id) {
            id = *p;
            guard += 1;
            if guard > 32 {
                break;
            }
        }
        names.get(&id).cloned().unwrap_or_default()
    };

    let claims = workspace.claims_for(None, true);
    let approvals = workspace.pending_approvals();
    let conflicts = workspace.conflicts.list(None, false);
    // Questions a worker stopped on and nobody has answered, by the item they
    // are about. Read once for the whole board rather than per feature: this
    // walks the personal store, and doing it inside the loop would be one walk
    // per feature on every refresh.
    let asked: std::collections::HashMap<String, usize> = crate::workers::all_runs()
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.status == "running" && !r.item.trim().is_empty())
        .map(|r| (r.item.clone(), crate::asks::unanswered(&r.id).len()))
        .filter(|(_, n)| *n > 0)
        .collect();
    let mut out = Vec::new();
    for id in workspace.project_ids() {
        let Some(project) = workspace.project(&id) else {
            continue;
        };
        let node_id: i64 = id.parse().unwrap_or(-1);
        let deck = project.deck();
        for slug in deck.feature_slugs() {
            let f = deck.feature(&slug).ok();
            let items = deck.work(&slug).map(|w| w.meta.items).unwrap_or_default();
            let managing = bots
                .iter()
                .find(|b| b.node_id == node_id && b.feature.trim() == slug);
            let thread = convs.and_then(|c| {
                c.list().into_iter().find(|x| {
                    x.feature.as_deref() == Some(&slug) && x.project_id.as_deref() == Some(&id)
                })
            });
            let on_it: Vec<String> = claims
                .iter()
                .filter(|c| c.project_id == id && c.feature_id == slug)
                .map(|c| c.agent_id.clone())
                .collect();

            out.push(GoalRow {
                node_id,
                space: project.name.clone(),
                workspace: if node_id > 0 {
                    workspace_of(node_id)
                } else {
                    "Demo".to_string()
                },
                feature_name: f
                    .as_ref()
                    .map(|d| d.meta.name.clone())
                    .unwrap_or_else(|| slug.clone()),
                status: f
                    .as_ref()
                    .map(|d| d.meta.status.clone())
                    .unwrap_or_else(|| "unreadable".into()),
                goal: f.as_ref().and_then(|d| d.meta.goal.clone()),
                managed_by: managing.map(|b| b.name.clone()),
                // The name is for reading and the handle is for looking up.
                // With only the name, the goal page fetched its manager as
                // `bot_get("Studio")`, which reads `Studio.md` — it resolved
                // solely because Windows filenames are case-insensitive, and
                // would have missed any manager whose handle is not its name
                // in lower case ("Product manager" → `product-manager.md`).
                managed_handle: managing.map(|b| b.handle.clone()),
                bot_node: managing.map(|b| b.node_id),
                items_total: items.len(),
                items_done: items.iter().filter(|i| i.status == "done").count(),
                items_blocked: items.iter().filter(|i| i.status == "blocked").count(),
                items_unclaimed: items
                    .iter()
                    .filter(|i| i.status.is_empty() || i.status == "unclaimed")
                    .count(),
                waiting: waiting_on_you(
                    approvals
                        .iter()
                        .filter(|a| {
                            a.project_id.as_deref() == Some(&id)
                                && a.feature_id.as_deref().map(|f| f == slug).unwrap_or(true)
                        })
                        .count(),
                    &items,
                    &asked,
                ),
                conflicts: conflicts
                    .iter()
                    .filter(|c| c.project_id == id && c.feature_id.as_deref() == Some(&slug))
                    .count(),
                last_said: thread
                    .as_ref()
                    .map(|t| t.preview.clone())
                    .filter(|p| !p.is_empty()),
                last_by: thread.as_ref().and_then(|t| t.preview_by.clone()),
                last_at: thread.as_ref().map(|t| t.updated_at.clone()),
                participants: thread.map(|t| t.participants).unwrap_or_default(),
                on_it,
                feature_id: slug,
            });
        }
    }

    // Waiting first, then moving, then quiet; newest talked-in first inside
    // each group. The UI groups them again, but a list that arrives in the
    // right order cannot be shown in the wrong one by accident.
    out.sort_by(|a, b| {
        let rank = |g: &str| match g {
            "waiting" => 0,
            "moving" => 1,
            _ => 2,
        };
        rank(a.group())
            .cmp(&rank(b.group()))
            .then_with(|| b.last_at.cmp(&a.last_at))
    });
    out
}

/// Everything on one feature that a person has to answer.
///
/// It counted live approval requests and nothing else. So a board showing
/// three items badged "needs your yes", with an Agree button beside each of
/// them, said **"0 waiting on you"** across the top — and a worker sitting on
/// an unanswered question, which is the most urgent thing there is here,
/// counted for nothing at all.
///
/// A proposal is the commonest thing anyone is waiting on: it is the one
/// status nothing can start from, so until you answer it, nothing happens.
fn waiting_on_you(
    approvals: usize,
    items: &[crate::aiw::deck::WorkItem],
    asked: &std::collections::HashMap<String, usize>,
) -> usize {
    approvals
        + items.iter().filter(|i| i.status == "proposed").count()
        + items.iter().filter_map(|i| asked.get(&i.id)).sum::<usize>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, status: &str) -> crate::aiw::deck::WorkItem {
        crate::aiw::deck::WorkItem {
            id: id.into(),
            title: id.into(),
            status: status.into(),
            assignee: None,
            areas: vec![],
            due: None,
            branch: None,
        }
    }

    /// The count under the heading must agree with the buttons under it.
    #[test]
    fn what_is_waiting_on_you_counts_the_things_you_can_press() {
        let none = std::collections::HashMap::new();
        let items = vec![
            item("w01", "proposed"),
            item("w02", "proposed"),
            item("w03", "proposed"),
            item("w04", "in-progress"),
            item("w05", "done"),
        ];
        // Studio's plan exactly: three proposals, no live approval, and the
        // board said nothing was waiting.
        assert_eq!(waiting_on_you(0, &items, &none), 3);

        // A worker stopped on two questions is two more things to answer.
        let asked = std::collections::HashMap::from([("w04".to_string(), 2)]);
        assert_eq!(waiting_on_you(0, &items, &asked), 5);

        // Approvals still count, and a question about an item that is not on
        // this plan is not this plan's business.
        let elsewhere = std::collections::HashMap::from([("w99".to_string(), 7)]);
        assert_eq!(waiting_on_you(1, &items, &elsewhere), 4);

        // Nothing to answer is nothing to answer.
        assert_eq!(waiting_on_you(0, &[item("w01", "done")], &none), 0);
    }

    fn row(waiting: usize, conflicts: usize, on_it: &[&str]) -> GoalRow {
        GoalRow {
            node_id: 1,
            space: "x".into(),
            workspace: "w".into(),
            feature_id: "f".into(),
            feature_name: "F".into(),
            status: "planned".into(),
            goal: None,
            managed_handle: None,
            managed_by: None,
            bot_node: None,
            on_it: on_it.iter().map(|s| s.to_string()).collect(),
            participants: vec![],
            items_total: 0,
            items_done: 0,
            items_blocked: 0,
            items_unclaimed: 0,
            last_said: None,
            last_by: None,
            last_at: None,
            waiting,
            conflicts,
        }
    }

    #[test]
    fn anything_that_needs_you_outranks_anything_that_is_merely_moving() {
        assert_eq!(row(1, 0, &["dev-a"]).group(), "waiting");
        assert_eq!(row(0, 1, &["dev-a"]).group(), "waiting");
        assert_eq!(row(0, 0, &["dev-a"]).group(), "moving");
        assert_eq!(row(0, 0, &[]).group(), "quiet");
    }
}
