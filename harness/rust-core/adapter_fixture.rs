//! Only the desktop/runtime seam is stubbed; test executes the production adapter.
use crate::cli_setup_model::CliTool;
use serde::Serialize;
use serde_json::Value;
use std::process::Command;
#[derive(Default)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}
pub struct ProviderHealth {
    pub ok: bool,
    pub configured: bool,
    pub detail: String,
}
#[derive(Default)]
pub struct AgentRequest {
    pub agent_id: String,
    pub role: String,
    pub model: String,
    pub system: String,
    pub context: String,
    pub goal: String,
    pub tools: Vec<ToolDefinition>,
    pub observations: Vec<Observation>,
    pub history: Vec<ChatTurn>,
    pub turn: u32,
}
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}
pub struct Observation {
    pub call_id: String,
    pub tool: String,
    pub action: String,
    pub args: Value,
    pub ok: bool,
    pub output: String,
}
#[derive(Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}
pub struct ToolCall {
    pub tool: String,
    pub action: String,
    pub args: Value,
    pub call_id: String,
}
pub enum AgentAction {
    Tool(ToolCall),
    Done,
}
pub struct AgentResponse {
    pub message: String,
    pub complete: bool,
    pub actions: Vec<AgentAction>,
    pub usage: Option<()>,
}
pub trait LLMProvider {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn list_models(&self) -> Vec<ModelInfo>;
    fn fetch_models(&self) -> Result<Vec<ModelInfo>, String>;
    fn run(&self, request: &AgentRequest) -> Result<AgentResponse, String>;
    fn health(&self) -> ProviderHealth;
}
pub struct CliStatus {
    pub installed: bool,
    pub auth: String,
    pub detail: String,
}
pub fn cli_setup_status(_: CliTool) -> CliStatus {
    CliStatus {
        installed: true,
        auth: "subscription".into(),
        detail: "Fixture subscription".into(),
    }
}
pub fn resolve_cli(_: CliTool) -> String {
    "python3".into()
}
pub fn cli_command(_: &str, args: &[String]) -> Command {
    let tool = if args.first().is_some_and(|s| s == "exec") {
        "codex"
    } else {
        "claude"
    };
    let mut c = Command::new("python3");
    c.args(["-c", r#"
import json,sys,os
p=json.load(sys.stdin)
assert 'Read project notes' == p['goal']
assert p['history'][0]['content'] == 'Remember this project'
assert p['system'] == 'Fixture system'
assert p['context'] == 'Scoped project'
assert 'OPENAI_API_KEY' not in os.environ
if p['observations']:
    assert p['observations'][0]['output'] == 'Fixture project notes'
    assert p['observations'][0]['call_id'] == 'subscription-0-0'
    reply={'message':'The notes say Fixture project notes','calls':[]}
else:
    assert p['available_tools'][0]['name'] == 'files_read'
    reply={'message':'Reading the project notes','calls':[{'name':'files_read','arguments':json.dumps({'path':'README.md'})}]}
if sys.argv[1]=='claude': print(json.dumps({'subtype':'success','is_error':False,'structured_output':reply}))
else:
    print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps(reply)}}))
    print(json.dumps({'type':'turn.completed'}))
"#, tool]);
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subscription_adapter::SubscriptionProvider;
    #[test]
    fn both_cli_protocols_carry_context_history_and_tool_results() {
        for tool in [CliTool::ClaudeCode, CliTool::Codex] {
            let p = SubscriptionProvider::new(tool);
            let mut request = AgentRequest {
                goal: "Read project notes".into(),
                system: "Fixture system".into(),
                context: "Scoped project".into(),
                history: vec![ChatTurn {
                    role: "user".into(),
                    content: "Remember this project".into(),
                }],
                tools: vec![ToolDefinition {
                    name: "files_read".into(),
                    description: "Read".into(),
                    input_schema: serde_json::json!({}),
                }],
                ..Default::default()
            };
            let first = p.run(&request).unwrap();
            assert!(!first.complete);
            let AgentAction::Tool(call) = &first.actions[0] else {
                panic!("Expected tool")
            };
            request.observations.push(Observation {
                call_id: call.call_id.clone(),
                tool: call.tool.clone(),
                action: call.action.clone(),
                args: call.args.clone(),
                ok: true,
                output: "Fixture project notes".into(),
            });
            request.turn = 1;
            let last = p.run(&request).unwrap();
            assert!(last.complete && last.actions.is_empty());
            assert!(last.message.contains("Fixture project notes"));
        }
    }
}
