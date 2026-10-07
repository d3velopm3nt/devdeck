fn main() {
    println!("cargo:rerun-if-env-changed=DEVDECK_GITHUB_CLIENT_ID");
    tauri_build::build()
}
