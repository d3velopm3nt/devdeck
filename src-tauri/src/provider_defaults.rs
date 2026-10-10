//! Inherited provider choices are persisted as `default`, never copied overrides.
use crate::aiw::{assistant::ASSISTANT_ID, state::Workspace};
use serde::Serialize;
use std::sync::Arc;
#[derive(Serialize)]
pub struct Defaults {
    pub provider: String,
    pub model: String,
    pub inherited: Vec<String>,
}
#[tauri::command(async)]
pub fn aiw_provider_defaults(ws: tauri::State<Arc<Workspace>>) -> Result<Defaults, String> {
    let docs = ws.convs()?.store().agents();
    let assistant = docs
        .iter()
        .find(|d| d.meta.id == ASSISTANT_ID)
        .ok_or("Assistant not found")?;
    Ok(Defaults {
        provider: assistant.meta.provider.clone(),
        model: assistant.meta.model.clone(),
        inherited: docs
            .iter()
            .filter(|d| d.meta.provider == "default")
            .map(|d| d.meta.id.clone())
            .collect(),
    })
}
#[tauri::command(async)]
pub fn aiw_default_provider_set(
    ws: tauri::State<Arc<Workspace>>,
    provider: String,
    model: String,
) -> Result<(), String> {
    if provider == "mock" || model.trim().is_empty() {
        return Err("Choose and verify a real assistant provider and model.".into());
    }
    ws.set_agent_provider(ASSISTANT_ID, &provider, &model)?;
    let convs = ws.convs()?;
    let store = convs.store();
    for mut doc in store.agents() {
        // Upgrade only previously unconfigured agents. Explicit overrides stay intact.
        if doc.meta.id != ASSISTANT_ID && doc.meta.provider == "mock" {
            doc.meta.provider = "default".into();
            doc.meta.model.clear();
            store.save_agent(&doc)?;
        }
    }
    ws.load_agents()?;
    Ok(())
}
#[tauri::command(async)]
pub fn aiw_agent_use_default(
    ws: tauri::State<Arc<Workspace>>,
    agent_id: String,
) -> Result<(), String> {
    if agent_id == ASSISTANT_ID {
        return Err("The main assistant defines the default.".into());
    }
    let convs = ws.convs()?;
    let store = convs.store();
    let mut doc = store
        .agents()
        .into_iter()
        .find(|d| d.meta.id == agent_id)
        .ok_or("Agent not found")?;
    doc.meta.provider = "default".into();
    doc.meta.model.clear();
    store.save_agent(&doc)?;
    ws.load_agents()?;
    Ok(())
}
