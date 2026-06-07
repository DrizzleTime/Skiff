use serde::{Deserialize, Serialize};

#[derive(Clone, Copy)]
pub struct TargetDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub risk: &'static str,
    pub description: &'static str,
    pub relative_paths: &'static [&'static str],
}

#[derive(Default, Clone, Copy)]
pub struct PathStats {
    pub size: u64,
    pub files: u64,
}

#[derive(Serialize)]
pub struct CleanupTarget {
    pub id: String,
    pub name: String,
    pub category: String,
    pub risk: String,
    pub description: String,
    pub path: String,
    pub paths: Vec<String>,
    pub exists: bool,
    pub cleanable: bool,
    pub requires_privilege: bool,
    pub size: u64,
    pub files: u64,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CleanupScanResult {
    pub targets: Vec<CleanupTarget>,
    pub total_size: u64,
    pub total_files: u64,
}

#[derive(Deserialize)]
pub struct CleanupRequest {
    pub ids: Vec<String>,
}

#[derive(Serialize)]
pub struct CleanupRunItemResult {
    pub id: String,
    pub name: String,
    pub path: String,
    pub released_size: u64,
    pub deleted_files: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CleanupRunResult {
    pub items: Vec<CleanupRunItemResult>,
    pub released_size: u64,
    pub deleted_files: u64,
    pub failed_count: u64,
}
