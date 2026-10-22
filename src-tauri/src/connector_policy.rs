//! Deny-only controls for existing connections. No credentials or legacy grants move.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

pub type Guard =
    Arc<dyn Fn(&str, &str, Option<&str>, Option<&str>) -> Result<(), String> + Send + Sync>;
static RUNTIME_GUARD: OnceLock<Guard> = OnceLock::new();
pub fn install(guard: Guard) {
    let _ = RUNTIME_GUARD.set(guard);
}
pub fn runtime_check(
    key: &str,
    capability: &str,
    agent: Option<&str>,
    project: Option<&str>,
) -> Result<(), String> {
    RUNTIME_GUARD
        .get()
        .ok_or("Connector controls unavailable")?(key, capability, agent, project)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct Control {
    pub key: String,
    pub state: String,
    pub agents: Option<Vec<String>>,
    pub projects: Option<Vec<String>>,
    pub spaces: Option<Vec<String>>,
    pub revision: u64,
    pub activity: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OwnerCheck {
    pub key: String,
    pub at: u64,
    pub ok: bool,
    pub summary: String,
}
#[derive(Serialize)]
pub struct Dependencies {
    pub uses: Vec<String>,
    pub coverage: String,
}
pub fn project_uses(raw: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Link {
        name: String,
        repository: String,
    }
    let links: Vec<Link> =
        serde_json::from_str(raw).map_err(|_| "Saved repository dependencies could not be read")?;
    Ok(links
        .into_iter()
        .map(|p| format!("{} ({})", p.name, p.repository))
        .collect())
}
pub fn supported(key: &str, capability: &str) -> bool {
    (key == "github:global" && matches!(capability, "repository.read" | "repository.write"))
        || (key.starts_with("ai:") && key.len() > 3 && capability == "model.infer")
}
pub fn init(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS connector_controls(key TEXT PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connector_owner_checks(key TEXT PRIMARY KEY, record TEXT NOT NULL)").map_err(|_|"Cannot initialize connector controls".into())
}
pub fn list(db: &Connection) -> Result<Vec<Control>, String> {
    init(db)?;
    let mut stmt = db
        .prepare("SELECT record FROM connector_controls ORDER BY key")
        .map_err(|_| "Cannot read connector controls")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot read connector controls")?;
    rows.map(|r| {
        serde_json::from_str(&r.map_err(|_| "Cannot read connector control")?)
            .map_err(|_| "Invalid saved connector control".into())
    })
    .collect()
}
pub fn save(db: &Connection, mut desired: Control, expected: u64) -> Result<(), String> {
    if !supported(
        &desired.key,
        if desired.key.starts_with("ai:") {
            "model.infer"
        } else {
            "repository.read"
        },
    ) || desired.key.len() > 250
    {
        return Err("Unsupported connector control".into());
    }
    if !matches!(desired.state.as_str(), "active" | "paused" | "disconnected") {
        return Err("Invalid connector lifecycle state".into());
    }
    for values in [&desired.agents, &desired.projects, &desired.spaces]
        .into_iter()
        .flatten()
    {
        if values.len() > 200 || values.iter().any(|v| v.trim().is_empty() || v.len() > 200) {
            return Err("Use exact nonempty identifiers".into());
        }
    }
    let previous = list(db)?
        .into_iter()
        .find(|p| p.key == desired.key)
        .unwrap_or_default();
    if previous.revision != expected {
        return Err("Connector changed. Refresh before saving controls.".into());
    }
    desired.revision = expected
        .checked_add(1)
        .ok_or("Connector revision exhausted")?;
    desired.activity = previous.activity;
    desired.activity.push(if desired.state != previous.state {
        format!("lifecycle: {}", desired.state)
    } else {
        "access restrictions updated".into()
    });
    if desired.activity.len() > 20 {
        desired.activity.remove(0);
    }
    let json = serde_json::to_string(&desired).map_err(|_| "Cannot encode connector control")?;
    db.execute("INSERT INTO connector_controls(key,record) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET record=excluded.record",params![desired.key,json]).map_err(|_|"Cannot save connector controls")?;
    Ok(())
}
pub fn check(
    db: &Connection,
    key: &str,
    capability: &str,
    agent: Option<&str>,
    project: Option<&str>,
) -> Result<(), String> {
    if !supported(key, capability) {
        return Err("Unsupported connector capability".into());
    }
    let Some(control) = list(db)?.into_iter().find(|p| p.key == key) else {
        return Ok(());
    };
    if control.state != "active" {
        return Err(format!("Connector use is {}", control.state));
    }
    let matches = |restriction: &Option<Vec<String>>, identity: Option<&str>| {
        restriction.as_ref().map_or(true, |ids| {
            identity
                .filter(|id| !id.is_empty())
                .is_some_and(|id| ids.iter().any(|v| v == id))
        })
    };
    if !matches(&control.agents, agent)
        || !matches(&control.projects, project)
        || control.spaces.is_some()
    {
        return Err("Connector access denied for this runtime identity".into());
    }
    Ok(())
}
pub fn owner_checks(db: &Connection) -> Result<Vec<OwnerCheck>, String> {
    init(db)?;
    let mut stmt = db
        .prepare("SELECT record FROM connector_owner_checks ORDER BY key")
        .map_err(|_| "Cannot read connector checks")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot read connector checks")?;
    rows.map(|r| {
        serde_json::from_str(&r.map_err(|_| "Cannot read connector check")?)
            .map_err(|_| "Invalid connector check".into())
    })
    .collect()
}
pub fn record_check(
    db: &Connection,
    key: String,
    ok: bool,
    summary: String,
) -> Result<OwnerCheck, String> {
    init(db)?;
    let check = OwnerCheck {
        key,
        at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        ok,
        summary,
    };
    let json = serde_json::to_string(&check).map_err(|_| "Cannot encode connector check")?;
    db.execute("INSERT INTO connector_owner_checks(key,record) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET record=excluded.record",params![check.key,json]).map_err(|_|"Cannot save connector check")?;
    Ok(check)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connector_controls_preserve_configuration_and_grants() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE settings(key TEXT,value TEXT);INSERT INTO settings VALUES('provider','original');CREATE TABLE permissions(agent TEXT,level TEXT);INSERT INTO permissions VALUES('a','approval')").unwrap();
        assert!(check(&db, "ai:existing", "model.infer", None, None).is_ok());
        let mut p = Control {
            key: "ai:existing".into(),
            state: "active".into(),
            agents: Some(vec!["a".into()]),
            ..Default::default()
        };
        save(&db, p.clone(), 0).unwrap();
        assert!(check(&db, &p.key, "model.infer", Some("a"), None).is_ok());
        assert!(check(&db, &p.key, "model.infer", Some("b"), None).is_err());
        assert!(check(&db, &p.key, "model.infer", None, None).is_err());
        assert!(save(&db, p.clone(), 0).is_err());
        p.state = "paused".into();
        save(&db, p.clone(), 1).unwrap();
        assert!(check(&db, &p.key, "model.infer", Some("a"), None).is_err());
        p.state = "disconnected".into();
        save(&db, p.clone(), 2).unwrap();
        assert!(check(&db, &p.key, "model.infer", Some("a"), None).is_err());
        p.state = "active".into();
        save(&db, p.clone(), 3).unwrap();
        assert!(check(&db, &p.key, "model.infer", Some("b"), None).is_err());
        assert_eq!(
            db.query_row("SELECT value FROM settings", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
        assert_eq!(
            db.query_row("SELECT level FROM permissions", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "approval"
        );
    }
    #[test]
    fn connector_controls_fail_closed_for_missing_context() {
        let db = Connection::open_in_memory().unwrap();
        let mut p = Control {
            key: "ai:fixture".into(),
            state: "active".into(),
            projects: Some(vec!["p1".into()]),
            ..Default::default()
        };
        save(&db, p.clone(), 0).unwrap();
        assert!(check(&db, &p.key, "model.infer", Some("a"), Some("p1")).is_ok());
        assert!(check(&db, &p.key, "model.infer", Some("a"), None).is_err());
        p.spaces = Some(vec!["p1".into()]);
        save(&db, p.clone(), 1).unwrap();
        assert!(check(&db, &p.key, "model.infer", Some("a"), Some("p1")).is_err());
        assert!(check(&db, "github:global", "model.infer", None, None).is_err());
    }
    #[test]
    fn connector_dependency_report_only_names_saved_links() {
        assert_eq!(
            project_uses(
                r#"[{"id":"p1","name":"Product","repository":"acme/app","space":"Work"}]"#
            )
            .unwrap(),
            ["Product (acme/app)"]
        );
        assert!(project_uses(r#"[{"name":"Product"}]"#).is_err());
    }
}
