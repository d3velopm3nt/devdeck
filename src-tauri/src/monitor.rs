//! Real-time process dashboard feed: CPU, memory, uptime, and listening
//! ports for every managed service and terminal shell (including their
//! child process trees), emitted every 2 seconds as `stats:update`.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
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

/// `AF_INET` and `AF_INET6`, from `ws2def.h`.
///
/// Spelled out rather than pulling the whole WinSock module in for two
/// integers; they are fixed by the ABI and cannot change.
#[cfg(windows)]
const AF_INET: u32 = 2;
#[cfg(windows)]
const AF_INET6: u32 = 23;

/// A port out of a `dwLocalPort`, which Windows keeps in network order inside
/// the low two bytes of a `u32`.
fn port_of(raw: u32) -> u16 {
    u16::from_be_bytes([(raw & 0xff) as u8, ((raw >> 8) & 0xff) as u8])
}

fn add_port(map: &mut HashMap<u32, Vec<u16>>, pid: u32, port: u16) {
    let ports = map.entry(pid).or_default();
    if !ports.contains(&port) {
        ports.push(port);
    }
}

/// One address family's listener table.
///
/// # Safety
/// The documented two-step: ask how much room the table needs, then hand over
/// a buffer that big. The table is read here and nowhere else, so nothing can
/// free it underneath the slice.
#[cfg(windows)]
unsafe fn tcp_listeners(family: u32, map: &mut HashMap<u32, Vec<u16>>) {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6TABLE_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
        TCP_TABLE_OWNER_PID_LISTENER,
    };

    let mut size: u32 = 0;
    // The first call is *expected* to fail: it is how the size is obtained.
    GetExtendedTcpTable(
        std::ptr::null_mut(),
        &mut size,
        0,
        family,
        TCP_TABLE_OWNER_PID_LISTENER,
        0,
    );
    if size == 0 {
        return;
    }
    // A `u32` buffer rather than a `u8` one: every field of both row types is
    // four bytes wide, so this is aligned for them and a byte vector would not
    // be guaranteed to be.
    let mut buf: Vec<u32> = vec![0; (size as usize).div_ceil(4)];
    let rc = GetExtendedTcpTable(
        buf.as_mut_ptr().cast(),
        &mut size,
        0,
        family,
        TCP_TABLE_OWNER_PID_LISTENER,
        0,
    );
    if rc != 0 {
        return;
    }

    if family == AF_INET6 {
        let t = &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
        for r in std::slice::from_raw_parts(t.table.as_ptr(), t.dwNumEntries as usize) {
            add_port(map, r.dwOwningPid, port_of(r.dwLocalPort));
        }
    } else {
        let t = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        for r in std::slice::from_raw_parts(t.table.as_ptr(), t.dwNumEntries as usize) {
            add_port(map, r.dwOwningPid, port_of(r.dwLocalPort));
        }
    }
}

/// pid → listening TCP ports, asked of Windows directly.
///
/// This used to spawn `netstat -ano -p TCP` every two seconds and read its
/// columns back: a process launch per tick, a console window suppressed by a
/// flag so it did not flash, and a text format that is localised — all to get a
/// table the kernel hands over for the asking. `GetExtendedTcpTable` is the
/// same data with none of that, and it covers IPv6, which the parse did not
/// distinguish.
#[cfg(windows)]
fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    unsafe {
        tcp_listeners(AF_INET, &mut map);
        tcp_listeners(AF_INET6, &mut map);
    }
    for ports in map.values_mut() {
        ports.sort_unstable();
    }
    map
}

