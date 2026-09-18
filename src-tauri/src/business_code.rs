//! A business's code: repositories listed from GitHub, each linked to a
//! product as a project.
//!
//! A project is a folder under its product whose meta names the repository,
//! the same shape every project in the vault has. A repository already cloned
//! somewhere is found and used where it is, and never cloned twice. The
//! commands and services a project had are read back from the repository by
//! the same scan the project setup page uses.
//!
//! `DEVDECK_GITHUB_FAKE=1` lists example repositories instead of calling
//! GitHub, and makes a small local repository for each one linked. It is for a
//! test run on a throwaway profile, and every screen that shows its list says
//! the repositories are examples.

use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::Db;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Repo {
    #[serde(default)]
    pub full_name: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub clone_url: String,
    #[serde(default)]
    pub html_url: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct RepoList {
    /// github | example
    pub source: String,
    pub login: String,
    pub signed_in: bool,
    pub repos: Vec<Repo>,
    pub note: String,
}

pub fn example_mode() -> bool {
    std::env::var("DEVDECK_GITHUB_FAKE").map(|v| v.trim() == "1").unwrap_or(false)
}

/// What a test run lists. Made up, and each one says so.
pub fn example_repos() -> Vec<Repo> {
    let ago = |days: i64| (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    let r = |owner: &str, name: &str, desc: &str, private: bool, days: i64, lang: &str| Repo {
        full_name: format!("{owner}/{name}"),
        name: name.into(),
        owner: owner.into(),
        description: format!("{desc} An example repository."),
        private,
        updated_at: ago(days),
        language: lang.into(),
        clone_url: format!("https://github.com/{owner}/{name}.git"),
        html_url: format!("https://github.com/{owner}/{name}"),
    };
    vec![
        r("innotrack", "asset-tracker-api", "The API behind asset tracking.", true, 2, "C#"),
        r("innotrack", "asset-tracker-web", "The web app for asset tracking.", true, 2, "TypeScript"),
        r("innotrack", "rfid-gateway", "Reads the fixed RFID readers on site.", true, 8, "Go"),
        r("innotrack", "mobile-scanner", "A handheld scanning app that uses the asset tracker API.", true, 170, "Kotlin"),
        r("innotrack", "website", "The site at innotrack.co.za.", false, 140, "HTML"),
        r("you", "dotfiles", "Your own settings.", false, 30, "Shell"),
    ]
}

fn list_github(token: &str) -> Result<RepoList, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("DevDeck")
        .build()
        .map_err(err)?;
    let get = |url: &str| -> Result<serde_json::Value, String> {
        let res = client
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .bearer_auth(token)
            .send()
            .map_err(|e| format!("could not reach GitHub: {e}"))?;
        if !res.status().is_success() {
            return Err(match res.status().as_u16() {
                401 => "GitHub rejected the stored token. Paste a new one.".to_string(),
                403 => "GitHub refused (403). An organisation may need SSO authorising for this token.".to_string(),
                s => format!("GitHub answered {s}"),
            });
        }
        res.json().map_err(|e| format!("GitHub sent something unreadable: {e}"))
    };
    let me = get("https://api.github.com/user")?;
    let login = me.get("login").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let mut repos = Vec::new();
    for page in 1..=5 {
        let v = get(&format!(
            "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page={page}"
        ))?;
        let Some(arr) = v.as_array() else { break };
        for r in arr {
            let s = |k: &str| r.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
            repos.push(Repo {
                full_name: s("full_name"),
                name: s("name"),
                owner: r
                    .get("owner")
                    .and_then(|o| o.get("login"))
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string(),
                description: s("description"),
                private: r.get("private").and_then(|x| x.as_bool()).unwrap_or(false),
                updated_at: s("updated_at"),
                language: s("language"),
                clone_url: s("clone_url"),
                html_url: s("html_url"),
            });
        }
        if arr.len() < 100 {
            break;
        }
    }
    Ok(RepoList { source: "github".into(), login, signed_in: true, repos, note: String::new() })
}

/// The repositories the business could link.
#[tauri::command]
pub async fn business_repos() -> Result<RepoList, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if example_mode() {
            return Ok(RepoList {
                source: "example".into(),
                login: "example".into(),
                signed_in: true,
                repos: example_repos(),
                note: "Example repositories. This run is not connected to GitHub.".into(),
            });
        }
        match crate::github::stored_token() {
            None => Ok(RepoList {
                source: "github".into(),
                signed_in: false,
                note: "Paste a GitHub token to list your repositories.".into(),
                ..Default::default()
            }),
            Some(t) => list_github(&t),
        }
    })
    .await
    .map_err(|e| format!("the listing did not finish: {e}"))?
}

/// Where new clones for this business go, when the owner has not said.
#[tauri::command(async)]
pub fn business_clone_folder(db: tauri::State<Db>, node_id: i64) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let name: String = conn
        .query_row("SELECT name FROM nodes WHERE id = ?1", params![node_id], |r| r.get(0))
        .map_err(err)?;
    let slug = crate::managers::handle_from(&name);
    let base = match std::env::var("DEVDECK_HOME") {
        Ok(h) if !h.trim().is_empty() => PathBuf::from(h).join("code"),
        _ if Path::new(r"C:\code").is_dir() => PathBuf::from(r"C:\code"),
        _ => dirs::home_dir().unwrap_or_default().join("code"),
    };
    Ok(base.join(slug).to_string_lossy().to_string())
}

