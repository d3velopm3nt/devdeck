//! Shared execution rules, independent of desktop APIs for sandbox verification.
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

pub fn scope_allows(scopes: &[i64], node: i64, parents: &[(i64, Option<i64>)]) -> bool {
    if scopes.is_empty() {
        return true;
    }
    let mut current = Some(node);
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id) {
            return false;
        }
        if scopes.contains(&id) {
            return true;
        }
        current = parents.iter().find(|(n, _)| *n == id).and_then(|(_, p)| *p);
    }
    false
}
pub fn task_outcome(ok: bool, wrote_files: bool) -> &'static str {
    if !ok {
        "blocked"
    } else if wrote_files {
        "built"
    } else {
        "needs-review"
    }
}
#[derive(Default)]
struct Active {
    keys: HashSet<String>,
    runs: usize,
}
static ACTIVE: OnceLock<Mutex<Active>> = OnceLock::new();
pub struct RunPermit {
    keys: Vec<String>,
}
impl RunPermit {
    pub fn acquire(keys: Vec<String>) -> Result<Self, String> {
        let mut active = ACTIVE
            .get_or_init(|| Mutex::new(Active::default()))
            .lock()
            .map_err(|e| e.to_string())?;
        // A permit lives for the entire worker/merge operation.
        if active.runs >= 4 {
            return Err(
                "Four workers are already running. Wait for one to finish, then retry.".into(),
            );
        }
        if keys.iter().any(|k| active.keys.contains(k)) {
            return Err("This task or write target already has a running worker. Wait for its receipt before retrying.".into());
        }
        active.keys.extend(keys.iter().cloned());
        active.runs += 1;
        Ok(Self { keys })
    }
}
impl Drop for RunPermit {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.get_or_init(|| Mutex::new(Active::default())).lock() {
            for key in &self.keys {
                active.keys.remove(key);
            }
            active.runs -= 1;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lending_inherits_and_does_not_cross_spaces() {
        let tree = [(1, None), (2, Some(1)), (3, Some(2)), (4, None)];
        assert!(scope_allows(&[1], 3, &tree));
        assert!(!scope_allows(&[1], 4, &tree));
        assert!(!scope_allows(&[99], 1, &[(1, Some(2)), (2, Some(1))]));
    }
    #[test]
    fn outcome_never_claims_acceptance() {
        assert_eq!(task_outcome(false, true), "blocked");
        assert_eq!(task_outcome(false, false), "blocked");
        assert_eq!(task_outcome(true, true), "built");
        assert_eq!(task_outcome(true, false), "needs-review");
    }
    #[test]
    fn permits_hold_until_execution_finishes() {
        let keys = vec!["test-repo:branch".into(), "test-task".into()];
        let permit = RunPermit::acquire(keys.clone()).unwrap();
        assert!(RunPermit::acquire(keys.clone()).is_err());
        drop(permit);
        let first = RunPermit::acquire(keys).unwrap();
        let second = RunPermit::acquire(vec!["test-target-2".into()]).unwrap();
        let third = RunPermit::acquire(vec!["test-target-3".into()]).unwrap();
        let fourth = RunPermit::acquire(vec!["test-target-4".into()]).unwrap();
        assert!(RunPermit::acquire(vec!["test-target-5".into()]).is_err());
        drop((first, second, third, fourth));
        assert!(RunPermit::acquire(vec!["test-target-5".into()]).is_ok());
    }
}
