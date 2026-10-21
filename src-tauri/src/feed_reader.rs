//! Public feed transport; reusable without Tauri or credentials.
use crate::connector_model as model;
use std::{
    io::Read,
    net::{IpAddr, ToSocketAddrs},
    time::Duration,
};
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            !v.is_private()
                && !v.is_loopback()
                && !v.is_link_local()
                && !v.is_unspecified()
                && !v.is_multicast()
                && !v.is_broadcast()
                && !v.is_documentation()
                && v.octets()[0] != 0
                && v.octets()[0] < 224
                && !(v.octets()[0] == 198 && matches!(v.octets()[1], 18 | 19))
                && !(v.octets()[0..3] == [192, 0, 0])
                && !(v.octets()[0..3] == [192, 88, 99])
                && !(v.octets()[0] == 100 && (64..=127).contains(&v.octets()[1]))
        }
        IpAddr::V6(v) => v
            .to_ipv4_mapped()
            .map(|v| public_ip(IpAddr::V4(v)))
            .unwrap_or_else(|| {
                (v.segments()[0] & 0xe000) == 0x2000
                    && !(v.segments()[0] == 0x2001 && v.segments()[1] < 0x0200)
                    && !matches!(v.segments()[0], 0x2002 | 0x3fff)
                    && v.segments()[0..2] != [0x2001, 0x0db8]
            }),
    }
}

/// Public-feed capability only. No cookies, credentials, redirects or proxy inheritance.
pub fn read_public_feed(url: &str) -> Result<Vec<model::FeedEntry>, String> {
    let url = model::validate_url(url)?;
    let host = url.host_str().ok_or("Missing host")?;
    let addresses: Vec<_> = (host, 443)
        .to_socket_addrs()
        .map_err(|_| "Feed hostname could not be resolved")?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("Feeds must resolve only to public internet addresses".into());
    }
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| "Feed client unavailable")?;
    let response = client
        .get(url)
        .header(
            "Accept",
            "application/atom+xml, application/rss+xml, application/xml, text/xml",
        )
        .send()
        .map_err(|_| "Feed request failed; check URL and connectivity")?;
    if !response.status().is_success() {
        return Err(
            "Feed server did not return success; redirects require adding the final URL explicitly"
                .into(),
        );
    }
    let mut bytes = Vec::new();
    response
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|_| "Feed response failed")?;
    if bytes.len() > 1_048_576 {
        return Err("Feed exceeds the 1 MiB limit".into());
    }
    model::parse_feed(std::str::from_utf8(&bytes).map_err(|_| "Feed must use UTF-8")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_addresses_only() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.0.1",
            "198.18.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "2002:a00:1::1",
            "2001:2::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()));
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
    }
}
