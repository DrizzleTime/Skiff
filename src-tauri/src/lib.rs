mod cli;
mod commands;
mod models;
mod services;
mod tray;

use commands::{
    clean_agent_threads, delete_user_files, get_app_info, get_disk_status, get_settings,
    list_installed_packages, load_package_icons, run_cleanup, save_env_inventory, save_settings,
    scan_agent_threads, scan_cleanup_targets, scan_duplicate_files, scan_env_inventory,
    scan_large_files, uninstall_packages,
};
use services::{settings::read_settings, system::home_dir};
use tray::setup_tray;

pub fn run_cli(args: impl IntoIterator<Item = String>) -> i32 {
    cli::run(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_to_tray_enabled() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_cleanup_targets,
            run_cleanup,
            get_disk_status,
            scan_large_files,
            scan_duplicate_files,
            delete_user_files,
            get_settings,
            save_settings,
            scan_env_inventory,
            save_env_inventory,
            get_app_info,
            list_installed_packages,
            load_package_icons,
            uninstall_packages,
            scan_agent_threads,
            clean_agent_threads
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn close_to_tray_enabled() -> bool {
    let Ok(home) = home_dir() else {
        return true;
    };

    read_settings(&home)
        .map(|settings| settings.close_to_tray)
        .unwrap_or(true)
}
