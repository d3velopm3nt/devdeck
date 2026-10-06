//! Durable, bounded manager messages. Pure core, also exercised by the sandbox crate.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path, sync::Mutex};

pub static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Profile {
    pub revision: u64,
    /// life | personal | business. Classification, never a filesystem grant.
    pub domain: String,
    pub role: String,
    pub responsibilities: Vec<String>,
    pub boundaries: Vec<String>,
    pub peers: Vec<String>,
    pub workers: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Draft {
    pub to: String,
    pub kind: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub reply_to: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub subject: String,
    pub body: String,
    pub reply_to: Option<String>,
    pub created_at: String,
    pub depth: usize,
}

pub fn valid_handle(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

pub fn validate_profile(p: &Profile) -> Result<(), String> {
    if !["life", "personal", "business"].contains(&p.domain.as_str()) {
        return Err("Choose Life, Personal or Business.".into());
    }
    if p.role.trim().is_empty() || p.role.len() > 160 || p.responsibilities.is_empty() {
        return Err("Give this manager a role and at least one responsibility.".into());
    }
    if p.responsibilities.len() > 20
        || p.boundaries.len() > 20
        || p.peers.len() > 30
        || p.workers.len() > 30
        || p.responsibilities
            .iter()
            .chain(&p.boundaries)
            .any(|s| s.trim().is_empty() || s.len() > 1000)
        || p.peers.iter().chain(&p.workers).any(|s| !valid_handle(s))
    {
        return Err(
            "Keep responsibilities and boundaries short; use valid manager and worker handles."
                .into(),
        );
    }
    Ok(())
}

pub fn read_profile(dir: &Path, handle: &str) -> Result<Profile, String> {
    if !valid_handle(handle) {
        return Err("Invalid manager handle.".into());
    }
    match fs::read(dir.join(format!("{handle}.json"))) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("Manager profile could not be read: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Profile::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_profile(dir: &Path, handle: &str, mut profile: Profile) -> Result<Profile, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    validate_profile(&profile)?;
    let previous = read_profile(dir, handle)?;
    if previous.revision != profile.revision {
        return Err("This manager changed. Reload before saving.".into());
    }
    profile.revision += 1;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Keep the previous valid revision for recovery if the machine stops during a write.
    let path = dir.join(format!("{handle}.json"));
    if path.exists() {
        fs::copy(&path, dir.join(format!("{handle}.previous.json"))).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(&profile).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(profile)
}

pub fn messages(dir: &Path) -> Result<Vec<Message>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|x| x == "json") {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            out.push(
                serde_json::from_slice::<Message>(&bytes)
                    .map_err(|e| format!("Unreadable manager message: {e}"))?,
            );
        }
    }
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    Ok(out)
}

pub fn pending<'a>(messages: &'a [Message], handle: &str) -> Vec<&'a Message> {
    messages
        .iter()
        .filter(|m| {
            m.to == handle
                && m.kind != "acknowledgement"
                && !messages
                    .iter()
                    .any(|r| r.reply_to.as_deref() == Some(&m.id))
        })
        .collect()
}

pub fn send(
    dir: &Path,
    from: &str,
    sender: &Profile,
    recipient: &Profile,
    draft: Draft,
) -> Result<Message, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    if !valid_handle(from) || !valid_handle(&draft.to) || draft.to == from {
        return Err("Choose another valid manager.".into());
    }
    if !sender.peers.contains(&draft.to) || !recipient.peers.iter().any(|p| p == from) {
        return Err(
            "Both managers must list each other as communication peers. Nothing was sent.".into(),
        );
    }
    if !["request", "update", "reply", "acknowledgement"].contains(&draft.kind.as_str())
        || draft.subject.trim().is_empty()
        || draft.subject.len() > 200
        || draft.body.trim().is_empty()
        || draft.body.len() > 6000
    {
        return Err(
            "Use a valid message kind, subject (200 characters) and body (6000 characters).".into(),
        );
    }
    let all = messages(dir)?;
    let key = serde_json::to_vec(&(from, &draft)).map_err(|e| e.to_string())?;
    let id = format!("{:x}", Sha256::digest(&key));
    if let Some(existing) = all.iter().find(|m| m.id == id) {
        return Ok(existing.clone());
    }

    let depth = if let Some(id) = &draft.reply_to {
        let parent = all
            .iter()
            .find(|m| &m.id == id)
            .ok_or("The message being answered does not exist.")?;
        if parent.to != from || parent.from != draft.to || parent.kind == "acknowledgement" {
            return Err(
                "A reply must go back to the sender of a message addressed to this manager.".into(),
            );
        }
        if all.iter().any(|m| m.reply_to.as_deref() == Some(id)) {
            return Err("This message already has a response. Reload the inbox.".into());
        }
        parent.depth + 1
    } else {
        if draft.kind == "reply" || draft.kind == "acknowledgement" {
            return Err("Choose the message being answered.".into());
        }
        0
    };
    if depth > 8 {
        return Err("This exchange reached eight replies. Ask the person to resolve it.".into());
    }
    if pending(&all, &draft.to).len() >= 100 {
        return Err("This manager has 100 unanswered messages. Resolve those first.".into());
    }
    let message = Message {
        id: id.clone(),
        from: from.into(),
        to: draft.to,
        kind: draft.kind,
        subject: draft.subject.trim().into(),
        body: draft.body.trim().into(),
        reply_to: draft.reply_to,
        created_at: chrono::Utc::now().to_rfc3339(),
        depth,
    };
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join(format!("{id}.json")))
        .map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(&message).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(message)
}

