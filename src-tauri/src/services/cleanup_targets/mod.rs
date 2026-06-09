mod definitions;
mod engine;
mod providers;
mod spec;

use crate::{
    models::{
        CleanupProgressPayload, CleanupRunItemResult, CleanupRunResult, CleanupScanResult,
        CleanupTarget, PathStats,
    },
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
    scan_targets_with_progress(home, |_| {})
}

pub fn scan_targets_with_progress<F>(home: &Path, mut on_progress: F) -> CleanupScanResult
where
    F: FnMut(CleanupProgressPayload),
{
    let specs = providers::build_target_specs(home);
    let total = specs.len() as u64;
    on_progress(cleanup_progress("scanning", 0, total, None, None));

    let mut targets: Vec<CleanupTarget> = Vec::with_capacity(specs.len());
    for (index, spec) in specs.iter().enumerate() {
        let target = scan_target(spec);
        on_progress(cleanup_progress(
            "scanning",
            (index + 1) as u64,
            total,
            Some(target.id.clone()),
            Some(target.name.clone()),
        ));
        targets.push(target);
    }

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
    clean_targets_with_progress(home, ids, |_| {})
}

pub fn clean_targets_with_progress<F>(
    home: &Path,
    ids: &[String],
    mut on_progress: F,
) -> CleanupRunResult
where
    F: FnMut(CleanupProgressPayload),
{
    let specs = providers::build_target_specs(home);
    let mut items = Vec::new();
    let total = ids.len() as u64;
    on_progress(cleanup_progress("cleaning", 0, total, None, None));

    for (index, id) in ids.iter().enumerate() {
        let Some(spec) = specs.iter().find(|candidate| candidate.id == *id) else {
            let target_name = "未知清理项目".to_string();
            items.push(CleanupRunItemResult {
                id: id.clone(),
                name: target_name.clone(),
                path: String::new(),
                released_size: 0,
                deleted_files: 0,
                success: false,
                error: Some("前端传入了未注册的清理项目。".to_string()),
            });
            on_progress(cleanup_progress(
                "cleaning",
                (index + 1) as u64,
                total,
                Some(id.clone()),
                Some(target_name),
            ));
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

        on_progress(cleanup_progress(
            "cleaning",
            (index + 1) as u64,
            total,
            Some(spec.id.clone()),
            Some(spec.name.clone()),
        ));
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

fn cleanup_progress(
    phase: &str,
    processed: u64,
    total: u64,
    target_id: Option<String>,
    target_name: Option<String>,
) -> CleanupProgressPayload {
    let percent = if total == 0 {
        100
    } else {
        processed.min(total) * 100 / total
    };

    CleanupProgressPayload {
        phase: phase.to_string(),
        processed,
        total,
        percent,
        target_id,
        target_name,
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
    fn cleanup_reports_progress_for_requested_ids() {
        let home = temp_root("progress");
        let mut progress = Vec::new();

        let _ = clean_targets_with_progress(&home, &[String::from("not-registered")], |payload| {
            progress.push(payload)
        });

        assert_eq!(progress.len(), 2);
        assert_eq!(progress[0].phase, "cleaning");
        assert_eq!(progress[0].processed, 0);
        assert_eq!(progress[0].percent, 0);
        assert_eq!(progress[1].processed, 1);
        assert_eq!(progress[1].percent, 100);

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
