//! The same rules as desktop/src/policy.js, in Rust, with the same cases tested. Pure functions.

use url::Url;

pub const SCHEME: &str = "interviewmeet";

/// The origin of an address; a custom scheme such as tauri:// has an opaque origin to the URL
/// parser, so its scheme and host identify it (as in policy.js).
fn origin_of(u: &Url) -> String {
    let o = u.origin().ascii_serialization();
    if o == "null" {
        if let Some(h) = u.host_str() {
            return format!("{}://{}", u.scheme(), h);
        }
    }
    o
}

/// A sign-in link handed back by the browser: only a well-formed `interviewmeet://auth?code=…` (or
/// `error=…`) is accepted, and only its query is kept.
pub fn parse_auth_link(link: &str) -> Option<String> {
    let u = Url::parse(link).ok()?;
    if u.scheme() != SCHEME || u.host_str() != Some("auth") {
        return None;
    }
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    if let Some(code) = get("code") {
        let ok = (20..=200).contains(&code.len())
            && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if ok {
            return Some(format!("code={code}"));
        }
    }
    if let Some(err) = get("error") {
        let ok = (1..=40).contains(&err.len()) && err.chars().all(|c| c.is_ascii_lowercase() || c == '_');
        if ok {
            return Some(format!("error={err}"));
        }
    }
    None
}

/// Only the app's own Google sign-in start may be opened in the browser on a page's request.
pub fn is_google_start_url(link: &str, site_origin: &str) -> bool {
    match Url::parse(link) {
        Ok(u) => u.origin().ascii_serialization() == site_origin && u.path() == "/api/auth/google/start",
        Err(_) => false,
    }
}

/// Native screen-capture protection is for the app's own private screens, and never during a live
/// interview session.
pub fn privacy_decision(want: bool, live: bool, from_app_page: bool) -> bool {
    want && !live && from_app_page
}

/// What a link in the app may do: stay (the app's own address), open in the normal browser (https
/// and mail only), or nothing.
#[derive(Debug, PartialEq)]
pub enum Nav {
    Allow,
    External,
    Deny,
}

pub fn navigation(link: &str, app_origins: &[&str]) -> Nav {
    let Ok(u) = Url::parse(link) else { return Nav::Deny };
    if app_origins.contains(&origin_of(&u).as_str()) {
        return Nav::Allow;
    }
    match u.scheme() {
        "https" | "mailto" => Nav::External,
        _ => Nav::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_well_shaped_sign_in_link_is_accepted() {
        let code = "a".repeat(30);
        assert_eq!(parse_auth_link(&format!("interviewmeet://auth?code={code}")), Some(format!("code={code}")));
        assert_eq!(parse_auth_link("interviewmeet://auth?error=access_denied"), Some("error=access_denied".into()));
        assert_eq!(parse_auth_link("interviewmeet://auth?code=short"), None);
        assert_eq!(parse_auth_link("interviewmeet://auth?code=bad code with spaces!!!!!!"), None);
        assert_eq!(parse_auth_link("interviewmeet://other?code=aaaaaaaaaaaaaaaaaaaaaaaaaaaa"), None);
        assert_eq!(parse_auth_link("https://evil.example/auth?code=aaaaaaaaaaaaaaaaaaaaaaaaaaaa"), None);
        assert_eq!(parse_auth_link("not a url"), None);
    }

    #[test]
    fn a_page_may_only_ask_for_the_apps_own_google_sign_in() {
        let site = "https://app.example.com";
        assert!(is_google_start_url("https://app.example.com/api/auth/google/start", site));
        assert!(!is_google_start_url("https://evil.example/api/auth/google/start", site));
        assert!(!is_google_start_url("https://app.example.com/other", site));
        assert!(!is_google_start_url("file:///etc/passwd", site));
    }

    #[test]
    fn protection_is_never_on_during_a_live_session_or_for_other_pages() {
        assert!(privacy_decision(true, false, true));
        assert!(!privacy_decision(true, true, true));
        assert!(!privacy_decision(true, false, false));
        assert!(!privacy_decision(false, false, true));
    }

    #[test]
    fn links_stay_open_externally_or_are_refused() {
        let app = ["tauri://localhost", "http://tauri.localhost"];
        assert_eq!(navigation("tauri://localhost/dashboard", &app), Nav::Allow);
        assert_eq!(navigation("https://example.com/x", &app), Nav::External);
        assert_eq!(navigation("mailto:a@b.co", &app), Nav::External);
        assert_eq!(navigation("javascript:alert(1)", &app), Nav::Deny);
        assert_eq!(navigation("file:///etc/passwd", &app), Nav::Deny);
        assert_eq!(navigation("garbage", &app), Nav::Deny);
    }
}