/// `owner/name`, lowercased, from any address GitHub hands out.
pub fn repo_key(url: &str) -> String {
    let u = url.trim().trim_end_matches('/');
    let u = u.strip_suffix(".git").unwrap_or(u);
    let tail = match u.find("github.com") {
        Some(i) => &u[i + "github.com".len()..],
        None => u,
    };
    tail.trim_start_matches([':', '/']).to_ascii_lowercase()
}

fn origin_of(dir: &Path) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git(dir: &Path, args: &[&str]) -> Result<(), String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=DevDeck", "-c", "user.email=devdeck@example.invalid"])
        .args(args)
        .output()
        .map_err(|e| format!("git did not run: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// A small local repository standing in for an example one, so a test run
/// can link, scan and show a project without touching GitHub.
pub fn make_example_repo(dir: &Path, repo: &Repo) -> Result<(), String> {
    if dir.exists() && dir.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err(format!("{} already exists and is not empty", dir.display()));
    }
    std::fs::create_dir_all(dir).map_err(err)?;
    std::fs::write(
        dir.join("README.md"),
        format!(
            "# {}\n\n{}\n\nMade by DevDeck for a test run. Not a real project.\n",
            repo.name, repo.description
        ),
    )
    .map_err(err)?;
    std::fs::write(
        dir.join("package.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "name": repo.name,
            "private": true,
            "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run" }
        }))
        .map_err(err)?,
    )
    .map_err(err)?;
    let init = Command::new("git").arg("init").arg("-q").arg(dir).output().map_err(|e| format!("git did not run: {e}"))?;
    if !init.status.success() {
        return Err(format!("git init: {}", String::from_utf8_lossy(&init.stderr).trim()));
    }
    git(dir, &["add", "-A"])?;
    git(dir, &["commit", "-q", "-m", "An example repository for a test run"])?;
    git(dir, &["remote", "add", "origin", &repo.clone_url])?;
    Ok(())
}

/// Seed a project's commands and services from what the scan found, without
/// adding one that is already there.
pub fn seed_runs(
    conn: &Connection,
    node_id: i64,
    root: &Path,
    found: &[crate::scan::DetectedCommand],
) -> Result<(usize, usize), String> {
    let (mut commands, mut services) = (0, 0);
    for d in found {
        let cwd = if d.dir.trim().is_empty() {
            String::new()
        } else {
            root.join(&d.dir).to_string_lossy().to_string()
        };
        if d.service {
            let there: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM services WHERE project_id = ?1 AND command = ?2 AND cwd = ?3",
                    params![node_id, d.command, cwd],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if there == 0 {
                conn.execute(
                    "INSERT INTO services (project_id, name, command, cwd, env, auto_restart, health_port, shell)
                     VALUES (?1, ?2, ?3, ?4, '', 0, NULL, '')",
                    params![node_id, d.name, d.command, cwd],
                )
                .map_err(err)?;
                services += 1;
            }
        } else {
            let there: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM commands WHERE project_id = ?1 AND command = ?2 AND cwd = ?3",
                    params![node_id, d.command, cwd],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if there == 0 {
                conn.execute(
                    "INSERT INTO commands (project_id, group_name, name, command, cwd, shell)
                     VALUES (?1, ?2, ?3, ?4, ?5, '')",
                    params![node_id, d.group, d.name, d.command, cwd],
                )
                .map_err(err)?;
                commands += 1;
            }
        }
    }
    Ok((commands, services))
}

