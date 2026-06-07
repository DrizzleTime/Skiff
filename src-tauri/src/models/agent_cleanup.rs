use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct AgentProviderStatus {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub path: String,
    pub note: String,
}

#[derive(Serialize, Clone)]
pub struct AgentThread {
    pub id: String,
    pub agent: String,
    pub title: String,
    pub cwd: String,
    pub rollout_path: String,
    pub source: String,
    pub model: String,
    pub archived: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub size: u64,
    pub log_count: u64,
    pub goal_count: u64,
}

#[derive(Serialize)]
pub struct AgentThreadScanResult {
    pub threads: Vec<AgentThread>,
    pub agents: Vec<AgentProviderStatus>,
    pub total_size: u64,
    pub total_logs: u64,
}

#[derive(Deserialize)]
pub struct AgentCleanupRequest {
    pub ids: Vec<String>,
}

#[derive(Serialize)]
pub struct AgentCleanupItemResult {
    pub id: String,
    pub agent: String,
    pub title: String,
    pub path: String,
    pub released_size: u64,
    pub deleted_logs: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct AgentCleanupResult {
    pub items: Vec<AgentCleanupItemResult>,
    pub released_size: u64,
    pub deleted_threads: u64,
    pub deleted_logs: u64,
    pub failed_count: u64,
}
