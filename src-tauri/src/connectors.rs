//! Desktop administration commands; no agent tool is registered by this slice.
use crate::{
    connector_model::{self as model, FeedConnection},
    db::Db,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command(async)]
pub fn connectors_feeds(db: tauri::State<Db>) -> Result<Vec<FeedConnection>, String> {
    model::list(&db.conn())
}

#[tauri::command(async)]
pub fn connectors_add_feed(db: tauri::State<Db>, name: String, url: String) -> Result<(), String> {
    let url = model::validate_url(url.trim())?.to_string();
    if name.trim().is_empty() || name.len() > 100 {
        return Err("Name must contain 1–100 characters".into());
    }
    let conn = db.conn();
    let feeds = model::list(&conn)?;
    if feeds.iter().any(|f| f.url == url) {
        return Err("This feed is already configured".into());
    }
    let feed = FeedConnection {
        id: feeds.iter().map(|f| f.id).max().unwrap_or(0) + 1,
        name: name.trim().into(),
        url,
        state: "configured".into(),
        last_check: None,
        access: vec![],
        entries: vec![],
        activity: vec!["configured".into()],
    };
    model::save(&conn, &feed)
}

#[tauri::command(async)]
pub fn connectors_feed_action(db: tauri::State<Db>, id: i64, action: String) -> Result<(), String> {
    let conn = db.conn();
    let mut feed = model::get(&conn, id)?;
    model::transition(&mut feed, &action)?;
    model::save(&conn, &feed)
}

#[tauri::command(async)]
pub fn connectors_feed_access(
    db: tauri::State<Db>,
    id: i64,
    scope: String,
    resource: String,
    allow: bool,
) -> Result<(), String> {
    if !matches!(scope.as_str(), "agent" | "space" | "project")
        || resource.trim().is_empty()
        || resource.len() > 200
    {
        return Err("Choose an exact agent, space or project identifier".into());
    }
    let conn = db.conn();
    let mut feed = model::get(&conn, id)?;
    if feed.state == "disconnected" {
        return Err("Reconnect before changing access".into());
    }
    feed.access
        .retain(|a| !(a.scope == scope && a.id == resource));
    if allow {
        feed.access.push(model::Access {
            scope,
            id: resource,
            capability: "feed.read".into(),
        });
    }
    model::record(
        &mut feed,
        if allow {
            "access granted"
        } else {
            "access revoked"
        },
    );
    model::save(&conn, &feed)
}

#[tauri::command(async)]
pub fn connectors_test_feed(db: tauri::State<Db>, id: i64) -> Result<(), String> {
    let before = model::get(&db.conn(), id)?;
    if matches!(before.state.as_str(), "paused" | "disconnected") {
        return Err("Reconnect before testing".into());
    }
    let result = crate::feed_reader::read_public_feed(&before.url);
    // Do not hold the DB mutex during I/O, or resurrect a connection paused meanwhile.
    let conn = db.conn();
    let mut feed = model::get(&conn, id)?;
    if matches!(feed.state.as_str(), "paused" | "disconnected") {
        return Err("Connection changed during test; result discarded".into());
    }
    feed.last_check = Some(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64,
    );
    match result {
        Ok(entries) => {
            feed.entries = entries;
            feed.state = "verified".into();
            model::record(&mut feed, "feed read verified");
            model::save(&conn, &feed)
        }
        Err(error) => {
            feed.state = "degraded".into();
            model::record(&mut feed, "feed check failed");
            model::save(&conn, &feed)?;
            Err(error)
        }
    }
}
