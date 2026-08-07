//! Real-time process dashboard feed: CPU, memory, uptime, and listening
//! ports for every managed service and terminal shell (including their
//! child process trees), emitted every 2 seconds as `stats:update`.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::Arc;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{Emitter, Manager};

use crate::pty::PtyManager;
use crate::services::ServiceManager;

#[derive(Serialize, Clone)]
pub struct ProcStat {
    pub kind: String, // "service" | "terminal" | "detected"
    pub id: i64,
    pub name: String,
    pub pid: u32,
    pub cpu: f32,    // percent (whole tree)
    pub mem_mb: f64, // resident, MB (whole tree)
    pub uptime_secs: u64,
    pub ports: Vec<u16>,
    pub procs: usize, // processes in the tree
    #[serde(default)]
    pub cwd: String, // detected sessions: working dir, to attribute to a space
    #[serde(default)]
    pub tool: String, // detected sessions: inferred dev tool ("vite", "uvicorn"…)
}

/// Recognise a dev server from its process name + full command line, returning
/// a friendly tool label. `None` means "doesn't look like a dev server".
fn dev_tool(name: &str, cmd: &str) -> Option<String> {
    let n = name.to_ascii_lowercase();
    let c = cmd.to_ascii_lowercase();
    let has = |k: &str| c.contains(k);
    if n.starts_with("node") || n.starts_with("deno") || n.starts_with("bun") {
        for (k, label) in [
            ("vite", "vite"),
            ("next", "next"),
            ("nuxt", "nuxt"),
            ("remix", "remix"),
            ("astro", "astro"),
            ("webpack", "webpack"),
            ("react-scripts", "react"),
            ("@angular", "angular"),
            ("gatsby", "gatsby"),
            ("storybook", "storybook"),
            ("wrangler", "wrangler"),
            ("nest", "nest"),
            ("vue-cli-service", "vue"),
        ] {
            if has(k) {
                return Some(label.into());
            }
        }
        return Some(
            if n.starts_with("deno") {
                "deno"
            } else if n.starts_with("bun") {
                "bun"
            } else {
                "node"
            }
            .into(),
        );
    }
    if n.starts_with("python") || n == "py.exe" || n == "py" {
        for (k, label) in [
            ("uvicorn", "uvicorn"),
            ("gunicorn", "gunicorn"),
            ("flask", "flask"),
            ("manage.py", "django"),
            ("django", "django"),
            ("http.server", "python http"),
            ("streamlit", "streamlit"),
            ("fastapi", "fastapi"),
        ] {
            if has(k) {
                return Some(label.into());
            }
        }
        return Some("python".into());
    }
    for (k, label) in [
        ("ruby", "rails"),
        ("rails", "rails"),
        ("php", "php"),
        ("dotnet", "dotnet"),
        ("cargo", "cargo"),
        ("wrangler", "wrangler"),
    ] {
        if n.starts_with(k) {
            return Some(label.into());
        }
    }
    None
}

/// Processes we never surface as detected servers (system + our own).
fn is_system_proc(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "system"
            | "registry"
            | "svchost.exe"
            | "services.exe"
            | "lsass.exe"
            | "wininit.exe"
            | "csrss.exe"
            | "smss.exe"
            | "spoolsv.exe"
            | "winlogon.exe"
            | "msedgewebview2.exe"
            | "devdeck.exe"
            | "explorer.exe"
            | "searchhost.exe"
    )
}

/// pid → listening TCP ports, from one netstat pass.
fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut cmd = Command::new("netstat");
    cmd.args(["-ano", "-p", "TCP"]);
    // Suppress the console window that would otherwise flash every tick.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output();
    if let Ok(out) = out {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() >= 5 && cols[0] == "TCP" && cols[3] == "LISTENING" {
                if let (Some(port), Ok(pid)) = (
                    cols[1]
                        .rsplit(':')
                        .next()
                        .and_then(|p| p.parse::<u16>().ok()),
                    cols[4].parse::<u32>(),
                ) {
                    let ports = map.entry(pid).or_default();
                    if !ports.contains(&port) {
                        ports.push(port);
                    }
                }
            }
        }
    }
    map
}

/// Transitive children of `root` using a parent map built per tick.
fn tree_pids(root: u32, children: &HashMap<u32, Vec<u32>>) -> Vec<u32> {
    let mut out = vec![root];
    let mut stack = vec![root];
    let mut seen: HashSet<u32> = HashSet::new();
    seen.insert(root);
    while let Some(p) = stack.pop() {
        if let Some(kids) = children.get(&p) {
            for &k in kids {
                if seen.insert(k) {
                    out.push(k);
                    stack.push(k);
                }
            }
        }
    }
    out
}

