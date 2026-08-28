//! DevDeck AI Workspace.
//!
//! Humans and agents collaborating on the same project, coordinated through
//! events and a shared, Git-versioned context.
//!
//! Layering, outermost first:
//!
//! - `commands`  Tauri entry points. The only thing the UI can call.
//! - `runtime`   AgentRuntime — the session lifecycle every agent goes through.
//! - `provider`  LLMProvider trait + Mock / Anthropic / OpenAI-compatible.
//! - `tools`     ToolRegistry + ToolService. Agents reach the machine only here.
//! - `context`   Assembly, checkpoints, deltas, reconciliation.
//! - `conflict`  Watches events, decides when two pieces of work disagree.
//! - `deck`      `.devdeck` on disk — the durable source of truth.
//! - `events`    The bus everything else talks through.
//!
//! The dependency arrow points one way, down. `deck` knows nothing about
//! agents; `provider` knows nothing about `.devdeck`. That is what makes
//! swapping the LLM a change to one layer.

pub mod approval;
pub mod commands;
pub mod conflict;
pub mod context;
pub mod deck;
pub mod events;
pub mod provider;
pub mod runtime;
pub mod state;
pub mod tools;

#[cfg(test)]
mod scenario_tests;
