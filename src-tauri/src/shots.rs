//! Screenshots for Stash: watch the folder Windows already saves them to,
//! read the text out of each one, and link it — never copy it.
//!
//! Three deliberate choices:
//!
//! 1. **We use the Windows Screenshots folder, and add nothing of our own.**
//!    The row stores a path; the PNG stays exactly where you took it. Deleting
//!    a stash row never touches your picture.
//! 2. **OCR text goes in `content`.** That means the existing FTS triggers
//!    index it with no extra machinery, so searching for words that only
//!    appear inside an image just works.
//! 3. **Watching is event-driven**, on the same principle as the clipboard:
//!    `FindFirstChangeNotification` blocks until the directory actually
//!    changes rather than us waking up to re-list it on a timer.

use std::path::{Path, PathBuf};

/// Files we'll consider. Windows writes PNG; a few tools write JPEG.
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg"];
/// Thumbnails fill a small card tile — roughly 132x84 CSS px. Bounding *both*
/// edges at ~3x that matters more than it looks: bounding only the width let a
/// tall screenshot come out 520x1040, and the card then had to throw four
/// fifths of it away to fit. Fit inside this box and the whole shot survives.
const THUMB_W: u32 = 400;
const THUMB_H: u32 = 260;
/// Thumbnails are drawn small; 84 is past the point where more bytes show.
const THUMB_QUALITY: u8 = 84;
/// Ceiling on what the detail pane may ask for, so a bad `max_width` can't
/// turn into a 40MB data URI over the IPC bridge.
const DETAIL_MAX_EDGE: u32 = 4096;

/// Where Windows saves screenshots. The Screenshots known folder can be
/// relocated, so ask the registry first and only then fall back to the
/// default — a hardcoded `Pictures\Screenshots` would silently watch nothing
/// for anyone who moved it.
pub fn screenshots_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    if let Some(p) = registry_screenshots_dir() {
        return Some(p);
    }
    let dir = dirs::picture_dir()?.join("Screenshots");
    Some(dir)
}

#[cfg(windows)]
fn registry_screenshots_dir() -> Option<PathBuf> {
    // {B7BEDE81-DF94-4682-A7D8-57A52620B86F} is the Screenshots known folder.
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            "/v",
            "{B7BEDE81-DF94-4682-A7D8-57A52620B86F}",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags_quiet()
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    // "    {GUID}    REG_EXPAND_SZ    %USERPROFILE%\Pictures\Screenshots"
    let value = text
        .lines()
        .find(|l| l.contains("REG_"))?
        .rsplit("    ")
        .next()?
        .trim()
        .to_string();
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(expand_env(&value)))
}

/// Expand %VAR% the way REG_EXPAND_SZ expects.
fn expand_env(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Quiet child processes (no console flash) without repeating the cfg dance.
trait QuietCommand {
    fn creation_flags_quiet(&mut self) -> &mut Self;
}
impl QuietCommand for std::process::Command {
    fn creation_flags_quiet(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        self
    }
}

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// The largest size that fits inside `max_w` x `max_h` keeping the aspect
/// ratio — and **never bigger than the source**.
///
/// Two rules, both learned the hard way:
///
/// * *Fit, don't crop.* Anything that bounds one edge and lets the other run
///   hands the UI an image it can only show by cutting most of it off.
/// * *Never upscale.* Stretching a small capture up to a target box is how a
///   preview goes soft; if the source is smaller than the box, that is the
///   size it gets drawn at.
pub fn fit_within(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    if w == 0 || h == 0 || max_w == 0 || max_h == 0 {
        return (w.max(1), h.max(1));
    }
    if w <= max_w && h <= max_h {
        return (w, h);
    }
    // Scale by the tighter of the two axes, in f64 so a 4K shot doesn't
    // overflow the integer maths on the way.
    let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64);
    (
        ((w as f64 * scale).round() as u32).max(1),
        ((h as f64 * scale).round() as u32).max(1),
    )
}

/// A small JPEG data URI for the card list. Generated once at capture so the
/// list never has to load full-size screenshots to draw itself.
pub fn thumbnail(path: &Path) -> Option<String> {
    let img = image::open(path).ok()?;
    let (w, h) = fit_within(img.width(), img.height(), THUMB_W, THUMB_H);
    // `DynamicImage::thumbnail` is the fast, low-quality path; at these sizes
    // the difference between it and a proper Lanczos resample is the
    // difference between readable UI text and mush.
    let small = if (w, h) == (img.width(), img.height()) {
        img
    } else {
        img.resize_exact(w, h, image::imageops::FilterType::Lanczos3)
    };
    encode_jpeg(&small, THUMB_QUALITY)
}

