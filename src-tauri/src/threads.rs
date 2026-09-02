//! Threads: a feature's room, and a node's.
//!
//! A bot's own thread lives in `bots.rs` because a bot is a file in a folder.
//! These two are the other halves of the same idea, and they live here rather
//! than in `aiw` for one reason: resolving *who answers* needs the database —
//! which bot manages this feature, what a node's children are — and `aiw`
//! knows nothing about SQLite. The arrow points down, so the layer that knows
//! both sits above both.
//!
//! **A feature is a room.** Nothing new is created on disk: the feature
//! already exists in the deck, and it gains a conversation marked with its
//! slug. Whoever manages it answers in it — the bot whose `_bot.md` names that
//! feature, or the assistant when nothing manages it yet. Bots and agents
//! reach each other here with `@`.
//!
//! **A node is a conversation at any level.** A workspace, a folder, a
//! project. What changes with depth is what there is to say: a project owns a
//! commit, so its context is the real thing; a parent owns none, so it rolls
//! its children up as headlines and says outright that it has no repository.
//! Pretending otherwise would give a model a context assembled from nothing
//! and let it answer confidently about a repository that does not exist.

use std::sync::Arc;

use crate::aiw::assistant::{Assistant, AssistantReply, ChatEvent, ConversationMeta, Persona};
use crate::aiw::state::Workspace;
use crate::db::{self, Db};
use tauri::{Emitter, Manager};

type Ws<'a> = tauri::State<'a, Arc<Workspace>>;

/// Make sure the AI Workspace knows this node before anyone talks about it.
///
/// The same two-directory rule as everywhere else: context in the node's own
/// vault folder, code wherever the repository is. Registering is idempotent.
fn register(app: &tauri::AppHandle, ws: &Arc<Workspace>, node_id: i64) -> Result<(), String> {
    if ws.project(&node_id.to_string()).is_some() {
        return Ok(());
    }
    let db = app.try_state::<Db>().ok_or("no database")?;
    let conn = db.0.lock().unwrap();
    let node = db::node_by_id(&conn, node_id).map_err(|e| e.to_string())?;
    let deck_root = db::node_deck_dir(&conn, &node).ok_or("that node has no folder yet")?;
    let code_root = db::node_dir(&conn, &node).unwrap_or_else(|| deck_root.clone());
    ws.register_project(&node_id.to_string(), &node.name, code_root, deck_root);
    Ok(())
}

/// Who answers in a feature's thread: the bot managing it, or the assistant.
///
/// "Managing" is not a new field — it is the bot whose `_bot.md` already names
/// this feature as its plan. A feature nobody manages is answered by the
/// assistant, which is honest: somebody is talking to you, and it is not
/// pretending to be a manager it does not have.
fn feature_persona(
    app: &tauri::AppHandle,
    ws: &Arc<Workspace>,
    node_id: i64,
    feature_id: &str,
) -> Result<(Persona, Option<String>), String> {
    let managing = {
        let db = app.try_state::<Db>().ok_or("no database")?;
        let conn = db.0.lock().unwrap();
        crate::bots::bot_on(&conn, node_id).filter(|b| b.feature.trim() == feature_id)
    };
    match managing {
        Some(bot) => {
            let name = bot.name.clone();
            let mut p = crate::bots::persona(&bot);
            p.system.push_str(&format!(
                "\n\nYou are in the thread for the feature “{feature_id}”. Other bots and agents \
                 are in here too. Address one with @name to pull them in; say @name take \"item\" \
                 only when you actually mean to hand that work over, because that moves the claim."
            ));
            Ok((p, Some(name)))
        }
        None => {
            let agent = ws
                .agent(crate::aiw::assistant::ASSISTANT_ID)
                .ok_or("no assistant agent")?;
            let mut p = Persona::assistant(&agent.system);
            p.system.push_str(&format!(
                "\n\nYou are in the thread for the feature “{feature_id}”. No bot manages it yet, \
                 so say so if it matters. Address an agent with @name to pull them in."
            ));
            Ok((p, None))
        }
    }
}

