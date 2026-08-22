//! Scan a project directory for runnable scripts (package.json, Cargo, Make,
//! Go, .NET, composer, pyproject) so they can be added as DevDeck commands in
//! one click. Re-scanning surfaces newly-added scripts; the UI de-dupes against
//! commands that already exist.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct DetectedCommand {
    pub name: String,
    pub command: String,
    pub group: String,
    /// Package manager / toolchain, for the UI badge: npm|pnpm|yarn|bun|cargo|
    /// go|dotnet|make|composer|python.
    pub manager: String,
}

fn dc(name: &str, command: impl Into<String>, group: &str, manager: &str) -> DetectedCommand {
    DetectedCommand {
        name: name.into(),
        command: command.into(),
        group: group.into(),
        manager: manager.into(),
    }
}

/// The JS package manager, inferred from the lockfile (defaults to npm).
fn js_manager(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

fn js_run(mgr: &str, script: &str) -> String {
    match mgr {
        "pnpm" => format!("pnpm {script}"),
        "yarn" => format!("yarn {script}"),
        "bun" => format!("bun run {script}"),
        _ => format!("npm run {script}"),
    }
}

fn read_json(p: &Path) -> Option<serde_json::Value> {
    fs::read_to_string(p)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

/// Detect runnable scripts/commands in a project folder.
#[tauri::command]
pub fn scan_project(dir: String) -> Result<Vec<DetectedCommand>, String> {
    let d = Path::new(&dir);
    if dir.trim().is_empty() || !d.is_dir() {
        return Err(format!("Not a folder: {dir}"));
    }
    let mut out: Vec<DetectedCommand> = Vec::new();

    // package.json scripts (the common case)
    if let Some(json) = read_json(&d.join("package.json")) {
        let mgr = js_manager(d);
        if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
            let group = format!("{mgr} scripts");
            for name in scripts.keys() {
                out.push(dc(name, js_run(mgr, name), &group, mgr));
            }
        }
    }

    // Rust
    if d.join("Cargo.toml").exists() {
        out.push(dc("run", "cargo run", "cargo", "cargo"));
        out.push(dc("build", "cargo build --release", "cargo", "cargo"));
        out.push(dc("test", "cargo test", "cargo", "cargo"));
    }

    // Go
    if d.join("go.mod").exists() {
        out.push(dc("run", "go run .", "go", "go"));
        out.push(dc("build", "go build ./...", "go", "go"));
        out.push(dc("test", "go test ./...", "go", "go"));
    }

    // .NET
    let has_dotnet = fs::read_dir(d)
        .map(|rd| {
            rd.flatten().any(|e| {
                matches!(
                    e.path().extension().and_then(|x| x.to_str()),
                    Some("csproj") | Some("fsproj") | Some("sln")
                )
            })
        })
        .unwrap_or(false);
    if has_dotnet {
        out.push(dc("run", "dotnet run", "dotnet", "dotnet"));
        out.push(dc("build", "dotnet build", "dotnet", "dotnet"));
    }

    // Makefile targets (top-level, non-hidden)
    if let Ok(txt) = fs::read_to_string(d.join("Makefile")) {
        for line in txt.lines() {
            if line.starts_with(' ') || line.starts_with('\t') {
                continue;
            }
            if let Some(idx) = line.find(':') {
                let target = line[..idx].trim();
                if !target.is_empty()
                    && !target.starts_with('.')
                    && target
                        .chars()
                        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
                {
                    out.push(dc(target, format!("make {target}"), "make", "make"));
                }
            }
        }
    }

    // composer scripts
    if let Some(json) = read_json(&d.join("composer.json")) {
        if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
            for name in scripts.keys() {
                out.push(dc(
                    name,
                    format!("composer run-script {name}"),
                    "composer",
                    "composer",
                ));
            }
        }
    }

    // Python entry points ([project.scripts] / [tool.poetry.scripts])
    if let Ok(txt) = fs::read_to_string(d.join("pyproject.toml")) {
        let mut in_scripts = false;
        for line in txt.lines() {
            let l = line.trim();
            if l.starts_with('[') {
                in_scripts = l == "[project.scripts]" || l == "[tool.poetry.scripts]";
                continue;
            }
            if in_scripts {
                if let Some(eq) = l.find('=') {
                    let name = l[..eq].trim().trim_matches('"');
                    if !name.is_empty() {
                        out.push(dc(name, format!("python -m {name}"), "python", "python"));
                    }
                }
            }
        }
    }

    Ok(out)
}
