//! Install and sign in via official CLIs. Credentials stay with the CLI.
use crate::cli_setup_model::{auth_mode, ps_literal, CliAction, CliTool};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

#[derive(Serialize)]
pub struct CliStatus {
    tool: CliTool,
    pub installed: bool,
    version: String,
    pub auth: String,
    pub detail: String,
    setup_supported: bool,
}

#[derive(Serialize)]
pub struct SetupPlan {
    pub title: String,
    pub command: String,
    pub shell: String,
    pub cwd: String,
}

/// Native installer locations are checked without relying on a stale app PATH.
pub fn resolve_cli(tool: CliTool) -> String {
    let mut candidates = Vec::<PathBuf>::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin").join(if cfg!(windows) {
            format!("{}.exe", tool.program())
        } else {
            tool.program().to_string()
        }));
    }
    if tool == CliTool::Codex {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/OpenAI/Codex/bin/codex.exe"));
        }
    }
    if let Some(path) = candidates.into_iter().find(|p| p.is_file()) {
        return path.to_string_lossy().into_owned();
    }
    crate::mcp::resolve_program(tool.program())
}

/// Probes have no interactive input and a deadline. Drain both pipes to avoid
/// deadlocking a CLI that writes a warning before answering.
pub fn cli_command(program: &str, args: &[String]) -> Command {
    #[cfg(windows)]
    {
        let script = format!(
            "& {} {}",
            ps_literal(program),
            args.iter()
                .map(|a| ps_literal(a))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &format!("$ErrorActionPreference = 'Stop'; try {{ {script}; exit $LASTEXITCODE }} catch {{ exit 1 }}")]);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(program);
        c.args(args);
        c
    }
}

fn probe(program: &str, args: &[&str]) -> Result<(bool, String), String> {
    let args = args.iter().map(|a| a.to_string()).collect::<Vec<_>>();
    let mut cmd = cli_command(program, &args);
    crate::subscription_model::clear_api_environment(&mut cmd);
    let output =
        crate::subscription_process::run(&mut cmd, None, Duration::from_secs(8), &|| false)?;
    Ok((
        output.success,
        if output.stdout.trim().is_empty() {
            output.stderr
        } else {
            output.stdout
        },
    ))
}

#[tauri::command(async)]
pub fn cli_setup_status(tool: CliTool) -> CliStatus {
    let program = resolve_cli(tool);
    let version = probe(&program, &["--version"]);
    let mut result = CliStatus {
        tool,
        installed: false,
        version: String::new(),
        auth: "signed-out".into(),
        detail: "CLI not installed or could not be started".into(),
        setup_supported: cfg!(windows),
    };
    match version {
        Ok((true, text)) => {
            result.installed = true;
            result.version = text
                .lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(100)
                .collect();
        }
        Err(message) => {
            result.detail = message;
            return result;
        }
        _ => return result,
    }
    match probe(&program, tool.status_args()) {
        Ok((ok, text)) => {
            result.auth = auth_mode(tool, ok, &text).into();
            result.detail = match result.auth.as_str() {
                "subscription" => "Signed in with your subscription. Usage shares your provider's plan limits.",
                "api" => "API billing is active. Sign in with your subscription to use your plan.",
                "signed-out" => "Installed. Sign in to connect your subscription.",
                _ => "Installed, but the billing mode could not be verified. Check the CLI account settings.",
            }.into();
        }
        Err(message) => {
            result.auth = "unknown".into();
            result.detail = message;
        }
    }
    result
}

/// The frontend gets a fixed, inspectable command, not credentials. Execution
/// uses the existing interactive terminal, including browser login prompts.
#[tauri::command(async)]
pub fn cli_setup_plan(tool: CliTool, action: CliAction) -> Result<SetupPlan, String> {
    if !cfg!(windows) {
        return Err(
            "In-app CLI setup currently supports Windows. Use the provider's installer on this OS."
                .into(),
        );
    }
    let cwd = dirs::home_dir()
        .ok_or("Home directory unavailable")?
        .to_string_lossy()
        .into_owned();
    let script = match action {
        CliAction::Install => format!(
            "$ErrorActionPreference = 'Stop'; try {{ Invoke-RestMethod {} | Invoke-Expression; Write-Host 'Installer finished. Check status in DevDeck to verify installation.' }} catch {{ Write-Error $_; exit 1 }}",
            ps_literal(tool.installer())
        ),
        CliAction::SignIn => {
            let status = cli_setup_status(tool);
            if !status.installed { return Err("Install the CLI before signing in".into()); }
            // Process-only removal prevents environment API credentials from
            // selecting API billing during the subscription login ceremony.
            let remove = match tool {
                CliTool::ClaudeCode => "Remove-Item Env:ANTHROPIC_API_KEY,Env:ANTHROPIC_AUTH_TOKEN,Env:CLAUDE_CODE_OAUTH_TOKEN -ErrorAction SilentlyContinue;",
                CliTool::Codex => "Remove-Item Env:OPENAI_API_KEY,Env:CODEX_ACCESS_TOKEN -ErrorAction SilentlyContinue;",
            };
            format!("{remove} & {} {}; if ($LASTEXITCODE -ne 0) {{ Write-Host 'Sign-in was not completed. Retry from DevDeck.'; exit $LASTEXITCODE }}; Write-Host 'Login command finished. Check status in DevDeck to verify your subscription.'", ps_literal(&resolve_cli(tool)), tool.login_args().join(" "))
        }
    };
    Ok(SetupPlan {
        title: format!(
            "{} — {}",
            tool.label(),
            match action {
                CliAction::Install => "install",
                CliAction::SignIn => "sign in",
            }
        ),
        command: format!("powershell.exe -NoProfile -Command {}", ps_literal(&script)),
        shell: "powershell.exe".into(),
        cwd,
    })
}
