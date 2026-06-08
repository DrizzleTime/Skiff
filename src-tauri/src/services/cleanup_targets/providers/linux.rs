use crate::services::{
    cleanup_targets::{
        providers::{existing_candidates, first_available_command, strings},
        spec::{CleanupCommand, CleanupTargetSpec},
    },
    system::command_exists,
};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub(crate) fn package_manager_targets(home: &Path) -> Vec<CleanupTargetSpec> {
    let mut specs = Vec::new();

    if command_exists("pacman") {
        let command = if command_exists("paccache") {
            CleanupCommand {
                command: "paccache".to_string(),
                args: strings(&["-r"]),
                privileged: true,
            }
        } else {
            CleanupCommand {
                command: "pacman".to_string(),
                args: strings(&["-Sc", "--noconfirm"]),
                privileged: true,
            }
        };
        specs.push(CleanupTargetSpec {
            id: "pacman-cache-clean".to_string(),
            name: "Pacman 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "清理 Arch Linux 软件包缓存和同步数据库缓存。".to_string(),
            paths: existing_candidates(&[
                PathBuf::from("/var/cache/pacman/pkg"),
                PathBuf::from("/var/lib/pacman/sync"),
            ]),
            commands: vec![command],
            clean_paths: false,
            always_cleanable: false,
        });
    }

    if command_exists("yay") || home.join(".cache/yay").exists() {
        specs.push(CleanupTargetSpec {
            id: "yay-cache".to_string(),
            name: "Yay 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "清理 yay AUR 构建和下载缓存。".to_string(),
            paths: vec![home.join(".cache/yay")],
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        });
    }

    if command_exists("paru") || home.join(".cache/paru").exists() {
        specs.push(CleanupTargetSpec {
            id: "paru-cache".to_string(),
            name: "Paru 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "清理 paru AUR 构建和下载缓存。".to_string(),
            paths: vec![home.join(".cache/paru")],
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        });
    }

    if let Some(command) = first_available_command(&["dnf", "yum"]) {
        specs.push(CleanupTargetSpec {
            id: "dnf-cache-clean".to_string(),
            name: "DNF/YUM 缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "调用系统包管理器清理软件包、元数据和数据库缓存。".to_string(),
            paths: existing_candidates(&[
                PathBuf::from("/var/cache/libdnf5"),
                PathBuf::from("/var/cache/dnf"),
                home.join(".cache/libdnf5"),
                home.join(".cache/dnf"),
            ]),
            commands: vec![CleanupCommand {
                command,
                args: strings(&["clean", "all"]),
                privileged: true,
            }],
            clean_paths: false,
            always_cleanable: false,
        });
    }

    if command_exists("flatpak") {
        specs.push(CleanupTargetSpec {
            id: "flatpak-cache".to_string(),
            name: "Flatpak 下载缓存".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "清理 Flatpak 下载、临时仓库和系统缓存目录。".to_string(),
            paths: existing_candidates(&[
                home.join(".cache/flatpak"),
                home.join(".local/share/flatpak/repo/tmp/cache"),
            ]),
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        });

        let mut flatpak_unused_commands = Vec::new();
        if home.join(".local/share/flatpak").exists() {
            flatpak_unused_commands.push(CleanupCommand {
                command: "flatpak".to_string(),
                args: strings(&["uninstall", "--user", "--unused", "-y", "--noninteractive"]),
                privileged: false,
            });
        }
        flatpak_unused_commands.push(CleanupCommand {
            command: "flatpak".to_string(),
            args: strings(&[
                "uninstall",
                "--system",
                "--unused",
                "-y",
                "--noninteractive",
            ]),
            privileged: false,
        });

        specs.push(CleanupTargetSpec {
            id: "flatpak-unused-runtimes".to_string(),
            name: "Flatpak 未使用运行时".to_string(),
            category: "package".to_string(),
            risk: "review".to_string(),
            description: "调用 flatpak 清理未被应用依赖的运行时和扩展。大小无法提前可靠预估。"
                .to_string(),
            paths: Vec::new(),
            commands: flatpak_unused_commands,
            clean_paths: false,
            always_cleanable: true,
        });
    }

    specs
}

pub(crate) fn flatpak_targets(home: &Path) -> Vec<CleanupTargetSpec> {
    let app_root = home.join(".var/app");
    let Ok(entries) = fs::read_dir(&app_root) else {
        return Vec::new();
    };

    let names = flatpak_app_names();
    let mut specs = Vec::new();

    for entry in entries.flatten() {
        let app_dir = entry.path();
        if !entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false)
        {
            continue;
        }

        let Some(app_id) = app_dir.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let display_name = names.get(app_id).map(String::as_str).unwrap_or(app_id);

        specs.push(CleanupTargetSpec {
            id: format!("flatpak-cache:{app_id}"),
            name: format!("{display_name} 缓存"),
            category: "flatpak".to_string(),
            risk: "safe".to_string(),
            description: "清理 Flatpak 应用缓存，不删除配置、登录态和本地数据。".to_string(),
            paths: vec![app_dir.join("cache"), app_dir.join(".cache")],
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        });

        specs.push(CleanupTargetSpec {
            id: format!("flatpak-data:{app_id}"),
            name: format!("{display_name} 应用数据"),
            category: "flatpak".to_string(),
            risk: "careful".to_string(),
            description: "重置 Flatpak 应用数据和配置。会删除登录状态、本地数据库和应用配置。"
                .to_string(),
            paths: flatpak_data_paths(&app_dir),
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        });
    }

    specs.sort_by(|left, right| {
        left.category
            .cmp(&right.category)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    specs
}

fn flatpak_app_names() -> HashMap<String, String> {
    if !command_exists("flatpak") {
        return HashMap::new();
    }

    let Ok(output) = Command::new("flatpak")
        .args(["list", "--app", "--columns=application,name"])
        .output()
    else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut columns = line.splitn(2, '\t');
            let app_id = columns.next()?.trim();
            let name = columns.next().unwrap_or(app_id).trim();
            if app_id.is_empty() {
                None
            } else {
                Some((app_id.to_string(), name.to_string()))
            }
        })
        .collect()
}

fn flatpak_data_paths(app_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(app_dir) else {
        return Vec::new();
    };

    let mut paths = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            if matches!(name, "cache" | ".cache") {
                return None;
            }
            Some(entry.path())
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs};

    fn temp_root(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("skiff-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn flatpak_data_paths_skip_cache_dirs() {
        let app = temp_root("flatpak-data");
        fs::create_dir_all(app.join("cache")).unwrap();
        fs::create_dir_all(app.join("data")).unwrap();
        fs::create_dir_all(app.join("config")).unwrap();

        let paths = flatpak_data_paths(&app);
        assert_eq!(paths.len(), 2);
        assert!(paths
            .iter()
            .all(|path| path.file_name().unwrap().to_string_lossy() != "cache"));

        let _ = fs::remove_dir_all(app);
    }
}
