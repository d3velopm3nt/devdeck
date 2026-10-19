//! Conversations reference existing work; reports stay in their source records.
use crate::db::Db;
use std::collections::BTreeMap;
#[derive(Clone)]
pub struct Subject { pub id: String, pub title: String, pub node: i64, pub source: String, pub context: String }
pub fn subjects(db: &Db) -> Result<Vec<Subject>, String> {
    let records = crate::work_records::all(db)?;
    let mut items = BTreeMap::new();
    let intake = crate::issue_monitor::view(db)?;
    for source in &intake.sources {
        for issue in &source.items {
            if issue.get("pull_request").is_some() || issue["state"].as_str() != Some("open") { continue; }
            let Some(number) = issue["number"].as_u64() else { continue };
            let title = issue["title"].as_str().unwrap_or("GitHub issue").to_string();
            let url = format!("https://github.com/{}/issues/{number}",source.repository);
            let id = records.iter().find(|r|r.source_url==url).map(|r|r.id.clone()).unwrap_or_else(||format!("github:{}:{number}",source.repository.to_lowercase()));
            let node = intake.bindings.iter().find(|b|b.repository==source.repository).map(|b|b.node).unwrap_or(0);
            let text = format!("Issue: {title}\n{url}\n\n{}",issue["body"].as_str().unwrap_or(""));
            items.insert(id.clone(),Subject{id,title,node,source:text.clone(),context:text});
        }
    }
    for r in &records {
        let text = format!("Work item: {}\n{}\n\n{}\nAcceptance: {}",r.title,r.source_url,r.description,r.acceptance);
        items.insert(r.id.clone(),Subject{id:r.id.clone(),title:r.title.clone(),node:r.node,source:text.clone(),context:text});
    }
    let snapshot = crate::folder_workflows::snapshot(db);
    if snapshot["warnings"].as_array().is_some_and(|w|!w.is_empty()) { return Err("Some workflow records could not be read. Refresh work before opening its conversations.".into()); }
    for entry in snapshot["items"].as_array().into_iter().flatten() {
        let d = &entry["definition"];
        let url = d["ticket_url"].as_str().unwrap_or("");
        if url.is_empty() { continue; }
        let node = entry["node"].as_i64().unwrap_or(0);
        let id = records.iter().find(|r|r.source_url==url).map(|r|r.id.clone()).or_else(|| crate::github_completion::issue(url).ok().map(|(repo,n)|format!("github:{}:{n}",repo.to_lowercase())));
        let Some(id) = id else { continue };
        let title = d["title"].as_str().unwrap_or("Work item").to_string();
        let item = items.entry(id.clone()).or_insert_with(||Subject{id,title:title.clone(),node,source:format!("Issue: {title}\n{url}"),context:format!("Issue: {title}\n{url}")});
        item.context.push_str(&format!("\nRecorded plan: {title}\n{}",serde_json::to_string(&d["steps"]).map_err(|e|e.to_string())?));
    }
    Ok(items.into_values().collect())
}
