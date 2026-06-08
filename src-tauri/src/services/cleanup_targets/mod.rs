mod definitions;
mod engine;
mod providers;
mod spec;

use crate::{
    models::{CleanupRunItemResult, CleanupRunResult, CleanupScanResult, CleanupTarget, PathStats},
    services::cleanup_targets::{
        engine::{clean_path_list, run_cleanup_commands, scan_target, sort_targets},
        spec::display_paths_or_commands,
    },
};
use std::path::Path;

pub fn cleanup_target_count(home: &Path) -> u64 {
    providers::build_target_specs(home).len() as u64
}

pub fn scan_targets(home: &Path) -> CleanupScanResult {
    let mut targets: Vec<CleanupTarget> = providers::build_target_specs(home)
        .iter()
        .map(scan_target)
        .collect();
    sort_targets(&mut targets);

    let total_size = targets.iter().map(|target| target.size).sum();
    let total_files = targets.iter().map(|target| target.files).sum();

    CleanupScanResult {
        targets,
        total_size,
        total_files,
    }
}

pub fn clean_targets(home: &Path, ids: &[String]) -> CleanupRunResult {
    let specs = providers::build_target_specs(home);
    let mut items = Vec::new();

    for id in ids {
        let Some(spec) = specs.iter().find(|candidate| candidate.id == *id) else {
            items.push(CleanupRunItemResult {
                id: id.clone(),
                name: "未知清理项目".to_string(),
                path: String::new(),
                released_size: 0,
                deleted_files: 0,
                success: false,
                error: Some("前端传入了未注册的清理项目。".to_string()),
            });
            continue;
        };

        let before = engine::measure_existing_paths(&spec.paths);
        let path = display_paths_or_commands(spec);

        let result = if !spec.commands.is_empty() {
            run_cleanup_commands(&spec.commands).map(|_| before.unwrap_or_default())
        } else if spec.clean_paths {
            clean_path_list(&spec.paths).map_err(|err| err.to_string())
        } else {
            Ok(PathStats::default())
        };

        match result {
            Ok(stats) => items.push(CleanupRunItemResult {
                id: spec.id.clone(),
                name: spec.name.clone(),
                path,
                released_size: stats.size,
                deleted_files: stats.files,
                success: true,
                error: None,
            }),
            Err(err) => items.push(CleanupRunItemResult {
                id: spec.id.clone(),
                name: spec.name.clone(),
                path,
                released_size: 0,
                deleted_files: 0,
                success: false,
                error: Some(err),
            }),
        }
    }

    let released_size = items.iter().map(|item| item.released_size).sum();
    let deleted_files = items.iter().map(|item| item.deleted_files).sum();
    let failed_count = items.iter().filter(|item| !item.success).count() as u64;

    CleanupRunResult {
        items,
        released_size,
        deleted_files,
        failed_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::system::Platform;
    use std::path::PathBuf;
    use std::{env, fs};

    fn temp_root(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("skiff-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn cleanup_rejects_unknown_ids() {
        let home = temp_root("unknown");
        let result = clean_targets(&home, &[String::from("not-registered")]);

        assert_eq!(result.failed_count, 1);
        assert_eq!(result.released_size, 0);
        assert_eq!(result.deleted_files, 0);
        assert_eq!(result.items[0].success, false);

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn platform_targets_use_expected_roots() {
        let home = PathBuf::from("/Users/example");
        let macos = providers::build_target_specs_for_platform(&home, Platform::MacOS);
        assert!(macos.iter().any(|target| target.id == "system-cache"
            && target.paths.contains(&home.join("Library/Caches"))));

        let windows_home = PathBuf::from(r"C:\Users\example");
        let windows = providers::build_target_specs_for_platform(&windows_home, Platform::Windows);
        assert!(windows.iter().any(|target| target.id == "temp-files"
            && target
                .paths
                .contains(&windows_home.join("AppData/Local/Temp"))));

        let linux = providers::build_target_specs_for_platform(
            &PathBuf::from("/home/example"),
            Platform::Linux,
        );
        assert!(linux.iter().any(|target| target.id == "thumbnail-cache"));
    }
}
