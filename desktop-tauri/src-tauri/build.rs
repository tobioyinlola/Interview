fn main() {
    // The site/API origin is baked into the app at build time (see policy::site_origin), so a change
    // to INTERVIEWMEET_URL must rebuild it.
    println!("cargo:rerun-if-env-changed=INTERVIEWMEET_URL");
    tauri_build::build()
}
