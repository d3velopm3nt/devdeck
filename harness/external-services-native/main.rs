#[path = "../../src-tauri/src/service_detection.rs"]
mod detection;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let pid: u32 = args[1].parse().unwrap();
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );
    if args[2] == "absent" {
        assert!(sys.process(Pid::from_u32(pid)).is_none());
        println!("PASS: external PID {pid} disappeared after exit");
        return;
    }
    let process = sys
        .process(Pid::from_u32(pid))
        .expect("external process must exist");
    let cwd = process.cwd().unwrap().to_string_lossy();
    let cmd = process
        .cmd()
        .iter()
        .map(|a| format!("\"{}\"", a.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        detection::matches(&args[2], &args[3], None, &cwd, &cmd, &[]),
        "cwd={cwd} cmd={cmd}"
    );
    assert!(!detection::matches(
        "C:/unrelated-project",
        &args[3],
        None,
        &cwd,
        &cmd,
        &[]
    ));
    let port: u16 = args[4].parse().unwrap();
    assert!(detection::matches(
        &args[2],
        "npm run dev",
        Some(port),
        &cwd,
        &cmd,
        &[port]
    ));
    assert!(!detection::matches(
        &args[2],
        "different command",
        Some(port),
        &cwd,
        &cmd,
        &[]
    ));
    println!("PASS: external PID {pid} matched saved command and directory; unrelated directory rejected");
    println!("cwd={cwd}; command={cmd}");
    println!("PASS: OS-confirmed listener port {port} matched; missing port rejected");
}
