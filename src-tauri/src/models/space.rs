use serde::{Deserialize, Serialize};

pub const DEFAULT_SPACE_SCAN_DEPTH: u8 = 4;
pub const DEFAULT_SPACE_SCAN_CHILDREN: usize = 48;

#[derive(Deserialize)]
pub struct SpaceScanRequest {
    pub path: Option<String>,
    pub max_depth: Option<u8>,
    pub max_children: Option<usize>,
}

#[derive(Clone, Serialize)]
pub struct SpaceScanNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub depth: u8,
    pub children: Vec<SpaceScanNode>,
    pub read_error: Option<String>,
}

#[derive(Serialize)]
pub struct SpaceScanResult {
    pub root: SpaceScanNode,
    pub total_size: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub inspected_entries: u64,
    pub unreadable_entries: u64,
    pub truncated_dirs: u64,
}

#[derive(Deserialize)]
pub struct SpaceAiAnalysisRequest {
    pub path: String,
    pub total_size: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub unreadable_entries: u64,
    pub top_items: Vec<SpaceAiReportItem>,
    #[serde(default)]
    pub messages: Vec<SpaceAiChatMessage>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SpaceAiReportItem {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub depth: u8,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SpaceAiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct SpaceAiAnalysisResult {
    pub provider: String,
    pub model: String,
    pub content: String,
}
