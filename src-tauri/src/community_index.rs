//! Where the Community index comes from.
//!
//! Two sources, and they answer different questions — which is why they are
//! two lists on screen rather than one merged one with a hidden ordering:
//!
//!  * **The official MCP registry** (`registry.modelcontextprotocol.io`) is
//!    the place servers publish themselves. It carries what a server *is* and
//!    how to run it, and it carries no popularity signal at all. Its order is
//!    recency, and the page says so.
//!  * **GitHub search** answers "most starred", which is a real, documented,
//!    sortable query. It carries stars and no run instructions.
//!
//! Neither is scraped. GitHub Trending — the thing with no API, whose ranking
//! has never been published — is the next slice, and it is deliberately not
//! mixed in here: a list whose order is partly a documented sort and partly
//! somebody's unpublished algorithm cannot describe itself honestly.
//!
//! **A failed fetch is never an empty list.** The cache keeps the last good
//! answer with the time it was taken; a fetch that fails returns that, with
//! `ok: false` and the reason. "Nothing is published" and "we could not look"
//! are different facts and the page shows which one it has.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::community::{Item, KIND_TOOL};
use crate::db::err;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS community_index (
    -- 'registry' | 'github'
    source TEXT PRIMARY KEY,
    -- The whole answer, as JSON. Small enough that rows would be a needless
    -- second schema to migrate every time an index gains a field.
    items TEXT NOT NULL DEFAULT '[]',
    -- When a read last *succeeded*. Not when it was last attempted: the point
    -- of showing it is to say how stale what you are reading might be.
    fetched_at INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
);
";

/// Every source, in the order the page shows them: what is publishable and
/// runnable first, then what is popular, then what is merely moving.
pub const SOURCES: &[&str] = &[
    SOURCE_REGISTRY,
    SOURCE_GITHUB,
    SOURCE_TRENDING_WEEK,
    SOURCE_TRENDING_MONTH,
];

pub const SOURCE_REGISTRY: &str = "registry";
pub const SOURCE_GITHUB: &str = "github";

const REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0/servers?limit=100";

/// The topics that mean "a thing a bot could hold".
///
/// This is the filter the roadmap's third gap is about: GitHub Trending is
/// every repository on the site, and this page only wants AI tooling. A topic
/// query is filtered at the source, so there is nothing to guess at afterwards.
const TOPICS: &[&str] = &["mcp", "mcp-server", "ai-agent", "llm-tools"];

/// One source's answer, and how much to trust it.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Feed {
    pub source: String,
    pub items: Vec<Item>,
    /// True when the last attempt succeeded. False means `items` is the last
    /// good answer, or empty because there has never been one.
    pub ok: bool,
    /// Unix millis of the last *successful* read. Zero when there has not been
    /// one, which the page says rather than showing a 1970 date.
    pub fetched_at: i64,
    /// What went wrong, or how the list is ordered when nothing did.
    pub note: String,
}

// ---------------------------------------------------------------------------
// Parsing — pure, and therefore checkable
// ---------------------------------------------------------------------------

/// Turn an npm/pypi package declaration into a command that would run it.
///
/// Returns nothing for a registry type we cannot run, which is the honest
/// answer: an entry we cannot start should not offer an Install button that
/// would fail on click.
pub fn command_for(registry_type: &str, identifier: &str, version: &str) -> Option<String> {
    let id = identifier.trim();
    if id.is_empty() {
        return None;
    }
    let pinned = if version.trim().is_empty() {
        id.to_string()
    } else {
        format!("{id}@{}", version.trim())
    };
    match registry_type.trim().to_ascii_lowercase().as_str() {
        "npm" => Some(format!("npx -y {pinned}")),
        // uvx runs a published Python tool without installing it, which is the
        // closest equivalent to npx -y.
        "pypi" => Some(format!("uvx {id}")),
        _ => None,
    }
}

