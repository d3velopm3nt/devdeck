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
}

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
    let mut team = Team { id: proposal.id.clone(), name: proposal.name, description: proposal.description, revision: 1, roles: vec![] };
    for member in proposal.members {
        let handle = if member.worker.is_empty() { format!("{}-{}", team.id, member.role) } else { member.worker.clone() };
        team.roles.push(Role { name: member.role, worker: handle.clone(), kind: member.kind.clone(), reports_to: member.reports_to, instructions: if member.worker.is_empty() { String::new() } else { member.instructions.clone() }, handoffs: vec![] });
        if member.worker.is_empty() {
            let worker = Worker { meta: WorkerMeta { handle, name: member.name, category: if member.kind == "specialist" { "specialist" } else { "worker" }.into(), profile: "Custom".into(), what: team.description.clone(), runner: "claude-code".into(), model: "sonnet".into(), writes: "branch".into(), minutes: 20, usd: 2.0, created_at: crate::aiw::events::now_iso(), ..Default::default() }, body: member.instructions };
            let definition = agent_library::from_worker(&worker)?;
            tx.execute("INSERT INTO agent_definitions(id,definition) VALUES (?1,?2)", rusqlite::params![definition.id, serde_json::to_string(&definition).map_err(|e| e.to_string())?]).map_err(|_| "An agent with this identity already exists. Start a new discussion or choose an existing agent.".to_string())?;
        } else {
            let raw: Option<String> = tx.query_row("SELECT definition FROM agent_definitions WHERE id=?1 AND deleted=0", [format!("worker:{}", member.worker)], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
            let definition: agent_library::AgentDefinition = serde_json::from_str(&raw.ok_or("A selected agent is no longer available.")?).map_err(|e| e.to_string())?;
            if definition.execution != "cli" { return Err("This agent cannot run as a team worker.".into()); }
        }
    }
    crate::team_library_model::validate(&team)?;
    let result = serde_json::to_string(&team).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO reusable_teams(id,definition) VALUES (?1,?2)", rusqlite::params![team.id, result]).map_err(|_| "A team with this identity already exists.".to_string())?;
    tx.execute("INSERT INTO team_build_requests(id,request,result) VALUES (?1,?2,?3)", rusqlite::params![team.id, request, result]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(team)
}

#[tauri::command(async)]
pub fn team_builder_create(proposal: Proposal) -> Result<Team, String> {
    let _guard = crate::library::WRITE.lock().map_err(|e| e.to_string())?;
    let store = crate::aiw::personal::PersonalStore::open()?;
    crate::workers::all_workers()?;
    for member in &proposal.members { if !member.worker.is_empty() { crate::personal_library::validate_worker(&member.worker)?; } }
    build(store.root(), proposal)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let proposal = Proposal { id: "test-team".into(), name: "Test team".into(), description: "Review software".into(), members: vec![Member {role:"lead".into(),name:"Lead".into(),kind:"manager".into(),reports_to:String::new(),instructions:"Coordinate".into(),worker:String::new()}] };
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
