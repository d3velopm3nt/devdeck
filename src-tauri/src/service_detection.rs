//! Conservative matching of saved services to process snapshots.

/// Pick one process tree per service. Overlapping definitions are ambiguous.
pub fn select_roots(candidates: &[(i64, u32, Vec<u32>, u8)]) -> Vec<usize> {
    let mut order: Vec<_> = (0..candidates.len()).collect();
    order.sort_by_key(|&i| {
        (
            std::cmp::Reverse(candidates[i].3),
            std::cmp::Reverse(candidates[i].2.len()),
            candidates[i].1,
        )
    });
    let mut selected: Vec<usize> = Vec::new();
    for i in order {
        let (id, pid, tree, strength) = &candidates[i];
        if candidates
            .iter()
            .any(|(other_id, other_pid, other_tree, other_strength)| {
                id != other_id
                    && other_strength >= strength
                    && (tree.contains(other_pid) || other_tree.contains(pid))
            })
        {
            continue;
        }
        if selected.iter().any(|&j| {
            candidates[j].0 == *id
                || candidates[j].2.contains(pid)
                || tree.contains(&candidates[j].1)
        }) {
            continue;
        }
        selected.push(i);
    }
    selected
}

pub fn same_directory(saved: &str, actual: &str) -> bool {
    fn normalize(path: &str) -> String {
        let path = path.trim().replace('\\', "/");
        let path = path
            .strip_prefix("//?/")
            .unwrap_or(&path)
            .trim_end_matches('/');
        if cfg!(windows) {
            path.to_lowercase()
        } else {
            path.to_string()
        }
    }
    !saved.trim().is_empty() && !actual.trim().is_empty() && normalize(saved) == normalize(actual)
}

fn words(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    for ch in command.chars() {
        if quote == Some(ch) {
            quote = None;
        } else if quote.is_none() && (ch == '"' || ch == '\'') {
            quote = Some(ch);
        } else if ch.is_whitespace() && quote.is_none() {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
        } else {
            token.push(ch);
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    tokens
        .into_iter()
        .map(|s| {
            let s = s.trim_matches(['"', '\'']).replace('\\', "/");
            // npm and pnpm invoke a CLI script rather than preserving argv[0].
            let base = s.rsplit('/').next().unwrap_or(&s);
            match base.to_ascii_lowercase().as_str() {
                "npm-cli.js" | "npm.cmd" => "npm".into(),
                "pnpm.cjs" | "pnpm.cmd" | "pnpm.exe" => "pnpm".into(),
                "yarn.js" | "yarn.cmd" => "yarn".into(),
                "node.exe" | "node" => "node".into(),
                "python.exe" | "python" => "python".into(),
                _ => s,
            }
        })
        .collect()
}

pub fn matches(
    saved_dir: &str,
    command: &str,
    port: Option<u16>,
    cwd: &str,
    cmd: &str,
    ports: &[u16],
) -> bool {
    if !same_directory(saved_dir, cwd) {
        return false;
    }
    // Launch commands can remain alive above a server in a different directory.
    // Their identity remains valid when the server chooses a different port.
    let port_matches = port.is_some_and(|port| ports.contains(&port));
    let expected = words(command);
    let mut actual = words(cmd);
    if let (Some(wanted), Some(executable)) = (expected.first(), actual.first_mut()) {
        if !wanted.contains('/') {
            let name = executable.rsplit('/').next().unwrap_or(executable);
            *executable = if cfg!(windows) && !wanted.ends_with(".exe") {
                name.strip_suffix(".exe").unwrap_or(name).to_string()
            } else {
                name.to_string()
            };
        }
    }
    if expected.is_empty() {
        return port_matches;
    }
    if actual == expected {
        return true;
    }
    // Node package managers have an extra runtime argument. Do not match
    // arbitrary command fragments in an editor, shell, or an echo command.
    port_matches
        || (actual.first().is_some_and(|s| s == "node")
            && expected
                .first()
                .is_some_and(|s| matches!(s.as_str(), "npm" | "pnpm" | "yarn"))
            && actual.get(1..) == Some(expected.as_slice()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_and_child_are_one_service_but_distinct_workers_survive() {
        let candidates = vec![
            (1, 12, vec![12], 1),
            (1, 10, vec![10, 12], 2),
            (2, 20, vec![20], 2),
        ];
        assert_eq!(select_roots(&candidates), vec![1, 2]);
    }

    #[test]
    fn overlapping_definitions_are_not_assigned_arbitrarily() {
        let candidates = vec![(1, 10, vec![10, 12], 2), (2, 12, vec![12], 2)];
        assert!(select_roots(&candidates).is_empty());
    }
    #[test]
    fn port_and_directory_identify_service() {
        assert!(matches(
            "C:/repo/",
            "npm run dev",
            Some(5173),
            "C:/repo",
            "node vite",
            &[5173]
        ));
        assert!(!matches(
            "C:/repo",
            "npm run dev",
            Some(5173),
            "C:/other",
            "node vite",
            &[5173]
        ));
        assert!(!matches(
            "C:/repo",
            "npm run dev",
            Some(5173),
            "C:/repo",
            "npm run preview",
            &[3000]
        ));
    }
    #[test]
    fn workers_without_ports_match_complete_command_tokens() {
        assert!(matches(
            "C:/repo",
            "npm run worker",
            None,
            "C:/repo",
            "node C:/tools/npm-cli.js run worker",
            &[]
        ));
        assert!(!matches(
            "C:/repo",
            "npm run work",
            None,
            "C:/repo",
            "npm run worker",
            &[]
        ));
        assert!(!matches("C:/repo", "", None, "C:/repo", "node", &[]));
    }
    #[test]
    fn unknown_or_sibling_directories_do_not_match() {
        assert!(!matches(
            "",
            "node worker.js",
            Some(3000),
            "",
            "node worker.js",
            &[3000]
        ));
        assert!(!matches(
            "C:/repo",
            "node worker.js",
            None,
            "C:/repo-two",
            "node worker.js",
            &[]
        ));
        assert!(same_directory("C:\\repo\\", "C:/repo"));
    }

    #[test]
    fn command_mentions_are_not_running_services() {
        assert!(!matches(
            "C:/repo",
            "npm run worker",
            None,
            "C:/repo",
            "echo npm run worker",
            &[]
        ));
        assert!(!matches(
            "C:/repo",
            "node worker.js",
            None,
            "C:/repo",
            "editor --title node worker.js",
            &[]
        ));
        assert!(matches(
            "C:/repo",
            "node worker.js",
            None,
            "C:/repo",
            "C:/tools/node.exe worker.js",
            &[]
        ));
    }

    #[test]
    fn quoted_executables_and_arguments_preserve_spaces() {
        assert!(matches(
            "C:/repo",
            "node \"worker tasks.js\"",
            None,
            "C:/repo",
            "\"C:/Program Files/nodejs/node.exe\" \"worker tasks.js\"",
            &[]
        ));
        assert!(!matches(
            "C:/repo",
            "node \"worker tasks.js\"",
            None,
            "C:/repo",
            "node worker tasks.js",
            &[]
        ));
    }

    #[test]
    fn exact_launcher_survives_a_changed_port_and_wins_over_port_inference() {
        assert!(matches(
            "C:/repo",
            "pnpm dev:staging",
            Some(3001),
            "C:/repo",
            "C:/tools/pnpm.exe dev:staging",
            &[]
        ));
        let candidates = vec![(2, 10, vec![10, 12], 2), (3, 12, vec![12], 1)];
        assert_eq!(select_roots(&candidates), vec![0]);
    }
}