/// Read the official registry's `/v0/servers` response.
///
/// Only stdio servers survive. A `remotes` entry is an HTTP server, and this
/// client speaks stdio — listing one would put an Install button in front of
/// somebody that could never work.
pub fn parse_registry(body: &Value) -> Vec<Item> {
    let Some(list) = body.get("servers").and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|entry| {
            let s = entry.get("server")?;
            let name = s.get("name").and_then(Value::as_str)?.trim();
            if name.is_empty() {
                return None;
            }
            // The registry returns every version ever published, so one server
            // arrives as five rows. Only the latest is a thing to install, and
            // only an active one is a thing to install at all — a deleted or
            // deprecated entry is still served, just not as current.
            let meta = entry.pointer("/_meta/io.modelcontextprotocol.registry~1official");
            let latest = meta
                .and_then(|m| m.get("isLatest"))
                .and_then(Value::as_bool)
                // Absent means the registry did not say. Treating that as
                // "latest" keeps a server that predates the field rather than
                // silently dropping every one of them.
                .unwrap_or(true);
            if !latest {
                return None;
            }
            let active = meta
                .and_then(|m| m.get("status"))
                .and_then(Value::as_str)
                .map(|st| st.eq_ignore_ascii_case("active"))
                .unwrap_or(true);
            if !active {
                return None;
            }
            let pkgs = s.get("packages").and_then(Value::as_array)?;
            // The first package we know how to run wins.
            let (command, _) = pkgs.iter().find_map(|p| {
                let stdio = p
                    .pointer("/transport/type")
                    .and_then(Value::as_str)
                    .map(|t| t.eq_ignore_ascii_case("stdio"))
                    .unwrap_or(false);
                if !stdio {
                    return None;
                }
                let rt = p.get("registryType").and_then(Value::as_str)?;
                let ident = p.get("identifier").and_then(Value::as_str)?;
                let ver = p.get("version").and_then(Value::as_str).unwrap_or("");
                command_for(rt, ident, ver).map(|c| (c, rt.to_string()))
            })?;

            let short = name.rsplit('/').next().unwrap_or(name).to_string();
            Some(Item {
                id: format!("tool.registry.{name}"),
                kind: KIND_TOOL.into(),
                name: s
                    .get("title")
                    .and_then(Value::as_str)
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or(&short)
                    .to_string(),
                summary: s
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                // The registry publishes no author field of its own; the name
                // is a reverse-DNS namespace, and its first part is who.
                author: name.split('/').next().unwrap_or(name).to_string(),
                source: s
                    .pointer("/repository/url")
                    .and_then(Value::as_str)
                    .unwrap_or("https://registry.modelcontextprotocol.io")
                    .to_string(),
                // The registry does not carry licences. Saying "missing" is
                // true and is the safe reading — no licence means no
                // permission — and it is visibly different from a licence we
                // read and recognised.
                licence: "missing".into(),
                version: s
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                tool_id: format!("{}{}", crate::mcp::PREFIX, slug(&short)),
                command,
                ..Default::default()
            })
        })
        .collect()
}

/// A tool id has to survive being part of a permission key, so it is reduced
/// to something predictable rather than carrying whatever a publisher chose.
pub fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    s.trim_matches('-').replace("--", "-")
}

/// Read a GitHub `/search/repositories` response.
///
/// These are repositories, not installable servers: there is no manifest and
/// no run command, which is exactly the state the design already draws as
/// *No manifest*. They are listed so you can see what is popular and go and
/// look; installing one is not offered, because we would be guessing at how.
pub fn parse_github(body: &Value) -> Vec<Item> {
    let Some(list) = body.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|r| {
            let full = r.get("full_name").and_then(Value::as_str)?.trim();
            if full.is_empty() {
                return None;
            }
            let stars = r.get("stargazers_count").and_then(Value::as_i64).unwrap_or(0);
            Some(Item {
                id: format!("repo.{full}"),
                kind: KIND_TOOL.into(),
                name: r
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(full)
                    .to_string(),
                summary: r
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("No description.")
                    .to_string(),
                author: r
                    .pointer("/owner/login")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                source: r
                    .get("html_url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                licence: licence_of(r.pointer("/license/spdx_id").and_then(Value::as_str)),
                // Stars are the whole reason this list exists, and there is
                // nowhere else on an Item to put them.
                version: format!("{stars}★"),
                // No tool_id and no command: nothing here is installable, and
                // an Install button that guessed would be the manifest
                // detection problem pretending to be solved.
                ..Default::default()
            })
        })
        .collect()
}

/// Classify an SPDX id the way somebody deciding whether they can ship it
/// would.
pub fn licence_of(spdx: Option<&str>) -> String {
    let Some(id) = spdx.map(str::trim).filter(|s| {
        !s.is_empty() && !s.eq_ignore_ascii_case("NOASSERTION") && !s.eq_ignore_ascii_case("null")
    }) else {
        return "missing".into();
    };
    let up = id.to_ascii_uppercase();
    if up.starts_with("AGPL") || up.starts_with("SSPL") || up.starts_with("BUSL") {
        "restricted".into()
    } else if up.starts_with("GPL") || up.starts_with("LGPL") || up.starts_with("MPL") || up.starts_with("EPL") {
        "copyleft".into()
    } else {
        "permissive".into()
    }
}

/// The search query. One string so the test can read it.
pub fn github_query() -> String {
    TOPICS
        .iter()
        .map(|t| format!("topic:{t}"))
        .collect::<Vec<_>>()
        .join(" OR ")
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/// Run a blocking HTTP call on a plain OS thread.
///
/// `reqwest::blocking` builds its own tokio runtime and drops it when the call
/// finishes. Dropping a runtime inside another runtime's async context is a
/// panic — "Cannot drop a runtime in a context where blocking is not allowed"
/// — and a Tauri command body is exactly that context. It aborted the whole
/// process at startup and poisoned the database mutex on the way down.
///
/// A thread hop is the whole fix: the runtime is created and dropped on a
/// thread that belongs to nobody else.
fn off_runtime<T: Send + 'static>(
    what: &'static str,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    std::thread::spawn(f)
        .join()
        .map_err(|_| format!("the {what} fetch panicked"))?
}

fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("DevDeck/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("could not build an HTTP client: {e}"))
}

