use serde::Serialize;

#[derive(Serialize)]
pub struct DiskStatus {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub used_percent: u64,
    pub mount_point: String,
}
