//! Shared lifecycle and policy for managed connectors. Legacy stores remain owners.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Access {
    pub scope: String, // agent | space | project; exact identifiers, no inherited grants
    pub id: String,
    pub capability: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FeedConnection {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub state: String,
    pub last_check: Option<i64>,
    pub access: Vec<Access>,
    pub entries: Vec<FeedEntry>,
    pub activity: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FeedEntry {
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct FeedSnapshot {
    pub id: i64,
    pub name: String,
    pub state: String,
    pub last_check: Option<i64>,
    pub entries: Vec<FeedEntry>,
}

/// Called with identities from the runtime, never identities in model arguments.
pub type FeedConsumer =
    std::sync::Arc<dyn Fn(i64, &str, &str) -> Result<FeedSnapshot, String> + Send + Sync>;

pub fn read_cached(
    db: &Connection,
    id: i64,
    agent: &str,
    project: &str,
) -> Result<FeedSnapshot, String> {
    let feed = get(db, id)?;
    if agent.is_empty()
        || !(permitted(&feed, "agent", agent)
            || (!project.is_empty() && permitted(&feed, "project", project)))
    {
        return Err("Feed read denied: an explicit agent or project binding is required".into());
    }
    // Space bindings remain reserved until the runtime supplies a trusted space identity.
    Ok(FeedSnapshot {
        id: feed.id,
        name: feed.name,
        state: feed.state,
        last_check: feed.last_check,
        entries: feed.entries,
    })
}

pub fn init(db: &Connection) -> Result<(), String> {
    // Additive and idempotent: never rename/rewrite legacy account or permission rows.
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS connector_feeds (id INTEGER PRIMARY KEY, record TEXT NOT NULL)",
    )
    .map_err(|_| "Cannot initialize connectors".to_string())
}
pub fn list(db: &Connection) -> Result<Vec<FeedConnection>, String> {
    init(db)?;
    let mut stmt = db
        .prepare("SELECT record FROM connector_feeds ORDER BY id")
        .map_err(|_| "Cannot read connectors")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot read connectors")?;
    rows.map(|r| {
        serde_json::from_str(&r.map_err(|_| "Cannot read connector")?)
            .map_err(|_| "Invalid saved connector".into())
    })
    .collect()
}
pub fn get(db: &Connection, id: i64) -> Result<FeedConnection, String> {
    list(db)?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or("Connection not found".into())
}
pub fn save(db: &Connection, feed: &FeedConnection) -> Result<(), String> {
    init(db)?;
    let value = serde_json::to_string(feed).map_err(|_| "Cannot encode connector")?;
    db.execute("INSERT INTO connector_feeds(id,record) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET record=excluded.record", params![feed.id,value]).map_err(|_| "Cannot save connector")?;
    Ok(())
}
pub fn validate_url(input: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(input).map_err(|_| "Enter a public HTTPS feed URL")?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.port().is_some_and(|p| p != 443)
    {
        return Err("Use public HTTPS on port 443 without credentials, query or fragment".into());
    }
    Ok(u)
}
pub fn permitted(feed: &FeedConnection, scope: &str, id: &str) -> bool {
    matches!(feed.state.as_str(), "configured" | "verified" | "degraded")
        && feed
            .access
            .iter()
            .any(|a| a.scope == scope && a.id == id && a.capability == "feed.read")
}
pub fn transition(feed: &mut FeedConnection, action: &str) -> Result<(), String> {
    match action {
        "pause" if feed.state != "disconnected" => feed.state = "paused".into(),
        "reconnect" => feed.state = "configured".into(),
        "disconnect" => {
            feed.state = "disconnected".into();
            feed.access.clear();
        }
        "delete-cache" => feed.entries.clear(),
        _ => return Err("Unsupported lifecycle action".into()),
    }
    record(feed, action);
    Ok(())
}
pub fn record(feed: &mut FeedConnection, action: &str) {
    feed.activity.push(action.into());
    if feed.activity.len() > 20 {
        feed.activity.remove(0);
    }
}
/// Read-only feed capability. Text only: HTML, enclosure URLs and scripts are never rendered.
pub fn parse_feed(xml: &str) -> Result<Vec<FeedEntry>, String> {
    use quick_xml::{events::Event, Reader};
    let mut reader = Reader::from_str(xml);
    let mut depth = 0usize;
    let mut root = false;
    let mut item_depth = None;
    let mut title_depth = None;
    let mut title = String::new();
    let mut entries = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                depth += 1;
                let name = e.local_name();
                if depth == 1 {
                    if root {
                        return Err("Expected one feed document".into());
                    }
                    root = matches!(name.as_ref(), b"rss" | b"feed" | b"RDF");
                    if !root {
                        return Err("Expected RSS or Atom XML".into());
                    }
                }
                if matches!(name.as_ref(), b"item" | b"entry") {
                    item_depth = Some(depth);
                    title.clear();
                }
                if name.as_ref() == b"title" && item_depth == Some(depth - 1) {
                    title_depth = Some(depth);
                }
            }
            Ok(Event::Text(e)) if title_depth.is_some() => {
                title.push_str(&e.decode().map_err(|_| "Invalid feed text")?)
            }
            Ok(Event::CData(e)) if title_depth.is_some() => {
                title.push_str(&e.decode().map_err(|_| "Invalid feed text")?)
            }
            Ok(Event::GeneralRef(e)) if title_depth.is_some() => {
                if let Some(ch) = e
                    .resolve_char_ref()
                    .map_err(|_| "Invalid character reference")?
                {
                    title.push(ch);
                } else {
                    let name = e.decode().map_err(|_| "Invalid character reference")?;
                    title.push_str(match name.as_ref() {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => return Err("Unknown XML entity".into()),
                    });
                }
            }
            Ok(Event::Empty(e)) if depth == 0 => {
                if root || !matches!(e.local_name().as_ref(), b"rss" | b"feed" | b"RDF") {
                    return Err("Expected one feed document".into());
                }
                root = true;
            }
            Ok(Event::End(_)) => {
                if title_depth == Some(depth) {
                    title_depth = None;
                }
                if item_depth == Some(depth) {
                    if entries.len() < 100 {
                        entries.push(FeedEntry {
                            title: title.chars().take(500).collect(),
                        });
                    }
                    item_depth = None;
                }
                depth = depth.saturating_sub(1);
            }
            Ok(Event::DocType(_)) => return Err("Feed document types are not supported".into()),
            Ok(Event::Eof) => break,
            Err(_) => return Err("Invalid RSS/Atom XML".into()),
            _ => (),
        }
    }
    if !root || depth != 0 {
        return Err("Expected complete RSS or Atom XML".into());
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> FeedConnection {
        FeedConnection {
            id: 1,
            name: "News".into(),
            url: "https://example.org/feed".into(),
            state: "verified".into(),
            last_check: None,
            access: vec![],
            entries: vec![FeedEntry {
                title: "Cached".into(),
            }],
            activity: vec![],
        }
    }
    #[test]
    fn migration_preserves_legacy() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE settings(key TEXT,value TEXT); INSERT INTO settings VALUES('mail','unchanged')").unwrap();
        init(&db).unwrap();
        init(&db).unwrap();
        save(&db, &fixture()).unwrap();
        assert_eq!(get(&db, 1).unwrap().url, fixture().url);
        assert_eq!(
            db.query_row("SELECT value FROM settings", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "unchanged"
        );
    }
    #[test]
    fn saved_connection_survives_database_reopen() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "devdeck-connectors-{}-{unique}.sqlite",
            std::process::id()
        ));
        {
            let db = Connection::open(&path).unwrap();
            save(&db, &fixture()).unwrap();
        }
        {
            let db = Connection::open(&path).unwrap();
            let restored = get(&db, 1).unwrap();
            assert_eq!(restored.url, fixture().url);
            assert!(restored.access.is_empty());
            assert_eq!(restored.entries[0].title, "Cached");
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn fail_closed_scopes_and_disconnect_preserves_cache() {
        let mut f = fixture();
        assert!(!permitted(&f, "agent", "a"));
        f.access.push(Access {
            scope: "project".into(),
            id: "1".into(),
            capability: "feed.read".into(),
        });
        assert!(permitted(&f, "project", "1"));
        assert!(!permitted(&f, "agent", "1"));
        f.state = "unknown".into();
        assert!(!permitted(&f, "project", "1"));
        f.state = "verified".into();
        transition(&mut f, "pause").unwrap();
        assert!(!permitted(&f, "project", "1"));
        transition(&mut f, "reconnect").unwrap();
        assert!(permitted(&f, "project", "1"));
        transition(&mut f, "disconnect").unwrap();
        assert_eq!(f.entries.len(), 1);
        assert!(f.access.is_empty());
        transition(&mut f, "reconnect").unwrap();
        assert!(!permitted(&f, "project", "1"));
        transition(&mut f, "delete-cache").unwrap();
        assert!(f.entries.is_empty());
    }
    #[test]
    fn consumer_refuses_space_only_bindings_and_reads_current_revocations() {
        let db = Connection::open_in_memory().unwrap();
        let mut f = fixture();
        f.access.push(Access {
            scope: "space".into(),
            id: "p1".into(),
            capability: "feed.read".into(),
        });
        save(&db, &f).unwrap();
        assert!(read_cached(&db, 1, "reader", "p1").is_err());
        f.access.push(Access {
            scope: "agent".into(),
            id: "reader".into(),
            capability: "feed.read".into(),
        });
        save(&db, &f).unwrap();
        assert_eq!(
            read_cached(&db, 1, "reader", "other").unwrap().entries[0].title,
            "Cached"
        );
        assert!(read_cached(&db, 1, "", "p1").is_err());
        f.access.clear();
        save(&db, &f).unwrap();
        assert!(read_cached(&db, 1, "reader", "p1").is_err());
    }
    #[test]
    fn rss_and_atom_text_only() {
        assert_eq!(
            parse_feed("<rss><channel><item><title>News</title></item></channel></rss>").unwrap()
                [0]
            .title,
            "News"
        );
        assert_eq!(parse_feed("<feed xmlns='http://www.w3.org/2005/Atom'><entry><title><![CDATA[<script>x</script>]]></title></entry></feed>").unwrap()[0].title,"<script>x</script>");
        assert!(parse_feed("<html></html>").is_err());
        assert!(parse_feed("<rss><item>").is_err());
        assert!(parse_feed("<!DOCTYPE rss><rss/>").is_err());
        assert_eq!(
            parse_feed("<feed><entry><title>Tom &amp; Jerry &#33;</title></entry></feed>").unwrap()
                [0]
            .title,
            "Tom & Jerry !"
        );
        assert!(parse_feed("<rss/><feed/>").is_err());
    }
    #[test]
    fn rejects_credential_bearing_and_non_https_urls() {
        for url in [
            "http://example.org/feed",
            "https://user:pass@example.org/feed",
            "https://example.org/feed?token=secret",
            "file:///etc/passwd",
        ] {
            assert!(validate_url(url).is_err());
        }
        assert!(validate_url("https://example.org/feed").is_ok());
    }
}
