//! Durable projections of domain events. Written on the event-log thread, never
//! inside a publisher's database lock. Alert preferences do not delete history.
use crate::{aiw::events::DomainEvent, db::{Db, err}};
use rusqlite::{params, Connection};
use serde::{Serialize, Deserialize};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL, source TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
 at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, unread INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS notification_events (id TEXT PRIMARY KEY);";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notice {
    pub id: String, pub event_id: String, pub source: String, pub title: String,
    pub body: String, pub kind: String, pub target: String, pub at: String,
    pub count: i64, pub unread: bool,
}

fn text(e: &DomainEvent, field: &str) -> String {
    e.payload[field].as_str().unwrap_or_default().chars().take(1000).collect()
}

pub fn project(e: &DomainEvent) -> Option<Notice> {
    // Issue intake emits the canonical review/blocker with the owning work-item link.
    if matches!(e.kind.as_str(), "work.updated" | "work.released") && text(e, "attention_owner") == "issue-intake" { return None; }
    let status = text(e, "status");
    let (kind, title) = match e.kind.as_str() {
        "notification.test" => (match e.payload["kind"].as_str() { Some("info")=>"info", Some("alert")=>"alert", Some("blocker")=>"blocker", _=>"approval" }, "Test notification"),
        "inbox.requested" => (if text(e,"kind")=="review" {"approval"} else {"blocker"}, "Dev needs your input"),
        "tool.approval.requested" => ("approval", "Dev needs your approval"),
        "conflict.detected" => ("blocker", "Work needs your input"),
        "agent.failed" | "process.failed" | "test.failed" => ("alert", "Work needs attention"),
        "work.updated" | "work.released" if status == "blocked" => ("blocker", "Work is blocked"),
        "work.updated" | "agent.completed" if ["review", "needs-review", "done"].contains(&status.as_str()) => ("approval", "Work is ready for review"),
        "agent.started" => ("info", "Dev started work"),
        "agent.completed" | "work.completed" => ("info", "Work completed"),
        "file.changed" if text(e, "source") == "repository_briefing" => ("info", "Dev has a repository briefing"),
        _ => return None,
    };
    let repo = text(e, "repository");
    let run = text(e, "run");
    let work_target = text(e, "target");
    let source = if !repo.is_empty() { repo.clone() } else { e.scope.project_id.clone().unwrap_or_else(|| "DevDeck".into()) };
    let entity = if !run.is_empty() { run.clone() } else { e.scope.work_item_id.clone().or(e.scope.session_id.clone()).unwrap_or_else(|| if !repo.is_empty() { repo.clone() } else { e.id.clone() }) };
    let body = [text(e, "title"), text(e, "summary"), text(e, "error")].into_iter().find(|s| !s.is_empty()).unwrap_or_else(|| title.into());
    Some(Notice { id: format!("{}:{}:{}:{}", e.scope.workspace_id.as_deref().unwrap_or(""), source, entity, kind), event_id:e.id.clone(), source,
        title:title.into(), body, kind:kind.into(), target: if e.kind=="inbox.requested" && work_target.starts_with("work-item:") { work_target } else if e.kind=="inbox.requested" { "inbox".into() } else if !repo.is_empty() { format!("repo:{repo}") } else if !run.is_empty() { format!("run:{run}") } else { "inbox".into() }, at:e.timestamp.clone(), count:1, unread:true })
}

pub fn keep(conn: &Connection, e: &DomainEvent) -> Result<Option<Notice>, String> {
    let Some(mut n) = project(e) else { return Ok(None) };
    let tx = conn.unchecked_transaction().map_err(err)?;
    if tx.execute("INSERT OR IGNORE INTO notification_events(id) VALUES (?1)", [&e.id]).map_err(err)? == 0 { return Ok(None); }
    tx.execute("INSERT INTO notifications(id,event_id,source,title,body,kind,target,at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
        ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,title=excluded.title,body=excluded.body,target=excluded.target,at=excluded.at,count=count+1,unread=1",
        params![n.id,n.event_id,n.source,n.title,n.body,n.kind,n.target,n.at]).map_err(err)?;
    n.count = tx.query_row("SELECT count FROM notifications WHERE id=?1", [&n.id], |r|r.get(0)).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(Some(n))
}