fn encode_jpeg(img: &image::DynamicImage, quality: u8) -> Option<String> {
    let rgb = img.to_rgb8();
    let mut buf = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality)
        .encode_image(&rgb)
        .ok()?;
    Some(format!("data:image/jpeg;base64,{}", b64(&buf.into_inner())))
}

/// What the detail pane gets: the picture at the size it will actually be
/// drawn, in device pixels, and **losslessly**.
///
/// The card thumbnail is deliberately tiny, and blowing it up to fill a
/// several-hundred-pixel pane was exactly why the preview looked soft. So this
/// goes back to the original file every time:
///
/// * asked for a box the image already fits inside → the original bytes,
///   untouched, so a PNG screenshot stays pixel-for-pixel what Windows saved;
/// * bigger than the box → one Lanczos downscale re-encoded as PNG, still
///   lossless, so text edges survive the trip.
///
/// `max_w`/`max_h` are **device** pixels: the caller multiplies its CSS box by
/// the display scale, which is the other half of why previews looked soft on a
/// 150% display.
pub fn detail_image(path: &Path, max_w: u32, max_h: u32) -> Result<DetailImage, String> {
    let max_w = max_w.clamp(1, DETAIL_MAX_EDGE);
    let max_h = max_h.clamp(1, DETAIL_MAX_EDGE);
    let img = image::open(path).map_err(|e| format!("couldn't read that image: {e}"))?;
    let (nw, nh) = (img.width(), img.height());
    let (w, h) = fit_within(nw, nh, max_w, max_h);

    if (w, h) == (nw, nh) {
        if let Ok(bytes) = std::fs::read(path) {
            let mime = match path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .as_deref()
            {
                Some("jpg") | Some("jpeg") => "image/jpeg",
                _ => "image/png",
            };
            return Ok(DetailImage {
                uri: format!("data:{mime};base64,{}", b64(&bytes)),
                width: w,
                height: h,
                natural_width: nw,
                natural_height: nh,
            });
        }
    }

    let small = img.resize_exact(w, h, image::imageops::FilterType::Lanczos3);
    let mut buf = std::io::Cursor::new(Vec::new());
    small
        .to_rgba8()
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("couldn't re-encode that image: {e}"))?;
    Ok(DetailImage {
        uri: format!("data:image/png;base64,{}", b64(&buf.into_inner())),
        width: w,
        height: h,
        natural_width: nw,
        natural_height: nh,
    })
}

/// A decoded screenshot plus the geometry the UI needs to draw it honestly.
/// `width`/`height` are what the data URI really contains — the pane must not
/// stretch past that, or we are back to an upscaled blur.
#[derive(serde::Serialize)]
pub struct DetailImage {
    pub uri: String,
    pub width: u32,
    pub height: u32,
    pub natural_width: u32,
    pub natural_height: u32,
}

/// Minimal base64 — one small dependency avoided.
fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

// ---------- OCR ----------

/// Read the text out of an image using the OCR engine already in Windows.
///
/// Returns an empty string when the image genuinely has no text, and `None`
/// when OCR could not run at all — no language pack, an unreadable file. The
/// difference matters: "no text in this picture" and "we never looked" should
/// not look the same in the vault.
/// WinRT calls need a multithreaded apartment to exist in the process. A
/// plain `std::thread` has none, so every OCR call failed at the first
/// `GetFileFromPathAsync` -- and looked exactly like "this image has no text".
/// `CoIncrementMTAUsage` keeps one alive for the process without tying it to
/// a particular thread, and is safe to call more than once.
#[cfg(windows)]
fn ensure_winrt() {
    use std::sync::OnceLock;
    static MTA: OnceLock<bool> = OnceLock::new();
    MTA.get_or_init(|| unsafe {
        windows::Win32::System::Com::CoIncrementMTAUsage()
            .map(|_cookie| true)
            .unwrap_or(false)
    });
}

#[cfg(windows)]
pub fn ocr(app: &tauri::AppHandle, path: &Path) -> Option<String> {
    match ocr_inner(path) {
        Ok(text) => Some(text),
        Err(e) => {
            // Say why, in the Logs the user can actually see. A silent failure
            // here is indistinguishable from "this image has no text in it",
            // which is exactly the confusion the preview text avoids too.
            crate::services::push_log(
                app,
                STASH_LOG_ID,
                "stash",
                "stderr",
                format!("couldn't read text from {}: {e}", path.display()),
            );
            None
        }
    }
}

/// Log id the Stash system stream uses (see the other negative ids in lib.rs).
const STASH_LOG_ID: i64 = -500_000;