/// Percent-encode one query value.
///
/// Written out rather than pulled from a crate: the query is `topic:mcp OR
/// topic:ai-agent`, and a space or a colon that reaches GitHub unencoded is a
/// 422 rather than a search.
fn percent(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Ask the official registry what servers exist.
pub fn fetch_registry() -> Result<Vec<Item>, String> {
    off_runtime("registry", fetch_registry_blocking)
}

fn fetch_registry_blocking() -> Result<Vec<Item>, String> {
    let res = http()?
        .get(REGISTRY_URL)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("could not reach the MCP registry: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("the MCP registry answered {}", res.status()));
    }
    let body: Value = res
        .json()
        .map_err(|e| format!("the MCP registry returned something unreadable: {e}"))?;
    Ok(parse_registry(&body))
}

/// Ask GitHub for the most-starred AI tooling.
///
/// Authenticated when a token is stored, and it matters: unauthenticated
/// search is ten requests a minute, which will not carry an index of any size.
/// The 403 GitHub answers when that runs out says so in as many words, so it
/// is passed through rather than reworded into something vaguer.
pub fn fetch_github() -> Result<Vec<Item>, String> {
    off_runtime("GitHub", fetch_github_blocking)
}

fn fetch_github_blocking() -> Result<Vec<Item>, String> {
    let url = format!(
        "https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page=30",
        percent(&github_query())
    );
    let mut req = http()?
        .get(&url)
        .header("Accept", "application/vnd.github+json");
    if let Some(token) = crate::github::stored_token() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let res = req
        .send()
        .map_err(|e| format!("could not reach GitHub: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let hint = if status.as_u16() == 403 {
            " — add a GitHub token in Settings → Development; unauthenticated search is ten a minute"
        } else {
            ""
        };
        return Err(format!("GitHub answered {status}{hint}"));
    }
    let body: Value = res
        .json()
        .map_err(|e| format!("GitHub returned something unreadable: {e}"))?;
    Ok(parse_github(&body))
}

/// Refresh one source, and say honestly what came back.
///
/// A failed fetch does not clear the cache and does not return an empty list:
/// it returns the last good answer with `ok: false` and the reason. That is
/// the update-checker rule — a failure that renders as a clean empty result is
/// the bug this codebase already had once.
pub fn refresh(conn: &Connection, source: &str) -> Feed {
    let attempt = match source {
        SOURCE_REGISTRY => fetch_registry(),
        SOURCE_GITHUB => fetch_github(),
        s if trending_period(s).is_some() => fetch_trending(trending_period(s).unwrap()),
        other => Err(format!("no such index source '{other}'")),
    };
    match attempt {
        Ok(items) => {
            let at = now_ms();
            // Stars arrive here and nowhere else, so this is where a year of
            // history gets written — at no extra request.
            if source == SOURCE_GITHUB {
                let _ = snapshot(conn, &items, at);
            }
            let note = match source {
                SOURCE_REGISTRY => "Published to the official MCP registry, most recent first. \
                                    The registry carries no popularity signal."
                    .to_string(),
                SOURCE_GITHUB => "GitHub search, most starred first. A documented sort, not a \
                                  trending algorithm."
                    .to_string(),
                // Said plainly, because the alternative is letting people read
                // a scrape of an unpublished ranking as a measurement.
                s if trending_period(s).is_some() => format!(
                    "Scraped from github.com/trending ({}). The order is GitHub's own \
                     judgement by an algorithm they have never published — not a star count. \
                     Unfiltered, so nothing here declares a manifest.",
                    trending_period(s).unwrap()
                ),
                _ => String::new(),
            };
            let _ = store(conn, source, &items, at, &note);
            Feed {
                source: source.to_string(),
                items,
                ok: true,
                fetched_at: at,
                note,
            }
        }
        Err(e) => {
            let mut last = cached(conn, source);
            last.ok = false;
            last.note = e;
            last
        }
    }
}

// ---------------------------------------------------------------------------
// Trending — the one source with no API
// ---------------------------------------------------------------------------
//
// GitHub publishes no endpoint for its trending page, and has never published
// the algorithm behind it. So this is a scrape of somebody else's HTML, and
// everything about how it is presented follows from that:
//
//  * The order is **GitHub's judgement**, not a star count. The page says so,
//    because "most starred" and "trending" are different claims and only one
//    of them is a number we can defend.
//  * It **will break**. Markup changes without notice, and when it does the
//    honest answer is "we could not look", never an empty list. That is the
//    update-checker bug this codebase already had once.
//  * It is **unfiltered**. Trending is every repository on the site, and a
//    trending row carries no manifest — so nothing here is installable, and
//    every row says *No manifest* rather than being guessed at.

pub const SOURCE_TRENDING_WEEK: &str = "trending-week";
pub const SOURCE_TRENDING_MONTH: &str = "trending-month";

/// The `since` value GitHub wants for a source id.
pub fn trending_period(source: &str) -> Option<&'static str> {
    match source {
        SOURCE_TRENDING_WEEK => Some("weekly"),
        SOURCE_TRENDING_MONTH => Some("monthly"),
        _ => None,
    }
}

/// Undo the HTML entities GitHub's markup actually contains.
///
/// Not a general decoder: a description is escaped text, and these five are
/// what turn up. Anything else is left alone rather than half-decoded.
fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Strip tags and collapse whitespace, the way a person reading it would.
fn text_of(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    unescape(out.split_whitespace().collect::<Vec<_>>().join(" ").trim())
}

