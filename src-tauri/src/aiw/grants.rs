//! Standing grants: permission you gave in advance, narrowly.
//!
//! `Permission::Approval` asks a person and denies when nobody answers. That is
//! correct, and it is also why an agent could not run unattended: at 3am there
//! is nobody to ask, so it either stalls or you set the tool to `Full` and the
//! permission system stops meaning anything.
//!
//! A grant is the third option, and it is deliberately the *narrow* one. It
//! does not say "this agent may use the terminal". It says "this agent may run
//! exactly `npm test`, in this project, twenty times, until Tuesday". Anything
//! outside it still asks, and at 3am still denies.
//!
//! **A grant refines `Approval`; it never overrides anything.** The matrix stays
//! authoritative: set a tool to `None` and every grant on it is inert without
//! being touched, because the level is checked first. That is what makes "revoke
//! the tool" a complete answer rather than a partial one.
//!
//! Four properties, and none of them is optional:
//!
//! 1. **It expires.** A grant with no end is `Full` wearing a disguise.
//! 2. **It is spent.** A bounded number of uses is what stops a loop that has
//!    gone wrong from running a thousand commands before you wake up.
//! 3. **It is narrow where it matters.** A grant for an action that *writes*
//!    must name what it writes — the exact command, the path prefix. "Any
//!    command, standing" is not a grant; it is `Full`, and if that is what you
//!    want, the matrix has a word for it that reads honestly.
//! 4. **It remembers what it did.** Each one keeps the last few things it
//!    allowed, so "what happened while I was asleep" has an answer in the same
//!    place as "what did I agree to".
//!
//! **Grants live in the personal store, never in `.devdeck`.** A grant is a
//! statement about what *you* trust on *your* machine. Committing one would
//! pre-authorise a teammate's machine to run something they never agreed to,
//! which is the worst version of the mistake the store split exists to prevent.
//!
//! **The file is read once, at startup, and is a record after that.** Unlike a
//! bot's `_bot.md`, which the app re-reads and treats as the truth, the live
//! book is the authority while DevDeck is open: editing `grants.md` by hand
//! mid-session changes nothing and will be overwritten by the next use. That is
//! the deliberate direction — a file swap must not be able to widen what an
//! agent may do without the app noticing — but it means the file is for reading
//! and for backups, not for granting.

use serde::{Deserialize, Serialize};

use super::events::{new_id, now_iso};
use super::tools::Access;

/// What the arguments of a call must look like for a grant to cover it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(tag = "kind", content = "value", rename_all = "lowercase")]
pub enum Scope {
    /// The one value this grant was created from, matched exactly. This is the
    /// only shape "allow always" on a prompt ever produces.
    Exact(String),
    /// Anything starting with this. Broader, so it is only ever made
    /// deliberately, by typing it.
    Prefix(String),
    /// Any arguments at all. Read actions only — see [`validate`].
    ///
    /// The default only so `Grant` can derive one; nothing constructs a grant
    /// this way except a test, and `validate` refuses it for a write.
    #[default]
    Any,
}