/// Register any bot named with `@` as a participant, and say who they are.
///
/// Agents are resolved inside the assistant loop, which knows them. Bots are
/// files in folders, so they are resolved here — the one place that can read
/// both. A mention that matches nothing is left alone rather than invented.
///
/// Returns the bots the message named, because they are also the ones that
/// should answer it.
fn pull_in_bots(
    app: &tauri::AppHandle,
    ws: &Arc<Workspace>,
    conv_id: &str,
    text: &str,
) -> Vec<crate::bots::Bot> {
    let names = crate::aiw::mentions::mentions(text);
    if names.is_empty() {
        return Vec::new();
    }
    let Some(db) = app.try_state::<Db>() else {
        return Vec::new();
    };
    let bots = {
        let conn = db.0.lock().unwrap();
        crate::bots::all_bots(&conn)
    };
    let Ok(convs) = ws.convs() else {
        return Vec::new();
    };
    let mut named = Vec::new();
    for name in names {
        let Some(bot) = bots.iter().find(|b| crate::bots::answers_to(b, &name)) else {
            continue;
        };
        let id = format!("bot:{}", bot.node_id);
        if let Ok(true) = convs.add_participant(conv_id, &id) {
            let _ = convs.post(
                conv_id,
                crate::aiw::assistant::ChatMessage::pulled_in(
                    &id,
                    format!("@{name} — {} — pulled into this thread", bot.name),
                ),
            );
        }
        if !named.iter().any(|b: &crate::bots::Bot| b.node_id == bot.node_id) {
            named.push(bot.clone());
        }
    }
    named
}

/// Let every bot the message named answer it, as itself.
///
/// This is bot-to-bot with nothing special about it: one conversation, several
/// personas, each message carrying who said it. It runs after whoever owns the
/// thread has answered, and only for bots the *incoming* message named — a
/// reply is never re-read for mentions, so two bots that each name the other
/// cannot talk each other into a bill.
///
/// A bot that would be answering itself is skipped, and so is one that fails:
/// a second voice not arriving must not take the first one's answer with it.
fn also_answer(
    app: &tauri::AppHandle,
    ws: &Arc<Workspace>,
    conv_id: &str,
    text: &str,
    bots: Vec<crate::bots::Bot>,
    already: &str,
) {
    for bot in bots {
        let who = crate::bots::persona(&bot);
        if who.agent_id == already {
            continue;
        }
        let emit = app.clone();
        let sink = move |e: crate::aiw::assistant::ChatEvent| {
            let _ = emit.emit("aiw:chat", e);
        };
        let Ok(convs) = ws.convs() else { return };
        if let Err(e) = Assistant::answer_as(ws, convs, conv_id, text, &sink, &who) {
            eprintln!("[threads] {} was asked something and could not answer: {e}", bot.name);
        }
    }
}

// ---------------------------------------------------------------------------
// A feature's thread
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn feature_thread(
    app: tauri::AppHandle,
    ws: Ws,
    node_id: i64,
    feature_id: String,
) -> Result<ConversationMeta, String> {
    let workspace: Arc<Workspace> = (*ws).clone();
    register(&app, &workspace, node_id)?;
    let name = workspace
        .project(&node_id.to_string())
        .and_then(|p| p.deck().feature(&feature_id).ok())
        .map(|f| f.meta.name)
        .unwrap_or_else(|| feature_id.clone());
    ws.convs()?
        .for_feature(&node_id.to_string(), &feature_id, &name)
}

