//! Opt-in local-network companion. No cloud dependency and no general RPC.
//! HTTP is deliberately restricted to a chosen loopback/private IPv4 address.
//! Use only a trusted LAN; remote access needs a separate TLS relay.
use crate::aiw::state::Workspace;
use crate::companion_protocol::{valid_id, Pairing};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{Listener, Manager};

#[derive(Default)]
pub struct Companion(pub Mutex<Option<Arc<Bridge>>>);

pub struct Bridge {
    authority: String,
    stop: AtomicBool,
    clients: AtomicUsize,
    pairing: Mutex<Pairing>,
    events: Mutex<(u64, VecDeque<(u64, Value)>)>,
    busy: Mutex<bool>,
}

#[derive(Serialize)]
pub struct PairingView {
    pub url: String,
    pub expires_in: u16,
}

impl Bridge {
    fn event(&self, event: Value) {
        let mut log = self.events.lock().unwrap_or_else(|p| p.into_inner());
        log.0 += 1;
        let cursor = log.0;
        log.1.push_back((cursor, event));
        if log.1.len() > 256 {
            log.1.pop_front();
        }
    }
}

#[tauri::command(async)]
pub fn companion_start(
    app: tauri::AppHandle,
    state: tauri::State<Companion>,
    address: String,
) -> Result<PairingView, String> {
    let ip: Ipv4Addr = address
        .parse()
        .map_err(|_| "Choose a private IPv4 address from this PC")?;
    if !(ip.is_loopback() || ip.is_private()) {
        return Err("Only loopback and private LAN addresses are supported".into());
    }
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(old) = current.take() {
        old.stop.store(true, Ordering::Relaxed);
    }
    let server = TcpListener::bind((ip, 0)).map_err(|e| e.to_string())?;
    server.set_nonblocking(true).map_err(|e| e.to_string())?;
    let authority = server.local_addr().map_err(|e| e.to_string())?.to_string();
    let bridge = Arc::new(Bridge {
        authority,
        stop: AtomicBool::new(false),
        clients: AtomicUsize::new(0),
        pairing: Mutex::new(Pairing::default()),
        events: Mutex::new((0, VecDeque::new())),
        busy: Mutex::new(false),
    });
    let code = bridge.pairing.lock().map_err(|e| e.to_string())?.renew();
    let view = PairingView {
        url: format!("http://{}/#pair={code}", bridge.authority),
        expires_in: 120,
    };
    *current = Some(bridge.clone());
    let weak = Arc::downgrade(&bridge);
    let event_handle = app.listen("aiw:chat", move |event| {
        if let Some(b) = weak.upgrade() {
            if let Ok(value) = serde_json::from_str(event.payload()) {
                b.event(value);
            }
        }
    });
    std::thread::spawn(move || {
        while !bridge.stop.load(Ordering::Relaxed) {
            match server.accept() {
                Ok((stream, _)) => {
                    if bridge.clients.fetch_add(1, Ordering::Relaxed) >= 16 {
                        bridge.clients.fetch_sub(1, Ordering::Relaxed);
                        continue;
                    }
                    let b = bridge.clone();
                    let a = app.clone();
                    std::thread::spawn(move || {
                        let _ = serve(stream, &a, &b);
                        b.clients.fetch_sub(1, Ordering::Relaxed);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(_) => break,
            }
        }
        app.unlisten(event_handle);
    });
    Ok(view)
}

#[tauri::command(async)]
pub fn companion_stop(state: tauri::State<Companion>) {
    if let Some(b) = state.0.lock().unwrap_or_else(|p| p.into_inner()).take() {
        b.stop.store(true, Ordering::Relaxed);
    }
}

#[tauri::command(async)]
pub fn companion_pair(state: tauri::State<Companion>) -> Result<PairingView, String> {
    let current = state.0.lock().map_err(|e| e.to_string())?;
    let b = current.as_ref().ok_or("Start the companion first")?;
    let code = b.pairing.lock().map_err(|e| e.to_string())?.renew();
    Ok(PairingView {
        url: format!("http://{}/#pair={code}", b.authority),
        expires_in: 120,
    })
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
    cookie: Option<&str>,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Error",
    };
    write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'\r\n", body.len())?;
    if let Some(token) = cookie {
        write!(stream, "Set-Cookie: devdeck_companion={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200\r\n")?;
    }
    write!(stream, "\r\n{body}")
}

fn serve(mut stream: TcpStream, app: &tauri::AppHandle, b: &Arc<Bridge>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut bytes = Vec::new();
    let header_end = loop {
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(i) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
            break i + 4;
        }
        if bytes.len() > 8192 {
            return respond(&mut stream, 400, "text/plain", "Headers too large", None);
        }
    };
    let header = String::from_utf8_lossy(&bytes[..header_end]).to_string();
    let mut lines = header.lines();
    let first = lines.next().unwrap_or_default();
    let parts: Vec<_> = first.split_whitespace().collect();
    if parts.len() != 3 {
        return respond(&mut stream, 400, "text/plain", "Invalid request", None);
    }
    let method = parts[0];
    let target = parts[1];
    let headers: Vec<_> = lines.filter_map(|line| line.split_once(':')).collect();
    let get = |key: &str| {
        headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.trim())
            .unwrap_or("")
    };
    // No CORS. Exact Host prevents DNS rebinding. Every mutation checks Origin.
    if get("host") != b.authority
        || (!get("origin").is_empty() && get("origin") != format!("http://{}", b.authority))
        || (method == "POST" && get("origin") != format!("http://{}", b.authority))
    {
        return respond(&mut stream, 403, "text/plain", "Untrusted origin", None);
    }
    if !get("transfer-encoding").is_empty()
        || headers
            .iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            .count()
            > 1
    {
        return respond(&mut stream, 400, "text/plain", "Unsupported framing", None);
    }
    let length = if get("content-length").is_empty() {
        0
    } else {
        match get("content-length").parse::<usize>() {
            Ok(n) if n <= 16384 => n,
            _ => return respond(&mut stream, 400, "text/plain", "Body too large", None),
        }
    };
    while bytes.len() < header_end + length {
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    if method == "GET" && target == "/" {
        return respond(
            &mut stream,
            200,
            "text/html; charset=utf-8",
            include_str!("../../mobile/index.html"),
            None,
        );
    }
    let input: Value = if length == 0 {
        Value::Null
    } else {
        match serde_json::from_slice(&bytes[header_end..header_end + length]) {
            Ok(v) => v,
            Err(_) => return respond(&mut stream, 400, "text/plain", "Invalid JSON", None),
        }
    };
    if method == "POST" && target == "/api/pair" {
        let token = b
            .pairing
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .exchange(input["code"].as_str().unwrap_or(""));
        return match token {
            Ok(token) => respond(&mut stream, 200, "application/json", "{}", Some(&token)),
            Err(e) => respond(
                &mut stream,
                401,
                "application/json",
                &json!({"error": e}).to_string(),
                None,
            ),
        };
    }
    let token = get("cookie")
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find(|(key, _)| *key == "devdeck_companion")
        .map(|(_, v)| v)
        .unwrap_or("");
    if b.stop.load(Ordering::Relaxed)
        || !b
            .pairing
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .authorized(token)
    {
        return respond(
            &mut stream,
            401,
            "application/json",
            "{\"error\":\"Pair this device on the desktop\"}",
            None,
        );
    }
    if method == "POST" && target == "/api/unpair" {
        b.pairing
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .revoke(token);
        return respond(&mut stream, 200, "application/json", "{}", Some(""));
    }
    let result = route(app, b, method, target, input);
    // A long poll may have waited while the user revoked the device.
    if b.stop.load(Ordering::Relaxed)
        || !b
            .pairing
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .authorized(token)
    {
        return respond(
            &mut stream,
            401,
            "application/json",
            "{\"error\":\"Device revoked\"}",
            None,
        );
    }
    match result {
        Ok((status, value)) => respond(
            &mut stream,
            status,
            "application/json",
            &value.to_string(),
            None,
        ),
        Err(e) => respond(
            &mut stream,
            400,
            "application/json",
            &json!({"error":e}).to_string(),
            None,
        ),
    }
}

fn route(
    app: &tauri::AppHandle,
    b: &Arc<Bridge>,
    method: &str,
    target: &str,
    input: Value,
) -> Result<(u16, Value), String> {
    let ws = app.state::<Arc<Workspace>>();
    let convs = ws.convs()?;
    if method == "GET" && target == "/api/snapshot" {
        let cursor = b.events.lock().map_err(|e| e.to_string())?.0;
        let db = app.state::<crate::db::Db>();
        let nodes = crate::db::nodes_on(&db.conn())?;
        let summaries = convs.list();
        // Initial paint contains only the newest rooms and 30 recent messages.
        let recent: Vec<_> = summaries.iter().take(5).filter_map(|s| convs.load(&s.id).ok()).map(|c| json!({"id":c.id,"messages":c.messages.iter().rev().take(30).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>() })).collect();
        return Ok((
            200,
            json!({"nodes":nodes.iter().map(|n| json!({"id":n.id,"parent_id":n.parent_id,"kind":n.kind,"name":n.name})).collect::<Vec<_>>(),"conversations":summaries,"recent":recent,"cursor":cursor,"sessions":ws.sessions_for(None)}),
        ));
    }
    if method == "GET" && target.starts_with("/api/conversation/") {
        let (id, query) = target
            .trim_start_matches("/api/conversation/")
            .split_once('?')
            .unwrap_or((target.trim_start_matches("/api/conversation/"), ""));
        if !valid_id(id) {
            return Err("Invalid conversation ID".into());
        }
        let c = convs.load(id)?;
        let before = query
            .strip_prefix("before=")
            .and_then(|n| n.parse::<usize>().ok())
            .unwrap_or(c.messages.len())
            .min(c.messages.len());
        let start = before.saturating_sub(50);
        return Ok((
            200,
            json!({"id":id,"title":c.title,"messages":c.messages[start..before],"before":start}),
        ));
    }
    if method == "GET" && target.starts_with("/api/events?after=") {
        let after: u64 = target
            .trim_start_matches("/api/events?after=")
            .parse()
            .map_err(|_| "Invalid cursor")?;
        for _ in 0..100 {
            if b.stop.load(Ordering::Relaxed) {
                return Err("Companion stopped".into());
            }
            {
                let log = b.events.lock().map_err(|e| e.to_string())?;
                if log.0 > after {
                    let reset = log
                        .1
                        .front()
                        .is_some_and(|(id, _)| after.saturating_add(1) < *id);
                    return Ok((
                        200,
                        json!({"cursor":log.0,"reset":reset,"events":log.1.iter().filter(|(id,_)| *id > after).map(|(_,v)|v).collect::<Vec<_>>()}),
                    ));
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        return Ok((200, json!({"cursor":after,"events":[]})));
    }
    if method == "POST" && target == "/api/conversations" {
        return Ok((
            200,
            serde_json::to_value(convs.create(None)?).map_err(|e| e.to_string())?,
        ));
    }
    if method == "POST" && target == "/api/node" {
        let id = input["node_id"].as_i64().ok_or("Choose a space")?;
        let conv = crate::threads::node_thread(app.clone(), app.state::<Arc<Workspace>>(), id)?;
        return Ok((200, json!({"id":conv.id,"title":conv.title})));
    }
    if method == "POST" && target == "/api/send" {
        let id = input["conversation_id"]
            .as_str()
            .ok_or("Choose a conversation")?
            .to_string();
        if !valid_id(&id) {
            return Err("Invalid conversation ID".into());
        }
        let request_id = input["request_id"]
            .as_str()
            .ok_or("Request ID required")?
            .to_string();
        let text = input["text"]
            .as_str()
            .ok_or("Message required")?
            .trim()
            .to_string();
        if text.is_empty() || text.len() > 8000 {
            return Err("Message must contain 1–8000 bytes".into());
        }
        convs.load(&id)?;
        let mut busy = b.busy.lock().map_err(|e| e.to_string())?;
        let mut pairing = b.pairing.lock().map_err(|e| e.to_string())?;
        // A retry is always acknowledged, even when the original is running.
        if !valid_id(&request_id) {
            return Err("Invalid request ID".into());
        }
        if pairing.known(&request_id) {
            if let Some(receipt) = pairing.receipt(&request_id) {
                b.event(receipt);
            }
            return Ok((202, json!({"accepted":true,"duplicate":true})));
        }
        if *busy {
            return Ok((
                409,
                json!({"error":"Dev is handling another mobile message. Retry shortly."}),
            ));
        }
        pairing.accept(&request_id)?;
        *busy = true;
        let app = app.clone();
        let b = b.clone();
        let workspace = ws.inner().clone();
        std::thread::spawn(move || {
            let result = crate::threads::companion_send(&app, &workspace, &id, &text);
            let receipt = json!({"kind":"receipt","conversation_id":id,"request_id":request_id,"error":result.err()});
            b.pairing
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .finish(&request_id, receipt.clone());
            b.event(receipt);
            *b.busy.lock().unwrap_or_else(|p| p.into_inner()) = false;
        });
        return Ok((202, json!({"accepted":true})));
    }
    Ok((404, json!({"error":"Unknown endpoint"})))
}
