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
    /// The bot whose plan this is, when one has adopted it.
    pub managed_by: Option<String>,
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
        let conn = db.0.lock().unwrap();
        let nodes = db::nodes_on(&conn).map_err(|e| e.to_string())?;
        let names: std::collections::HashMap<i64, String> =
            nodes.iter().map(|n| (n.id, n.name.clone())).collect();
        let parents: std::collections::HashMap<i64, Option<i64>> =
            nodes.iter().map(|n| (n.id, n.parent_id)).collect();
        (names, parents, crate::bots::all_bots(&conn))
    };

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
    let convs = workspace.convs().ok();

    let mut out = Vec::new();
    for id in workspace.project_ids() {
        let Some(project) = workspace.project(&id) else { continue };
        let node_id: i64 = match id.parse() {
            Ok(n) => n,
            // The demo projects are named rather than numbered. They are still
            // worth showing; they simply have no node behind them.
            Err(_) => -1,
        };
        let deck = project.deck();
        for slug in deck.feature_slugs() {
            let f = deck.feature(&slug).ok();
            let items = deck.work(&slug).map(|w| w.meta.items).unwrap_or_default();
            let managing = bots
                .iter()
                .find(|b| b.node_id == node_id && b.feature.trim() == slug);
            let thread = convs.and_then(|c| {
                c.list()
                    .into_iter()
                    .find(|x| x.feature.as_deref() == Some(&slug) && x.project_id.as_deref() == Some(&id))
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
                bot_node: managing.map(|b| b.node_id),
                items_total: items.len(),
                items_done: items.iter().filter(|i| i.status == "done").count(),
                items_blocked: items.iter().filter(|i| i.status == "blocked").count(),
                items_unclaimed: items
                    .iter()
                    .filter(|i| i.status.is_empty() || i.status == "unclaimed")
                    .count(),
                waiting: approvals
                    .iter()
                    .filter(|a| {
                        a.project_id.as_deref() == Some(&id)
                            && a.feature_id.as_deref().map(|f| f == slug).unwrap_or(true)
                    })
                    .count(),
                conflicts: conflicts
                    .iter()
                    .filter(|c| c.project_id == id && c.feature_id.as_deref() == Some(&slug))
                    .count(),
                last_said: thread.as_ref().map(|t| t.preview.clone()).filter(|p| !p.is_empty()),
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
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(waiting: usize, conflicts: usize, on_it: &[&str]) -> GoalRow {
        GoalRow {
            node_id: 1,
            space: "x".into(),
            workspace: "w".into(),
            feature_id: "f".into(),
            feature_name: "F".into(),
            status: "planned".into(),
            goal: None,
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