/// Read one trending page.
///
/// Returns nothing when the markup has changed under us — which the caller
/// must treat as a failure rather than as "nothing is trending". Those are
/// different facts and only one of them means anything.
pub fn parse_trending(html: &str, period: &str) -> Vec<Item> {
    let mut out = Vec::new();
    for chunk in html.split("<article class=\"Box-row\"").skip(1) {
        let article = chunk.split("</article>").next().unwrap_or(chunk);

        // The repository is the first /owner/name link inside the heading.
        let Some(head) = between(article, "<h2 class=\"h3 lh-condensed\">", "</h2>") else {
            continue;
        };
        let Some(full) = between(head, "href=\"/", "\"") else { continue };
        let full = full.trim_end_matches('/');
        // Owner/name and nothing else: /sponsors/x and /apps/y are not repos.
        let mut parts = full.split('/');
        let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if owner.is_empty() || name.is_empty() {
            continue;
        }

        let summary = between(article, "<p class=\"col-9", "</p>")
            .map(|p| text_of(p.split_once('>').map(|(_, r)| r).unwrap_or(p)))
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| "No description.".to_string());

        let language = between(article, "itemprop=\"programmingLanguage\">", "</span>")
            .map(text_of)
            .unwrap_or_default();

        // "1,234 stars this week" — the number GitHub itself puts on the row.
        // Kept as its own phrase rather than turned into a rank, because the
        // rank is GitHub's and this number is not what produced it.
        let gained = article
            .find("stars this")
            .and_then(|i| {
                let before = &article[..i];
                let start = before.rfind('>')? + 1;
                Some(before[start..].trim().to_string())
            })
            .filter(|n| n.chars().any(|c| c.is_ascii_digit()))
            .unwrap_or_default();

        out.push(Item {
            id: format!("trend.{period}.{full}"),
            kind: KIND_TOOL.into(),
            name: name.to_string(),
            summary,
            author: owner.to_string(),
            source: format!("https://github.com/{full}"),
            // The page carries no licence at all. "Missing" is the safe
            // reading and is visibly different from one we read.
            licence: "missing".into(),
            // The period is on the feed, not on every row — repeating it
            // twenty times says nothing the heading has not already said.
            version: if gained.is_empty() {
                language
            } else if language.is_empty() {
                format!("+{gained} stars")
            } else {
                format!("{language} · +{gained} stars")
            },
            // No command and no tool_id: a trending row declares nothing, so
            // there is nothing to install and nothing to guess.
            ..Default::default()
        });
    }
    out
}

/// The text between two markers, after the first.
fn between<'a>(hay: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = hay.find(start)? + start.len();
    let rest = &hay[i..];
    let j = rest.find(end)?;
    Some(&rest[..j])
}

/// Fetch and read one trending page.
pub fn fetch_trending(period: &str) -> Result<Vec<Item>, String> {
    let period = period.to_string();
    off_runtime("trending", move || fetch_trending_blocking(&period))
}

fn fetch_trending_blocking(period: &str) -> Result<Vec<Item>, String> {
    let res = http()?
        .get(format!("https://github.com/trending?since={period}"))
        .header("Accept", "text/html")
        .send()
        .map_err(|e| format!("could not reach github.com/trending: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("github.com/trending answered {}", res.status()));
    }
    let html = res
        .text()
        .map_err(|e| format!("github.com/trending returned something unreadable: {e}"))?;
    let items = parse_trending(&html, period);
    if items.is_empty() {
        // The page loaded and we understood none of it. That is the scrape
        // breaking, and it must never render as "nothing is trending".
        return Err(
            "github.com/trending loaded but nothing on it could be read — the page's markup \
             has probably changed. Showing the last good list."
                .into(),
        );
    }
    Ok(items)
}

// ---------------------------------------------------------------------------
// The year — DevDeck's own arithmetic, because GitHub has no such page
// ---------------------------------------------------------------------------
//
// GitHub Trending offers today, this week and this month. There is no year,
// and there is no endpoint for "stars gained in the last twelve months"
// either. So this is the one list DevDeck computes itself, from snapshots it
// takes of the star counts it has already fetched.
//
// Two consequences, and the page states both rather than letting a reader
// assume otherwise:
//
//  * **It is empty at first, and thin for months.** History starts the day
//    you install DevDeck. Twelve months of it takes twelve months. The
//    alternative — walking the stargazers API for timestamps — is paginated,
//    slow and capped, and would spend an hour of rate limit to answer one
//    page.
//  * **Its ranks are not comparable with week and month.** Those are GitHub's
//    unpublished judgement over recent activity; this is a subtraction over
//    whatever window we happen to have. A repository that is large and
//    declining appears here and never there, which is the point of having it
//    — and exactly why the two orders must not be read as one scale.

pub const SOURCE_YEAR: &str = "year";

pub const SNAPSHOT_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS community_stars (
    repo TEXT NOT NULL,
    -- Unix millis of the reading.
    at INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    PRIMARY KEY (repo, at)
);
";

/// How long a window the year list reports over.
const YEAR_MS: i64 = 365 * 86_400_000;

/// One repository's growth over whatever history we hold.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Growth {
    pub repo: String,
    pub gained: i64,
    pub latest: i64,
    /// Millis between the oldest and newest reading used. Reported because a
    /// gain over eleven days and a gain over eleven months are not the same
    /// number, and only one of them is what the heading claims.
    pub span_ms: i64,
}

