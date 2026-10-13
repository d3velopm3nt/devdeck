//! Fixed provider setup operations and credential-free status parsing.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CliTool {
    ClaudeCode,
    Codex,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CliAction {
    Install,
    SignIn,
}

impl CliTool {
    pub fn program(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude",
            Self::Codex => "codex",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
        }
    }

    pub fn installer(self) -> &'static str {
        match self {
            Self::ClaudeCode => "https://claude.ai/install.ps1",
            Self::Codex => "https://chatgpt.com/codex/install.ps1",
        }
    }

    pub fn login_args(self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode => &["auth", "login"],
            Self::Codex => &["login"],
        }
    }

    pub fn status_args(self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode => &["auth", "status"],
            Self::Codex => &["login", "status"],
        }
    }
}

/// PowerShell single-quoted literal: neither interpolation nor command execution.
pub fn ps_literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// POSIX shell literal; paths may contain spaces, quotes, or shell syntax.
pub fn sh_literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\"'\"'"))
}

/// Linux setup is also usable from the headless harness. No desktop dependency.
pub fn linux_setup_script(tool: CliTool, action: CliAction, program: &str) -> String {
    match action {
        CliAction::Install => {
            let (url, interpreter) = match tool {
                CliTool::Codex => ("https://chatgpt.com/codex/install.sh", "sh"),
                CliTool::ClaudeCode => ("https://claude.ai/install.sh", "bash"),
            };
            // Download first: a failed curl must never look like a successful installer.
            format!("set -eu; installer=$(mktemp); trap 'rm -f \"$installer\"' EXIT; curl -fsSL {} -o \"$installer\"; {} \"$installer\"", sh_literal(url), interpreter)
        }
        CliAction::SignIn => {
            let (remove, args) = match tool {
                CliTool::Codex => (
                    "OPENAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN OPENAI_BASE_URL",
                    "login --device-auth",
                ),
                CliTool::ClaudeCode => (
                    "ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN",
                    "auth login",
                ),
            };
            format!(
                "set -eu; unset {remove}; exec {} {args}",
                sh_literal(program)
            )
        }
    }
}

/// Never return the raw auth response: it can contain account details.
pub fn auth_mode(tool: CliTool, success: bool, output: &str) -> &'static str {
    if !success {
        return "signed-out";
    }
    match tool {
        CliTool::ClaudeCode => {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(output) else {
                return "unknown";
            };
            if v.get("loggedIn").and_then(|x| x.as_bool()) == Some(false) {
                return "signed-out";
            }
            match v.get("authMethod").and_then(|x| x.as_str()) {
                Some("claude.ai" | "oauth_token") => "subscription",
                Some("api_key" | "api_key_helper") => "api",
                Some("none") => "signed-out",
                _ => "unknown",
            }
        }
        CliTool::Codex => {
            if output.contains("Logged in using ChatGPT") {
                "subscription"
            } else if output.contains("Logged in using an API key") {
                "api"
            } else {
                "unknown"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn linux_login_quotes_program_and_removes_api_credentials() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("devdeck-login-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let program = dir.join("codex ' $literal");
        std::fs::write(&program, "#!/bin/sh\n[ -z \"${OPENAI_API_KEY+x}${CODEX_API_KEY+x}${CODEX_ACCESS_TOKEN+x}${OPENAI_BASE_URL+x}\" ] || exit 7\n[ \"$1\" = login ] && [ \"$2\" = --device-auth ]\n").unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        let script =
            linux_setup_script(CliTool::Codex, CliAction::SignIn, program.to_str().unwrap());
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", &script])
            .env("OPENAI_API_KEY", "fixture")
            .env("CODEX_API_KEY", "fixture")
            .env("CODEX_ACCESS_TOKEN", "fixture")
            .env("OPENAI_BASE_URL", "fixture")
            .status()
            .unwrap();
        std::fs::remove_dir_all(dir).unwrap();
        assert!(status.success());
    }

    #[cfg(unix)]
    #[test]
    fn linux_install_propagates_download_failure() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("devdeck-install-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let curl = dir.join("curl");
        std::fs::write(&curl, "#!/bin/sh\nexit 22\n").unwrap();
        std::fs::set_permissions(&curl, std::fs::Permissions::from_mode(0o700)).unwrap();
        let script = linux_setup_script(CliTool::Codex, CliAction::Install, "codex");
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", &script])
            .env("PATH", format!("{}:/usr/bin:/bin", dir.display()))
            .status()
            .unwrap();
        std::fs::remove_dir_all(dir).unwrap();
        assert_eq!(status.code(), Some(22));
    }

    #[test]
    fn does_not_accept_arbitrary_programs_or_actions() {
        assert!(serde_json::from_str::<CliTool>("\"codex;whoami\"").is_err());
        assert!(serde_json::from_str::<CliAction>("\"execute\"").is_err());
    }

    #[test]
    fn quotes_paths_with_powershell_metacharacters() {
        assert_eq!(
            ps_literal("C:\\Users\\O'Brien\\$name`cmd.exe"),
            "'C:\\Users\\O''Brien\\$name`cmd.exe'"
        );
    }

    #[test]
    fn auth_requires_success_and_recognized_billing_mode() {
        assert_eq!(
            auth_mode(CliTool::Codex, false, "Logged in using ChatGPT"),
            "signed-out"
        );
        assert_eq!(
            auth_mode(CliTool::Codex, true, "Logged in using ChatGPT"),
            "subscription"
        );
        assert_eq!(
            auth_mode(CliTool::Codex, true, "Logged in using an API key"),
            "api"
        );
        assert_eq!(
            auth_mode(CliTool::Codex, true, "Unexpected successful response"),
            "unknown"
        );
        assert_eq!(
            auth_mode(
                CliTool::ClaudeCode,
                true,
                r#"{"loggedIn":true,"authMethod":"claude.ai","email":"private"}"#
            ),
            "subscription"
        );
        assert_eq!(
            auth_mode(
                CliTool::ClaudeCode,
                true,
                r#"{"loggedIn":false,"authMethod":"claude.ai"}"#
            ),
            "signed-out"
        );
        assert_eq!(
            auth_mode(CliTool::ClaudeCode, true, r#"{"authMethod":"api_key"}"#),
            "api"
        );
        assert_eq!(auth_mode(CliTool::ClaudeCode, true, "not json"), "unknown");
    }
}