pub fn spawn(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let svc_mgr = app.state::<Arc<ServiceManager>>();
            let pty_mgr = app.state::<Arc<PtyManager>>();

            let services = crate::services::live_pids(&svc_mgr);
            let terminals = crate::pty::live_pids(&pty_mgr);

            // Always refresh: even with nothing of ours running we still scan
            // for foreign dev servers (e.g. one Claude or a script just started).
            sys.refresh_processes(ProcessesToUpdate::All, true);

            // Build parent → children map once.
            let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
            for (pid, proc_) in sys.processes() {
                if let Some(parent) = proc_.parent() {
                    children
                        .entry(parent.as_u32())
                        .or_default()
                        .push(pid.as_u32());
                }
            }
            let ports = listening_ports();

            let mut stats: Vec<ProcStat> = Vec::new();
            let mut collect = |kind: &str, id: i64, name: String, root: u32| {
                let pids = tree_pids(root, &children);
                let mut cpu = 0.0f32;
                let mut mem = 0u64;
                let mut uptime = 0u64;
                let mut plist: Vec<u16> = Vec::new();
                let mut count = 0usize;
                for p in &pids {
                    if let Some(proc_) = sys.process(Pid::from_u32(*p)) {
                        cpu += proc_.cpu_usage();
                        mem += proc_.memory();
                        count += 1;
                        if *p == root {
                            uptime = proc_.run_time();
                        }
                        if let Some(pp) = ports.get(p) {
                            for port in pp {
                                if !plist.contains(port) {
                                    plist.push(*port);
                                }
                            }
                        }
                    }
                }
                plist.sort_unstable();
                stats.push(ProcStat {
                    kind: kind.into(),
                    id,
                    name,
                    pid: root,
                    cpu,
                    mem_mb: mem as f64 / (1024.0 * 1024.0),
                    uptime_secs: uptime,
                    ports: plist,
                    procs: count,
                    cwd: String::new(),
                    tool: String::new(),
                });
            };

            // Every pid that belongs to us (our own tree + managed service /
            // terminal trees) — so we don't report our own children as foreign.
            let mut managed_pids: HashSet<u32> = HashSet::new();
            for p in tree_pids(std::process::id(), &children) {
                managed_pids.insert(p);
            }
            for (_, _, pid) in &services {
                for p in tree_pids(*pid, &children) {
                    managed_pids.insert(p);
                }
            }
            for (_, pid) in &terminals {
                for p in tree_pids(*pid, &children) {
                    managed_pids.insert(p);
                }
            }

            for (id, name, pid) in services {
                collect("service", id, name, pid);
            }
            for (id, pid) in terminals {
                collect("terminal", id as i64, format!("terminal #{id}"), pid);
            }

            // Detected (foreign) sessions: any listener we didn't spawn that
            // looks like a dev server (known tool or a dev-range port).
            for (pid, plist) in &ports {
                if managed_pids.contains(pid) {
                    continue;
                }
                let mut show_ports: Vec<u16> =
                    plist.iter().copied().filter(|p| *p >= 1024).collect();
                if show_ports.is_empty() {
                    continue;
                }
                show_ports.sort_unstable();
                let proc_ = match sys.process(Pid::from_u32(*pid)) {
                    Some(p) => p,
                    None => continue,
                };
                let pname = proc_.name().to_string_lossy().to_string();
                if is_system_proc(&pname) {
                    continue;
                }
                let cmd = proc_
                    .cmd()
                    .iter()
                    .map(|s| s.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ");
                let tool = dev_tool(&pname, &cmd);
                let in_dev_range = show_ports.iter().any(|p| (3000..=9999).contains(p));
                if tool.is_none() && !in_dev_range {
                    continue;
                }
                let cwd = proc_
                    .cwd()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                let label = tool
                    .clone()
                    .unwrap_or_else(|| pname.trim_end_matches(".exe").to_string());
                stats.push(ProcStat {
                    kind: "detected".into(),
                    id: *pid as i64,
                    name: label,
                    pid: *pid,
                    cpu: proc_.cpu_usage(),
                    mem_mb: proc_.memory() as f64 / (1024.0 * 1024.0),
                    uptime_secs: proc_.run_time(),
                    ports: show_ports,
                    procs: 1,
                    cwd,
                    tool: tool.unwrap_or_default(),
                });
            }

            let _ = app.emit("stats:update", stats);
        }
    });
}
