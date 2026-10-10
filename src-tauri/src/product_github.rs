//! Product GitHub setup; remote creation is an explicit user action.
use crate::{
    db::Db,
    visibility::{github_get, github_request},
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
fn owner_valid(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub url: String,
}
fn graphql(query: &str, variables: serde_json::Value) -> Result<serde_json::Value, String> {
    let result = github_request(
        "graphql",
        "POST",
        Some(serde_json::json!({"query":query,"variables":variables})),
    )?;
    if result.get("errors").is_some() {
        return Err("GitHub Projects access failed. Reading needs read:project; creation needs project scope, or equivalent GitHub App permissions. No Project connection was saved.".into());
    }
    Ok(result["data"].clone())
}
fn owner_info(owner: &str) -> Result<serde_json::Value, String> {
    if !owner_valid(owner) {
        return Err("Choose a GitHub account or organisation.".into());
    }
    github_get(&format!("users/{owner}"))
}
#[tauri::command(async)]
pub fn product_github_projects(owner: String) -> Result<Vec<Project>, String> {
    let info = owner_info(&owner)?;
    let kind = if info["type"] == "Organization" {
        "organization"
    } else {
        "user"
    };
    let query = format!("query($login:String!,$after:String){{{kind}(login:$login){{projectsV2(first:100,after:$after){{nodes{{id title url}} pageInfo{{hasNextPage endCursor}}}}}}}}");
    let mut after = serde_json::Value::Null;
    let mut projects = vec![];
    for _ in 0..10 {
        let data = graphql(&query, serde_json::json!({"login":owner,"after":after}))?;
        let connection = &data[kind]["projectsV2"];
        let rows = connection["nodes"]
            .as_array()
            .ok_or("Projects could not be read.")?;
        for row in rows {
            projects.push(serde_json::from_value(row.clone()).map_err(|e| e.to_string())?);
        }
        if connection["pageInfo"]["hasNextPage"] != true {
            return Ok(projects);
        }
        after = connection["pageInfo"]["endCursor"].clone();
    }
    Err("Too many Projects to list. Use an existing connection in Advanced connections.".into())
}
#[tauri::command(async)]
pub fn product_github_create_project(owner: String, title: String) -> Result<Project, String> {
    if title.trim().is_empty() || title.len() > 200 {
        return Err("Give the Project a short name.".into());
    }
    let info = owner_info(&owner)?;
    let data = graphql("mutation($owner:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,title:$title}){projectV2{id title url}}}", serde_json::json!({"owner":info["node_id"],"title":title.trim()}))?;
    serde_json::from_value(data["createProjectV2"]["projectV2"].clone()).map_err(|e| e.to_string())
}
#[tauri::command(async)]
pub fn product_github_create_repo(
    owner: String,
    name: String,
) -> Result<crate::business_code::Repo, String> {
    if !crate::visibility_model::repository_valid(&format!("{owner}/{name}")) {
        return Err(
            "Use a repository name containing letters, numbers, dots, hyphens or underscores."
                .into(),
        );
    }
    let info = owner_info(&owner)?;
    let endpoint = if info["type"] == "Organization" {
        format!("orgs/{owner}/repos")
    } else {
        let me = github_get("user")?;
        if me["login"].as_str().map(|s| s.eq_ignore_ascii_case(&owner)) != Some(true) {
            return Err("You can only create repositories on your own user account or an authorised organisation.".into());
        }
        "user/repos".into()
    };
    let data = github_request(
        &endpoint,
        "POST",
        Some(serde_json::json!({"name":name,"private":true,"auto_init":true})),
    )?;
    repo_from_json(data)
}
fn repo_from_json(v: serde_json::Value) -> Result<crate::business_code::Repo, String> {
    let full_name = v["full_name"]
        .as_str()
        .ok_or("Repository response is missing its name")?
        .to_string();
    Ok(crate::business_code::Repo {
        full_name,
        name: v["name"].as_str().unwrap_or("").into(),
        owner: v["owner"]["login"].as_str().unwrap_or("").into(),
        description: v["description"].as_str().unwrap_or("").into(),
        private: v["private"].as_bool().unwrap_or(true),
        updated_at: v["updated_at"].as_str().unwrap_or("").into(),
        language: v["language"].as_str().unwrap_or("").into(),
        clone_url: v["clone_url"].as_str().unwrap_or("").into(),
        html_url: v["html_url"].as_str().unwrap_or("").into(),
    })
}
#[tauri::command]
pub async fn product_github_connect(
    app: tauri::AppHandle,
    business: i64,
    product: i64,
    repository: String,
    project_url: String,
) -> Result<crate::business_code::Linked, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !crate::visibility_model::repository_valid(&repository) {
            return Err("Choose a repository.".into());
        }
        let db = app.state::<Db>();
        {
            let conn = db.conn();
            let view = crate::business::view(&conn, business)?;
            if !view
                .meta
                .items
                .iter()
                .any(|i| i.field == "product" && i.node_id == product && i.state != "declined")
            {
                return Err("Choose a product in this business.".into());
            }
        }
        let repo = repo_from_json(github_get(&format!("repos/{repository}"))?)?;
        if !project_url.is_empty() {
            let owner = &repo.owner;
            let allowed = [
                format!("https://github.com/users/{owner}/projects/"),
                format!("https://github.com/orgs/{owner}/projects/"),
            ];
            if !allowed.iter().any(|prefix| {
                project_url
                    .strip_prefix(prefix)
                    .map(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
                    .unwrap_or(false)
            }) {
                return Err("Choose a Project belonging to the repository owner.".into());
            }
        }
        let clone_into = crate::business_code::clone_folder(&db.conn(), business)?;
        let linked = crate::business_code::link_blocking(
            &app,
            crate::business_code::LinkRequest {
                business,
                parent: product,
                repo,
                clone_into,
            },
        )?;
        crate::visibility::set_project_url(&db, &repository, &project_url)?;
        Ok(linked)
    })
    .await
    .map_err(|e| e.to_string())?
}
