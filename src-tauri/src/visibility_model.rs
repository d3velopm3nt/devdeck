use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ProductLink {
    pub id: String,
    pub name: String,
    pub space: String,
    pub folder: String,
    pub repository: String,
    #[serde(default)]
    pub project_url: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SessionRecord {
    pub id: String,
    pub assistant: String,
    pub product_id: String,
    pub space: String,
    pub folder: String,
    pub title: String,
    pub status: String,
    pub started_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub ticket_url: String,
    #[serde(default)]
    pub conversation_url: String,
    #[serde(default)]
    pub step: String,
    #[serde(default)]
    pub blocker: String,
    #[serde(default)]
    pub next_action: String,
    #[serde(default)]
    pub checkpoints: Vec<Checkpoint>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Checkpoint {
    pub at: String,
    pub summary: String,
    #[serde(default)]
    pub evidence: Vec<String>,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub products: Vec<ProductLink>,
    pub config_raw: String,
    pub sessions: Vec<SessionRecord>,
    pub warnings: Vec<String>,
}

pub fn repository_valid(s: &str) -> bool {
    let parts: Vec<_> = s.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repositories_cannot_redirect_credentials_or_traverse() {
        assert!(repository_valid("d3velopm3nt/devdeck"));
        for bad in [
            "https://evil.test/x",
            "../x",
            "a/..",
            "a/b/c",
            "a/b?x",
            "/b",
        ] {
            assert!(!repository_valid(bad), "{bad}");
        }
    }
}