/// DevDeck is a Windows app; this keeps it compiling and testable elsewhere.
///
/// Reporting no listeners is honest, which the old `netstat -ano` parse was not
/// on another platform: those are Windows flags, so it produced an empty map
/// there too, by accident rather than on purpose.
#[cfg(not(windows))]
fn listening_ports() -> HashMap<u32, Vec<u16>> {
    HashMap::new()
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

/// Is any window of ours on screen?
///
/// The dashboard this feeds is only ever read from a window, so when every one
/// of them is hidden or minimised there is nobody to show a sample to. The
/// widget counts: it is a window of its own and shows live state.
fn on_screen(app: &tauri::AppHandle) -> bool {
    ["main", "widget"].iter().any(|label| {
        app.get_webview_window(label)
            .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
            .unwrap_or(false)
    })
}

pub fn spawn(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));

            // Minimised cost nothing to nobody, and it was reported: this
            // walked every process on the machine every two seconds behind a
            // hidden window. The sleep stays short rather than backing off, so
            // the first sample after you come back is two seconds away and not
            // ten — it is the walk that is skipped, not the clock.
            if !on_screen(&app) {
                continue;
            }

            let svc_mgr = app.state::<Arc<ServiceManager>>();
            let pty_mgr = app.state::<Arc<PtyManager>>();

            let services = crate::services::live_pids(&svc_mgr);
            let terminals = crate::pty::live_pids(&pty_mgr);

            // Always refresh: even with nothing of ours running we still scan
            // for foreign dev servers (e.g. one Claude or a script just started).
            //
            // **Asking for `cmd` and `cwd` is a fix, not a tuning.**
            // `refresh_processes` gathers memory, CPU, disk usage, exe and
            // tasks — and neither the command line nor the working directory.
            // This loop reads both: `dev_tool` matches a command line to label
            // a detected server, and `cwd` is how one gets attributed to a
            // space. Measured on this machine: of 269 processes, **none** had
            // either under the old call and 132 had both under this one. So
            // every foreign server was labelled by its bare process name — a
            // `vite` was a "node" — and none could be placed in a space, with
            // nothing anywhere saying so. Disk usage and tasks are dropped in
            // the same breath, because nothing here reads them.
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing()
                    .with_cpu()
                    .with_memory()
                    .with_cmd(UpdateKind::OnlyIfNotSet)
                    .with_cwd(UpdateKind::OnlyIfNotSet),
            );

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Windows keeps the port in network order inside a `u32`, so reading it
    /// as a number gives 5173 as 13588. Off-by-byte-order here would list
    /// every dev server under a port nobody is using.
    #[test]
    fn a_port_is_read_out_of_network_order() {
        // 5173 = 0x1435. On the wire that is [0x14, 0x35]; read back out of a
        // little-endian u32 that is 0x3514.
        assert_eq!(port_of(0x3514), 5173);
        assert_eq!(port_of(0xB80B), 3000); // 3000 = 0x0BB8
        assert_eq!(port_of(0x5000), 80);
        assert_eq!(port_of(0), 0);
    }

    /// The same port from two families is one port, and the list is sorted so
    /// the UI does not reorder itself between ticks.
    #[test]
    fn a_port_heard_twice_is_listed_once() {
        let mut map = HashMap::new();
        add_port(&mut map, 42, 5173);
        add_port(&mut map, 42, 3000);
        add_port(&mut map, 42, 5173); // again, e.g. once for IPv4 and once for IPv6
        let mut ports = map.remove(&42).expect("the pid is there");
        ports.sort_unstable();
        assert_eq!(ports, vec![3000, 5173]);
    }

    /// The label comes from the command line, which is the thing that was
    /// empty for every process until the refresh started asking for it. A
    /// `vite` that reads as "node" is the symptom to watch for.
    #[test]
    fn a_dev_server_is_named_by_its_command_line() {
        assert_eq!(
            dev_tool("node.exe", "node C:/p/node_modules/vite/bin/vite.js"),
            Some("vite".into())
        );
        assert_eq!(
            dev_tool("python.exe", "python -m uvicorn app:api --reload"),
            Some("uvicorn".into())
        );
        // With no command line the best it can do is the process name — which
        // is exactly what every detected server used to get.
        assert_eq!(dev_tool("node.exe", ""), Some("node".into()));
        assert_eq!(dev_tool("notepad.exe", ""), None);
    }
}
