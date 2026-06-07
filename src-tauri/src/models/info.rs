use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub scan_roots: Vec<String>,
    pub cleanup_targets: u64,
}