#[derive(Deserialize, Clone, Debug)]
pub struct LinkRequest {
    /// The business space.
    pub business: i64,
    /// The folder the project goes in: a product, or Marketing.
    pub parent: i64,
    pub repo: Repo,
    pub clone_into: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Linked {
    pub node_id: i64,
    pub name: String,
    pub path: String,
    /// Already on this machine: used where it was, not cloned.
    pub reused: bool,
    pub commands: usize,
    pub services: usize,
}

fn link_blocking(app: &tauri::AppHandle, req: LinkRequest) -> Result<Linked, String> {
    let db = app.state::<Db>();
    let key = repo_key(if req.repo.clone_url.is_empty() { &req.repo.html_url } else { &req.repo.clone_url });
    if key.is_empty() || req.repo.name.trim().is_empty() {
        return Err("That repository has no address to link.".into());
    }

    // Already a project somewhere? Then that clone is the one.
    let paths: Vec<String> = {
        let conn = db.0.lock().unwrap();
        let mut st = conn
            .prepare("SELECT path FROM nodes WHERE kind = 'project' AND path IS NOT NULL AND path <> ''")
            .map_err(err)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.flatten().collect()
    };
    let known = paths
        .into_iter()
        .find(|p| origin_of(Path::new(p)).map(|o| repo_key(&o) == key).unwrap_or(false));

    let target = PathBuf::from(req.clone_into.trim()).join(&req.repo.name);
    let (path, reused) = match known {
        Some(p) => (PathBuf::from(p), true),
        None if target.join(".git").is_dir()
            && origin_of(&target).map(|o| repo_key(&o) == key).unwrap_or(false) =>
        {
            (target, true)
        }
        None => {
            if req.clone_into.trim().is_empty() {
                return Err("Choose a folder to clone into.".into());
            }
            if example_mode() {
                make_example_repo(&target, &req.repo)?;
            } else {
                std::fs::create_dir_all(req.clone_into.trim()).map_err(err)?;
                crate::setup::clone_now(app.clone(), req.repo.clone_url.clone(), req.clone_into.trim().to_string())?;
            }
            (target, false)
        }
    };
    let path_str = path.to_string_lossy().to_string();

    let name = crate::business::folder_name(&req.repo.name);
    let existing: Option<i64> = {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT id FROM nodes WHERE parent_id = ?1 AND name = ?2 COLLATE NOCASE",
            params![req.parent, name],
            |r| r.get(0),
        )
        .ok()
    };
    let node_id = match existing {
        Some(id) => id,
        None => crate::vault::vault_create(db.clone(), Some(req.parent), name.clone())?.id,
    };
    crate::vault::vault_set_meta(
        db.clone(),
        node_id,
        Some("Project".into()),
        Some(path_str.clone()),
        None,
        (!req.repo.description.trim().is_empty()).then(|| req.repo.description.trim().to_string()),
    )?;

    let found = crate::scan::scan_project(path_str.clone()).unwrap_or_default();
    let (commands, services) = {
        let conn = db.0.lock().unwrap();
        seed_runs(&conn, node_id, &path, &found)?
    };
    crate::activity::record(
        app,
        "space",
        format!("{} linked", req.repo.full_name),
        format!(
            "{} · {} command{}, {} service{}",
            if reused { "used where it already was" } else { "cloned" },
            commands,
            if commands == 1 { "" } else { "s" },
            services,
            if services == 1 { "" } else { "s" }
        ),
        true,
        Some(req.business),
    );
    Ok(Linked { node_id, name, path: path_str, reused, commands, services })
}

/// Link one repository to a product (or to Marketing) as a project.
#[tauri::command]
pub async fn business_link_repo(app: tauri::AppHandle, req: LinkRequest) -> Result<Linked, String> {
    tauri::async_runtime::spawn_blocking(move || link_blocking(&app, req))
        .await
        .map_err(|e| format!("the link did not finish: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_address_github_hands_out_names_the_same_repository() {
        assert_eq!(repo_key("https://github.com/innotrack/rfid-gateway.git"), "innotrack/rfid-gateway");
        assert_eq!(repo_key("git@github.com:Innotrack/rfid-gateway.git"), "innotrack/rfid-gateway");
        assert_eq!(repo_key("https://github.com/innotrack/rfid-gateway/"), "innotrack/rfid-gateway");
    }

    #[test]
    fn a_project_gets_its_commands_and_services_once() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::db::CORE_SCHEMA).unwrap();
        crate::db::migrate(&c);
        c.execute("INSERT INTO nodes (id, parent_id, kind, name, rel_path) VALUES (9, NULL, 'project', 'api', 'api')", [])
            .unwrap();
        let found = vec![
            crate::scan::DetectedCommand { name: "dev".into(), command: "npm run dev".into(), group: "npm".into(), manager: "npm".into(), dir: String::new(), service: true },
            crate::scan::DetectedCommand { name: "test".into(), command: "npm test".into(), group: "npm".into(), manager: "npm".into(), dir: "apps/web".into(), service: false },
        ];
        let root = Path::new(r"C:\code\innotrack\api");
        assert_eq!(seed_runs(&c, 9, root, &found).unwrap(), (1, 1));
        assert_eq!(seed_runs(&c, 9, root, &found).unwrap(), (0, 0), "linking again adds nothing");
        let cwd: String = c.query_row("SELECT cwd FROM commands WHERE project_id = 9", [], |r| r.get(0)).unwrap();
        assert!(cwd.ends_with(r"api\apps/web") || cwd.ends_with("apps/web"), "a command in a subfolder runs there: {cwd}");
        let svc_cwd: String = c.query_row("SELECT cwd FROM services WHERE project_id = 9", [], |r| r.get(0)).unwrap();
        assert_eq!(svc_cwd, "", "the project root is the default, left empty");
    }

    #[test]
    fn an_example_repository_is_a_real_git_repository_with_its_origin() {
        let dir = std::env::temp_dir().join(format!("devdeck-example-repo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = example_repos().into_iter().find(|r| r.name == "rfid-gateway").unwrap();
        make_example_repo(&dir, &repo).unwrap();
        assert_eq!(origin_of(&dir).map(|o| repo_key(&o)), Some("innotrack/rfid-gateway".to_string()));
        assert!(make_example_repo(&dir, &repo).is_err(), "never over a folder with something in it");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