#[tauri::command]
pub async fn feature_thread_send(
    app: tauri::AppHandle,
    ws: Ws<'_>,
    node_id: i64,
    feature_id: String,
    text: String,
) -> Result<AssistantReply, String> {
    let workspace: Arc<Workspace> = (*ws).clone();
    register(&app, &workspace, node_id)?;
    let (who, _managed_by) = feature_persona(&app, &workspace, node_id, &feature_id)?;
    let name = workspace
        .project(&node_id.to_string())
        .and_then(|p| p.deck().feature(&feature_id).ok())
        .map(|f| f.meta.name)
        .unwrap_or_else(|| feature_id.clone());

    let conv_id = workspace
        .convs()?
        .for_feature(&node_id.to_string(), &feature_id, &name)?
        .id;
    let named = pull_in_bots(&app, &workspace, &conv_id, &text);

    let emit = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = emit.clone();
        let sink = move |e: ChatEvent| {
            let _ = progress.emit("aiw:chat", e);
        };
        let convs = workspace.convs()?;
        let reply = Assistant::send_as(&workspace, convs, &conv_id, &text, &sink, &who)?;
        // Then everyone else the message named. The room is the point: one
        // question, several voices, one transcript.
        also_answer(&emit, &workspace, &conv_id, &text, named, &who.agent_id);
        Ok(reply)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// A node's thread
// ---------------------------------------------------------------------------

/// What a parent can honestly say about its children.
///
/// Headlines, never their context: context anchors to a commit and a parent
/// has none. So this is deliberately thin — who lives there, whether last
/// night went well, how much is open — and it says which it is.
fn headlines(app: &tauri::AppHandle, ws: &Arc<Workspace>, node_id: i64) -> String {
    let Some(db) = app.try_state::<Db>() else {
        return String::new();
    };
    let (children, repo) = {
        let conn = db.0.lock().unwrap();
        let all = db::nodes_on(&conn).unwrap_or_default();
        let repo = all
            .iter()
            .find(|n| n.id == node_id)
            .and_then(|n| n.path.clone())
            .filter(|p| !p.trim().is_empty());
        let kids: Vec<(i64, String, Option<crate::bots::Bot>)> = all
            .iter()
            .filter(|n| n.parent_id == Some(node_id))
            .map(|n| (n.id, n.name.clone(), crate::bots::bot_on(&conn, n.id)))
            .collect();
        (kids, repo)
    };

    let mut out = String::new();
    match repo {
        Some(p) => out.push_str(&format!("This node is a repository at {p}.\n")),
        None => out.push_str(
            "This node has no repository of its own, so there is no commit to anchor context to. \
             Say that plainly rather than answering as though you had read code here.\n",
        ),
    }
    if children.is_empty() {
        return out;
    }
    out.push_str("\nWhat is under it, as headlines only — never their full context:\n");
    for (id, name, bot) in children {
        let open = ws
            .project(&id.to_string())
            .map(|p| {
                let deck = p.deck();
                deck.feature_slugs()
                    .into_iter()
                    .map(|s| {
                        deck.work(&s)
                            .map(|w| {
                                w.meta
                                    .items
                                    .iter()
                                    .filter(|i| i.status != "done")
                                    .count()
                            })
                            .unwrap_or(0)
                    })
                    .sum::<usize>()
            })
            .unwrap_or(0);
        let who = match &bot {
            Some(b) if b.last_woke.is_some() => format!("{} watches it", b.name),
            Some(b) => format!("{} watches it, and has not woken yet", b.name),
            None => "no bot".to_string(),
        };
        out.push_str(&format!("- {name}: {who}, {open} open item(s)\n"));
    }
    out
}

fn node_persona(
    app: &tauri::AppHandle,
    ws: &Arc<Workspace>,
    node_id: i64,
    node_name: &str,
) -> Result<Persona, String> {
    let bot = {
        let db = app.try_state::<Db>().ok_or("no database")?;
        let conn = db.0.lock().unwrap();
        crate::bots::bot_on(&conn, node_id)
    };
    let mut p = match bot {
        Some(b) => crate::bots::persona(&b),
        None => {
            let agent = ws
                .agent(crate::aiw::assistant::ASSISTANT_ID)
                .ok_or("no assistant agent")?;
            let mut p = Persona::assistant(&agent.system);
            p.system.push_str(&format!(
                "\n\nYou are talking about “{node_name}”, one node of the vault tree. There is no \
                 bot here, so you answer for it."
            ));
            p
        }
    };
    p.system
        .push_str(&format!("\n\n# {node_name}\n\n{}", headlines(app, ws, node_id)));
    Ok(p)
}

#[tauri::command]
pub fn node_thread(
    app: tauri::AppHandle,
    ws: Ws,
    node_id: i64,
) -> Result<ConversationMeta, String> {
    let workspace: Arc<Workspace> = (*ws).clone();
    register(&app, &workspace, node_id)?;
    let name = {
        let db = app.try_state::<Db>().ok_or("no database")?;
        let conn = db.0.lock().unwrap();
        db::node_by_id(&conn, node_id).map_err(|e| e.to_string())?.name
    };
    ws.convs()?.for_node(node_id, &name)
}

#[tauri::command]
pub async fn node_thread_send(
    app: tauri::AppHandle,
    ws: Ws<'_>,
    node_id: i64,
    text: String,
) -> Result<AssistantReply, String> {
    let workspace: Arc<Workspace> = (*ws).clone();
    register(&app, &workspace, node_id)?;
    let name = {
        let db = app.try_state::<Db>().ok_or("no database")?;
        let conn = db.0.lock().unwrap();
        db::node_by_id(&conn, node_id).map_err(|e| e.to_string())?.name
    };
    let who = node_persona(&app, &workspace, node_id, &name)?;
    let conv_id = workspace.convs()?.for_node(node_id, &name)?.id;
    let named = pull_in_bots(&app, &workspace, &conv_id, &text);

    let emit = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = emit.clone();
        let sink = move |e: ChatEvent| {
            let _ = progress.emit("aiw:chat", e);
        };
        let convs = workspace.convs()?;
        let reply = Assistant::send_as(&workspace, convs, &conv_id, &text, &sink, &who)?;
        also_answer(&emit, &workspace, &conv_id, &text, named, &who.agent_id);
        Ok(reply)
    })
    .await
    .map_err(|e| e.to_string())?
}
