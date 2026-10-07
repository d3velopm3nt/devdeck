// Tests use the production source, not a parallel implementation.
#[path = "../../src-tauri/src/coordination.rs"]
pub mod coordination;
#[path = "../../src-tauri/src/execution_policy.rs"]
pub mod execution_policy;

// Only the desktop adapter is stubbed. EventBus and its tests are production code.
extern crate self as tauri;
pub struct AppHandle;
pub trait Manager { fn try_state<T>(&self) -> Option<T> { None } }
impl Manager for AppHandle {}
#[path = "../../src-tauri/src/aiw/events.rs"]
pub mod events;
pub mod aiw { pub mod state { pub struct Workspace { pub bus: crate::events::SharedBus } } }

#[path = "../../src-tauri/src/workflow_model.rs"]
pub mod workflow_model;