/// One explicit envelope per turn. Prose mentions never trigger communication.
pub fn outgoing(text: &str) -> Result<Option<Draft>, String> {
    let lines: Vec<_> = text
        .lines()
        .filter_map(|l| l.trim().strip_prefix("MANAGER_MESSAGE "))
        .collect();
    if lines.len() > 1 {
        return Err("Only one manager message is allowed per turn.".into());
    }
    lines
        .first()
        .map(|s| serde_json::from_str(s).map_err(|e| format!("Invalid manager message: {e}")))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profiles() -> (Profile, Profile) {
        (
            Profile {
                domain: "life".into(),
                role: "Life coordinator".into(),
                responsibilities: vec!["Coordinate priorities".into()],
                peers: vec!["business".into()],
                ..Default::default()
            },
            Profile {
                domain: "business".into(),
                role: "Business manager".into(),
                responsibilities: vec!["Deliver work".into()],
                peers: vec!["life".into()],
                ..Default::default()
            },
        )
    }
    fn dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "devdeck-coordination-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn draft() -> Draft {
        Draft {
            to: "business".into(),
            kind: "request".into(),
            subject: "Tomorrow's priorities".into(),
            body: "Can work finish before family time?".into(),
            reply_to: None,
        }
    }
    #[test]
    fn real_persistence_request_reply_and_dedup() {
        let d = dir();
        let (a, b) = profiles();
        let first = send(&d, "life", &a, &b, draft()).unwrap();
        assert_eq!(send(&d, "life", &a, &b, draft()).unwrap().id, first.id);
        assert_eq!(pending(&messages(&d).unwrap(), "business").len(), 1);
        send(
            &d,
            "business",
            &b,
            &a,
            Draft {
                to: "life".into(),
                kind: "reply".into(),
                subject: "Plan".into(),
                body: "Builder at 09:00; review at 11:00.".into(),
                reply_to: Some(first.id),
            },
        )
        .unwrap();
        let reopened = messages(&d).unwrap();
        assert_eq!(reopened.len(), 2);
        assert!(pending(&reopened, "business").is_empty());
        assert_eq!(pending(&reopened, "life").len(), 1);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn cross_domain_requires_mutual_consent() {
        let (a, mut b) = profiles();
        b.peers.clear();
        let d = dir();
        assert!(send(&d, "life", &a, &b, draft()).is_err());
        assert!(!d.exists());
    }
    #[test]
    fn stale_profile_and_path_escape_are_refused() {
        let d = dir();
        let (a, _) = profiles();
        let saved = save_profile(&d, "life", a.clone()).unwrap();
        assert_eq!(saved.revision, 1);
        assert!(save_profile(&d, "life", a).is_err());
        assert!(read_profile(&d, "../secret").is_err());
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn parser_does_not_execute_mentions_or_multiple_envelopes() {
        assert!(outgoing("@business please check").unwrap().is_none());
        let json = serde_json::to_string(&draft()).unwrap();
        assert!(outgoing(&format!("MANAGER_MESSAGE {json}\nMANAGER_MESSAGE {json}")).is_err());
    }
    #[test]
    fn replies_cannot_spoof_unrelated_conversations() {
        let d = dir();
        let (a, b) = profiles();
        let m = send(&d, "life", &a, &b, draft()).unwrap();
        let mut bad = draft();
        bad.kind = "reply".into();
        bad.reply_to = Some(m.id);
        assert!(send(&d, "life", &a, &b, bad).is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
