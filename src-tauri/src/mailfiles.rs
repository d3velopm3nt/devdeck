//! Attachments on disk, and the text read out of them.
//!
//! **A folder, not an integration.** Google Drive for Desktop presents as an
//! ordinary folder, so pointing this setting at it is the whole of "store my
//! attachments in Drive" — no Drive API, no new OAuth scope, and no second
//! verification problem, which matters because Drive's full scope is
//! restricted exactly like Gmail's. Because the contract is a path, Dropbox,
//! OneDrive, a network share and a plain local folder all work identically.
//!
//! It is also not a new exposure: these files already sit on Google's servers
//! inside Gmail. Copying them into Drive keeps them with the vendor that
//! already had them.
//!
//! **A folder per message.** Everyone calls it `invoice.pdf`. Filing by
//! message id means two of them never collide, and it makes the mail an
//! attachment came from findable from the file alone.
//!
//! **Extraction is local, and says what it cannot read.** Text and CSV are
//! read directly; images go through the Windows OCR the screenshot watcher has
//! used for months. A type with no reader produces `Unreadable` carrying the
//! reason, so the UI can say "this looks scanned" rather than showing an empty
//! box that means nothing.
//!
//! **The rule that matters most.** A scanned passport becomes *searchable
//! text* the moment OCR touches it. The file was always there; the text is
//! new, and the text is what would be sent to a model. So extracted text runs
//! through the same classifier the Stash uses on screenshots, and a hit is
//! withheld rather than stored.

use std::path::{Path, PathBuf};

/// Where attachments are written. Empty means the default under appdata.
pub const FOLDER_KEY: &str = "mail.attachments_dir";

/// Files above this are stored but never read.
///
/// Extraction loads the whole thing into memory and the text goes on to a
/// model, so a 200MB video is pointless twice over.
const MAX_EXTRACT_BYTES: u64 = 25 * 1024 * 1024;

/// What came of trying to read a file.
#[derive(Debug, Clone, PartialEq)]
pub enum Extracted {
    /// Text we are willing to keep and, later, to send.
    Text(String),
    /// Read, and deliberately withheld. The file stays; the text does not.
    Withheld(&'static str),
    /// No reader for this type, or the file was too large.
    Unreadable(String),
}

/// The default root, used when nothing is configured.
pub fn default_root() -> PathBuf {
    // Beside the database. `DEVDECK_HOME` moves the whole profile at once.
    crate::db::home_dir().join("mail")
}

pub fn root(conn: &rusqlite::Connection) -> PathBuf {
    match crate::db::setting_get_conn(conn, FOLDER_KEY) {
        Ok(Some(v)) if !v.trim().is_empty() => PathBuf::from(v.trim()),
        _ => default_root(),
    }
}

/// Make a mail filename safe to be a path component.
///
/// Three separate hazards, and all three are ordinary rather than exotic:
/// mail filenames carry characters Windows forbids, they can be long enough to
/// blow the 260-character path limit on their own, and `..` in one of them
/// would write outside the folder entirely. The original name is kept in the
/// database, so nothing is lost by being strict here.
pub fn safe_name(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('.');
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | ' ' => out.push(ch),
            _ => out.push('-'),
        }
    }
    // Collapse runs of dots. Replacing separators alone is not enough:
    // "../../etc/passwd" becomes "-..-etc-passwd", which still carries `..`
    // and is still the thing a path traversal is made of.
    let mut out = out.trim().trim_matches('.').to_string();
    while out.contains("..") {
        out = out.replace("..", ".");
    }
    let out = out.trim().trim_matches('.').to_string();
    if out.is_empty() {
        return "attachment".to_string();
    }

    // Truncate the stem, never the extension: a `.pdf` that became `.p` is a
    // file nothing will open.
    if out.len() > 80 {
        let (stem, ext) = match out.rfind('.') {
            Some(i) if out.len() - i <= 12 => (&out[..i], &out[i..]),
            _ => (out.as_str(), ""),
        };
        let keep: String = stem.chars().take(80 - ext.len()).collect();
        return format!("{}{ext}", keep.trim_end());
    }
    out
}

/// Where one attachment belongs.
pub fn path_for(root: &Path, message_id: i64, filename: &str) -> PathBuf {
    root.join(message_id.to_string()).join(safe_name(filename))
}

/// Write the bytes, returning where they went.
pub fn store(
    root: &Path,
    message_id: i64,
    filename: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let path = path_for(root, message_id, filename);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path)
}

/// Where the extracted text sits: beside the file it came from, so you can
/// read exactly what the machine read.
pub fn text_path(file: &Path) -> PathBuf {
    let mut s = file.as_os_str().to_os_string();
    s.push(".txt");
    PathBuf::from(s)
}