/// Record what we just learned about star counts.
///
/// Called with whatever the GitHub search returned, because that is the only
/// place stars arrive from — this takes no extra requests, which is what makes
/// a year of history affordable at all.
pub fn snapshot(conn: &Connection, items: &[Item], at: i64) -> Result<usize, String> {
    let mut n = 0;
    for i in items {
        let Some(stars) = stars_of(&i.version) else { continue };
        let repo = i.source.trim_start_matches("https://github.com/").to_string();
        if repo.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO community_stars (repo, at, stars) VALUES (?1,?2,?3)",
            params![repo, at, stars],
        )
        .map_err(err)?;
        n += 1;
    }
    Ok(n)
}

/// Read a star count back out of the display string the search put it in.
///
/// A little grubby, and the alternative was a field on `Item` that only one of
/// four sources could ever fill. Returns nothing for anything that is not a
/// star count, so a trending row's "JavaScript · +1,204 stars" is not mistaken
/// for a total.
pub fn stars_of(version: &str) -> Option<i64> {
    let v = version.trim();
    let digits = v.strip_suffix('★')?;
    digits.replace(',', "").parse::<i64>().ok()
}

/// Growth per repository, newest reading minus oldest, within the window.
///
/// Only repositories with two readings appear: one reading is a number, not a
/// change, and showing it as a gain of zero would put every newly-seen
/// repository at the bottom of a list it has not earned a place in.
pub fn growth(conn: &Connection, now: i64) -> Result<Vec<Growth>, String> {
    let since = now - YEAR_MS;
    let mut stmt = conn
        .prepare(
            "SELECT repo, MIN(at), MAX(at), COUNT(*) FROM community_stars \
             WHERE at >= ?1 GROUP BY repo HAVING COUNT(*) > 1",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![since], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(err)?;

    let mut out = Vec::new();
    for row in rows {
        let (repo, first_at, last_at) = row.map_err(err)?;
        let first: i64 = conn
            .query_row(
                "SELECT stars FROM community_stars WHERE repo = ?1 AND at = ?2",
                params![repo, first_at],
                |r| r.get(0),
            )
            .map_err(err)?;
        let last: i64 = conn
            .query_row(
                "SELECT stars FROM community_stars WHERE repo = ?1 AND at = ?2",
                params![repo, last_at],
                |r| r.get(0),
            )
            .map_err(err)?;
        out.push(Growth {
            repo,
            gained: last - first,
            latest: last,
            span_ms: last_at - first_at,
        });
    }
    out.sort_by(|a, b| b.gained.cmp(&a.gained));
    Ok(out)
}

/// The year list, from the history we hold and the names we already know.
pub fn year_feed(conn: &Connection, now: i64) -> Feed {
    let rows = match growth(conn, now) {
        Ok(r) => r,
        Err(e) => {
            return Feed {
                source: SOURCE_YEAR.into(),
                ok: false,
                note: e,
                ..Default::default()
            }
        }
    };
    // Names and descriptions come from the GitHub feed we already cached, so
    // this costs no requests at all.
    let known = cached(conn, SOURCE_GITHUB);
    let widest = rows.iter().map(|g| g.span_ms).max().unwrap_or(0);
    let days = widest / 86_400_000;

    let items = rows
        .iter()
        .filter(|g| g.gained != 0)
        .filter_map(|g| {
            let base = known
                .items
                .iter()
                .find(|i| i.source.ends_with(&g.repo))
                .cloned()
                .unwrap_or_else(|| Item {
                    name: g.repo.rsplit('/').next().unwrap_or(&g.repo).to_string(),
                    summary: "No description — seen only in a star reading.".into(),
                    author: g.repo.split('/').next().unwrap_or_default().to_string(),
                    source: format!("https://github.com/{}", g.repo),
                    licence: "missing".into(),
                    ..Default::default()
                });
            Some(Item {
                id: format!("year.{}", g.repo),
                kind: KIND_TOOL.into(),
                version: format!("{:+} stars · now {}", g.gained, g.latest),
                // Never installable: this is an observation about a
                // repository, not a thing anybody published to be run.
                command: String::new(),
                tool_id: String::new(),
                ..base
            })
        })
        .collect::<Vec<_>>();

    Feed {
        source: SOURCE_YEAR.into(),
        ok: true,
        fetched_at: if items.is_empty() { 0 } else { now },
        note: if items.is_empty() {
            "Nothing yet. This list is DevDeck's own arithmetic over star readings it has \
             taken, and history starts the day you install it — refresh the GitHub list a \
             few times, on different days, and repositories appear here."
                .into()
        } else {
            format!(
                "DevDeck's own arithmetic: stars gained over the readings we hold, widest \
                 span {days} day(s). Not comparable with the trending lists — those are \
                 GitHub's judgement over recent activity, this is a subtraction."
            )
        },
        items,
    }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

pub fn cached(conn: &Connection, source: &str) -> Feed {
    let row: Result<(String, i64, String), _> = conn.query_row(
        "SELECT items, fetched_at, note FROM community_index WHERE source = ?1",
        params![source],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    );
    match row {
        Ok((json, at, note)) => Feed {
            source: source.to_string(),
            items: serde_json::from_str(&json).unwrap_or_default(),
            // Read from the cache, so this is the last good answer rather than
            // a fresh one. The caller decides what `ok` means for its own
            // attempt; here it reports only that something was stored.
            ok: at > 0,
            fetched_at: at,
            note,
        },
        Err(_) => Feed {
            source: source.to_string(),
            ..Default::default()
        },
    }
}

pub fn store(conn: &Connection, source: &str, items: &[Item], at: i64, note: &str) -> Result<(), String> {
    let json = serde_json::to_string(items).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO community_index (source, items, fetched_at, note) VALUES (?1,?2,?3,?4)",
        params![source, json, at, note],
    )
    .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_npm_package_becomes_a_command_and_an_unknown_one_becomes_nothing() {
        assert_eq!(
            command_for("npm", "pretrip-mcp", "1.0.1").unwrap(),
            "npx -y pretrip-mcp@1.0.1"
        );
        assert_eq!(command_for("npm", "x", "").unwrap(), "npx -y x");
        assert_eq!(command_for("pypi", "mcp-thing", "2.0").unwrap(), "uvx mcp-thing");
        // An Install button that would fail on click is worse than no button.
        assert!(command_for("cargo", "thing", "1").is_none());
        assert!(command_for("npm", "  ", "1").is_none());
    }

    #[test]
    fn an_http_only_server_is_not_offered_because_we_speak_stdio() {
        // The registry is full of these. Listing one would put an Install
        // button in front of somebody that could never work.
        let body: Value = serde_json::from_str(
            r#"{"servers":[{"server":{"name":"ac.inference.sh/mcp","description":"d",
                 "version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://x"}]}}]}"#,
        )
        .unwrap();
        assert!(parse_registry(&body).is_empty());
    }

    #[test]
    fn a_stdio_server_becomes_an_installable_item() {
        let body: Value = serde_json::from_str(
            r#"{"servers":[{"server":{
                 "name":"agency.kesey/pretrip","title":"PreTrip","description":"Trip planning",
                 "version":"1.0.1",
                 "packages":[{"registryType":"npm","identifier":"pretrip-mcp","version":"1.0.1",
                              "transport":{"type":"stdio"}}]}}]}"#,
        )
        .unwrap();
        let items = parse_registry(&body);
        assert_eq!(items.len(), 1);
        let i = &items[0];
        assert_eq!(i.name, "PreTrip");
        assert_eq!(i.kind, KIND_TOOL);
        assert_eq!(i.command, "npx -y pretrip-mcp@1.0.1");
        assert_eq!(i.tool_id, "mcp.pretrip");
        assert_eq!(i.author, "agency.kesey");
        assert_eq!(
            i.licence, "missing",
            "the registry publishes no licence, and no licence means no permission"
        );
    }

    #[test]
    fn only_the_latest_active_version_of_a_server_is_listed() {
        // The registry serves every version ever published. Without this,
        // "Aether Wealth" arrived as five identical rows differing only in a
        // version number, which is a list nobody can read.
        let body: Value = serde_json::from_str(
            r#"{"servers":[
              {"server":{"name":"a/b","version":"1.0.0",
                "packages":[{"registryType":"npm","identifier":"b","transport":{"type":"stdio"}}]},
               "_meta":{"io.modelcontextprotocol.registry/official":{"isLatest":false,"status":"active"}}},
              {"server":{"name":"a/b","version":"2.0.0",
                "packages":[{"registryType":"npm","identifier":"b","transport":{"type":"stdio"}}]},
               "_meta":{"io.modelcontextprotocol.registry/official":{"isLatest":true,"status":"active"}}},
              {"server":{"name":"c/d","version":"1.0.0",
                "packages":[{"registryType":"npm","identifier":"d","transport":{"type":"stdio"}}]},
               "_meta":{"io.modelcontextprotocol.registry/official":{"isLatest":true,"status":"deleted"}}},
              {"server":{"name":"e/f","version":"1.0.0",
                "packages":[{"registryType":"npm","identifier":"f","transport":{"type":"stdio"}}]}}
            ]}"#,
        )
        .unwrap();
        let items = parse_registry(&body);
        let names: Vec<_> = items.iter().map(|i| i.version.as_str()).collect();
        assert_eq!(items.len(), 2, "one row per server: {names:?}");
        assert_eq!(items[0].version, "2.0.0", "the latest, not the first seen");
        assert_eq!(
            items[1].author, "e",
            "a server whose metadata says nothing is kept, not silently dropped"
        );
    }

    #[test]
    fn a_server_whose_only_package_is_unrunnable_is_left_out() {
        let body: Value = serde_json::from_str(
            r#"{"servers":[{"server":{"name":"a/b","version":"1",
                 "packages":[{"registryType":"nuget","identifier":"x","transport":{"type":"stdio"}}]}}]}"#,
        )
        .unwrap();
        assert!(parse_registry(&body).is_empty());
    }

    #[test]
    fn a_tool_id_is_reduced_to_something_a_permission_key_can_hold() {
        assert_eq!(slug("PreTrip"), "pretrip");
        assert_eq!(slug("server-fetch"), "server-fetch");
        // Trailing punctuation is trimmed, so a key never ends in a dash.
        assert_eq!(slug("Weird Name!"), "weird-name");
        assert_eq!(slug("@scope/thing"), "scope-thing");
    }

    #[test]
    fn github_repositories_carry_stars_and_no_install() {
        let body: Value = serde_json::from_str(
            r#"{"items":[{"full_name":"anthropics/servers","name":"servers",
                 "description":"Reference MCP servers","stargazers_count":41234,
                 "html_url":"https://github.com/anthropics/servers",
                 "owner":{"login":"anthropics"},"license":{"spdx_id":"MIT"}}]}"#,
        )
        .unwrap();
        let items = parse_github(&body);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].version, "41234★");
        assert_eq!(items[0].licence, "permissive");
        assert!(
            items[0].command.is_empty() && items[0].tool_id.is_empty(),
            "a repository is not an installable server, and guessing how to run it \
             is the manifest problem pretending to be solved"
        );
    }

    #[test]
    fn a_licence_is_classified_the_way_someone_shipping_it_would() {
        assert_eq!(licence_of(Some("MIT")), "permissive");
        assert_eq!(licence_of(Some("Apache-2.0")), "permissive");
        assert_eq!(licence_of(Some("GPL-3.0")), "copyleft");
        assert_eq!(licence_of(Some("AGPL-3.0")), "restricted");
        assert_eq!(licence_of(Some("SSPL-1.0")), "restricted");
        // The three ways GitHub says "we do not know".
        assert_eq!(licence_of(None), "missing");
        assert_eq!(licence_of(Some("NOASSERTION")), "missing");
        assert_eq!(licence_of(Some("")), "missing");
    }

    #[test]
    fn the_query_asks_only_for_things_a_bot_could_hold() {
        let q = github_query();
        assert!(q.contains("topic:mcp"));
        assert!(q.contains("topic:ai-agent"));
        assert!(q.contains(" OR "), "any of the topics, not all of them: {q}");
    }

    #[test]
    fn a_cache_that_has_never_been_filled_is_not_ok_and_is_not_an_error() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let f = cached(&conn, SOURCE_GITHUB);
        assert!(!f.ok);
        assert_eq!(f.fetched_at, 0);
        assert!(f.items.is_empty());
    }

    #[test]
    fn the_cache_keeps_the_last_good_answer_and_when_it_was_taken() {
        // The whole point: a fetch that fails later must not turn this into
        // "nothing is published".
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let items = vec![Item {
            id: "repo.a/b".into(),
            name: "b".into(),
            ..Default::default()
        }];
        store(&conn, SOURCE_GITHUB, &items, 1_700_000_000_000, "most starred").unwrap();

        let f = cached(&conn, SOURCE_GITHUB);
        assert!(f.ok);
        assert_eq!(f.fetched_at, 1_700_000_000_000);
        assert_eq!(f.items.len(), 1);
        assert_eq!(f.note, "most starred");
    }

    /// A trimmed capture of the real page, September 2026. Two rows, one of
    /// them without a language, plus the navigation links that are not
    /// repositories and must not be read as ones.
    const TRENDING_HTML: &str = r##"
