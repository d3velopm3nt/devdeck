//! Desktop administration commands. Agent consumption lives behind runtime tool permissions.
use crate::{
    connector_model::{self as model, FeedConnection},
    db::Db,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command(async)]
pub fn connectors_controls(
    db: tauri::State<Db>,
) -> Result<Vec<crate::connector_policy::Control>, String> {
    crate::connector_policy::list(&db.conn())
}
#[tauri::command(async)]
pub fn connectors_owner_checks(
    db: tauri::State<Db>,
) -> Result<Vec<crate::connector_policy::OwnerCheck>, String> {
    crate::connector_policy::owner_checks(&db.conn())
}
#[tauri::command(async)]
pub fn connectors_control_save(
    db: tauri::State<Db>,
    control: crate::connector_policy::Control,
    expected: u64,
) -> Result<(), String> {
    crate::connector_policy::save(&db.conn(), control, expected)
}
#[tauri::command(async)]
pub fn connectors_provider_bindings(
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
) -> Vec<(String, String, Vec<String>)> {
    let agents = ws.agents();
    ws.providers
        .lock()
        .unwrap()
        .handles()
        .iter()
        .filter_map(|p| {
            let uses: Vec<String> = agents
                .iter()
                .filter(|a| a.provider == p.id())
                .map(|a| format!("Agent {}", a.name))
                .collect();
            if uses.is_empty() {
                None
            } else {
                Some((p.id().into(), p.name().into(), uses))
            }
        })
        .collect()
}
#[tauri::command(async)]
pub fn connectors_dependencies(
    db: tauri::State<Db>,
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
    key: String,
) -> Result<crate::connector_policy::Dependencies, String> {
    let (uses, coverage) = if key == "github:global" {
        match crate::visibility::root(&db) {
            Ok(root)=>{
                let raw=match std::fs::read_to_string(root.join(".devdeck/activity-products.json")) {Ok(raw)=>raw,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>"[]".into(),Err(_)=>return Err("Saved repository dependencies unavailable".into())};
                (crate::connector_policy::project_uses(&raw)?,"Saved Activity product/repository links only. Other repositories, CLI usage and in-flight operations are not enumerated.")
            },
            Err(_)=>(vec![],"Vault not configured; repository dependencies unavailable. No exhaustive dependency claim is made."),
        }
    } else if let Some(id) = key.strip_prefix("ai:") {
        (ws.agents().into_iter().filter(|a|a.provider==id).map(|a|format!("Agent {}",a.name)).collect(),"Direct runtime agent/provider mappings only. Inherited personal defaults, temporary overrides and external CLI sessions may add consumers.")
    } else {
        return Err("No shared dependency report for this connector".into());
    };
    Ok(crate::connector_policy::Dependencies {
        uses,
        coverage: coverage.into(),
    })
}
#[tauri::command(async)]
pub fn connectors_check_owner(
    db: tauri::State<Db>,
    ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>,
    key: String,
) -> Result<crate::connector_policy::OwnerCheck, String> {
    let (result, summary) = if key == "github:global" {
        let result = crate::github_transport::request(
            "user",
            "GET",
            None,
            std::time::Duration::from_secs(15),
        )
        .and_then(|v| {
            if v["login"].as_str().is_some_and(|s| !s.is_empty()) {
                Ok(())
            } else {
                Err("Missing identity".into())
            }
        });
        (
            result,
            "Repository transport authenticated. Per-repository permissions were not tested.",
        )
    } else if let Some(id) = key.strip_prefix("ai:").filter(|id| !id.is_empty()) {
        (ws.test_provider(id).map(|_|()),"Existing owner probe passed. API probes make a small configured-model request; CLI health alone does not verify inference.")
    } else {
        return Err("No shared owner check for this connection".into());
    };
    let ok = result.is_ok();
    let summary = if ok {
        summary.to_string()
    } else {
        "Owner check failed or was blocked. Credentials and access restrictions were unchanged; use existing account controls for diagnostics.".into()
    };
    crate::connector_policy::record_check(&db.conn(), key, ok, summary)
}

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