pub fn list(conn: &Connection) -> Result<Vec<Notice>, String> {
    let mut q=conn.prepare("SELECT id,event_id,source,title,body,kind,target,at,count,unread FROM notifications ORDER BY at DESC LIMIT 300").map_err(err)?;
    let rows=q.query_map([], |r| Ok(Notice{id:r.get(0)?,event_id:r.get(1)?,source:r.get(2)?,title:r.get(3)?,body:r.get(4)?,kind:r.get(5)?,target:r.get(6)?,at:r.get(7)?,count:r.get(8)?,unread:r.get(9)?})).map_err(err)?;
    rows.collect::<Result<Vec<_>,_>>().map_err(err)
}

#[tauri::command(async)]
pub fn notifications_list(db: tauri::State<Db>) -> Result<Vec<Notice>,String> { let conn=db.0.lock().map_err(err)?; list(&conn) }

#[tauri::command(async)]
pub fn notification_read(db: tauri::State<Db>, id:String, event_id:String) -> Result<(),String> {
    db.0.lock().map_err(err)?.execute("UPDATE notifications SET unread=0 WHERE id=?1 AND event_id=?2",params![id,event_id]).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn notification_test(app: tauri::AppHandle, kind:Option<String>, delay_seconds:Option<u64>) -> Result<(),String> {
    use tauri::Manager;
    let kind=kind.unwrap_or_else(||"approval".into());
    if !["info","alert","approval","blocker"].contains(&kind.as_str()) {return Err("Unknown notification category".into())}
    let delay=delay_seconds.unwrap_or(0).min(10);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(delay));
        let mut event=DomainEvent::new(crate::aiw::events::EventType::WorkUpdated,
            crate::aiw::events::EventScope::project("Notification test").with_work_item("test-alert"),
            serde_json::json!({"title":format!("{} sound and desktop delivery test. No work was executed.",kind),"kind":kind}));
        event.kind="notification.test".into();event.category="Workspace".into();
        app.state::<std::sync::Arc<crate::aiw::state::Workspace>>().bus.emit(event);
    });
    Ok(())
}

static POPUPS: std::sync::Mutex<Vec<Notice>> = std::sync::Mutex::new(Vec::new());

#[tauri::command]
pub fn notification_popup_push(app:tauri::AppHandle, notice:Notice) -> Result<(),String> {
    use tauri::Emitter;
    { let mut cards=POPUPS.lock().map_err(err)?; cards.retain(|n|n.id!=notice.id); cards.insert(0,notice); cards.truncate(3); }
    app.emit_to("notifications","devdeck:popup-changed",()).map_err(err)
}

#[tauri::command]
pub fn notification_popup_list() -> Result<Vec<Notice>,String> { Ok(POPUPS.lock().map_err(err)?.clone()) }

#[tauri::command]
pub fn notification_popup_dismiss(app:tauri::AppHandle,id:Option<String>) -> Result<(),String> {
    use tauri::{Emitter,Manager};
    let empty={let mut cards=POPUPS.lock().map_err(err)?;if let Some(id)=id {cards.retain(|n|n.id!=id)}else{cards.clear()};cards.is_empty()};
    if empty {if let Some(w)=app.get_webview_window("notifications"){crate::stash::hide_window(&w)}}
    app.emit_to("notifications","devdeck:popup-changed",()).map_err(err)
}

