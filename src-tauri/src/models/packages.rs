use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct PackageManagerStatus {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub command: String,
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct InstalledPackage {
    pub id: String,
    pub manager: String,
    pub name: String,
    pub package_id: String,
    pub version: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub size: u64,
    pub source: String,
    pub requires_privilege: bool,
}

#[derive(Serialize)]
pub struct PackageScanResult {
    pub packages: Vec<InstalledPackage>,
    pub managers: Vec<PackageManagerStatus>,
    pub total_size: u64,
    pub total_count: u64,
}

#[derive(Deserialize)]
pub struct PackageScanRequest {
    pub include_system: Option<bool>,
}

#[derive(Deserialize)]
pub struct PackageIconRequest {
    pub packages: Vec<InstalledPackage>,
}

#[derive(Serialize)]
pub struct PackageIconItem {
    pub id: String,
    pub icon_url: Option<String>,
}

#[derive(Serialize)]
pub struct PackageIconResult {
    pub items: Vec<PackageIconItem>,
}

#[derive(Deserialize)]
pub struct PackageUninstallRequest {
    pub ids: Vec<String>,
}

#[derive(Serialize)]
pub struct PackageUninstallItemResult {
    pub id: String,
    pub name: String,
    pub manager: String,
    pub released_size: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct PackageUninstallResult {
    pub items: Vec<PackageUninstallItemResult>,
    pub released_size: u64,
    pub removed_count: u64,
    pub failed_count: u64,
}
