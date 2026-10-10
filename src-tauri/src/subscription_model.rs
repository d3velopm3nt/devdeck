//! Subscription inference protocol. A CLI proposes calls; DevDeck executes them.
use crate::cli_setup_model::CliTool;
use serde::Deserialize;
use serde_json::{json, Value};

pub const CLAUDE: &str = "claude-subscription";
pub const CHATGPT: &str = "chatgpt-subscription";

pub fn tool_for(id: &str) -> Option<CliTool> {
    match id {
        CLAUDE => Some(CliTool::ClaudeCode),
        CHATGPT => Some(CliTool::Codex),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposedCall {
    pub name: String,
    /// Encoded separately so arbitrary tool schemas stay compatible with
    /// both providers' strict structured-output support.
    pub arguments: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub message: String,
    pub calls: Vec<ProposedCall>,
}

pub fn schema() -> Value {
    json!({"type":"object", "additionalProperties":false,
        "properties": {"message":{"type":"string"}, "calls":{"type":"array", "items":{
            "type":"object", "additionalProperties":false,
            "properties":{"name":{"type":"string"},"arguments":{"type":"string"}},
            "required":["name","arguments"]}}}, "required":["message","calls"]})
}

pub fn decode(text: &str, allowed: &[String]) -> Result<Reply, String> {
    let reply: Reply = serde_json::from_str(text).map_err(|_| {
        "The subscription CLI returned an invalid structured answer. No actions were run."
            .to_string()
    })?;
    if reply.message.trim().is_empty() && reply.calls.is_empty() {
        return Err("The subscription CLI returned an empty answer.".into());
    }
    if reply.calls.len() > 32 {
        return Err("The subscription CLI proposed too many calls in one turn.".into());
    }
    for call in &reply.calls {
        if !allowed.contains(&call.name) {
            return Err(format!(
                "Subscription response requested an unavailable tool '{}'. No actions were run.",
                call.name
            ));
        }
        if !serde_json::from_str::<Value>(&call.arguments).is_ok_and(|v| v.is_object()) {
            return Err(format!(
                "Subscription tool '{}' returned invalid arguments. No actions were run.",
                call.name
            ));
        }
    }
    Ok(reply)
}

/// Native tools and inherited customizations are disabled for inference.
/// Work is requested through structured proposals and DevDeck's permission wall.
pub fn inference_args(tool: CliTool, model: &str, schema_path: &str) -> Vec<String> {
    let mut args: Vec<String> = match tool {
        CliTool::ClaudeCode => vec![
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            "",
            "--tools",
            "",
            "--disallowedTools",
            "*",
            "--safe-mode",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
        CliTool::Codex => {
            let mut a: Vec<String> = [
                "exec",
                "--json",
                "--ephemeral",
                "--ignore-user-config",
                "--ignore-rules",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--output-schema",
                schema_path,
            ]
            .into_iter()
            .map(String::from)
            .collect();
            for config in [
                "forced_login_method=\"chatgpt\"",
                "model_provider=\"openai\"",
                "mcp_servers={}",
                "plugins={}",
                "hooks={}",
                "notify=[]",
                "web_search=\"disabled\"",
                "features.shell_tool=false",
                "features.unified_exec=false",
                "features.apps=false",
                "features.hooks=false",
                "features.multi_agent=false",
                "features.browser_use=false",
                "features.browser_use_external=false",
                "features.memories=false",
            ] {
                a.extend(["-c".into(), config.into()]);
            }
            a.push("-".into());
            a
        }
    };
    if tool == CliTool::ClaudeCode {
        args[4] = schema().to_string();
    }
    if !model.trim().is_empty() && model != "default" {
        // Before Codex's stdin marker, which also keeps option parsing clear.
        let index = if tool == CliTool::Codex {
            args.len() - 1
        } else {
            args.len()
        };
        args.splice(index..index, ["--model".into(), model.trim().into()]);
    }
    args
}

pub fn clear_api_environment(cmd: &mut std::process::Command) {
    for key in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "CODEX_ACCESS_TOKEN",
        "OPENAI_BASE_URL",
    ] {
        cmd.env_remove(key);
    }
}

/// Parse successful CLI output, requiring its terminal success event. A partial
/// answer preceding a rate-limit/error never counts as a completed turn.
pub fn final_answer(tool: CliTool, stdout: &str) -> Result<String, String> {
    match tool {
        CliTool::ClaudeCode => {
            let result: Value = serde_json::from_str(stdout)
                .map_err(|_| "Claude returned invalid output".to_string())?;
            if result["is_error"].as_bool() == Some(true)
                || result["subtype"].as_str() != Some("success")
            {
                return Err("Claude did not complete the request. Check account access, plan limits and CLI version.".into());
            }
            if let Some(v) = result.get("structured_output") {
                return Ok(v.to_string());
            }
            result["result"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| "Claude returned no answer".into())
        }
        CliTool::Codex => {
            let mut answer = None;
            let mut complete = false;
            for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
                let v: Value = serde_json::from_str(line)
                    .map_err(|_| "Codex returned invalid event output".to_string())?;
                match v["type"].as_str() {
                    Some("error" | "turn.failed") => return Err("Codex did not complete the request. Check account access, plan limits and CLI version.".into()),
                    Some("turn.completed") => complete = true,
                    Some("item.completed") if v["item"]["type"] == "agent_message" => answer = v["item"]["text"].as_str().map(String::from),
                    Some("item.started" | "item.completed") if matches!(v["item"]["type"].as_str(), Some("command_execution" | "file_change" | "mcp_tool_call" | "web_search")) => return Err("Codex attempted a native tool in inference mode. No proposed DevDeck actions were run.".into()),
                    _ => {}
                }
            }
            if !complete {
                return Err("Codex ended without a completed turn.".into());
            }
            answer.ok_or_else(|| "Codex returned no answer".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structured_calls_require_offered_tools_and_object_arguments() {
        assert!(decode(r#"{"message":"Reading", "calls":[{"name":"files_read","arguments":"{\"path\":\"a\"}"}]}"#, &["files_read".into()]).is_ok());
        assert!(decode(
            r#"{"message":"", "calls":[{"name":"files_write","arguments":"{}"}]}"#,
            &[]
        )
        .is_err());
        assert!(decode(
            r#"{"message":"", "calls":[{"name":"files_read","arguments":"[]"}]}"#,
            &["files_read".into()]
        )
        .is_err());
        assert!(decode(r#"{"message":"", "calls":[]}"#, &[]).is_err());
    }
    #[test]
    fn inference_cannot_inherit_api_environment_or_native_tools() {
        let mut cmd = std::process::Command::new("fixture");
        clear_api_environment(&mut cmd);
        assert!(cmd
            .get_envs()
            .any(|(k, v)| k == "OPENAI_API_KEY" && v.is_none()));
        let args = inference_args(CliTool::Codex, "default", "schema.json");
        assert!(args.contains(&"forced_login_method=\"chatgpt\"".into()));
        assert!(args.contains(&"features.shell_tool=false".into()));
        assert!(args.contains(&"mcp_servers={}".into()));
        let claude = inference_args(CliTool::ClaudeCode, "sonnet", "");
        assert!(claude.windows(2).any(|a| a == ["--tools", ""]));
        assert!(claude.contains(&"--safe-mode".into()));
    }
    #[test]
    fn cli_failure_and_partial_output_are_never_success() {
        let result = r#"{"message":"Hi", "calls":[]}"#;
        let events = format!(
            "{}\n{}",
            json!({"type":"item.completed","item":{"type":"agent_message","text":result}}),
            json!({"type":"turn.completed"})
        );
        assert_eq!(final_answer(CliTool::Codex, &events).unwrap(), result);
        assert!(final_answer(
            CliTool::Codex,
            &format!("{events}\n{{\"type\":\"turn.failed\"}}")
        )
        .is_err());
        assert!(final_answer(CliTool::Codex, "{\"type\":\"turn.started\"}").is_err());
        assert!(final_answer(
            CliTool::ClaudeCode,
            "{\"subtype\":\"error_max_turns\",\"result\":\"partial\"}"
        )
        .is_err());
        assert!(final_answer(
            CliTool::Codex,
            "{\"type\":\"item.started\",\"item\":{\"type\":\"command_execution\"}}"
        )
        .is_err());
    }
}
