//! Reading a business's website into suggestions it can agree to.
//!
//! Knows nothing about decks, spaces or the database. It turns HTML into
//! text, text into a prompt, and a reply into suggestions, and it is honest
//! about which is which: a suggestion that claims to quote the site is checked
//! against the site's own words, and one that does not appear there stops
//! claiming to be a quote.

use serde::{Deserialize, Serialize};

/// The first words of the prompt. The mock provider recognises a site read by
/// them.
pub const SITE_MARK: &str = "You are reading a business's website";

pub const SITE_SYSTEM: &str = "\
You are reading a business's website so that its owner can agree what the
business is. The owner will see every line you return and say yes or no to it.

Return ONLY JSON, ONE OBJECT PER LINE. No prose, no code fence, no array.
Each line:

  {\"field\": \"what\" | \"serves\" | \"industry\" | \"where\" | \"product\" | \"service\",
   \"text\": \"the suggestion, short\",
   \"kind\": \"quote\" | \"suggestion\" | \"guess\",
   \"source\": \"where on the site this came from, in plain words\"}

field:
  what      what the business does, in one sentence
  serves    who its customers are
  industry  one industry per line, one or two words
  where     the city or country it is based in or works in
  product   something the business builds and sells, one per line
  service   work the business does for a customer, one per line

kind is how sure you are, and it matters:
  quote       the text is copied word for word from the site
  suggestion  the site says it in other words, and you can point at where
  guess       the site does not say it; you are inferring it

Never present a guess as a quote or a suggestion. Never invent a product name
the site does not use: if you think there must be a product but the site does
not name it, describe it and mark it a guess. If the site does not say where
the business is, return no where line. Fewer true lines beat many guesses.";

pub const FIELDS: &[&str] = &["what", "serves", "industry", "where", "product", "service"];

/// One line of a site read, as the model returned it and after checking.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SiteLine {
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SiteLink {
    pub href: String,
    pub text: String,
}

/// A page, as text.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SiteText {
    pub url: String,
    pub title: String,
    pub description: String,
    pub headings: Vec<String>,
    pub text: String,
    pub links: Vec<SiteLink>,
}

/// Words, lowercased, with punctuation dropped: what a quote is checked in.
fn words(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = true;
    for c in s.chars() {
        let c = if c == '&' { ' ' } else { c };
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            space = false;
        } else if !space {
            out.push(' ');
            space = true;
        }
    }
    out.trim().to_string()
}

/// Whether `needle` appears in `hay` word for word, ignoring case,
/// punctuation and spacing. What "quote" is held to.
pub fn contains_words(hay: &str, needle: &str) -> bool {
    let n = words(needle);
    !n.is_empty() && format!(" {} ", words(hay)).contains(&format!(" {n} "))
}

/// Every line in a reply that is a suggestion, checked and tidied.
///
/// A line claiming to be a quote that is not on the site becomes a
/// suggestion: the text may still be right, but it is not the site's words
/// and the screen must not say it is. A kind nobody recognises is a guess,
/// the side that asks the most of the reader.
pub fn parse_site_lines(reply: &str, site_text: &str) -> Vec<SiteLine> {
    let mut out: Vec<SiteLine> = Vec::new();
    for raw in reply.lines() {
        let l = raw.trim().trim_end_matches(',');
        if !l.starts_with('{') || !l.ends_with('}') {
            continue;
        }
        let Ok(mut s) = serde_json::from_str::<SiteLine>(l) else {
            continue;
        };
        s.field = s.field.trim().to_ascii_lowercase();
        s.text = s.text.trim().trim_matches('"').trim().to_string();
        s.source = s.source.trim().to_string();
        if !FIELDS.contains(&s.field.as_str()) || s.text.is_empty() {
            continue;
        }
        s.kind = match s.kind.trim().to_ascii_lowercase().as_str() {
            "quote" => "quote".into(),
            "suggestion" => "suggestion".into(),
            _ => "guess".into(),
        };
        if s.kind == "quote" && !contains_words(site_text, &s.text) {
            s.kind = "suggestion".into();
        }
        if out
            .iter()
            .any(|o| o.field == s.field && o.text.eq_ignore_ascii_case(&s.text))
        {
            continue;
        }
        out.push(s);
    }
    out
}

