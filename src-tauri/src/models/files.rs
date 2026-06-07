use serde::{Deserialize, Serialize};

pub const DEFAULT_LARGE_FILE_LIMIT: usize = 80;
pub const DEFAULT_DUPLICATE_GROUP_LIMIT: usize = 40;

#[derive(Deserialize)]
pub struct LargeFileScanRequest {
    pub min_size: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Serialize, Clone)]
pub struct FileItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Serialize)]
pub struct LargeFileScanResult {
    pub items: Vec<FileItem>,
    pub total_size: u64,
    pub total_files: u64,
    pub scanned_files: u64,
}

#[derive(Deserialize)]
pub struct DuplicateFileScanRequest {
    pub min_size: Option<u64>,
    pub group_limit: Option<usize>,
}

#[derive(Serialize)]
pub struct DuplicateFileGroup {
    pub id: String,
    pub size: u64,
    pub count: u64,
    pub reclaimable_size: u64,
    pub files: Vec<FileItem>,
}

#[derive(Serialize)]
pub struct DuplicateFileScanResult {
    pub groups: Vec<DuplicateFileGroup>,
    pub total_reclaimable_size: u64,
    pub total_files: u64,
    pub scanned_files: u64,
}

#[derive(Deserialize)]
pub struct DeleteFilesRequest {
    pub paths: Vec<String>,
}

#[derive(Serialize)]
pub struct DeleteFileItemResult {
    pub path: String,
    pub released_size: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct DeleteFilesResult {
    pub items: Vec<DeleteFileItemResult>,
    pub released_size: u64,
    pub deleted_files: u64,
    pub failed_count: u64,
}
