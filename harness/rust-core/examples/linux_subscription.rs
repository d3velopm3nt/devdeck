//! Headless Linux smoke test using DevDeck's production CLI protocol.
use devdeck_sandbox_core::{
    cli_setup_model::{self, CliAction, CliTool},
    subscription_model as protocol, subscription_process,
};
use std::{process::Command, time::Duration};
fn main() -> Result<(), String> {
    let action = std::env::args().nth(1).unwrap_or_else(|| "status".into());
    let program = std::env::var("DEVDECK_CODEX_BIN").unwrap_or_else(|_| {
        let local = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .map(|p| p.join(".local/bin/codex"));
        local
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "codex".into())
    });
    if action == "install" || action == "login" {
        let script = cli_setup_model::linux_setup_script(
            CliTool::Codex,
            if action == "install" {
                CliAction::Install
            } else {
                CliAction::SignIn
            },
            &program,
        );
        let status = Command::new("/bin/sh")
            .args(["-c", &script])
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("CLI setup failed; inspect the terminal output.".into())
        };
    }
    if action != "status" && action != "smoke" {
        return Err("Use install, login, status, or smoke".into());
    }
    let mut command = Command::new(&program);
    command.args(["login", "status"]);
    protocol::clear_api_environment(&mut command);
    let result = subscription_process::run(&mut command, None, Duration::from_secs(8), &|| false)?;
    let mode = cli_setup_model::auth_mode(
        CliTool::Codex,
        result.success,
        &format!("{}\n{}", result.stdout, result.stderr),
    );
    println!("Authentication: {mode}");
    if action == "status" {
        return Ok(());
    }
    if mode != "subscription" {
        return Err("Sign in with ChatGPT before the smoke test.".into());
    }
    let dir = std::env::temp_dir().join(format!(
        "devdeck-smoke-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let schema = dir.join("schema.json");
    std::fs::write(&schema, protocol::schema().to_string()).map_err(|e| e.to_string())?;
    let mut command = Command::new(&program);
    command.current_dir(&dir).args(protocol::inference_args(
        CliTool::Codex,
        "default",
        schema.to_str().ok_or("Invalid schema path")?,
    ));
    protocol::clear_api_environment(&mut command);
    let result = subscription_process::run(&mut command, Some("Return a JSON object with message equal to subscription smoke passed and calls equal to an empty array. Do not use tools.".into()), Duration::from_secs(120), &|| false);
    let _ = std::fs::remove_dir_all(dir);
    let output = result?;
    if !output.success {
        return Err("Codex request failed. Check CLI version, login, and plan limits.".into());
    }
    let answer = protocol::final_answer(CliTool::Codex, &output.stdout)?;
    let reply = protocol::decode(&answer, &[])?;
    println!(
        "Verified production subscription protocol: {}",
        reply.message
    );
    Ok(())
}