// ---------------------------------------------------------------------------
// HTML into text
// ---------------------------------------------------------------------------

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let Some(end) = after.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &after[1..];
            continue;
        };
        let ent = &after[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "ndash" => Some('-'),
            "mdash" => Some('-'),
            "rsquo" | "lsquo" => Some('\''),
            "rdquo" | "ldquo" => Some('"'),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &after[end + 1..];
            }
            None => {
                out.push('&');
                rest = &after[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Remove `<tag ...>...</tag>` blocks whose content is never text.
fn drop_blocks(html: &str, tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    while let Some(start) = lower[i..].find(&open).map(|s| s + i) {
        out.push_str(&html[i..start]);
        match lower[start..].find(&close) {
            Some(e) => i = start + e + close.len(),
            None => {
                i = html.len();
                break;
            }
        }
    }
    if i < html.len() {
        out.push_str(&html[i..]);
    }
    out
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    collapse(&decode_entities(&out))
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(p) = lower[from..].find(name).map(|p| p + from) {
        let before_ok = p == 0 || !lower.as_bytes()[p - 1].is_ascii_alphanumeric();
        let after = &tag[p + name.len()..];
        let trimmed = after.trim_start();
        if before_ok && trimmed.starts_with('=') {
            let v = trimmed[1..].trim_start();
            let (q, body) = match v.chars().next() {
                Some('"') => ('"', &v[1..]),
                Some('\'') => ('\'', &v[1..]),
                _ => {
                    let end = v
                        .find(|c: char| c.is_whitespace() || c == '>')
                        .unwrap_or(v.len());
                    return Some(decode_entities(&v[..end]));
                }
            };
            let end = body.find(q).unwrap_or(body.len());
            return Some(decode_entities(&body[..end]));
        }
        from = p + name.len();
    }
    None
}

/// Every `<tag ...>inner</tag>` as (opening tag, inner html).
fn elements<'a>(html: &'a str, lower: &str, tag: &str) -> Vec<(&'a str, &'a str)> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(s) = lower[i..].find(&open).map(|s| s + i) {
        let next = lower
            .as_bytes()
            .get(s + open.len())
            .copied()
            .unwrap_or(b'>');
        if next.is_ascii_alphanumeric() {
            i = s + open.len();
            continue;
        }
        let Some(gt) = lower[s..].find('>').map(|g| g + s) else {
            break;
        };
        let Some(e) = lower[gt..].find(&close).map(|e| e + gt) else {
            break;
        };
        out.push((&html[s..=gt], &html[gt + 1..e]));
        i = e + close.len();
    }
    out
}

/// A page as text: its title, description, headings, words and links.
///
/// Not an HTML parser, and it does not need to be: it has to find the words a
/// person would read on the page, and a malformed page yields fewer words
/// rather than an error.
pub fn html_to_text(html: &str, url: &str) -> SiteText {
    let mut cleaned = html.to_string();
    for t in ["script", "style", "noscript", "svg", "template"] {
        cleaned = drop_blocks(&cleaned, t);
    }
    let lower = cleaned.to_ascii_lowercase();

    let title = elements(&cleaned, &lower, "title")
        .first()
        .map(|(_, inner)| strip_tags(inner))
        .unwrap_or_default();

    let mut description = String::new();
    let mut i = 0;
    while let Some(s) = lower[i..].find("<meta").map(|s| s + i) {
        let Some(e) = lower[s..].find('>').map(|e| e + s) else {
            break;
        };
        let tag = &cleaned[s..=e];
        let key = attr(tag, "name")
            .or_else(|| attr(tag, "property"))
            .unwrap_or_default()
            .to_ascii_lowercase();
        if (key == "description" || key == "og:description") && description.is_empty() {
            description = collapse(&attr(tag, "content").unwrap_or_default());
        }
        i = e + 1;
    }

    let mut headings = Vec::new();
    for t in ["h1", "h2", "h3"] {
        for (_, inner) in elements(&cleaned, &lower, t) {
            let h = strip_tags(inner);
            if !h.is_empty() && !headings.contains(&h) {
                headings.push(h);
            }
        }
    }

    let mut links = Vec::new();
    for (tag, inner) in elements(&cleaned, &lower, "a") {
        let Some(href) = attr(tag, "href") else {
            continue;
        };
        let text = strip_tags(inner);
        if href.trim().is_empty() {
            continue;
        }
        links.push(SiteLink {
            href: absolute(url, href.trim()),
            text,
        });
    }

    let body = match lower.find("<body") {
        Some(b) => &cleaned[b..],
        None => &cleaned[..],
    };
    let text = strip_tags(body);

    SiteText {
        url: url.to_string(),
        title,
        description,
        headings,
        text,
        links,
    }
}

fn absolute(base: &str, href: &str) -> String {
    match reqwest::Url::parse(base).and_then(|b| b.join(href)) {
        Ok(u) => u.to_string(),
        Err(_) => href.to_string(),
    }
}

