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
