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
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Role {
    pub name: String,
    pub worker: String,
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
    Ok(())
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
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mapping_is_atomic_and_saved_runs_are_snapshots() {
        let mut team = Team {
            id: "delivery".into(),
            name: "Delivery".into(),
            roles: vec![Role {
                name: "developer".into(),
                worker: "builder".into(),
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
            }],
            ..Default::default()
        };
        assert!(validate(&t).is_ok());
        t.roles.push(t.roles[0].clone());
        assert!(validate(&t).is_err());
    }
}