<a href="/trending/developers">Developers</a>
<a href="/sponsors/explore">Explore sponsors</a>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a data-hydro-click="{&quot;event_type&quot;:&quot;explore.click&quot;}" href="/affaan-m/ECC">
      <svg aria-hidden="true"></svg>
      <span class="text-normal">affaan-m /</span>
      ECC
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">
    The agent harness performance optimization system. Skills &amp; memory for Claude Code.
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span itemprop="programmingLanguage">JavaScript</span>
    <a href="/affaan-m/ECC/stargazers">12,043</a>
    <span class="d-inline-block float-sm-right">
      <svg aria-hidden="true"></svg>
      1,204 stars this week
    </span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/some-org/quiet-tool">
      <span class="text-normal">some-org /</span>
      quiet-tool
    </a>
  </h2>
  <div class="f6 color-fg-muted mt-2">
    <span class="d-inline-block float-sm-right">
      98 stars this week
    </span>
  </div>
</article>
"##;

    #[test]
    fn a_trending_page_is_read_into_rows_that_declare_nothing() {
        let items = parse_trending(TRENDING_HTML, "week");
        assert_eq!(items.len(), 2, "the nav links are not repositories: {items:?}");

        let a = &items[0];
        assert_eq!(a.name, "ECC");
        assert_eq!(a.author, "affaan-m");
        assert_eq!(a.source, "https://github.com/affaan-m/ECC");
        assert!(a.summary.contains("Skills & memory"), "entities decoded: {}", a.summary);
        assert_eq!(a.version, "JavaScript · +1,204 stars");
        assert!(
            a.command.is_empty() && a.tool_id.is_empty(),
            "a trending row declares nothing, so there is nothing to install"
        );
        assert_eq!(a.licence, "missing", "the page carries no licence at all");

        // A row with no description and no language still reads, and says so
        // rather than showing an empty cell.
        let b = &items[1];
        assert_eq!(b.name, "quiet-tool");
        assert_eq!(b.summary, "No description.");
        assert_eq!(b.version, "+98 stars");
    }

    #[test]
    fn markup_we_cannot_read_is_a_failure_not_an_empty_trending_list() {
        // The whole reason a scrape needs its own rule. GitHub can change this
        // page without notice, and the day it does the answer must be "we
        // could not look" — never "nothing is trending".
        assert!(
            parse_trending("<html><body>a redesign happened</body></html>", "week").is_empty(),
            "nothing recognised"
        );
        // …and `fetch_trending` turns exactly that into an Err, which
        // `refresh` renders as the last good list plus a reason. Asserted at
        // the seam rather than over the network: the network is not the part
        // that is easy to get wrong.
        let feed = Feed {
            source: SOURCE_TRENDING_WEEK.into(),
            items: vec![Item { id: "trend.week.a/b".into(), ..Default::default() }],
            ok: false,
            fetched_at: 1_700_000_000_000,
            note: "markup changed".into(),
        };
        assert!(!feed.ok);
        assert_eq!(feed.items.len(), 1, "the last good list survives the failure");
        assert!(feed.fetched_at > 0, "and still says when it was last true");
    }

    #[test]
    fn each_trending_period_asks_github_for_that_period() {
        assert_eq!(trending_period(SOURCE_TRENDING_WEEK), Some("weekly"));
        assert_eq!(trending_period(SOURCE_TRENDING_MONTH), Some("monthly"));
        // There is no year on GitHub. Asking for one has to be nothing here
        // rather than a period that quietly means something else.
        assert_eq!(trending_period("trending-year"), None);
        assert_eq!(trending_period(SOURCE_GITHUB), None);
    }


    fn star_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        c.execute_batch(SNAPSHOT_SCHEMA).unwrap();
        c
    }

    fn repo(full: &str, stars: i64) -> Item {
        Item {
            id: format!("repo.{full}"),
            name: full.rsplit('/').next().unwrap().into(),
            source: format!("https://github.com/{full}"),
            version: format!("{stars}★"),
            ..Default::default()
        }
    }

    #[test]
    fn a_star_count_is_read_back_only_from_a_star_count() {
        assert_eq!(stars_of("41234★"), Some(41234));
        assert_eq!(stars_of("1,204★"), Some(1204));
        // A trending row's gain is not a total, and reading it as one would
        // put a made-up number into a year of history.
        assert_eq!(stars_of("JavaScript · +1,204 stars"), None);
        assert_eq!(stars_of("1.0.0"), None);
        assert_eq!(stars_of(""), None);
    }

    #[test]
    fn one_reading_is_a_number_not_a_change() {
        // Every repository is new once. Showing it as a gain of zero would
        // fill the list with rows that have not earned a place in it.
        let c = star_db();
        snapshot(&c, &[repo("a/b", 100)], 1_000).unwrap();
        assert!(growth(&c, 2_000).unwrap().is_empty());
    }

    #[test]
    fn growth_is_newest_minus_oldest_and_says_over_how_long() {
        let c = star_db();
        let day = 86_400_000i64;
        snapshot(&c, &[repo("a/b", 100), repo("c/d", 900)], 10 * day).unwrap();
        snapshot(&c, &[repo("a/b", 150), repo("c/d", 800)], 40 * day).unwrap();

        let g = growth(&c, 50 * day).unwrap();
        assert_eq!(g.len(), 2);
        // Sorted by gain, so the one that grew is first and the one that
        // shrank is last — a decline is a real answer, not a filter.
        assert_eq!(g[0].repo, "a/b");
        assert_eq!(g[0].gained, 50);
        assert_eq!(g[0].latest, 150);
        assert_eq!(g[0].span_ms, 30 * day, "and over how long it was measured");
        assert_eq!(g[1].repo, "c/d");
        assert_eq!(g[1].gained, -100, "a repository can lose stars");
    }

    #[test]
    fn readings_older_than_the_window_are_left_out() {
        let c = star_db();
        let day = 86_400_000i64;
        snapshot(&c, &[repo("a/b", 10)], 0).unwrap();
        snapshot(&c, &[repo("a/b", 20)], 100 * day).unwrap();
        // Now is two years after the first reading, so only the second is in
        // the window — and one reading is not a change.
        assert!(growth(&c, 800 * day).unwrap().is_empty());
    }

    #[test]
    fn the_year_says_it_is_empty_and_why_rather_than_pretending() {
        // The honest first-run state, and the one most likely to be papered
        // over: an empty list that looks like a failure when it is really
        // "history starts today".
        let c = star_db();
        let f = year_feed(&c, 1_000_000);
        assert!(f.ok, "empty is not an error");
        assert!(f.items.is_empty());
        assert_eq!(f.fetched_at, 0, "nothing was measured, so no time is claimed");
        assert!(f.note.contains("history starts the day you install"), "{}", f.note);
    }

    #[test]
    fn the_year_says_its_ranks_are_not_comparable_with_trending() {
        // The spec is explicit about this, and it is the whole reason the year
        // is allowed to exist beside two lists it does not share a scale with.
        let c = star_db();
        let day = 86_400_000i64;
        snapshot(&c, &[repo("a/b", 100)], 1 * day).unwrap();
        snapshot(&c, &[repo("a/b", 260)], 31 * day).unwrap();

        let f = year_feed(&c, 40 * day);
        assert!(f.ok);
        assert_eq!(f.items.len(), 1);
        assert!(f.items[0].version.contains("+160"), "{}", f.items[0].version);
        assert!(f.note.contains("Not comparable"), "{}", f.note);
        assert!(f.note.contains("30 day"), "and over what span: {}", f.note);
        assert!(
            f.items[0].command.is_empty(),
            "an observation about a repository is not something to install"
        );
    }

}
