// Tests use the production source, not a parallel implementation.
#[path = "../../src-tauri/src/coordination.rs"]
pub mod coordination;
#[path = "../../src-tauri/src/execution_policy.rs"]
pub mod execution_policy;

// Only the desktop adapter is stubbed. EventBus and its tests are production code.
extern crate self as tauri;
pub struct AppHandle;
pub trait Manager {
    fn try_state<T>(&self) -> Option<T> {
        None
    }
}
impl Manager for AppHandle {}
#[path = "../../src-tauri/src/aiw/events.rs"]
pub mod events;
pub mod aiw {
    pub mod state {
        pub struct Workspace {
            pub bus: crate::events::SharedBus,
        }
    }
    // Desktop boundary and runtime types are stubbed; the adapter and process
    // protocol below are the production files, executed with fixture CLIs.
    pub mod provider {
        pub use crate::adapter_fixture::*;
    }
    pub mod tools {
        pub use crate::adapter_fixture::ToolDefinition;
        pub fn parse_tool_call(
            name: &str,
            args: &serde_json::Value,
        ) -> Result<crate::adapter_fixture::ToolCall, String> {
            let (tool, action) = name.split_once('_').ok_or("Invalid name")?;
            Ok(crate::adapter_fixture::ToolCall {
                tool: tool.into(),
                action: action.into(),
                args: args.clone(),
                call_id: String::new(),
            })
        }
    }
    pub use crate::subscription_adapter as subscription;
}
#[path = "adapter_fixture.rs"]
pub mod adapter_fixture;
pub mod cli_setup {
    pub use crate::adapter_fixture::{cli_command, cli_setup_status, resolve_cli};
}
#[path = "../../src-tauri/src/aiw/subscription.rs"]
pub mod subscription_adapter;

#[path = "../../src-tauri/src/workflow_model.rs"]
pub mod workflow_model;

#[path = "../../src-tauri/src/visibility_model.rs"]
pub mod visibility_model;

#[path = "../../src-tauri/src/cli_setup_model.rs"]
pub mod cli_setup_model;

#[path = "../../src-tauri/src/subscription_model.rs"]
pub mod subscription_model;
#[path = "../../src-tauri/src/subscription_process.rs"]
pub mod subscription_process;
