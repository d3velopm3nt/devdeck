//! Reviewable team proposals. Creation is atomic and never starts execution.
use serde::{Deserialize, Serialize};
use crate::{agent_library, team_library_model::{Team, Role}, workers::{Worker, WorkerMeta}};
use rusqlite::OptionalExtension;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Member {
    pub role: String,
    pub name: String,
    pub kind: String,
    #[serde(default)] pub reports_to: String,
    #[serde(default)] pub instructions: String,
    #[serde(default)] pub worker: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub id: String,
    pub name: String,
    #[serde(default)] pub description: String,
    pub members: Vec<Member>,
    #[serde(default)] pub connection: Option<Connection>,
    #[serde(default)] pub target: Option<Target>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target { pub id: String, pub revision: u64 }

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connection { pub provider: String, pub model: String }

pub fn build(root: &std::path::Path, proposal: Proposal) -> Result<Team, String> {
    if proposal.id.len() > 36 || proposal.name.len() > 200 || proposal.description.len() > 20000 || proposal.members.iter().any(|m| m.role.len() > 40 || m.name.trim().is_empty() || m.name.len() > 200 || m.instructions.len() > 20000) {
        return Err("The proposal has invalid names or exceeds the size limit.".into());
    }
    let request = serde_json::to_string(&proposal).map_err(|e| e.to_string())?;
    let mut db = crate::personal_library::team_connection(root)?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let previous: Option<(String,String)> = tx.query_row("SELECT request,result FROM team_build_requests WHERE id=?1", [&proposal.id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
    if let Some((original, result)) = previous {
        if original != request { return Err("This proposal was already built. Start a new discussion to create another team.".into()); }
        return serde_json::from_str(&result).map_err(|e| e.to_string());
    }
    let mut previous_roles = Vec::new();
    let member_roles: std::collections::HashSet<_> = proposal.members.iter().map(|m| m.role.clone()).collect();
    let (team_id,revision) = if let Some(target) = &proposal.target {
        let raw:Option<String>=tx.query_row("SELECT definition FROM reusable_teams WHERE id=?1",[&target.id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let existing:Team=serde_json::from_str(&raw.ok_or("The team was removed. Reload before saving.")?).map_err(|e|e.to_string())?;
        if existing.revision != target.revision { return Err("This team changed. Reload it and review a fresh proposal before saving.".into()); }
        previous_roles = existing.roles;
        (target.id.clone(),existing.revision+1)
    } else { (proposal.id.clone(),1) };
    let mut team = Team { id:team_id, name: proposal.name, description: proposal.description, revision, roles: vec![] };
    for member in proposal.members {
        let handle = if member.worker.is_empty() { format!("{}-{}", proposal.id, member.role) } else { member.worker.clone() };
        let handoffs = previous_roles.iter().find(|r| r.name == member.role).map(|r| r.handoffs.iter().filter(|name| member_roles.contains(*name)).cloned().collect()).unwrap_or_default();
        team.roles.push(Role { name: member.role, worker: handle.clone(), kind: member.kind.clone(), reports_to: member.reports_to, instructions: if member.worker.is_empty() { String::new() } else { member.instructions.clone() }, handoffs });
        if member.worker.is_empty() {
            let worker = Worker { meta: WorkerMeta { handle, name: member.name, category: if member.kind == "specialist" { "specialist" } else { "worker" }.into(), profile: "Custom".into(), what: team.description.clone(), runner: "claude-code".into(), model: "sonnet".into(), writes: "branch".into(), minutes: 20, usd: 2.0, created_at: crate::aiw::events::now_iso(), ..Default::default() }, body: member.instructions };
            let definition = if let Some(connection) = &proposal.connection {
                if connection.provider.trim().is_empty() || connection.model.trim().is_empty() || matches!(connection.provider.as_str(), "mock" | "scripted" | "claude-code") { return Err("Choose a model connection for new agents.".into()); }
                let doc = crate::aiw::deck::Doc { meta: crate::aiw::personal::AgentMeta {
                    id: worker.meta.handle.clone(), name:worker.meta.name.clone(), role:member.kind.clone(), provider:connection.provider.clone(), model:connection.model.clone(), skills:vec![], builtin:false,
                    permissions:[("files","read"),("git","read"),("knowledge","full"),("terminal","approval"),("tests","approval"),("process","approval")].into_iter().map(|(k,v)|(k.into(),v.into())).collect(),
                }, body:worker.body.clone() };
                team.roles.last_mut().unwrap().worker = format!("agent:{}", doc.meta.id);
                agent_library::from_runtime(&doc)?
            } else { agent_library::from_worker(&worker)? };
            tx.execute("INSERT INTO agent_definitions(id,definition) VALUES (?1,?2)", rusqlite::params![definition.id, serde_json::to_string(&definition).map_err(|e| e.to_string())?]).map_err(|_| "An agent with this identity already exists. Start a new discussion or choose an existing agent.".to_string())?;
        } else {
            let key = member.worker.strip_prefix("agent:").map(|id| format!("runtime:{id}")).unwrap_or_else(|| format!("worker:{}", member.worker));
            let raw: Option<String> = tx.query_row("SELECT definition FROM agent_definitions WHERE id=?1 AND deleted=0", [key], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
            let definition: agent_library::AgentDefinition = serde_json::from_str(&raw.ok_or("A selected agent is no longer available.")?).map_err(|e| e.to_string())?;
            if !matches!(definition.execution.as_str(), "cli" | "model") { return Err("This agent cannot run as a team worker.".into()); }
        }
    }
    crate::team_library_model::validate(&team)?;
    let result = serde_json::to_string(&team).map_err(|e| e.to_string())?;
    let sql=if proposal.target.is_some() { "UPDATE reusable_teams SET definition=?2 WHERE id=?1" } else { "INSERT INTO reusable_teams(id,definition) VALUES (?1,?2)" };
    tx.execute(sql, rusqlite::params![team.id, result]).map_err(|_| "A team with this identity already exists.".to_string())?;
    tx.execute("INSERT INTO team_build_requests(id,request,result) VALUES (?1,?2,?3)", rusqlite::params![proposal.id, request, result]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(team)
}

#[tauri::command(async)]
pub fn team_builder_create(ws: tauri::State<std::sync::Arc<crate::aiw::state::Workspace>>, proposal: Proposal) -> Result<Team, String> {
    let _guard = crate::library::WRITE.lock().map_err(|e| e.to_string())?;
    let store = crate::aiw::personal::PersonalStore::open()?;
    crate::workers::all_workers()?;
    for member in &proposal.members { if !member.worker.is_empty() { crate::personal_library::validate_worker(&member.worker)?; } }
    if let Some(connection) = &proposal.connection {
        if ws.providers.lock().map_err(|e| e.to_string())?.get(&connection.provider).is_none() { return Err("The chosen model connection is unavailable. Open Providers to configure it.".into()); }
    }
    let team = build(store.root(), proposal)?;
    ws.load_agents()?;
    Ok(team)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subscription_teams_reuse_native_agents_and_preserve_the_connection() {
        let root = std::env::temp_dir().join(format!("devdeck-model-team-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut proposal = Proposal {id:"native-team".into(),name:"Native team".into(),description:String::new(),connection:Some(Connection{provider:"chatgpt-subscription".into(),model:"default".into()}),target:None,members:vec![Member{role:"lead".into(),name:"Lead".into(),kind:"manager".into(),reports_to:String::new(),instructions:"Coordinate".into(),worker:String::new()}]};
        let team=build(&root,proposal.clone()).unwrap();
        assert!(team.roles[0].worker.starts_with("agent:"));
        let definitions=agent_library::list(&root).unwrap();
        assert_eq!(definitions[0].execution,"model");
        assert_eq!(definitions[0].configuration["provider"],"chatgpt-subscription");
        proposal.id="second-team".into();proposal.members[0].worker=team.roles[0].worker.clone();
        build(&root,proposal).unwrap();
        assert_eq!(agent_library::list(&root).unwrap().len(),1);
        let mut edit=Proposal{id:"native-edit".into(),name:"Refined team".into(),description:String::new(),connection:None,target:Some(Target{id:team.id.clone(),revision:team.revision}),members:vec![Member{role:"lead".into(),name:"Lead".into(),kind:"manager".into(),reports_to:String::new(),instructions:"Coordinate".into(),worker:team.roles[0].worker.clone()}]};
        let updated=build(&root,edit.clone()).unwrap();
        assert_eq!(updated.revision,2);
        assert_eq!(build(&root,edit.clone()).unwrap().revision,2);
        edit.id="stale-edit".into();
        assert!(matches!(build(&root,edit), Err(error) if error.contains("changed")));
        assert_eq!(agent_library::list(&root).unwrap().len(),1);

        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refinement_preserves_handoffs_between_retained_roles() {
        let root = std::env::temp_dir().join(format!("devdeck-team-handoffs-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let proposal = Proposal { id: "handoff-team".into(), name: "Team".into(), description: String::new(), connection: None, target: None,
            members: vec![Member { role: "lead".into(), name: "Lead".into(), kind: "manager".into(), reports_to: String::new(), instructions: "Coordinate".into(), worker: String::new() }, Member { role: "reviewer".into(), name: "Reviewer".into(), kind: "specialist".into(), reports_to: "lead".into(), instructions: "Review".into(), worker: String::new() }] };
        let mut team = build(&root, proposal.clone()).unwrap();
        team.roles[0].handoffs = vec!["reviewer".into()];
        let db = crate::personal_library::team_connection(&root).unwrap();
        db.execute("UPDATE reusable_teams SET definition=?1 WHERE id=?2", rusqlite::params![serde_json::to_string(&team).unwrap(), team.id]).unwrap();
        drop(db);
        let mut edit = proposal; edit.id = "handoff-edit".into(); edit.target = Some(Target { id: team.id, revision: team.revision });
        for (member, role) in edit.members.iter_mut().zip(team.roles.iter()) { member.worker = role.worker.clone(); }
        assert_eq!(build(&root, edit).unwrap().roles[0].handoffs, vec!["reviewer"]);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_teams_migrate_once_and_keep_updated_revisions() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("devdeck-team-migration-{nonce}"));
        std::fs::create_dir_all(root.join("library")).unwrap();
        let legacy = Team { id:"existing".into(), name:"Existing team".into(), revision:7, ..Default::default() };
        std::fs::write(root.join("library/teams.json"), serde_json::to_vec(&vec![legacy.clone()]).unwrap()).unwrap();
        {
            let db = crate::personal_library::team_connection(&root).unwrap();
            let mut edited = legacy; edited.revision = 8; edited.name = "Edited team".into();
            db.execute("UPDATE reusable_teams SET definition=?1 WHERE id='existing'", [serde_json::to_string(&edited).unwrap()]).unwrap();
        }
        let db = crate::personal_library::team_connection(&root).unwrap();
        let raw: String = db.query_row("SELECT definition FROM reusable_teams WHERE id='existing'", [], |r| r.get(0)).unwrap();
        let restored: Team = serde_json::from_str(&raw).unwrap();
        assert_eq!(restored.revision,8);
        assert_eq!(restored.name,"Edited team");
        assert!(root.join("library/teams.json").exists());
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creation_is_atomic_idempotent_and_preserves_reused_agents() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("devdeck-build-{nonce}"));
        let proposal = Proposal { id: "test-team".into(), name: "Test team".into(), description: "Review software".into(), connection:None, target:None, members: vec![Member {role:"lead".into(),name:"Lead".into(),kind:"manager".into(),reports_to:String::new(),instructions:"Coordinate".into(),worker:String::new()}] };
        let first = build(&root, proposal.clone()).unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(build(&root, proposal.clone()).unwrap().roles[0].worker, first.roles[0].worker);
        assert_eq!(agent_library::list(&root).unwrap().len(), 1);
        let mut reused = proposal.clone(); reused.id = "reuse-team".into(); reused.members[0].worker = first.roles[0].worker.clone();
        build(&root, reused).unwrap();
        assert_eq!(agent_library::list(&root).unwrap().len(), 1);
        let mut invalid = proposal.clone(); invalid.id = "broken".into(); invalid.members[0].reports_to = "missing".into();
        assert!(build(&root, invalid).is_err());
        assert_eq!(agent_library::list(&root).unwrap().len(), 1, "failed team creation leaves no orphan agents");
        let mut changed = proposal; changed.name = "Different request".into();
        assert!(build(&root, changed).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
