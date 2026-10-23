fn main() {
    println!("cargo:rerun-if-env-changed=DEVDECK_GITHUB_CLIENT_ID");
    // Branding changes must rebuild the embedded Windows resources as well.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
