use crate::services::{
    cleanup_targets::{
        providers::{dedupe_paths, first_available_command, strings},
        spec::{CleanupCommand, CleanupTargetSpec},
    },
    system::{command_exists, Platform},
};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub(crate) fn package_manager_targets(home: &Path, platform: Platform) -> Vec<CleanupTargetSpec> {
    let mut specs = Vec::new();
    let npm_fallbacks = match platform {
        Platform::Windows => &["AppData/Local/npm-cache"][..],
        Platform::MacOS => &[".npm", "Library/Caches/npm"][..],
        Platform::Linux => &[".npm"][..],
    };
    let bun_fallbacks = match platform {
        Platform::Windows => &[".bun/install/cache", "AppData/Local/bun/install/cache"][..],
        Platform::MacOS => &[".bun/install/cache", "Library/Caches/bun"][..],
        Platform::Linux => &[".bun/install/cache", ".cache/bun"][..],
    };
    let pip_fallbacks = match platform {
        Platform::Windows => &["AppData/Local/pip/Cache"][..],
        Platform::MacOS => &["Library/Caches/pip"][..],
        Platform::Linux => &[".cache/pip"][..],
    };

    if command_exists("npm") {
        specs.push(CleanupTargetSpec {
            id: "npm-cache-clean".to_string(),
            name: "npm 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "调用 npm 清理下载缓存。删除后安装依赖时会重新下载包。".to_string(),
            paths: command_path_candidates(home, "npm", &["config", "get", "cache"], npm_fallbacks),
            commands: vec![CleanupCommand {
                command: "npm".to_string(),
                args: strings(&["cache", "clean", "--force"]),
                privileged: false,
            }],
            clean_paths: false,
            always_cleanable: false,
        });
    }

    if command_exists("bun") {
        specs.push(CleanupTargetSpec {
            id: "bun-cache-clean".to_string(),
            name: "Bun 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "调用 Bun 清理包管理缓存。删除后安装依赖时会重新下载包。".to_string(),
            paths: command_path_candidates(home, "bun", &["pm", "cache"], bun_fallbacks),
            commands: vec![CleanupCommand {
                command: "bun".to_string(),
                args: strings(&["pm", "cache", "rm"]),
                privileged: false,
            }],
            clean_paths: false,
            always_cleanable: false,
        });
    }

    if let Some(command) = first_available_command(&["pip", "pip3"]) {
        specs.push(CleanupTargetSpec {
            id: "pip-cache-clean".to_string(),
            name: "pip 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "调用 pip 清理 wheel 缓存。删除后安装依赖时会重新下载包。".to_string(),
            paths: command_path_candidates(home, &command, &["cache", "dir"], pip_fallbacks),
            commands: vec![CleanupCommand {
                command,
                args: strings(&["cache", "purge"]),
                privileged: false,
            }],
            clean_paths: false,
            always_cleanable: false,
        });
    }

    specs
}

fn command_path_candidates(
    home: &Path,
    command: &str,
    args: &[&str],
    fallbacks: &[&str],
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = command_output_path(command, args) {
        if path.starts_with(home) {
            paths.push(path);
        }
    }
    paths.extend(fallbacks.iter().map(|path| home.join(path)));
    dedupe_paths(paths)
}

fn command_output_path(command: &str, args: &[&str]) -> Option<PathBuf> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(PathBuf::from(text))
    }
}