#[cfg(windows)]
fn ocr_inner(path: &Path) -> windows::core::Result<String> {
    ensure_winrt();
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};

    // No canonicalize: it hands back a \\?\-prefixed path that the WinRT
    // storage APIs reject outright, and the watcher already gives us an
    // absolute path anyway.
    let text_path = path.to_string_lossy().to_string();

    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(text_path))?.join()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.join()?;
    let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
    let bitmap = decoder.GetSoftwareBitmapAsync()?.join()?;

    // Follows your Windows display languages. Fails when no OCR pack exists.
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
    let result = engine.RecognizeAsync(&bitmap)?.join()?;
    Ok(result.Text()?.to_string())
}

#[cfg(not(windows))]
pub fn ocr(_app: &tauri::AppHandle, _path: &Path) -> Option<String> {
    None
}

// ---------- watching ----------

/// Block until something changes in `dir`, then return. Event-driven: this
/// thread is asleep in the kernel until Windows says the directory changed,
/// the same principle as the clipboard listener.
#[cfg(windows)]
fn wait_for_change(dir: &Path) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
    use windows_sys::Win32::Storage::FileSystem::{
        FindCloseChangeNotification, FindFirstChangeNotificationW, FindNextChangeNotification,
        FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE,
    };
    use windows_sys::Win32::System::Threading::{WaitForSingleObject, INFINITE};

    let wide: Vec<u16> = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let handle = FindFirstChangeNotificationW(
            wide.as_ptr(),
            0, // this directory only, not its subtree
            FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_LAST_WRITE,
        );
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return false;
        }
        let signalled = WaitForSingleObject(handle, INFINITE) == WAIT_OBJECT_0;
        FindNextChangeNotification(handle);
        FindCloseChangeNotification(handle);
        let _ = CloseHandle;
        signalled
    }
}

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

/// Every image currently in the folder.
pub fn list_images(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_image(p))
        .collect()
}

// ---------- capture ----------

use crate::db::Db;
use rusqlite::params;
use tauri::{Emitter, Manager};

/// Stash one screenshot file. Returns false when it was already known, which
/// is the common case on a rescan.
fn record_shot(app: &tauri::AppHandle, path: &Path) -> bool {
    let Some(db) = app.try_state::<Db>() else {
        return false;
    };
    let path_str = path.to_string_lossy().to_string();

    // The unique index on file_path is the real guard; this just avoids doing
    // OCR work for a file we already have.
    if let Ok(conn) = db.0.lock() {
        let known: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM stash_items WHERE file_path = ?1",
                params![path_str],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if known > 0 {
            return false;
        }
    }

    // OCR and thumbnailing both open the file; a screenshot tool may still be
    // writing it when the change notification fires, so give it a moment.
    std::thread::sleep(std::time::Duration::from_millis(350));

    let text = ocr(app, path);
    // Run the image's text through the guardrail *before* any of it reaches
    // SQLite. A screenshot of a login screen is a credential, and OCR would
    // otherwise turn it into searchable plaintext -- precisely what this vault
    // promises never to do.
    let secret = text.as_deref().and_then(crate::stash::ocr_secret_reason);
    // No thumbnail either when flagged: that is a second copy of the same
    // secret, living in a database and rendered in a list you scroll past in
    // public. The original file is untouched and one click away.
    let thumb = if secret.is_some() {
        String::new()
    } else {
        thumbnail(path).unwrap_or_default()
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());
    let bytes = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);

    // An empty string means "OCR ran and found no text"; None means it could
    // not run. Only the first is safe to store as searchable content.
    let content = if secret.is_some() {
        String::new()
    } else {
        text.clone().unwrap_or_default()
    };
    let preview = match (&secret, &text) {
        (Some(reason), _) => reason.to_string(),
        (None, Some(t)) if !t.trim().is_empty() => t
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .take(3)
            .collect::<Vec<_>>()
            .join("\n"),
        (None, Some(_)) => "no text found in this image".to_string(),
        // Never let "we couldn't look" read as "there's nothing there".
        (None, None) => "couldn't read text from this image".to_string(),
    };

    let ctx = crate::stash::current_context(app);
    let Ok(conn) = db.0.lock() else { return false };
    // Date it by the file, not by when we noticed it. Importing a folder of
    // old screenshots must not stamp them all as "just now" and bury
    // everything else in the vault.
    let created = file_time(path);
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO stash_items
            (kind, item_type, title, content, note, preview, bytes, hash, file_path, thumb,
             project_id, project_name, workspace_name, source_app, created_at,
             is_secret, secret_reason)
         VALUES ('screenshot', 'image', ?1, ?2, '', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                 'Screenshots', ?11, ?12, ?13)",
        params![
            name,
            content,
            preview,
            bytes,
            path_str,
            path_str,
            thumb,
            ctx.project_id,
            ctx.project_name,
            ctx.workspace_name,
            created,
            secret.is_some() as i64,
            secret.unwrap_or_default(),
        ],
    );
    drop(conn);

    if matches!(inserted, Ok(n) if n > 0) {
        crate::activity::record(
            app,
            "screenshot",
            match secret {
                Some(reason) => format!("screenshot withheld — {reason}"),
                None => "stashed a screenshot".to_string(),
            },
            name.clone(),
            secret.is_none(),
            None,
        );
        let _ = app.emit("stash:shot", path_str);
        true
    } else {
        false
    }
}

