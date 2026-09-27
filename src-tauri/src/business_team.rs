//! A business's team: roles, the way a company has them.
//!
//! Never a manager per project. A role owns work across every product,
//! project and client it touches: one engineering lead for all the
//! repositories, one product manager for every product. Roles are suggested
//! from what the business sells and has; the owner puts each on the team or
//! keeps doing it themselves. A manager already working for another business
//! is offered too, and only ever offered.
//!
//! Everyone reports to the directors. A manager made here is the same file
//! at the vault root that every manager is, with its business ids beside it.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::business::{self, BusinessMeta};
use crate::db::Db;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct RoleDef {
    pub id: String,
    pub name: String,
    pub job: String,
    /// daily | weekdays | weekly
    pub every: String,
    pub at_min: i64,
    /// For weekly: 0-6, Sunday first.
    pub days: String,
    /// The agents it may put to work. Empty: it plans and asks.
    pub team: Vec<String>,
    pub stop_at: Vec<String>,
    /// The rhythm in words.
    pub rhythm: String,
}

fn role(
    id: &str,
    name: &str,
    job: &str,
    every: &str,
    at_min: i64,
    days: &str,
    rhythm: &str,
) -> RoleDef {
    RoleDef {
        id: id.into(),
        name: name.into(),
        job: job.into(),
        every: every.into(),
        at_min,
        days: days.into(),
        team: Vec::new(),
        stop_at: Vec::new(),
        rhythm: rhythm.into(),
    }
}

/// Every role a business can have.
pub fn catalogue() -> Vec<RoleDef> {
    let mut engineering = role(
        "engineering",
        "Engineering lead",
        "Keeps every repository healthy: builds, tests, dependencies and reviews.",
        "weekdays",
        7 * 60,
        "",
        "Weekdays 07:00",
    );
    engineering.team = vec!["dev-a".into(), "qa".into()];
    engineering.stop_at = vec!["before any push".into()];
    vec![
        role(
            "operations",
            "Operations manager",
            "Keeps the week moving: who is where, what is due, and what is stuck.",
            "weekly",
            8 * 60,
            "1",
            "Mondays 08:00, the week ahead",
        ),
        role(
            "product",
            "Product manager",
            "Owns the roadmap and what goes into each release, for every product.",
            "weekly",
            14 * 60,
            "5",
            "Fridays 14:00, ready to release?",
        ),
        engineering,
        role(
            "client-success",
            "Client success",
            "Clients and what they ask for. Nobody waits without hearing back.",
            "daily",
            9 * 60,
            "",
            "Daily 09:00",
        ),
        role(
            "finance",
            "Finance",
            "Quotes, invoices, what is owed, and the accountant.",
            "weekly",
            16 * 60,
            "5",
            "Fridays 16:00, invoices and follow-ups",
        ),
        role(
            "sales-marketing",
            "Sales and marketing",
            "The website, leads, and proposals to new customers.",
            "weekly",
            10 * 60,
            "3",
            "Wednesdays 10:00",
        ),
    ]
}