/// Too little on the page to say anything: a site drawn by script returns its
/// title and not much else to a plain fetch.
pub fn is_thin(t: &SiteText) -> bool {
    t.text.chars().count() < 400
}

/// Pages on the same site worth reading after the first: navigation links,
/// not anchors, files or mail links. At most `max`.
pub fn same_site_links(t: &SiteText, max: usize) -> Vec<String> {
    let Ok(base) = reqwest::Url::parse(&t.url) else {
        return Vec::new();
    };
    let host = base
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_string();
    let mut out: Vec<String> = Vec::new();
    for l in &t.links {
        let Ok(mut u) = reqwest::Url::parse(&l.href) else {
            continue;
        };
        if !matches!(u.scheme(), "http" | "https") {
            continue;
        }
        if u.host_str().unwrap_or_default().trim_start_matches("www.") != host {
            continue;
        }
        u.set_fragment(None);
        let path = u.path().to_ascii_lowercase();
        let skip = [
            ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".zip", ".docx", ".xlsx", ".mp4",
        ];
        if skip.iter().any(|x| path.ends_with(x)) {
            continue;
        }
        if u.path() == base.path() || u.path() == "/" {
            continue;
        }
        let s = u.to_string();
        if !out.contains(&s) {
            out.push(s);
        }
        if out.len() >= max {
            break;
        }
    }
    out
}

/// The prompt body: every page read, marked, so the model can say where on
/// the site each line came from.
pub fn render_context(name: &str, website: &str, pages: &[SiteText]) -> String {
    let mut s = format!("# The business\n\nName: {name}\nWebsite: {website}\n\n");
    for p in pages {
        s.push_str(&format!("# Page: {}\n\n", p.url));
        if !p.title.is_empty() {
            s.push_str(&format!("Title: {}\n", p.title));
        }
        if !p.description.is_empty() {
            s.push_str(&format!("Description: {}\n", p.description));
        }
        if !p.headings.is_empty() {
            s.push_str(&format!("Headings: {}\n", p.headings.join(" | ")));
        }
        s.push('\n');
        let text: String = p.text.chars().take(12_000).collect();
        s.push_str(&text);
        s.push_str("\n\n");
    }
    s
}