fn is_image(mime: &str, path: &Path) -> bool {
    if mime.starts_with("image/") {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "bmp" | "tif" | "tiff" | "gif"
    )
}

fn is_plain(mime: &str, path: &Path) -> bool {
    if mime.starts_with("text/") || mime == "application/json" {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "txt" | "csv" | "md" | "log" | "json" | "yml" | "yaml"
    )
}

/// Read a stored attachment, or say why not.
///
/// `app` is only needed for OCR, which must run on an MTA thread.
pub fn extract(app: &tauri::AppHandle, path: &Path, mime: &str) -> Extracted {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Extracted::Unreadable("the file is empty".into());
    }
    if size > MAX_EXTRACT_BYTES {
        return Extracted::Unreadable(format!("{} MB is too large to read", size / (1024 * 1024)));
    }

    let mime = mime.to_ascii_lowercase();
    let raw = if is_plain(&mime, path) {
        match std::fs::read(path) {
            // Lossy on purpose: mail is full of Latin-1 claiming to be UTF-8,
            // and one bad byte should not lose an invoice.
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(e) => return Extracted::Unreadable(format!("could not read it: {e}")),
        }
    } else if is_image(&mime, path) {
        match crate::shots::ocr(app, path) {
            Some(t) => t,
            None => return Extracted::Unreadable("no text could be read from this image".into()),
        }
    } else if mime == "application/pdf" {
        return Extracted::Unreadable(
            "PDFs are not read yet. If this one is a scan, it will need OCR rather than a parser."
                .into(),
        );
    } else {
        return Extracted::Unreadable(format!("nothing here reads {mime}"));
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Extracted::Unreadable("there was no text in it".into());
    }

    // The rule. Blunt on purpose, for the reason the Stash already documents:
    // a false positive costs you a preview of a file you can still open, and a
    // miss puts a card number in a database and then in a prompt.
    if let Some(reason) = sensitive_reason(trimmed) {
        return Extracted::Withheld(reason);
    }

    Extracted::Text(trimmed.to_string())
}

// ---------------------------------------------------------------------------
// What a document must never turn into searchable text
// ---------------------------------------------------------------------------

/// Words that mean the number beside them is somebody's identity or money.
const DOCUMENT_WORDS: &[&str] = &[
    "passport no",
    "passport number",
    "id number",
    "identity number",
    "national insurance",
    "social security",
    "tax file number",
    "driver's licence",
    "drivers licence",
    "driver's license",
    "drivers license",
    "iban",
    "swift code",
    "sort code",
    "routing number",
    "account number",
    "cvv",
    "card verification",
];

/// Does a digit run pass the Luhn check?
///
/// This is what separates a card number from an invoice number, and without it
/// the rule would withhold nearly every invoice ever sent. Luhn is not proof
/// something is a card, but a 16-digit run that passes it is worth refusing.
fn luhn(digits: &str) -> bool {
    let n = digits.len();
    if !(13..=19).contains(&n) {
        return false;
    }
    let mut sum = 0u32;
    for (i, ch) in digits.chars().rev().enumerate() {
        let Some(d) = ch.to_digit(10) else {
            return false;
        };
        let v = if i % 2 == 1 {
            let doubled = d * 2;
            if doubled > 9 {
                doubled - 9
            } else {
                doubled
            }
        } else {
            d
        };
        sum += v;
    }
    sum % 10 == 0
}