/// A role's first steps, from what the business has: its projects, its
/// products, its clients. Proposed when a manager wakes with nothing on its
/// plan, and added only when you say so.
pub fn first_steps(conn: &Connection, role: &str, node_id: i64) -> Vec<String> {
    let nodes = crate::db::nodes_on(conn).unwrap_or_default();
    let mut under: Vec<i64> = vec![node_id];
    let mut i = 0;
    while i < under.len() {
        let id = under[i];
        for n in nodes.iter().filter(|n| n.parent_id == Some(id)) {
            under.push(n.id);
        }
        i += 1;
    }
    let projects: Vec<String> = nodes
        .iter()
        .filter(|n| n.kind == "project" && n.id != node_id && under.contains(&n.id))
        .map(|n| n.name.clone())
        .collect();
    let in_folder = |name: &str| -> Vec<String> {
        nodes
            .iter()
            .find(|n| n.parent_id == Some(node_id) && n.name.eq_ignore_ascii_case(name))
            .map(|f| {
                nodes
                    .iter()
                    .filter(|n| n.parent_id == Some(f.id))
                    .map(|n| n.name.clone())
                    .collect()
            })
            .unwrap_or_default()
    };
    let meta = business::read(conn, node_id).ok().flatten();
    let name = meta
        .as_ref()
        .map(|m| m.name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "the business".into());
    let products: Vec<String> = meta
        .as_ref()
        .map(|m| {
            m.items
                .iter()
                .filter(|i| {
                    i.field == "product"
                        && (i.state == "agreed" || (i.kind == "you" && i.state != "declined"))
                })
                .map(|i| i.text.clone())
                .collect()
        })
        .unwrap_or_default();

    let mut out: Vec<String> = Vec::new();
    match role {
        "engineering" => {
            for p in projects.iter().take(3) {
                out.push(format!("Check {p} builds and its tests pass"));
            }
            if projects.is_empty() {
                out.push(format!("List the repositories {name} depends on"));
            }
            out.push("List dependencies with known vulnerabilities across the repositories".into());
            out.push("Review the open pull requests and say which are stuck".into());
        }
        "product" => {
            for p in products.iter().take(3) {
                out.push(format!("Write down what goes into the next release of {p}"));
            }
            out.push(format!(
                "Collect what clients have asked {name} for, by product"
            ));
        }
        "operations" => {
            out.push(format!("List what is due this week across {name}"));
            out.push("Note anything stuck waiting on someone, and on whom".into());
        }
        "client-success" => {
            let clients = in_folder("Clients");
            for c in clients.iter().take(3) {
                out.push(format!("Check whether {c} is waiting on a reply"));
            }
            if clients.is_empty() {
                out.push(format!("List the clients waiting on a reply from {name}"));
            }
        }
        "finance" => {
            out.push("List invoices sent and not yet paid".into());
            out.push("Note quotes waiting on an answer".into());
        }
        "sales-marketing" => {
            out.push(format!("Check the website still says what {name} sells"));
            out.push("List proposals sent and not yet answered".into());
        }
        _ => {}
    }
    out
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct RoleOffer {
    #[serde(flatten)]
    pub def: RoleDef,
    /// What it would cover in this business, in words.
    pub covers: Vec<String>,
    /// Suggested on the team.
    pub on: bool,
    /// Why it is suggested on or off, in words.
    pub why: String,
    /// Already made for this business: its handle.
    pub made: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ManagerOffer {
    pub handle: String,
    pub name: String,
    pub role: String,
    /// The businesses it works for now, by name.
    pub works_for: Vec<String>,
    pub rhythm: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct TeamOffer {
    pub roles: Vec<RoleOffer>,
    /// Managers from other businesses that could work for this one too.
    pub others: Vec<ManagerOffer>,
    /// Managers already working for this business, by handle.
    pub members: Vec<String>,
    pub directors: Vec<String>,
}

fn agreed<'a>(meta: &'a BusinessMeta, field: &str) -> Vec<&'a str> {
    meta.items
        .iter()
        .filter(|i| {
            i.field == field && (i.state == "agreed" || (i.kind == "you" && i.state != "declined"))
        })
        .map(|i| i.text.as_str())
        .collect()
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// Which roles a business needs, from what it sells and has.
///
/// Suggested on only where there is work for the role to own: engineering
/// when there is code, product when there are products, operations when
/// there are services to deliver, client success when there are clients or
/// services. Finance and sales start as the directors' own, because a small
/// business usually keeps those.
pub fn suggest(meta: &BusinessMeta, projects: usize, clients: usize) -> Vec<RoleOffer> {
    let products = agreed(meta, "product");
    let services = agreed(meta, "service");
    let host = business::normalise_site(&meta.website)
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .to_string();
    catalogue()
        .into_iter()
        .map(|def| {
            let (covers, on, why): (Vec<String>, bool, String) = match def.id.as_str() {
                "operations" => (
                    std::iter::once("the whole business".to_string())
                        .chain(services.iter().map(|s| s.to_string()))
                        .collect(),
                    !services.is_empty(),
                    if services.is_empty() {
                        "no services to deliver yet".into()
                    } else {
                        format!(
                            "{} to deliver",
                            plural(services.len(), "service", "services")
                        )
                    },
                ),
                "product" => (
                    products.iter().map(|p| p.to_string()).collect(),
                    !products.is_empty(),
                    if products.is_empty() {
                        "no products yet".into()
                    } else {
                        format!(
                            "{} to look after",
                            plural(products.len(), "product", "products")
                        )
                    },
                ),
                "engineering" => (
                    if projects > 0 {
                        vec![plural(projects, "project", "projects")]
                    } else {
                        vec![]
                    },
                    projects > 0,
                    if projects > 0 {
                        format!("{} with code", plural(projects, "project", "projects"))
                    } else {
                        "no repositories linked".into()
                    },
                ),
                "client-success" => (
                    {
                        let mut c = Vec::new();
                        if clients > 0 {
                            c.push(plural(clients, "client", "clients"));
                        }
                        c.extend(services.iter().map(|s| s.to_string()));
                        c
                    },
                    clients > 0 || !services.is_empty(),
                    if clients > 0 || !services.is_empty() {
                        "clients to keep in touch with".into()
                    } else {
                        "no clients yet".into()
                    },
                ),
                "finance" => (
                    vec!["Money".into()],
                    false,
                    "directors usually keep this at first".into(),
                ),
                _ => (
                    std::iter::once("Marketing".to_string())
                        .chain((!host.is_empty()).then_some(host.clone()))
                        .collect(),
                    false,
                    "directors usually keep this at first".into(),
                ),
            };
            RoleOffer {
                def,
                covers,
                on,
                why,
                made: String::new(),
            }
        })
        .collect()
}

fn count_under(conn: &Connection, business_id: i64, folder: &str, kind: &str) -> usize {
    let Ok(folder_id) = conn.query_row(
        "SELECT id FROM nodes WHERE parent_id = ?1 AND name = ?2 COLLATE NOCASE",
        params![business_id, folder],
        |r| r.get::<_, i64>(0),
    ) else {
        return 0;
    };
    crate::business_clear::subtree(conn, folder_id)
        .into_iter()
        .filter(|id| *id != folder_id)
        .filter(|id| {
            conn.query_row("SELECT kind FROM nodes WHERE id = ?1", params![id], |r| {
                r.get::<_, String>(0)
            })
            .map(|k| kind.is_empty() || k == kind)
            .unwrap_or(false)
        })
        .count()
}

fn names_of(conn: &Connection, ids: &[i64]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| {
            conn.query_row("SELECT name FROM nodes WHERE id = ?1", params![id], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        })
        .collect()
}

pub fn team_offer(conn: &Connection, node_id: i64) -> Result<TeamOffer, String> {
    let meta =
        business::read(conn, node_id)?.ok_or("That space has not been set up as a business.")?;
    let projects = count_under(conn, node_id, "Products", "project");
    let clients = conn
        .query_row(
            "SELECT COUNT(*) FROM nodes WHERE parent_id = (SELECT id FROM nodes WHERE parent_id = ?1 AND name = 'Clients' COLLATE NOCASE)",
            params![node_id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as usize;
    let mut roles = suggest(&meta, projects, clients);
    let all = crate::managers::all(conn);
    for r in roles.iter_mut() {
        if let Some(m) = all
            .iter()
            .find(|m| m.businesses.contains(&node_id) && m.template == format!("role:{}", r.def.id))
        {
            r.made = m.handle.clone();
            r.on = true;
        }
    }
    let members = all
        .iter()
        .filter(|m| m.businesses.contains(&node_id))
        .map(|m| m.handle.clone())
        .collect();
    let others = all
        .iter()
        .filter(|m| !m.businesses.is_empty() && !m.businesses.contains(&node_id))
        .map(|m| ManagerOffer {
            handle: m.handle.clone(),
            name: m.name.clone(),
            role: m.role.clone(),
            works_for: names_of(conn, &m.businesses),
            rhythm: crate::bots::rhythm_words(&m.every, m.at_min, &m.days),
        })
        .collect();
    let directors = meta
        .directors
        .iter()
        .map(|d| {
            if d.you {
                "You".to_string()
            } else {
                d.name.trim().to_string()
            }
        })
        .filter(|d| !d.is_empty())
        .collect();
    Ok(TeamOffer {
        roles,
        others,
        members,
        directors,
    })
}

#[tauri::command(async)]
pub fn business_team(db: tauri::State<Db>, node_id: i64) -> Result<TeamOffer, String> {
    let conn = db.0.lock().unwrap();
    team_offer(&conn, node_id)
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct TeamMade {
    pub made: Vec<String>,
    pub joined: Vec<String>,
    pub problems: Vec<String>,
}

/// Put the chosen roles on the team, and the chosen managers from other
/// businesses to work here too. Nothing is made for a role the directors keep.
pub fn make_team(
    conn: &Connection,
    node_id: i64,
    roles: &[String],
    reuse: &[String],
) -> Result<TeamMade, String> {
    let mut meta =
        business::read(conn, node_id)?.ok_or("That space has not been set up as a business.")?;
    let offer = team_offer(conn, node_id)?;
    let mut out = TeamMade::default();

    for id in roles {
        let Some(r) = offer.roles.iter().find(|r| &r.def.id == id) else {
            out.problems.push(format!("there is no role called {id}"));
            continue;
        };
        if !r.made.is_empty() {
            continue;
        }
        let handle = crate::managers::handle_from(&format!("{} {}", meta.name, r.def.id));
        let body = format!(
            "Works for {}. Reports to the directors: {}.\n\nCovers: {}.",
            meta.name,
            offer.directors.join(", "),
            if r.covers.is_empty() {
                "nothing yet".to_string()
            } else {
                r.covers.join(", ")
            },
        );
        let m = crate::managers::Manager {
            handle: handle.clone(),
            name: r.def.name.clone(),
            role: r.def.name.to_lowercase(),
            goal: r.def.job.clone(),
            every: r.def.every.clone(),
            at_min: r.def.at_min,
            days: r.def.days.clone(),
            body,
            skills: Vec::new(),
            template: format!("role:{}", r.def.id),
            agent: r.def.team.first().cloned().unwrap_or_default(),
            team: r.def.team.clone(),
            wake_intent: String::new(),
            stop_at: r.def.stop_at.clone(),
            was: String::new(),
            home: node_id,
            worker: String::new(),
            businesses: vec![node_id],
        };
        crate::managers::save(conn, &m)?;
        if let Err(e) = crate::bots::sync_manager_heartbeat(conn, &handle) {
            out.problems
                .push(format!("{}: its rhythm could not be set: {e}", r.def.name));
        }
        out.made.push(r.def.name.clone());
    }

    for handle in reuse {
        let Some(mut m) = crate::managers::get(conn, handle) else {
            out.problems
                .push(format!("there is no manager called @{handle}"));
            continue;
        };
        if !m.businesses.contains(&node_id) {
            m.businesses.push(node_id);
            crate::managers::save(conn, &m)?;
        }
        out.joined.push(m.name);
    }

    meta.made = true;
    meta.step = "done".into();
    business::write(conn, node_id, &meta)?;
    Ok(out)
}

#[tauri::command(async)]
pub fn business_make_team(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    node_id: i64,
    roles: Vec<String>,
    reuse: Vec<String>,
) -> Result<TeamMade, String> {
    let (made, name) = {
        let conn = db.0.lock().unwrap();
        let name = conn
            .query_row(
                "SELECT name FROM nodes WHERE id = ?1",
                params![node_id],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
        (make_team(&conn, node_id, &roles, &reuse)?, name)
    };
    crate::activity::record(
        &app,
        "bot",
        format!("{name}'s team"),
        format!(
            "{} on the team{}",
            made.made.len() + made.joined.len(),
            if made.joined.is_empty() {
                String::new()
            } else {
                format!(", {} from other businesses", made.joined.len())
            }
        ),
        made.problems.is_empty(),
        Some(node_id),
    );
    Ok(made)
}

/// One manager on a business's team, as the space's Team tab shows it.
#[derive(Serialize, Clone, Debug, Default)]
pub struct MemberView {
    pub handle: String,
    pub name: String,
    pub role: String,
    pub goal: String,
    pub rhythm: String,
    /// When its heartbeat last ran, in milliseconds. None until it has.
    pub last_woke: Option<i64>,
    /// Items not done on the features it owns.
    pub open_items: usize,
    /// Other businesses it also works for, by name.
    pub also_for: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct KindCount {
    pub folder: String,
    pub count: usize,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SpaceView {
    pub members: Vec<MemberView>,
    /// Roles nobody is on: the directors keep doing them.
    pub keeps: Vec<String>,
    pub organisations: Vec<KindCount>,
}

pub fn space_view(conn: &Connection, node_id: i64) -> Result<SpaceView, String> {
    let offer = team_offer(conn, node_id)?;
    let mut members = Vec::new();
    for m in crate::managers::all(conn)
        .into_iter()
        .filter(|m| m.businesses.contains(&node_id))
    {
        let last_woke: Option<i64> = conn
            .query_row(
                "SELECT last_run FROM schedules WHERE kind = 'bot' AND manager = ?1 LIMIT 1",
                params![m.handle],
                |r| r.get::<_, Option<i64>>(0),
            )
            .unwrap_or(None);
        let mut open_items = 0usize;
        for (owner_node, slug) in crate::managers::owned_by(conn, &m.handle) {
            let Some(dir) = crate::db::node_deck_dir_by_id(conn, owner_node) else {
                continue;
            };
            if let Ok(work) = crate::aiw::deck::Deck::new(dir).work(&slug) {
                open_items += work
                    .meta
                    .items
                    .iter()
                    .filter(|i| i.status != "done")
                    .count();
            }
        }
        let others: Vec<i64> = m
            .businesses
            .iter()
            .copied()
            .filter(|b| *b != node_id)
            .collect();
        members.push(MemberView {
            handle: m.handle.clone(),
            name: m.name.clone(),
            role: m.role.clone(),
            goal: m.goal.clone(),
            rhythm: crate::bots::rhythm_words(&m.every, m.at_min, &m.days),
            last_woke,
            open_items,
            also_for: names_of(conn, &others),
        });
    }
    let keeps = offer
        .roles
        .iter()
        .filter(|r| r.made.is_empty())
        .map(|r| r.def.name.clone())
        .collect();
    let organisations = ["Clients", "Suppliers", "Advisers", "Partner firms"]
        .iter()
        .map(|f| KindCount {
            folder: f.to_string(),
            count: conn
                .query_row(
                    "SELECT COUNT(*) FROM nodes WHERE parent_id = (SELECT id FROM nodes WHERE parent_id = ?1 AND name = ?2 COLLATE NOCASE)",
                    params![node_id, f],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0) as usize,
        })
        .collect();
    Ok(SpaceView {
        members,
        keeps,
        organisations,
    })
}

#[tauri::command(async)]
pub fn business_space(db: tauri::State<Db>, node_id: i64) -> Result<SpaceView, String> {
    let conn = db.0.lock().unwrap();
    space_view(&conn, node_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::business::Suggestion;

    fn item(field: &str, text: &str, state: &str) -> Suggestion {
        Suggestion {
            id: text.into(),
            field: field.into(),
            text: text.into(),
            kind: "suggestion".into(),
            state: state.into(),
            ..Default::default()
        }
    }

    #[test]
    fn roles_are_suggested_from_what_the_business_has_never_per_project() {
        let meta = BusinessMeta {
            name: "Innotrack".into(),
            website: "innotrack.co.za".into(),
            items: vec![
                item("product", "Asset tracking platform", "agreed"),
                item("product", "Mining equipment tracking", "agreed"),
                item("product", "Declined thing", "declined"),
                item("service", "Site surveys", "agreed"),
                item("service", "Still a suggestion", "open"),
            ],
            ..Default::default()
        };
        let roles = suggest(&meta, 3, 2);
        assert_eq!(
            roles.len(),
            catalogue().len(),
            "one offer per role, however many projects"
        );
        let get = |id: &str| roles.iter().find(|r| r.def.id == id).unwrap();
        assert!(get("engineering").on);
        assert_eq!(get("engineering").covers, vec!["3 projects"]);
        assert_eq!(
            get("product").covers,
            vec!["Asset tracking platform", "Mining equipment tracking"]
        );
        assert!(get("operations")
            .covers
            .contains(&"Site surveys".to_string()));
        assert!(
            !get("operations")
                .covers
                .contains(&"Still a suggestion".to_string()),
            "only agreed services"
        );
        assert!(get("client-success").on);
        assert!(!get("finance").on, "the directors keep finance at first");
        assert!(get("sales-marketing")
            .covers
            .contains(&"innotrack.co.za".to_string()));
        assert_eq!(get("engineering").def.stop_at, vec!["before any push"]);

        let empty = suggest(&BusinessMeta::default(), 0, 0);
        assert!(
            empty.iter().all(|r| !r.on),
            "nothing to own, nobody suggested"
        );
    }
}
