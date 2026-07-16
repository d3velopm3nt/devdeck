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
    pub kind: String, // "service" | "terminal"
    pub id: i64,
    pub name: String,
    pub pid: u32,
    pub cpu: f32,       // percent (whole tree)
    pub mem_mb: f64,    // resident, MB (whole tree)
    pub uptime_secs: u64,
    pub ports: Vec<u16>,
    pub procs: usize, // processes in the tree
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
                    cols[1].rsplit(':').next().and_then(|p| p.parse::<u16>().ok()),
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
            if services.is_empty() && terminals.is_empty() {
                let _ = app.emit("stats:update", Vec::<ProcStat>::new());
                continue;
            }

            sys.refresh_processes(ProcessesToUpdate::All, true);

            // Build parent → children map once.
            let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
            for (pid, proc_) in sys.processes() {
                if let Some(parent) = proc_.parent() {
                    children.entry(parent.as_u32()).or_default().push(pid.as_u32());
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
                });
            };

            for (id, name, pid) in services {
                collect("service", id, name, pid);
            }
            for (id, pid) in terminals {
                collect("terminal", id as i64, format!("terminal #{id}"), pid);
            }

            let _ = app.emit("stats:update", stats);
        }
    });
}
