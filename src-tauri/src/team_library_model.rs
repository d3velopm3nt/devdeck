//! Reusable role assignments. Saving a team grants no execution authority.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Team {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub roles: Vec<Role>,
    #[serde(default)]
    pub revision: u64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Role {
    pub name: String,
    pub worker: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub reports_to: String,
    #[serde(default)]
    pub handoffs: Vec<String>,
    #[serde(default)]
    pub instructions: String,
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
}
pub fn validate(team: &Team) -> Result<(), String> {
    if !valid_id(&team.id)
        || team.name.trim().is_empty()
        || team.roles.is_empty()
        || team.roles.len() > 50
    {
        return Err("Name the team, use a lowercase ID, and assign between 1 and 50 roles.".into());
    }
    let mut seen = HashSet::new();
    for role in &team.roles {
        if !valid_id(&role.name) || !seen.insert(&role.name) || !valid_id(&role.worker) {
            return Err(format!(
                "Role '{}' needs a unique lowercase name and a saved agent.",
                role.name
            ));
        }
    }
    let hierarchical = team
        .roles
        .iter()
        .any(|r| !r.kind.is_empty() || !r.reports_to.is_empty());
    if hierarchical {
        let roots: Vec<_> = team
            .roles
            .iter()
            .filter(|r| r.reports_to.is_empty())
            .collect();
        if roots.len() != 1 || roots[0].kind != "manager" {
            return Err("A team needs exactly one lead manager.".into());
        }
    }
    for role in &team.roles {
        if !role.kind.is_empty()
            && !matches!(role.kind.as_str(), "manager" | "specialist" | "worker")
        {
            return Err("Choose manager, specialist or worker.".into());
        }
        let mut ancestors = HashSet::new();
        ancestors.insert(role.name.as_str());
        let mut parent = role.reports_to.as_str();
        while !parent.is_empty() {
            if !ancestors.insert(parent) {
                return Err("Reporting lines cannot form a cycle.".into());
            }
            let p = team
                .roles
                .iter()
                .find(|r| r.name == parent)
                .ok_or("Reporting manager is missing.")?;
            if p.kind != "manager" {
                return Err("Only managers can have agents reporting to them.".into());
            }
            parent = &p.reports_to;
        }
        let mut targets = HashSet::new();
        for target in &role.handoffs {
            if target == &role.name
                || !targets.insert(target)
                || !team.roles.iter().any(|r| &r.name == target)
            {
                return Err("Handoffs must reference distinct other roles in this team.".into());
            }
        }
        if role.instructions.len() > 20_000 {
            return Err("Team role instructions are limited to 20 KB.".into());
        }
    }
    Ok(())
}
pub fn role_context(team: &Team, role: &Role) -> String {
    let children = team
        .roles
        .iter()
        .filter(|r| r.reports_to == role.name)
        .map(|r| r.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    format!("Team: {}. Role: {} ({}).\nReports to: {}.\nCoordinates: {}.\nHandoff targets: {}.\n{}\nThese are coordination relationships, not extra tools or permissions. Return reports and handoff requests through the workflow coordinator. Do not start other agents or send messages without an available authorized tool.", team.name, role.name, if role.kind.is_empty() { "worker" } else { &role.kind }, if role.reports_to.is_empty() { "Dev" } else { &role.reports_to }, children, role.handoffs.join(", "), role.instructions)
}
pub fn resolve(
    team: &Team,
    definition: &mut crate::workflow_model::Definition,
) -> Result<(), String> {
    validate(team)?;
    // Prepare every assignment first: a missing role must not partially change a workflow.
    let resolved = definition
        .steps
        .iter()
        .map(|s| {
            if s.role.is_empty() {
                return Ok(s.worker.clone());
            }
            team.roles
                .iter()
                .find(|r| r.name == s.role)
                .map(|r| r.worker.clone())
                .ok_or_else(|| {
                    format!(
                        "Team '{}' has no role '{}' for step '{}'. Configure the team in Agents.",
                        team.name, s.role, s.title
                    )
                })
        })
        .collect::<Result<Vec<_>, String>>()?;
    for (step, worker) in definition.steps.iter_mut().zip(resolved) {
        step.worker = worker;
        step.team_context = team
            .roles
            .iter()
            .find(|r| r.name == step.role)
            .map(|r| role_context(team, r))
            .unwrap_or_default();
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hierarchy_rejects_cycles_and_invalid_links() {
        let mut t: Team = serde_json::from_str(r#"{"id":"dev","name":"Dev","roles":[{"name":"lead","worker":"lead","kind":"manager"},{"name":"engineering","worker":"engineer","kind":"manager","reports_to":"lead"},{"name":"qa","worker":"tester","kind":"specialist","reports_to":"engineering","handoffs":["lead"]}]}"#).unwrap();
        assert!(validate(&t).is_ok());
        t.roles[1].reports_to = "engineering".into();
        assert!(validate(&t).unwrap_err().contains("cycle"));
        t.roles[1].reports_to = "qa".into();
        assert!(validate(&t).is_err());
        t.roles[1].reports_to = "lead".into();
        t.roles[2].handoffs = vec!["missing".into()];
        assert!(validate(&t).is_err());
        t.roles[2].handoffs.clear();
        t.roles[2].reports_to.clear();
        assert!(validate(&t).unwrap_err().contains("one lead"));
    }
    #[test]
    fn legacy_teams_load_and_role_context_is_snapshotted() {
        let mut t: Team = serde_json::from_str(
            r#"{"id":"dev","name":"Dev","roles":[{"name":"lead","worker":"builder"}]}"#,
        )
        .unwrap();
        assert!(validate(&t).is_ok());
        t.roles[0].kind = "manager".into();
        t.roles[0].instructions = "Coordinate accepted work".into();
        let mut d = crate::workflow_model::Definition {
            steps: vec![crate::workflow_model::Step {
                role: "lead".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        resolve(&t, &mut d).unwrap();
        assert!(d.steps[0].team_context.contains("Coordinate accepted work"));
        t.roles[0].instructions = "Changed later".into();
        assert!(!d.steps[0].team_context.contains("Changed later"));
        resolve(&t, &mut d).unwrap();
        assert!(d.steps[0].team_context.contains("Changed later"));
    }
    #[test]
    fn mapping_is_atomic_and_saved_runs_are_snapshots() {
        let mut team = Team {
            id: "delivery".into(),
            name: "Delivery".into(),
            roles: vec![Role {
                name: "developer".into(),
                worker: "builder".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut d = crate::workflow_model::Definition {
            steps: vec![
                crate::workflow_model::Step {
                    role: "developer".into(),
                    worker: "old".into(),
                    ..Default::default()
                },
                crate::workflow_model::Step {
                    role: "tester".into(),
                    worker: "old".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert!(resolve(&team, &mut d).unwrap_err().contains("tester"));
        assert_eq!(d.steps[0].worker, "old");
        team.roles.push(Role {
            name: "tester".into(),
            worker: "qa".into(),
            ..Default::default()
        });
        resolve(&team, &mut d).unwrap();
        team.roles[0].worker = "replacement".into();
        assert_eq!(d.steps[0].worker, "builder");
        resolve(&team, &mut d).unwrap();
        assert_eq!(d.steps[0].worker, "replacement");
    }
    #[test]
    fn rejects_ambiguous_roles_and_path_ids() {
        assert!(!valid_id("../agent"));
        let mut t = Team {
            id: "team".into(),
            name: "Team".into(),
            roles: vec![Role {
                name: "qa".into(),
                worker: "tester".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(validate(&t).is_ok());
        t.roles.push(t.roles[0].clone());
        assert!(validate(&t).is_err());
    }
}