/// A file's modified time in unix millis, falling back to now.
fn file_time(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
        })
}

/// Bring in everything already sitting in the folder, newest first, so the
/// most useful ones show up straight away and it works backwards through
/// history. Each is OCR'd as it goes, which is why order matters: this walks
/// a folder that may hold years of images.
fn import_existing(app: &tauri::AppHandle, dir: &Path) {
    let mut files = list_images(dir);
    files.sort_by_key(|p| std::cmp::Reverse(file_time(p)));
    let total = files.len();
    let mut added = 0usize;
    for path in files {
        if record_shot(app, &path) {
            added += 1;
        }
    }
    if added > 0 {
        crate::services::push_log(
            app,
            STASH_LOG_ID,
            "stash",
            "system",
            format!("read {added} of {total} screenshots from {}", dir.display()),
        );
    }
}

/// Watch the Windows screenshots folder for new images.
pub fn spawn(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Some(dir) = screenshots_dir() else { return };
        if !dir.is_dir() {
            // Windows creates it on the first Win+PrtScn. Nothing to watch yet
            // -- picked up next launch rather than us creating a folder.
            return;
        }
        // Everything already in the folder belongs in the vault, newest
        // first. Deliberately *not* a two-way mirror: deleting a picture
        // doesn't reach in and delete rows, and this never writes to your
        // Pictures folder.
        import_existing(&app, &dir);

        loop {
            #[cfg(windows)]
            if !wait_for_change(&dir) {
                std::thread::sleep(std::time::Duration::from_secs(5));
                continue;
            }
            #[cfg(not(windows))]
            std::thread::sleep(std::time::Duration::from_secs(5));

            // record_shot skips anything already stored, so a plain re-list
            // is enough -- and self-correcting if a change was missed.
            for path in list_images(&dir) {
                record_shot(&app, &path);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The regression that started this: bounding only the width let a tall
    /// screenshot stay four times taller than the card, and the card then
    /// cropped away everything below the first fifth. Fit bounds *both* edges.
    #[test]
    fn tall_shots_fit_inside_the_card_box() {
        let (w, h) = fit_within(800, 1600, THUMB_W, THUMB_H);
        assert!(w <= THUMB_W && h <= THUMB_H, "got {w}x{h}");
        assert_eq!((w, h), (130, 260));
    }

    #[test]
    fn wide_shots_fit_inside_the_card_box() {
        let (w, h) = fit_within(2560, 1440, THUMB_W, THUMB_H);
        assert!(w <= THUMB_W && h <= THUMB_H, "got {w}x{h}");
        assert_eq!((w, h), (400, 225));
    }

    /// Aspect ratio has to survive, or "fit" is just a differently-shaped crop.
    #[test]
    fn aspect_ratio_survives() {
        for (w, h) in [(2560u32, 1440u32), (800, 1600), (3840, 2160), (1024, 768)] {
            let (fw, fh) = fit_within(w, h, THUMB_W, THUMB_H);
            let src = w as f64 / h as f64;
            let out = fw as f64 / fh as f64;
            assert!((src - out).abs() < 0.02, "{w}x{h} -> {fw}x{fh}");
        }
    }

    /// Upscaling is what makes a preview blurry, so fitting never does it.
    #[test]
    fn small_images_are_left_alone() {
        assert_eq!(fit_within(120, 90, THUMB_W, THUMB_H), (120, 90));
        assert_eq!(fit_within(400, 260, THUMB_W, THUMB_H), (400, 260));
        // Detail pane: a small capture in a big pane stays its own size.
        assert_eq!(fit_within(640, 400, 2400, 2400), (640, 400));
    }

    /// Only one edge over the limit still has to scale the other one down.
    #[test]
    fn one_edge_over_still_scales_both() {
        let (w, h) = fit_within(1200, 100, THUMB_W, THUMB_H);
        assert_eq!((w, h), (400, 33));
    }

    #[test]
    fn degenerate_sizes_never_panic_or_return_zero() {
        assert_eq!(fit_within(0, 0, THUMB_W, THUMB_H), (1, 1));
        let (w, h) = fit_within(20000, 3, THUMB_W, THUMB_H);
        assert!(w >= 1 && h >= 1, "got {w}x{h}");
        assert!(w <= THUMB_W && h <= THUMB_H, "got {w}x{h}");
    }
}