impl Scope {
    pub fn covers(&self, value: &str) -> bool {
        match self {
            Scope::Exact(v) => v == value,
            // An empty prefix would silently be `Any`. `validate` refuses one,
            // and this refuses it again rather than trusting that.
            Scope::Prefix(p) => !p.is_empty() && value.starts_with(p.as_str()),
            Scope::Any => true,
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Scope::Exact(v) => format!("exactly `{v}`"),
            Scope::Prefix(p) => format!("anything starting `{p}`"),
            Scope::Any => "any arguments".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Grant {
    pub id: String,
    pub agent_id: String,
    pub tool: String,
    /// The one action this covers. Never empty: a grant that covered every
    /// action on a tool would cover the write ones too.
    pub action: String,
    #[serde(default)]
    pub scope: Scope,
    /// The project it applies in. Empty means every project, which is only
    /// reachable deliberately and is shown as such.
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub created_at: String,
    /// RFC3339. Required, and checked on every use.
    #[serde(default)]
    pub expires_at: String,
    #[serde(default)]
    pub max_uses: u32,
    #[serde(default)]
    pub uses: u32,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last_used: String,
    /// Why you gave it. Your words, shown back to you later when you have
    /// forgotten.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// The last few things it allowed, newest first. Capped, because this is a
    /// receipt, not a log.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub revoked_at: String,
}

pub const RECENT_KEPT: usize = 8;

impl Grant {
    pub fn revoked(&self) -> bool {
        !self.revoked_at.is_empty()
    }

    pub fn spent(&self) -> bool {
        self.uses >= self.max_uses
    }

    pub fn expired(&self, now_rfc3339: &str) -> bool {
        // An unparsable or missing expiry counts as expired. A grant whose end
        // date cannot be read must not be treated as endless.
        match (
            chrono::DateTime::parse_from_rfc3339(&self.expires_at),
            chrono::DateTime::parse_from_rfc3339(now_rfc3339),
        ) {
            (Ok(end), Ok(now)) => now >= end,
            _ => true,
        }
    }

    pub fn live(&self, now_rfc3339: &str) -> bool {
        !self.revoked() && !self.spent() && !self.expired(now_rfc3339)
    }

    pub fn uses_left(&self) -> u32 {
        self.max_uses.saturating_sub(self.uses)
    }

    /// One line a person can judge without reading the struct.
    pub fn describe(&self) -> String {
        let where_ = if self.project_id.is_empty() {
            " in any project".to_string()
        } else {
            String::new()
        };
        format!(
            "{} may {}.{} — {}{}",
            self.agent_id,
            self.tool,
            self.action,
            self.scope.describe(),
            where_
        )
    }
}

/// The argument a grant constrains, per tool and action.
///
/// A grant is only as narrow as the thing it pins down, so this names the one
/// field that actually decides what a call does: the command for a terminal,
/// the path for a file. Returning `None` means there is nothing to pin, and
/// [`validate`] then refuses anything but a read.
pub fn subject(tool: &str, action: &str, args: &serde_json::Value) -> Option<String> {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).map(|v| v.to_string());
    match (tool, action) {
        ("terminal", _) => s("command"),
        ("tests", _) => s("command").or(Some(String::new())),
        ("process", "start") => s("command").or(Some(String::new())),
        ("files", _) => s("path"),
        ("git", "commit") => s("message"),
        _ => None,
    }
}

/// Why a proposed grant was refused, or `Ok` if it is one we will keep.
///
/// This is the whole safety argument in one function, so it is worth stating
/// plainly: a standing permission to *write* has to say what it writes. A grant
/// that says "any command, forever" is `Permission::Full` with extra steps, and
/// the matrix already has an honest word for that.
pub fn validate(g: &Grant, access: Access) -> Result<(), String> {
    if g.agent_id.trim().is_empty() {
        return Err("A grant has to name an agent.".into());
    }
    if g.tool.trim().is_empty() || g.action.trim().is_empty() {
        return Err("A grant has to name one tool and one action.".into());
    }
    if g.max_uses == 0 {
        return Err("A grant needs a number of uses. Nought is not a grant.".into());
    }
    if g.max_uses > 1000 {
        return Err("That is too many uses to be a grant. Set the tool to Full instead, where it reads as what it is.".into());
    }
    if g.expires_at.trim().is_empty() {
        return Err("A grant has to expire. One that does not is Full wearing a disguise.".into());
    }
    if chrono::DateTime::parse_from_rfc3339(&g.expires_at).is_err() {
        return Err("That expiry date could not be read.".into());
    }
    if access == Access::Write {
        match &g.scope {
            Scope::Any => {
                return Err(format!(
                    "'{}.{}' changes things, so a standing grant has to say what it may change. \
                     Name the exact one, or a prefix.",
                    g.tool, g.action
                ))
            }
            Scope::Prefix(p) if p.trim().len() < 3 => {
                return Err(
                    "That prefix is short enough to match almost anything. Make it more specific."
                        .into(),
                )
            }
            _ => {}
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GrantBook {
    #[serde(default)]
    pub grants: Vec<Grant>,
}

impl GrantBook {
    /// The grant that covers this call, if any.
    ///
    /// Deliberately does not consult the permission matrix: the caller checks
    /// the level first, and a grant can therefore only ever answer a question
    /// that was already going to be asked.
    pub fn find(
        &self,
        agent_id: &str,
        tool: &str,
        action: &str,
        args: &serde_json::Value,
        project_id: &str,
        now: &str,
    ) -> Option<&Grant> {
        let value = subject(tool, action, args);
        self.grants.iter().find(|g| {
            g.live(now)
                && g.agent_id == agent_id
                && g.tool == tool
                && g.action == action
                && (g.project_id.is_empty() || g.project_id == project_id)
                && match (&g.scope, &value) {
                    (Scope::Any, _) => true,
                    // A grant that pins an argument cannot cover a call that
                    // does not carry one — that would be matching on nothing.
                    (_, None) => false,
                    (s, Some(v)) => s.covers(v),
                }
        })
    }

    /// Record that a grant allowed something. Returns the grant as it now
    /// stands, so the caller can say how much is left.
    pub fn spend(&mut self, id: &str, what: &str, now: &str) -> Option<Grant> {
        let g = self.grants.iter_mut().find(|g| g.id == id)?;
        g.uses = g.uses.saturating_add(1);
        g.last_used = now.to_string();
        g.recent.insert(0, format!("{now}  {what}"));
        g.recent.truncate(RECENT_KEPT);
        Some(g.clone())
    }

    /// Add a grant, refusing one that is too broad to be worth the name.
    ///
    /// Replaces an identical live grant rather than stacking duplicates:
    /// pressing "always" twice should not quietly double your budget.
    pub fn add(&mut self, mut g: Grant, access: Access, now: &str) -> Result<Grant, String> {
        validate(&g, access)?;
        if g.id.is_empty() {
            g.id = new_id("grant");
        }
        if g.created_at.is_empty() {
            g.created_at = now.to_string();
        }
        self.grants.retain(|x| {
            !(x.agent_id == g.agent_id
                && x.tool == g.tool
                && x.action == g.action
                && x.scope == g.scope
                && x.project_id == g.project_id
                && x.live(now))
        });
        self.grants.push(g.clone());
        Ok(g)
    }

    /// Withdraw one. Kept rather than deleted, so the receipt of what it did
    /// while it was live survives the withdrawal.
    pub fn revoke(&mut self, id: &str, now: &str) -> bool {
        match self.grants.iter_mut().find(|g| g.id == id) {
            Some(g) if !g.revoked() => {
                g.revoked_at = now.to_string();
                true
            }
            _ => false,
        }
    }

    /// Forget a revoked, spent or expired grant entirely.
    pub fn forget(&mut self, id: &str, now: &str) -> bool {
        let before = self.grants.len();
        self.grants.retain(|g| g.id != id || g.live(now));
        before != self.grants.len()
    }

    /// Withdraw every live grant. The button you want when something has gone
    /// wrong and you do not want to read a list first.
    pub fn revoke_all(&mut self, now: &str) -> usize {
        let mut n = 0;
        for g in self.grants.iter_mut() {
            if !g.revoked() {
                g.revoked_at = now.to_string();
                n += 1;
            }
        }
        n
    }
}


// ---------------------------------------------------------------------------
// Where they are kept
// ---------------------------------------------------------------------------

/// The book on disk, with a lock around it.
///
/// **Every change is written immediately**, and that is load-bearing rather
/// than tidy: uses are what bound a grant, so a budget held only in memory
/// would reset every time the app restarted. A grant for twenty runs that
/// silently becomes twenty *per launch* is not bounded at all.
pub struct GrantStore {
    book: std::sync::Mutex<GrantBook>,
    path: std::path::PathBuf,
}

impl GrantStore {
    /// Open the book at `path`, or start an empty one.
    ///
    /// A file that will not parse is an error, never an empty book: reading a
    /// damaged grants file as "you have granted nothing" would be quietly safe
    /// today and quietly destroy the record of what you agreed to on the next
    /// write.
    pub fn open(path: impl Into<std::path::PathBuf>) -> Result<Self, String> {
        let path = path.into();
        let book = match std::fs::read_to_string(&path) {
            Ok(raw) => {
                super::deck::parse_doc::<GrantBook>(&raw)
                    .map_err(|e| format!("{} could not be read: {e}", path.display()))?
                    .meta
            }
            Err(_) => GrantBook::default(),
        };
        Ok(Self {
            book: std::sync::Mutex::new(book),
            path,
        })
    }

    /// A store nothing can persist to. Tests and any service built without a
    /// grants file get this, and a grant added to it simply does not survive —
    /// which is the safe direction to fail in.
    pub fn ephemeral() -> Self {
        Self {
            book: std::sync::Mutex::new(GrantBook::default()),
            path: std::path::PathBuf::new(),
        }
    }

    fn save(&self, book: &GrantBook) {
        if self.path.as_os_str().is_empty() {
            return;
        }
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = super::deck::write_doc(&super::deck::Doc {
            meta: book.clone(),
            body: "Standing grants. Never committed — see grants.rs.".to_string(),
        }) {
            let _ = std::fs::write(&self.path, text);
        }
    }

    pub fn all(&self) -> Vec<Grant> {
        self.book.lock().unwrap().grants.clone()
    }

    pub fn add(&self, g: Grant, access: Access) -> Result<Grant, String> {
        let now = now_iso();
        let mut book = self.book.lock().unwrap();
        let made = book.add(g, access, &now)?;
        self.save(&book);
        Ok(made)
    }

    pub fn revoke(&self, id: &str) -> bool {
        let now = now_iso();
        let mut book = self.book.lock().unwrap();
        let ok = book.revoke(id, &now);
        if ok {
            self.save(&book);
        }
        ok
    }

    pub fn revoke_all(&self) -> usize {
        let now = now_iso();
        let mut book = self.book.lock().unwrap();
        let n = book.revoke_all(&now);
        if n > 0 {
            self.save(&book);
        }
        n
    }

    /// Withdraw every grant on one tool for one agent. What "deny always"
    /// means: saying never to a tool has to take back what you already said
    /// yes to, or the refusal is not a refusal.
    pub fn revoke_tool(&self, agent_id: &str, tool: &str) -> usize {
        let now = now_iso();
        let mut book = self.book.lock().unwrap();
        let mut n = 0;
        for g in book.grants.iter_mut() {
            if g.agent_id == agent_id && g.tool == tool && !g.revoked() {
                g.revoked_at = now.clone();
                n += 1;
            }
        }
        if n > 0 {
            self.save(&book);
        }
        n
    }

    pub fn forget(&self, id: &str) -> bool {
        let now = now_iso();
        let mut book = self.book.lock().unwrap();
        let ok = book.forget(id, &now);
        if ok {
            self.save(&book);
        }
        ok
    }

    /// Find a grant covering this call and spend it, in one step.
    ///
    /// One step on purpose: a "does a grant cover this?" that did not also
    /// count the use would let the same grant answer a hundred calls, and the
    /// bound would be decoration.
    pub fn claim(
        &self,
        agent_id: &str,
        tool: &str,
        action: &str,
        args: &serde_json::Value,
        project_id: &str,
        what: &str,
    ) -> Option<Grant> {
        let now = now_iso();
        let mut book = self.book.lock().unwrap();
        let id = book
            .find(agent_id, tool, action, args, project_id, &now)?
            .id
            .clone();
        let spent = book.spend(&id, what, &now);
        self.save(&book);
        spent
    }
}

/// A grant built from an approval you just answered with "always".
///
/// Exact, never a prefix: saying yes to `npm test` means yes to `npm test`, not
/// to everything beginning `npm`. Broadening one is a separate, deliberate act.
pub fn from_approval(
    agent_id: &str,
    tool: &str,
    action: &str,
    args: &serde_json::Value,
    project_id: Option<&str>,
    days: i64,
    max_uses: u32,
) -> Grant {
    let now = now_iso();
    let expires = chrono::Utc::now() + chrono::Duration::days(days.clamp(1, 365));
    Grant {
        id: new_id("grant"),
        agent_id: agent_id.to_string(),
        tool: tool.to_string(),
        action: action.to_string(),
        scope: match subject(tool, action, args) {
            Some(v) => Scope::Exact(v),
            None => Scope::Any,
        },
        project_id: project_id.unwrap_or_default().to_string(),
        created_at: now,
        expires_at: expires.to_rfc3339(),
        max_uses,
        uses: 0,
        last_used: String::new(),
        note: "From an approval you answered with “always”.".into(),
        recent: vec![],
        revoked_at: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(days: i64) -> String {
        (chrono::Utc::now() + chrono::Duration::days(days)).to_rfc3339()
    }

    fn grant(scope: Scope) -> Grant {
        Grant {
            id: "g1".into(),
            agent_id: "dev".into(),
            tool: "terminal".into(),
            action: "run".into(),
            scope,
            project_id: "p1".into(),
            created_at: now_iso(),
            expires_at: at(7),
            max_uses: 20,
            ..Default::default()
        }
    }

    fn cmd(c: &str) -> serde_json::Value {
        serde_json::json!({ "command": c })
    }

    #[test]
    fn an_exact_grant_covers_that_command_and_nothing_near_it() {
        let mut book = GrantBook::default();
        book.add(grant(Scope::Exact("npm test".into())), Access::Write, &now_iso())
            .unwrap();

        let now = now_iso();
        assert!(book.find("dev", "terminal", "run", &cmd("npm test"), "p1", &now).is_some());
        assert!(
            book.find("dev", "terminal", "run", &cmd("npm test -- --watch"), "p1", &now).is_none(),
            "an exact grant is exact"
        );
        assert!(
            book.find("dev", "terminal", "run", &cmd("rm -rf ."), "p1", &now).is_none(),
            "and covers nothing else at all"
        );
    }

    #[test]
    fn a_grant_is_for_one_agent_one_tool_one_action_and_one_project() {
        let mut book = GrantBook::default();
        book.add(grant(Scope::Exact("npm test".into())), Access::Write, &now_iso())
            .unwrap();
        let now = now_iso();
        let args = cmd("npm test");

        assert!(book.find("dev", "terminal", "run", &args, "p1", &now).is_some());
        assert!(book.find("qa", "terminal", "run", &args, "p1", &now).is_none(), "other agent");
        assert!(book.find("dev", "files", "run", &args, "p1", &now).is_none(), "other tool");
        assert!(book.find("dev", "terminal", "kill", &args, "p1", &now).is_none(), "other action");
        assert!(book.find("dev", "terminal", "run", &args, "p2", &now).is_none(), "other project");
    }

    /// The property the whole feature rests on: a standing permission to change
    /// something has to say what it may change.
    #[test]
    fn a_write_cannot_be_granted_against_any_arguments() {
        let err = validate(&grant(Scope::Any), Access::Write).unwrap_err();
        assert!(err.contains("has to say what it may change"), "{err}");

        // The same grant is fine for a read: "read any file in this project" is
        // a reasonable thing to have agreed to.
        assert!(validate(&grant(Scope::Any), Access::Read).is_ok());
    }

    #[test]
    fn a_grant_that_never_ends_or_never_runs_out_is_refused() {
        let mut g = grant(Scope::Exact("npm test".into()));
        g.expires_at = String::new();
        assert!(validate(&g, Access::Write).unwrap_err().contains("has to expire"));

        let mut g = grant(Scope::Exact("npm test".into()));
        g.max_uses = 0;
        assert!(validate(&g, Access::Write).unwrap_err().contains("number of uses"));

        let mut g = grant(Scope::Exact("npm test".into()));
        g.max_uses = 100_000;
        assert!(validate(&g, Access::Write).unwrap_err().contains("too many uses"));

        // And a prefix short enough to match almost anything is not narrow.
        assert!(validate(&grant(Scope::Prefix("n".into())), Access::Write).is_err());
        assert!(validate(&grant(Scope::Prefix("npm ".into())), Access::Write).is_ok());
    }

    #[test]
    fn a_spent_grant_stops_covering_anything() {
        let mut book = GrantBook::default();
        let mut g = grant(Scope::Exact("npm test".into()));
        g.max_uses = 2;
        let g = book.add(g, Access::Write, &now_iso()).unwrap();

        let now = now_iso();
        for _ in 0..2 {
            assert!(book.find("dev", "terminal", "run", &cmd("npm test"), "p1", &now).is_some());
            book.spend(&g.id, "npm test", &now).unwrap();
        }
        assert!(
            book.find("dev", "terminal", "run", &cmd("npm test"), "p1", &now).is_none(),
            "two uses meant two"
        );
    }

    #[test]
    fn an_expired_grant_stops_covering_anything() {
        let mut book = GrantBook::default();
        let mut g = grant(Scope::Exact("npm test".into()));
        g.expires_at = at(-1);
        book.grants.push(g);

        let now = now_iso();
        assert!(book.find("dev", "terminal", "run", &cmd("npm test"), "p1", &now).is_none());
    }

    /// An expiry we cannot read must not be treated as "no expiry".
    #[test]
    fn an_unreadable_expiry_counts_as_expired() {
        let mut g = grant(Scope::Exact("npm test".into()));
        g.expires_at = "next Tuesday".into();
        assert!(g.expired(&now_iso()));
        assert!(!g.live(&now_iso()));
    }

    #[test]
    fn revoking_keeps_the_receipt() {
        let mut book = GrantBook::default();
        let g = book
            .add(grant(Scope::Exact("npm test".into())), Access::Write, &now_iso())
            .unwrap();
        let now = now_iso();
        book.spend(&g.id, "npm test", &now);

        assert!(book.revoke(&g.id, &now));
        assert!(book.find("dev", "terminal", "run", &cmd("npm test"), "p1", &now).is_none());
        let kept = book.grants.iter().find(|x| x.id == g.id).expect("still listed");
        assert_eq!(kept.uses, 1, "what it did survives being withdrawn");
        assert_eq!(kept.recent.len(), 1);

        assert!(!book.revoke(&g.id, &now), "revoking twice changes nothing");
    }

    #[test]
    fn saying_always_twice_does_not_double_the_budget() {
        let mut book = GrantBook::default();
        let now = now_iso();
        book.add(grant(Scope::Exact("npm test".into())), Access::Write, &now).unwrap();
        book.add(grant(Scope::Exact("npm test".into())), Access::Write, &now).unwrap();
        assert_eq!(book.grants.iter().filter(|g| g.live(&now)).count(), 1);
    }

    #[test]
    fn an_approval_becomes_an_exact_grant_not_a_prefix() {
        let g = from_approval(
            "dev",
            "terminal",
            "run",
            &cmd("npm test"),
            Some("p1"),
            7,
            20,
        );
        assert_eq!(g.scope, Scope::Exact("npm test".into()));
        assert!(validate(&g, Access::Write).is_ok());
        assert!(!g.expires_at.is_empty());
        assert_eq!(g.max_uses, 20);
    }

    #[test]
    fn the_recent_list_is_a_receipt_not_a_log() {
        let mut book = GrantBook::default();
        let mut g = grant(Scope::Exact("npm test".into()));
        g.max_uses = 100;
        let g = book.add(g, Access::Write, &now_iso()).unwrap();
        let now = now_iso();
        for i in 0..20 {
            book.spend(&g.id, &format!("run {i}"), &now);
        }
        let kept = book.grants.iter().find(|x| x.id == g.id).unwrap();
        assert_eq!(kept.uses, 20);
        assert_eq!(kept.recent.len(), RECENT_KEPT);
        assert!(kept.recent[0].contains("run 19"), "newest first");
    }

    #[test]
    fn revoke_all_is_the_panic_button() {
        let mut book = GrantBook::default();
        let now = now_iso();
        for (i, c) in ["npm test", "npm run build", "cargo test"].iter().enumerate() {
            let mut g = grant(Scope::Exact((*c).into()));
            g.id = format!("g{i}");
            book.add(g, Access::Write, &now).unwrap();
        }
        assert_eq!(book.revoke_all(&now), 3);
        assert!(book.grants.iter().all(|g| g.revoked()));
        assert_eq!(book.revoke_all(&now), 0, "nothing left to withdraw");
    }

    /// A grant pinned to an argument must not match a call that has none —
    /// that would be matching on nothing at all.
    #[test]
    fn a_pinned_grant_does_not_cover_an_argumentless_call() {
        let mut book = GrantBook::default();
        let mut g = grant(Scope::Exact("npm test".into()));
        g.tool = "git".into();
        g.action = "status".into();
        book.grants.push(g);

        let now = now_iso();
        assert!(
            book.find("dev", "git", "status", &serde_json::json!({}), "p1", &now).is_none(),
            "git.status pins nothing, so an exact grant cannot cover it"
        );
    }

    /// Parsing a real file, written the way the app writes it — because a screen
    /// saying "nothing is pre-authorised" over a file full of grants is
    /// indistinguishable from having none.
    #[test]
    fn a_grants_file_round_trips_through_the_store() {
        let dir = std::env::temp_dir().join(format!("devdeck-grantfile-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("grants.md");

        let store = GrantStore::open(&path).unwrap();
        assert!(store.all().is_empty(), "no file means no grants");

        let g = Grant {
            agent_id: "qa".into(),
            tool: "terminal".into(),
            action: "run".into(),
            scope: Scope::Exact("npm test".into()),
            project_id: "tyrex".into(),
            expires_at: (chrono::Utc::now() + chrono::Duration::days(5)).to_rfc3339(),
            max_uses: 20,
            note: "From an approval you answered with always.".into(),
            ..Default::default()
        };
        store.add(g, Access::Write).unwrap();
        store.claim(
            "qa",
            "terminal",
            "run",
            &serde_json::json!({ "command": "npm test" }),
            "tyrex",
            "run `npm test`",
        );

        assert!(path.is_file(), "it wrote the file");

        // A second store over the same path sees the same grants, with the use
        // counted — which is the whole reason it is written at all.
        let again = GrantStore::open(&path).unwrap();
        let all = again.all();
        assert_eq!(all.len(), 1, "read back what was written");
        assert_eq!(all[0].uses, 1, "a spent use survives a restart");
        assert_eq!(all[0].scope, Scope::Exact("npm test".into()));
        assert_eq!(all[0].recent.len(), 1);
        assert!(all[0].live(&now_iso()));

        // A `Scope::Any` grant survives too — it serialises with no content,
        // which is the shape most likely to break.
        again
            .add(
                Grant {
                    agent_id: "dev".into(),
                    tool: "files".into(),
                    action: "read".into(),
                    scope: Scope::Any,
                    expires_at: (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
                    max_uses: 5,
                    ..Default::default()
                },
                Access::Read,
            )
            .unwrap();
        let third = GrantStore::open(&path).unwrap();
        assert_eq!(third.all().len(), 2);
        assert!(third.all().iter().any(|g| g.scope == Scope::Any));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