#[tauri::command]
pub fn notification_popup_layout(app:tauri::AppHandle,height:f64) {
    use tauri::Manager;
    let Some(w)=app.get_webview_window("notifications") else{return};
    if POPUPS.lock().map(|c|c.is_empty()).unwrap_or(true){crate::stash::hide_window(&w);return}
    let monitor=app.get_webview_window("main").and_then(|m|m.current_monitor().ok().flatten()).or_else(||w.primary_monitor().ok().flatten());
    if let Some(m)=monitor {
        let scale=m.scale_factor();let size=m.size().to_logical::<f64>(scale);let origin=m.position().to_logical::<f64>(scale);
        let width=370.0_f64.min((size.width-24.0).max(200.0));let height=height.clamp(90.0,(size.height-96.0).max(90.0));
        let _=w.set_size(tauri::LogicalSize::new(width,height));
        let _=w.set_position(tauri::LogicalPosition::new(origin.x+size.width-width-16.0,origin.y+size.height-height-64.0));
    }
    crate::stash::show_window_without_focus(&w);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aiw::events::{EventScope,EventType};
    #[test]
    fn deduplicates_groups_and_preserves_newer_unread() {
        let c=Connection::open_in_memory().unwrap(); c.execute_batch(SCHEMA).unwrap();
        let first=DomainEvent::new(EventType::AgentFailed,EventScope::project("p").with_session("s"),serde_json::json!({"error":"failed"}));
        assert!(keep(&c,&first).unwrap().is_some()); assert!(keep(&c,&first).unwrap().is_none());
        let mut next=first.clone(); next.id="new-event".into(); keep(&c,&next).unwrap();
        c.execute("UPDATE notifications SET unread=0 WHERE event_id=?1",[&first.id]).unwrap();
        let rows=list(&c).unwrap(); assert_eq!(rows.len(),1); assert_eq!(rows[0].count,2); assert!(rows[0].unread);
    }
    #[test]
    fn ignores_noise_and_marks_review() {
        let mut e=DomainEvent::new(EventType::FileChanged,Default::default(),serde_json::json!({"source":"issue_monitor"}));
        assert!(project(&e).is_none()); e.kind="work.updated".into(); e.payload=serde_json::json!({"status":"needs-review"});
        assert_eq!(project(&e).unwrap().kind,"approval");
    }
    #[test]
    fn workflow_attention_opens_its_owning_work_item() {
        let mut e=DomainEvent::new(EventType::FileChanged,EventScope::project("3"),serde_json::json!({"kind":"review","target":"work-item:github:owner/repo:36"}));
        e.kind="inbox.requested".into();
        assert_eq!(project(&e).unwrap().target,"work-item:github:owner/repo:36");
    }
    #[test]
    fn issue_intake_owns_review_notification_but_direct_work_still_notifies() {
        let mut event = DomainEvent::new(EventType::WorkUpdated, EventScope::project("3"), serde_json::json!({"status":"needs-review","attention_owner":"issue-intake"}));
        assert!(project(&event).is_none());
        event.payload["attention_owner"] = serde_json::json!("runtime");
        assert_eq!(project(&event).unwrap().kind, "approval");
        event.kind = "inbox.requested".into();
        event.payload = serde_json::json!({"kind":"review","target":"work-item:github:owner/repo:37","title":"Current issue plan"});
        assert_eq!(project(&event).unwrap().body, "Current issue plan");
    }
    #[test]
    fn history_and_read_state_survive_reopen() {
        let path=std::env::temp_dir().join(format!("devdeck-notice-{}.sqlite",std::process::id()));
        let e=DomainEvent::new(EventType::AgentFailed,EventScope::project("persist"),serde_json::json!({"error":"example"}));
        { let c=Connection::open(&path).unwrap(); c.execute_batch(SCHEMA).unwrap(); keep(&c,&e).unwrap(); c.execute("UPDATE notifications SET unread=0",[]).unwrap(); }
        { let c=Connection::open(&path).unwrap(); let rows=list(&c).unwrap(); assert_eq!(rows.len(),1); assert!(!rows[0].unread); assert!(keep(&c,&e).unwrap().is_none()); }
        let _=std::fs::remove_file(path);
    }
}
