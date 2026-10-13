//! In-memory pairing and replay protection. No secrets or transcripts in Git.
use rand::RngCore;
use std::collections::HashMap;
use std::time::{Duration, Instant};

fn secret() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub struct Pairing {
    code: String,
    until: Instant,
    attempts: u8,
    sessions: HashMap<String, Instant>,
    requests: HashMap<String, Option<serde_json::Value>>,
}

impl Default for Pairing {
    fn default() -> Self {
        Self {
            code: String::new(),
            until: Instant::now(),
            attempts: 0,
            sessions: HashMap::new(),
            requests: HashMap::new(),
        }
    }
}

impl Pairing {
    pub fn renew(&mut self) -> String {
        self.code = secret();
        self.until = Instant::now() + Duration::from_secs(120);
        self.attempts = 0;
        self.code.clone()
    }

    pub fn exchange(&mut self, code: &str) -> Result<String, String> {
        if self.code.is_empty() || Instant::now() >= self.until || self.attempts >= 5 {
            return Err("Pairing expired. Generate a new QR code on the desktop.".into());
        }
        self.attempts += 1;
        if code != self.code {
            return Err("Invalid pairing code".into());
        }
        self.code.clear();
        let token = secret();
        self.sessions
            .insert(token.clone(), Instant::now() + Duration::from_secs(43200));
        Ok(token)
    }

    pub fn authorized(&self, token: &str) -> bool {
        self.sessions
            .get(token)
            .is_some_and(|until| Instant::now() < *until)
    }

    pub fn revoke(&mut self, token: &str) {
        self.sessions.remove(token);
    }

    /// Never evict accepted IDs during a pairing session: retrying an old
    /// command must not execute it again. Bound memory by refusing new IDs.
    pub fn accept(&mut self, id: &str) -> Result<bool, String> {
        if !valid_id(id) {
            return Err("Invalid request ID".into());
        }
        if self.requests.contains_key(id) {
            return Ok(false);
        }
        if self.requests.len() >= 4096 {
            return Err("Session request limit reached. Restart pairing.".into());
        }
        self.requests.insert(id.into(), None);
        Ok(true)
    }

    pub fn request_limit_reached(&self) -> bool {
        self.requests.len() >= 4096
    }

    pub fn known(&self, id: &str) -> bool {
        self.requests.contains_key(id)
    }

    pub fn finish(&mut self, id: &str, receipt: serde_json::Value) {
        if let Some(value) = self.requests.get_mut(id) {
            *value = Some(receipt);
        }
    }

    pub fn receipt(&self, id: &str) -> Option<serde_json::Value> {
        self.requests.get(id).and_then(Clone::clone)
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pairing_is_single_use_and_revocable() {
        let mut p = Pairing::default();
        assert!(p.exchange("").is_err());
        let code = p.renew();
        let token = p.exchange(&code).unwrap();
        assert!(p.authorized(&token));
        assert!(!p.authorized(&code));
        assert!(p.exchange(&code).is_err());
        p.revoke(&token);
        assert!(!p.authorized(&token));
    }
    #[test]
    fn expired_and_bruteforced_codes_fail() {
        let mut p = Pairing::default();
        let code = p.renew();
        for _ in 0..5 {
            assert!(p.exchange("wrong").is_err());
        }
        assert!(p.exchange(&code).is_err());
        let code = p.renew();
        p.until = Instant::now();
        assert!(p.exchange(&code).is_err());
    }
    #[test]
    fn request_replays_are_not_accepted() {
        let mut p = Pairing::default();
        assert!(p.accept("request-1").unwrap());
        assert!(!p.accept("request-1").unwrap());
        assert!(p.receipt("request-1").is_none());
        p.finish("request-1", serde_json::json!({"ok": true}));
        assert_eq!(
            p.receipt("request-1"),
            Some(serde_json::json!({"ok": true}))
        );
        assert!(!valid_id("../../profile"));
        assert!(!valid_id(""));
    }
}

/// Bounded FIFO for accepted mobile messages. Delegated agent runs are managed
/// by the existing desktop runtime; this queue only serializes chat turns.
#[derive(Clone, serde::Serialize)]
pub struct QueuedMessage {
    pub request_id: String,
    pub conversation_id: String,
    pub text: String,
    pub status: String,
}

#[derive(Default)]
pub struct MessageQueue {
    waiting: std::collections::VecDeque<String>,
    records: HashMap<String, QueuedMessage>,
    order: Vec<String>,
    running: bool,
}

impl MessageQueue {
    pub fn enqueue(
        &mut self,
        request_id: &str,
        conversation_id: &str,
        text: &str,
    ) -> Result<bool, String> {
        if let Some(old) = self.records.get(request_id) {
            if old.conversation_id != conversation_id || old.text != text {
                return Err("Request ID belongs to a different message".into());
            }
            return Ok(false);
        }
        if self.waiting.len() >= 32 || self.records.len() >= 4096 {
            return Err("Mobile queue is full. Wait for accepted messages to finish.".into());
        }
        self.records.insert(
            request_id.into(),
            QueuedMessage {
                request_id: request_id.into(),
                conversation_id: conversation_id.into(),
                text: text.into(),
                status: "queued".into(),
            },
        );
        self.order.push(request_id.into());
        self.waiting.push_back(request_id.into());
        let start = !self.running;
        self.running = true;
        Ok(start)
    }

    pub fn take_next(&mut self) -> Option<QueuedMessage> {
        match self.waiting.pop_front() {
            Some(id) => {
                let message = self.records.get_mut(&id)?;
                message.status = "running".into();
                Some(message.clone())
            }
            None => {
                self.running = false;
                None
            }
        }
    }

    pub fn finish(&mut self, id: &str, failed: bool) {
        if let Some(message) = self.records.get_mut(id) {
            message.status = if failed { "failed" } else { "completed" }.into();
        }
    }

    pub fn snapshot(&self) -> Vec<QueuedMessage> {
        self.order
            .iter()
            .filter_map(|id| self.records.get(id))
            .rev()
            .take(100)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
}

#[cfg(test)]
mod queue_tests {
    use super::*;
    #[test]
    fn fifo_replay_and_payload_integrity() {
        let mut q = MessageQueue::default();
        assert!(q.enqueue("one", "room", "first").unwrap());
        assert!(!q.enqueue("two", "room", "second").unwrap());
        assert!(!q.enqueue("one", "room", "first").unwrap());
        assert!(q.enqueue("one", "other", "first").is_err());
        assert_eq!(q.take_next().unwrap().request_id, "one");
        q.finish("one", false);
        assert_eq!(q.take_next().unwrap().request_id, "two");
        q.finish("two", true);
        assert!(q.take_next().is_none());
        assert_eq!(q.snapshot()[0].status, "completed");
        assert_eq!(q.snapshot()[1].status, "failed");
        assert!(q.enqueue("three", "room", "next worker").unwrap());
    }
    #[test]
    fn bounded_queue_preserves_accepted_work() {
        let mut q = MessageQueue::default();
        for i in 0..32 {
            q.enqueue(&format!("r{i}"), "room", "work").unwrap();
        }
        assert!(q.enqueue("overflow", "room", "work").is_err());
        assert_eq!(q.take_next().unwrap().request_id, "r0");
        assert!(!q.enqueue("new", "room", "work").unwrap());
        assert_eq!(q.snapshot().len(), 33);
    }
}
