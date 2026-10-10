//! Bounded CLI I/O with cancellation and process-tree cleanup.
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub fn run(
    cmd: &mut Command,
    input: Option<String>,
    timeout: Duration,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> Result<Output, String> {
    if cancelled() {
        return Err("Subscription request cancelled.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            "Could not start the subscription CLI. Install it from Providers and retry.".to_string()
        })?;
    let pid = child.id();
    let (send, receive) = mpsc::channel();
    for (kind, stream) in [
        (
            "stdout",
            Box::new(child.stdout.take().unwrap()) as Box<dyn Read + Send>,
        ),
        (
            "stderr",
            Box::new(child.stderr.take().unwrap()) as Box<dyn Read + Send>,
        ),
    ] {
        let send = send.clone();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = stream.take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes);
            let _ = send.send((
                kind,
                result.is_ok() && bytes.len() <= 2 * 1024 * 1024,
                String::from_utf8_lossy(&bytes).into_owned(),
            ));
        });
    }
    if let Some(input) = input {
        let send = send.clone();
        let mut stdin = child.stdin.take().unwrap();
        std::thread::spawn(move || {
            let ok = stdin.write_all(input.as_bytes()).is_ok();
            drop(stdin);
            let _ = send.send(("stdin", ok, String::new()));
        });
    }
    drop(send);
    let start = Instant::now();
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut streams_done = 0;
    let mut status = None;
    let outcome = 'running: loop {
        if cancelled() {
            break Err("Subscription request cancelled.".into());
        }
        if start.elapsed() >= timeout {
            break Err("Subscription request timed out. Check the CLI and retry.".into());
        }
        while let Ok((kind, ok, text)) = receive.try_recv() {
            if !ok {
                break 'running Err(
                    "Subscription CLI I/O failed or exceeded the output limit.".into()
                );
            }
            if kind == "stdout" {
                stdout = text;
                streams_done += 1;
            } else if kind == "stderr" {
                stderr = text;
                streams_done += 1;
            }
        }
        match child.try_wait() {
            Ok(Some(s)) => status = Some(s),
            Ok(None) => {}
            Err(_) => break Err("Subscription CLI process status could not be read.".into()),
        }
        if let Some(s) = status {
            if streams_done == 2 {
                break Ok(Output {
                    success: s.success(),
                    stdout,
                    stderr,
                });
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // CLI children can outlive their parent or retain pipe handles. Clean up
    // the tree on success as well; the CLI is never a persistent background job.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
    outcome
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn drains_stderr_and_reports_nonzero_exit() {
        let mut command = Command::new("sh");
        command.args(["-c", "cat; printf warning >&2; exit 3"]);
        let output = run(
            &mut command,
            Some("fixture prompt".into()),
            Duration::from_secs(2),
            &|| false,
        )
        .unwrap();
        assert!(!output.success);
        assert_eq!(output.stdout, "fixture prompt");
    }
    #[test]
    fn timeout_and_cancellation_kill_a_silent_process() {
        for cancel in [false, true] {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 30"]);
            let start = Instant::now();
            let message = run(&mut command, None, Duration::from_millis(150), &|| {
                cancel && start.elapsed() > Duration::from_millis(50)
            })
            .err()
            .unwrap();
            assert!(message.contains(if cancel { "cancelled" } else { "timed out" }));
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }
}
