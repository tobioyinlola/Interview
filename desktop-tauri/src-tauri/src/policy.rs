//! Pure rules about what the desktop window may open or capture.
//!
//! Direct port of `desktop/src/policy.js` (the Electron app's rules). No Tauri types here, so these
//! are unit-tested on any machine with `cargo test`.

use url::Url;

/// The website and API. Same fallback as `desktop/src/config.js` and `scripts/build-app-ui.js`.
pub const FALLBACK_SITE: &str = "https://frontend-dev-2d437f97.up.railway.app";

pub const SCHEME: &str = "interviewmeet";

/// Where the app's own pages run from. Windows (WebView2) serves them from
/// `https://tauri.localhost`; macOS from `tauri://localhost`. In a debug build the Vite dev server
/// on localhost is also the app.
pub fn is_app_url(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("https" | "http", Some("tauri.localhost")) => true,
        ("tauri", Some("localhost")) => true,
        ("http", Some("localhost")) if cfg!(debug_assertions) => true,
        _ => false,
    }
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Nav {
    /// The app's own address: stay in the app window.
    Allow,
    /// Open in the person's normal browser (https and mail links only).
    External,
    /// Do nothing (file:, javascript:, custom schemes, malformed).
    Deny,
}

pub fn navigation_decision(url: &Url) -> Nav {
    if is_app_url(url) || url.as_str() == "about:blank" {
        return Nav::Allow;
    }
    match url.scheme() {
        "https" | "mailto" => Nav::External,
        _ => Nav::Deny,
    }
}

/// `https` only, except `http` for localhost while developing.
fn valid_site(u: &Url) -> bool {
    let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1"));
    u.scheme() == "https" || (local && u.scheme() == "http")
}

/// The site/API origin: INTERVIEWMEET_URL at run time, else the one baked in at build time (the same
/// value the interface was built with), else the fallback.
pub fn site_origin() -> String {
    let runtime = std::env::var("INTERVIEWMEET_URL").ok();
    let baked = option_env!("INTERVIEWMEET_URL").map(str::to_string);
    let raw = [runtime, baked]
        .into_iter()
        .flatten()
        .find(|v| !v.trim().is_empty())
        .unwrap_or_else(|| FALLBACK_SITE.to_string());
    let parsed = Url::parse(raw.trim()).ok().filter(valid_site);
    let url = parsed.unwrap_or_else(|| Url::parse(FALLBACK_SITE).expect("fallback is a valid URL"));
    url.origin().ascii_serialization()
}

/// What the system browser hands back after Google sign-in: `interviewmeet://auth?code=...` (or
/// `?error=...`). Returns just the safe query to pass on to the app's own page, or None. Anything
/// that is not exactly that shape is ignored, so another program cannot steer the app with a
/// crafted link.
pub fn parse_auth_link(link: &str) -> Option<String> {
    let u = Url::parse(link).ok()?;
    if u.scheme() != SCHEME || u.host_str() != Some("auth") {
        return None;
    }
    let find = |key: &str| u.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
    if let Some(code) = find("code") {
        if (20..=200).contains(&code.len())
            && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Some(format!("code={code}"));
        }
    }
    if let Some(error) = find("error") {
        if (1..=40).contains(&error.len()) && error.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
            return Some(format!("error={error}"));
        }
    }
    None
}

/// The address of the app's own Google sign-in start. Only this may be opened in the browser on the
/// page's request, so a page cannot ask the shell to open arbitrary addresses.
pub fn is_google_start_url(link: &str, site_origin: &str) -> bool {
    let Ok(u) = Url::parse(link) else { return false };
    u.origin().ascii_serialization() == site_origin
        && u.path() == "/api/auth/google/start"
        && u.query_pairs().any(|(k, v)| k == "app" && v == "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn app_addresses_stay_in_the_window() {
        assert_eq!(navigation_decision(&u("https://tauri.localhost/login")), Nav::Allow);
        assert_eq!(navigation_decision(&u("tauri://localhost/auth/app?code=x")), Nav::Allow);
        assert_eq!(navigation_decision(&u("about:blank")), Nav::Allow);
    }

    #[test]
    fn websites_and_mail_open_externally() {
        assert_eq!(navigation_decision(&u("https://example.com/")), Nav::External);
        assert_eq!(navigation_decision(&u("mailto:a@b.co")), Nav::External);
        // lookalike hosts are not the app
        assert_eq!(navigation_decision(&u("https://tauri.localhost.evil.test/")), Nav::External);
    }

    #[test]
    fn everything_else_is_denied() {
        for bad in ["file:///c:/x", "javascript:alert(1)", "interviewmeet://auth", "data:text/html,hi", "http://example.com"] {
            assert_eq!(navigation_decision(&u(bad)), Nav::Deny, "{bad}");
        }
    }

    #[test]
    fn auth_links_are_validated() {
        let code = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";
        assert_eq!(parse_auth_link(&format!("interviewmeet://auth?code={code}")), Some(format!("code={code}")));
        assert_eq!(parse_auth_link("interviewmeet://auth?error=access_denied"), Some("error=access_denied".into()));
        assert_eq!(parse_auth_link("interviewmeet://auth?code=short"), None);
        assert_eq!(parse_auth_link("interviewmeet://auth?code=abcdefghijklmnopqrstuvwxyz%20bad"), None);
        assert_eq!(parse_auth_link("interviewmeet://other?code=abcdefghijklmnopqrstuvwxyz0123"), None);
        assert_eq!(parse_auth_link("https://auth?code=abcdefghijklmnopqrstuvwxyz0123"), None);
        assert_eq!(parse_auth_link("interviewmeet://auth?error=Bad-Value"), None);
        assert_eq!(parse_auth_link("not a url"), None);
    }

    #[test]
    fn only_the_google_start_address_may_be_opened() {
        let site = "https://site.example";
        assert!(is_google_start_url("https://site.example/api/auth/google/start?app=1&challenge=x", site));
        assert!(!is_google_start_url("https://site.example/api/auth/google/start", site)); // no app=1
        assert!(!is_google_start_url("https://site.example/other?app=1", site));
        assert!(!is_google_start_url("https://evil.example/api/auth/google/start?app=1", site));
        assert!(!is_google_start_url("garbage", site));
    }

    #[test]
    fn site_origin_is_always_a_valid_https_origin() {
        let o = site_origin();
        assert!(o.starts_with("https://") || o.starts_with("http://localhost") || o.starts_with("http://127.0.0.1"));
    }
}