/// Every run of digits in the text, with spaces and dashes inside a run kept
/// together — a card number is written `4111 1111 1111 1111` far more often
/// than it is written as sixteen unbroken digits.
fn digit_runs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut gap = 0usize;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            cur.push(ch);
            gap = 0;
        } else if (ch == ' ' || ch == '-') && !cur.is_empty() && gap == 0 {
            gap = 1;
        } else {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            gap = 0;
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Should this extracted text be withheld?
///
/// The Stash's own rule first, because a mailed screenshot of a login form is
/// the same hazard as a copied one. Then the part that is specific to
/// documents: a clipboard rarely holds a passport, and an attachments folder
/// is full of them.
///
/// This lives here rather than in `stash.rs` on purpose. Widening the Stash's
/// clipboard heuristic to cover bank details would make it flag ordinary
/// copied invoice lines, and the two have genuinely different traffic.
pub fn sensitive_reason(text: &str) -> Option<&'static str> {
    if let Some(reason) = crate::stash::ocr_secret_reason(text) {
        return Some(reason);
    }
    let lower = text.to_ascii_lowercase();
    if DOCUMENT_WORDS.iter().any(|w| lower.contains(w)) {
        return Some("this document may carry bank or identity details");
    }
    if digit_runs(text).iter().any(|d| luhn(d)) {
        return Some("this document may carry a card number");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_that_would_escape_the_folder_cannot() {
        assert!(!safe_name("../../etc/passwd").contains(".."));
        assert!(!safe_name("..\\..\\windows\\system32").contains(".."));
        // The separators themselves must not survive either, or the name is
        // still two path components.
        assert!(!safe_name("a/b/c").contains('/'));
        assert!(!safe_name("a\\b\\c").contains('\\'));
    }

    #[test]
    fn windows_illegal_characters_are_replaced_not_dropped() {
        let n = safe_name("Q3: invoice <final>?.pdf");
        for bad in [':', '<', '>', '?', '"', '|', '*'] {
            assert!(!n.contains(bad), "{n} still has {bad}");
        }
        assert!(n.ends_with(".pdf"), "{n}");
    }

    /// Truncating into the extension produces a file nothing will open, which
    /// is a worse outcome than a long name.
    #[test]
    fn a_very_long_name_keeps_its_extension() {
        let n = safe_name(&format!("{}.pdf", "a".repeat(300)));
        assert!(n.len() <= 80, "{}", n.len());
        assert!(n.ends_with(".pdf"), "{n}");
    }

    #[test]
    fn a_name_that_sanitises_to_nothing_still_gets_one() {
        assert_eq!(safe_name(""), "attachment");
        assert_eq!(safe_name("..."), "attachment");
        assert_eq!(safe_name("   "), "attachment");
    }

    #[test]
    fn two_files_with_one_name_land_in_different_folders() {
        let r = Path::new("C:\\mail");
        let a = path_for(r, 1042, "invoice.pdf");
        let b = path_for(r, 1043, "invoice.pdf");
        assert_ne!(a, b);
        assert!(a.ends_with("1042\\invoice.pdf") || a.ends_with("1042/invoice.pdf"));
    }

    #[test]
    fn the_text_sits_beside_the_file_it_came_from() {
        assert_eq!(
            text_path(Path::new("C:\\mail\\7\\invoice.pdf")),
            PathBuf::from("C:\\mail\\7\\invoice.pdf.txt")
        );
    }

    #[test]
    fn types_are_recognised_by_extension_when_the_mime_lies() {
        // Mail servers label attachments application/octet-stream constantly.
        let p = Path::new("scan.PNG");
        assert!(is_image("application/octet-stream", p));
        assert!(is_plain("application/octet-stream", Path::new("rows.csv")));
        assert!(!is_plain("application/octet-stream", Path::new("a.zip")));
    }

    /// The Stash's rule still applies: a mailed screenshot of a login form is
    /// the same hazard as a copied one.
    #[test]
    fn a_credential_word_is_still_withheld() {
        assert!(sensitive_reason("the password is hunter2").is_some());
        assert!(sensitive_reason("Authorization: Bearer abc.def.ghi").is_some());
    }

    /// The gap the Stash's list does not cover, because a clipboard rarely
    /// holds a passport and an attachments folder is full of them.
    #[test]
    fn identity_and_bank_details_are_withheld() {
        for t in [
            "Passport No: X1234567",
            "IBAN GB33BUKB20201555555555",
            "Sort code 20-00-00, account number 55555555",
            "ID Number 8001015009087",
        ] {
            assert!(sensitive_reason(t).is_some(), "{t}");
        }
    }

    #[test]
    fn a_card_number_is_withheld_even_when_it_is_spaced_out() {
        // How a card is actually written on a document.
        assert!(sensitive_reason("4111 1111 1111 1111").is_some());
        assert!(sensitive_reason("5500-0000-0000-0004").is_some());
        assert!(sensitive_reason("Paid by card 4111111111111111").is_some());
    }

    /// Without the Luhn check this rule would withhold almost every invoice
    /// ever sent, which would make the feature useless rather than safe.
    #[test]
    fn an_ordinary_invoice_is_not_mistaken_for_a_card() {
        for t in [
            "Invoice 20260912 for R 14 500.00, due 30 days",
            "Order 1234567890123456 shipped on 3 March",
            "Tel +27 82 555 0134 · reg 2019/123456/07",
            "Total 1,240.50 excluding VAT at 15%",
        ] {
            assert_eq!(sensitive_reason(t), None, "{t}");
        }
    }

    #[test]
    fn luhn_separates_a_card_from_a_number_of_the_same_length() {
        assert!(luhn("4111111111111111"));
        assert!(!luhn("4111111111111112"));
        // Too short and too long are not cards whatever they add up to.
        assert!(!luhn("42"));
        assert!(!luhn("41111111111111111111"));
    }

    #[test]
    fn digits_split_on_words_but_not_on_the_spaces_inside_a_number() {
        assert_eq!(digit_runs("4111 1111 1111 1111"), vec!["4111111111111111"]);
        assert_eq!(digit_runs("ref 12 and 34"), vec!["12", "34"]);
    }
}
