use crate::{
    models::{
        AgentCleanupRequest, AgentCleanupResult, AgentThreadScanResult, AppInfo, AppSettings,
        CleanupProgressPayload, CleanupRequest, CleanupRunResult, CleanupScanResult,
        DeleteFilesRequest, DeleteFilesResult, DiskStatus, DuplicateFileScanRequest,
        DuplicateFileScanResult, EnvInventory, EnvInventorySaveRequest, EnvInventorySaveResult,
        LargeFileScanRequest, LargeFileScanResult, PackageIconRequest, PackageIconResult,
        PackageScanRequest, PackageScanResult, PackageUninstallRequest, PackageUninstallResult,
        DEFAULT_DUPLICATE_GROUP_LIMIT, DEFAULT_LARGE_FILE_LIMIT,
    },
    services::{
        agent_cleanup::{
            clean_agent_threads as clean_agent_thread_items,
            scan_agent_threads as scan_agent_thread_items,
        },
        cleanup_targets::{
            clean_targets_with_progress, cleanup_target_count, scan_targets_with_progress,
        },
        disk::read_disk_status,
        env_vars::{
            save_env_inventory as save_env_inventory_items,
            scan_env_inventory as scan_env_inventory_items,
        },
        files::{delete_files, find_duplicate_files, find_large_files, scan_roots},
        packages::{
            load_package_icons as load_package_icon_items, scan_installed_packages_without_icons,
            uninstall_selected_packages,
        },
        settings::{read_settings, write_settings},
        system::{home_dir, Platform},
    },
};
use tauri::{AppHandle, Emitter};

const CLEANUP_PROGRESS_EVENT: &str = "cleanup-progress";

#[tauri::command]
pub async fn scan_cleanup_targets(app: AppHandle) -> Result<CleanupScanResult, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        scan_targets_with_progress(&home, |progress| emit_cleanup_progress(&app, progress))
    })
    .await
    .map_err(|err| format!("扫描任务失败：{err}"))
}

#[tauri::command]
pub async fn run_cleanup(
    app: AppHandle,
    request: CleanupRequest,
) -> Result<CleanupRunResult, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        clean_targets_with_progress(&home, &request.ids, |progress| {
            emit_cleanup_progress(&app, progress);
        })
    })
    .await
    .map_err(|err| format!("清理任务失败：{err}"))
}

fn emit_cleanup_progress(app: &AppHandle, progress: CleanupProgressPayload) {
    let _ = app.emit(CLEANUP_PROGRESS_EVENT, progress);
}

#[tauri::command]
pub fn get_disk_status() -> Result<DiskStatus, String> {
    let home = home_dir()?;
    read_disk_status(&home)
}

#[tauri::command]
pub async fn scan_large_files(
    request: Option<LargeFileScanRequest>,
) -> Result<LargeFileScanResult, String> {
    let home = home_dir()?;
    let settings = read_settings(&home).unwrap_or_default();
    let min_size = request
        .as_ref()
        .and_then(|value| value.min_size)
        .unwrap_or(settings.large_file_min_size);
    let limit = request
        .as_ref()
        .and_then(|value| value.limit)
        .unwrap_or(DEFAULT_LARGE_FILE_LIMIT);

    tauri::async_runtime::spawn_blocking(move || find_large_files(&home, min_size, limit))
        .await
        .map_err(|err| format!("大文件扫描任务失败：{err}"))?
}

#[tauri::command]
pub async fn scan_duplicate_files(
    request: Option<DuplicateFileScanRequest>,
) -> Result<DuplicateFileScanResult, String> {
    let home = home_dir()?;
    let settings = read_settings(&home).unwrap_or_default();
    let min_size = request
        .as_ref()
        .and_then(|value| value.min_size)
        .unwrap_or(settings.duplicate_min_size);
    let group_limit = request
        .as_ref()
        .and_then(|value| value.group_limit)
        .unwrap_or(DEFAULT_DUPLICATE_GROUP_LIMIT);

    tauri::async_runtime::spawn_blocking(move || find_duplicate_files(&home, min_size, group_limit))
        .await
        .map_err(|err| format!("重复文件扫描任务失败：{err}"))?
}

#[tauri::command]
pub async fn delete_user_files(request: DeleteFilesRequest) -> Result<DeleteFilesResult, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || delete_files(&home, &request.paths))
        .await
        .map_err(|err| format!("文件删除任务失败：{err}"))?
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let home = home_dir()?;
    Ok(read_settings(&home).unwrap_or_default())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let home = home_dir()?;
    write_settings(&home, &settings)?;
    crate::tray::refresh_tray_menu(&app, settings.language)
        .map_err(|err| format!("刷新托盘菜单失败：{err}"))?;
    Ok(settings)
}

#[tauri::command]
pub async fn scan_env_inventory() -> Result<EnvInventory, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || scan_env_inventory_items(&home))
        .await
        .map_err(|err| format!("环境变量扫描任务失败：{err}"))?
}

#[tauri::command]
pub async fn save_env_inventory(
    request: EnvInventorySaveRequest,
) -> Result<EnvInventorySaveResult, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || save_env_inventory_items(&home, request))
        .await
        .map_err(|err| format!("保存环境变量失败：{err}"))?
}

#[tauri::command]
pub fn get_app_info() -> Result<AppInfo, String> {
    let home = home_dir()?;
    let scan_roots = scan_roots(&home)
        .into_iter()
        .map(|path| path.display().to_string())
        .collect();

    Ok(AppInfo {
        name: "skiff".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: Platform::current().id().to_string(),
        scan_roots,
        cleanup_targets: cleanup_target_count(&home),
    })
}

#[tauri::command]
pub async fn list_installed_packages(
    request: Option<PackageScanRequest>,
) -> Result<PackageScanResult, String> {
    let include_system = request
        .as_ref()
        .and_then(|value| value.include_system)
        .unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        scan_installed_packages_without_icons(include_system)
    })
    .await
    .map_err(|err| format!("应用扫描任务失败：{err}"))?
}

#[tauri::command]
pub async fn load_package_icons(request: PackageIconRequest) -> Result<PackageIconResult, String> {
    tauri::async_runtime::spawn_blocking(move || load_package_icon_items(&request.packages))
        .await
        .map_err(|err| format!("应用图标加载任务失败：{err}"))
}

#[tauri::command]
pub async fn uninstall_packages(
    request: PackageUninstallRequest,
) -> Result<PackageUninstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || uninstall_selected_packages(&request.ids))
        .await
        .map_err(|err| format!("应用卸载任务失败：{err}"))?
}

#[tauri::command]
pub async fn scan_agent_threads() -> Result<AgentThreadScanResult, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || scan_agent_thread_items(&home))
        .await
        .map_err(|err| format!("Agent 会话扫描任务失败：{err}"))?
}

#[tauri::command]
pub async fn clean_agent_threads(
    request: AgentCleanupRequest,
) -> Result<AgentCleanupResult, String> {
    let home = home_dir()?;
    tauri::async_runtime::spawn_blocking(move || clean_agent_thread_items(&home, &request.ids))
        .await
        .map_err(|err| format!("Agent 清理任务失败：{err}"))?
}
