use crate::services::{
    cleanup_targets::{
        providers::strings,
        spec::{CleanupCommand, CleanupTargetSpec},
    },
    system::command_exists,
};
use std::path::Path;

pub(crate) fn package_manager_targets(home: &Path) -> Vec<CleanupTargetSpec> {
    let mut specs = Vec::new();

    if command_exists("brew") {
        specs.push(CleanupTargetSpec {
            id: "homebrew-cache-clean".to_string(),
            name: "Homebrew 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "调用 Homebrew 清理下载缓存和旧版本缓存。".to_string(),
            paths: vec![home.join("Library/Caches/Homebrew")],
            commands: vec![CleanupCommand {
                command: "brew".to_string(),
                args: strings(&["cleanup", "-s"]),
                privileged: false,
            }],
            clean_paths: false,
            always_cleanable: false,
        });
    }

    specs
}
