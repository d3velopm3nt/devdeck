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
//! - `cli_agent` The other kind of engine: an external coding CLI that
//!   executes rather than proposes, and reports what it did.
//! - `tools`     ToolRegistry + ToolService. Agents reach the machine only here.
//! - `context`   Assembly, checkpoints, deltas, reconciliation.
//! - `conflict`  Watches events, decides when two pieces of work disagree.
//! - `learn`     The mail learn run: estimate, one approval, receipt, facts.
//! - `deck`      `.devdeck` on disk — a project's durable truth, committed.
//! - `personal`  `%APPDATA%\devdeckssistant` — *your* durable truth, never committed.
//! - `approval`  Where a tool call goes to ask a person.
//! - `assistant` The orchestrator — the one AI you talk to.
//! - `events`    The bus everything else talks through.
//!
//! The dependency arrow points one way, down. `deck` knows nothing about
//! agents; `provider` knows nothing about `.devdeck`. That is what makes
//! swapping the LLM a change to one layer.

pub mod approval;
pub mod assistant;
pub mod cli_agent;
pub mod commands;
pub mod conflict;
pub mod context;
pub mod deck;
pub mod events;
pub mod grants;
pub mod learn;
pub mod mentions;
pub mod persona;
pub mod personal;
pub mod provider;
pub mod runtime;
pub mod site;
pub mod state;
pub mod tools;

#[cfg(test)]
mod scenario_tests;