/// Everything the site says, as one string, for checking quotes against.
pub fn all_text(pages: &[SiteText]) -> String {
    pages
        .iter()
        .map(|p| {
            format!(
                "{} {} {} {}",
                p.title,
                p.description,
                p.headings.join(" "),
                p.text
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

const INDUSTRIES: &[(&str, &str)] = &[
    ("mining", "Mining"),
    ("asset management", "Asset management"),
    ("logistics", "Logistics"),
    ("retail", "Retail"),
    ("healthcare", "Healthcare"),
    ("construction", "Construction"),
    ("agriculture", "Agriculture"),
    ("manufacturing", "Manufacturing"),
    ("education", "Education"),
    ("finance", "Finance"),
    ("insurance", "Insurance"),
    ("energy", "Energy"),
    ("transport", "Transport"),
    ("hospitality", "Hospitality"),
    ("real estate", "Real estate"),
    ("software", "Software"),
    ("security", "Security"),
    ("rfid", "RFID"),
];

/// What the mock provider says about a site. A provider, not a bypass: it
/// reads the pages it was sent, quotes only words that are on them, and says
/// in every line it could not quote that it is the mock guessing.
pub fn mock_reply(context: &str) -> String {
    let mut lines: Vec<serde_json::Value> = Vec::new();
    let mut title = String::new();
    let mut description = String::new();
    for l in context.lines() {
        if title.is_empty() {
            if let Some(t) = l.strip_prefix("Title: ") {
                title = t.trim().to_string();
            }
        }
        if description.is_empty() {
            if let Some(d) = l.strip_prefix("Description: ") {
                description = d.trim().to_string();
            }
        }
    }
    // The longest part of the title is usually the line that says what the
    // business does: "NAME | What it does".
    let what = if !description.is_empty() {
        description.clone()
    } else {
        title
            .split(['|', '-', '–'])
            .map(str::trim)
            .max_by_key(|p| p.split_whitespace().count())
            .unwrap_or_default()
            .to_string()
    };
    if !what.is_empty() {
        lines.push(serde_json::json!({
            "field": "what", "text": what, "kind": "quote",
            "source": if description.is_empty() { "the page title" } else { "the page description" },
        }));
    }
    let lower = context.to_ascii_lowercase();
    let found: Vec<&str> = INDUSTRIES
        .iter()
        .filter(|(k, _)| lower.contains(k))
        .map(|(_, v)| *v)
        .collect();
    for ind in &found {
        lines.push(serde_json::json!({
            "field": "industry", "text": ind, "kind": "suggestion",
            "source": format!("the word \u{201c}{}\u{201d} on the site", ind),
        }));
    }
    if !found.is_empty() {
        lines.push(serde_json::json!({
            "field": "serves", "text": format!("Businesses in {} (guessed by the mock provider)", found.join(", ").to_lowercase()),
            "kind": "guess", "source": "the mock provider cannot read a site, only its words",
        }));
        for ind in found.iter().filter(|i| **i != "RFID").take(2) {
            lines.push(serde_json::json!({
                "field": "product", "text": format!("A {} product (guessed by the mock provider)", ind.to_lowercase()),
                "kind": "guess", "source": format!("\u{201c}{}\u{201d} on the site; no product is named", ind),
            }));
        }
        lines.push(serde_json::json!({
            "field": "service", "text": "Installation and support (guessed by the mock provider)",
            "kind": "guess", "source": "not stated on the site",
        }));
    }
    lines
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_becomes_the_words_a_person_reads() {
        let html = r##"<html><head><title>INNOTRACK | RFID Enabled Solutions for Mining &amp; Asset Management</title>
            <meta name="description" content="Tracking &amp; tagging">
            <script>var x = "<h1>not this</h1>";</script><style>.a{}</style></head>
            <body><nav><a href="/about">About us</a><a href="#top">Top</a><a href="mailto:a@b.co">Mail</a>
            <a href="https://other.example/x">Elsewhere</a><a href="/brochure.pdf">PDF</a></nav>
            <h1>Know where it is</h1><p>We fit tags&nbsp;on equipment.</p></body></html>"##;
        let t = html_to_text(html, "https://innotrack.co.za/");
        assert_eq!(
            t.title,
            "INNOTRACK | RFID Enabled Solutions for Mining & Asset Management"
        );
        assert_eq!(t.description, "Tracking & tagging");
        assert_eq!(t.headings, vec!["Know where it is"]);
        assert!(t.text.contains("We fit tags on equipment."));
        assert!(!t.text.contains("not this"), "script content is not text");
        assert_eq!(
            same_site_links(&t, 5),
            vec!["https://innotrack.co.za/about"]
        );
        assert!(is_thin(&t));
    }

    #[test]
    fn a_quote_that_is_not_on_the_site_stops_calling_itself_a_quote() {
        let site = "INNOTRACK | RFID Enabled Solutions for Mining & Asset Management";
        let reply = r#"{"field":"what","text":"RFID Enabled Solutions for Mining & Asset Management","kind":"quote","source":"title"}
{"field":"product","text":"TrackMaster Pro","kind":"quote","source":"made up"}
{"field":"serves","text":"Mines","kind":"certain","source":"?"}
{"field":"colour","text":"blue","kind":"quote"}
{"field":"industry","text":"Mining","kind":"suggestion","source":"title"}
{"field":"industry","text":"mining","kind":"suggestion","source":"title"}"#;
        let out = parse_site_lines(reply, site);
        assert_eq!(
            out.len(),
            4,
            "an unknown field and a repeat are dropped: {out:?}"
        );
        assert_eq!(out[0].kind, "quote", "the site's own words stay a quote");
        assert_eq!(
            out[1].kind, "suggestion",
            "a product name the site never uses is not a quote"
        );
        assert_eq!(
            out[2].kind, "guess",
            "a kind nobody knows is the careful one"
        );
    }

    #[test]
    fn the_mock_quotes_only_what_is_on_the_page_and_says_when_it_guesses() {
        let pages = vec![SiteText {
            url: "https://innotrack.co.za/".into(),
            title: "INNOTRACK | RFID Enabled Solutions for Mining & Asset Management".into(),
            ..Default::default()
        }];
        let ctx = render_context("Innotrack", "innotrack.co.za", &pages);
        let lines = parse_site_lines(&mock_reply(&ctx), &all_text(&pages));
        let what = lines.iter().find(|l| l.field == "what").unwrap();
        assert_eq!(
            what.text,
            "RFID Enabled Solutions for Mining & Asset Management"
        );
        assert_eq!(what.kind, "quote");
        assert!(lines
            .iter()
            .any(|l| l.field == "industry" && l.text == "Mining"));
        for l in lines.iter().filter(|l| l.kind == "guess") {
            assert!(
                l.text.contains("mock provider"),
                "a mock guess says so: {}",
                l.text
            );
        }
    }
}
