use crate::{
    models::{
        CleanupRunItemResult, CleanupRunResult, CleanupScanResult, CleanupTarget, PathStats,
        TargetDefinition,
    },
    services::system::{command_error, command_exists, Platform},
};
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Output},
};

pub const LINUX_CLEANUP_TARGETS: &[TargetDefinition] = &[
    TargetDefinition {
        id: "thumbnail-cache",
        name: "缩略图缓存",
        category: "cache",
        risk: "safe",
        description: "图片和视频预览缓存。删除后系统会在需要时重新生成。",
        relative_paths: &[".cache/thumbnails"],
    },
    TargetDefinition {
        id: "fontconfig-cache",
        name: "字体索引缓存",
        category: "cache",
        risk: "safe",
        description: "字体查找缓存。删除后系统会在下次加载字体时重建。",
        relative_paths: &[".cache/fontconfig"],
    },
    TargetDefinition {
        id: "shader-cache",
        name: "图形着色器缓存",
        category: "cache",
        risk: "safe",
        description: "Mesa、Radeon 和 Qt/GTK 渲染缓存。删除后会按需重建。",
        relative_paths: &[
            ".cache/mesa_shader_cache",
            ".cache/radv_builtin_shaders",
            ".cache/qtshadercache-x86_64-little_endian-lp64",
        ],
    },
    TargetDefinition {
        id: "media-framework-cache",
        name: "媒体框架缓存",
        category: "cache",
        risk: "safe",
        description: "GStreamer 和 Glycin 媒体处理缓存。删除后会按需重建。",
        relative_paths: &[".cache/gstreamer-1.0", ".cache/glycin"],
    },
    TargetDefinition {
        id: "gtk-cache",
        name: "GTK 缓存",
        category: "cache",
        risk: "safe",
        description: "GTK 组件缓存。删除后桌面应用会按需重建。",
        relative_paths: &[".cache/gtk-4.0"],
    },
    TargetDefinition {
        id: "mozilla-cache",
        name: "Firefox 缓存",
        category: "browser",
        risk: "review",
        description: "Firefox 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &[".cache/mozilla"],
    },
    TargetDefinition {
        id: "chrome-cache",
        name: "Chrome 缓存",
        category: "browser",
        risk: "review",
        description: "Chrome 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &[".cache/google-chrome"],
    },
    TargetDefinition {
        id: "chromium-cache",
        name: "Chromium 缓存",
        category: "browser",
        risk: "review",
        description: "Chromium 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &[".cache/chromium"],
    },
    TargetDefinition {
        id: "brave-cache",
        name: "Brave 缓存",
        category: "browser",
        risk: "review",
        description: "Brave 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &[".cache/BraveSoftware"],
    },
    TargetDefinition {
        id: "edge-cache",
        name: "Edge 缓存",
        category: "browser",
        risk: "review",
        description: "Microsoft Edge 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &[".cache/microsoft-edge", ".cache/Microsoft"],
    },
    TargetDefinition {
        id: "vscode-cache",
        name: "VS Code 缓存",
        category: "developer",
        risk: "review",
        description: "编辑器缓存、Webview 缓存和扩展缓存。删除后可能需要重新加载部分资源。",
        relative_paths: &[
            ".cache/vscode",
            ".cache/Code",
            ".cache/vscode-cpptools",
            ".config/Code/Cache",
            ".config/Code/CachedData",
            ".config/Code/GPUCache",
            ".config/Code/logs",
        ],
    },
    TargetDefinition {
        id: "pnpm-cache",
        name: "pnpm 缓存",
        category: "developer",
        risk: "review",
        description: "pnpm 下载缓存。删除后安装依赖时会重新下载包。",
        relative_paths: &[".cache/pnpm", ".local/share/pnpm/store"],
    },
    TargetDefinition {
        id: "cargo-cache",
        name: "Cargo 缓存",
        category: "developer",
        risk: "review",
        description: "Cargo 包和 Git 依赖缓存。删除后构建 Rust 项目时会重新下载依赖。",
        relative_paths: &[".cargo/registry/cache", ".cargo/git/db"],
    },
    TargetDefinition {
        id: "go-cache",
        name: "Go 构建缓存",
        category: "developer",
        risk: "review",
        description: "Go 构建和模块下载缓存。删除后构建时会重新生成或下载依赖。",
        relative_paths: &[".cache/go-build", "go/pkg/mod/cache"],
    },
    TargetDefinition {
        id: "playwright-cache",
        name: "Playwright 缓存",
        category: "developer",
        risk: "review",
        description: "Playwright 下载的浏览器缓存。删除后运行测试时会重新下载浏览器。",
        relative_paths: &[".cache/ms-playwright"],
    },
    TargetDefinition {
        id: "ccache-cache",
        name: "ccache 缓存",
        category: "developer",
        risk: "review",
        description: "C/C++ 编译缓存。删除后编译速度可能暂时变慢。",
        relative_paths: &[".cache/ccache"],
    },
    TargetDefinition {
        id: "uv-cache",
        name: "uv 缓存",
        category: "developer",
        risk: "review",
        description: "uv Python 包管理器缓存。删除后安装依赖时会重新下载包。",
        relative_paths: &[".cache/uv"],
    },
];

pub const MACOS_CLEANUP_TARGETS: &[TargetDefinition] = &[
    TargetDefinition {
        id: "system-cache",
        name: "系统用户缓存",
        category: "cache",
        risk: "review",
        description: "macOS 用户缓存目录。删除后应用会在需要时重新生成缓存。",
        relative_paths: &["Library/Caches"],
    },
    TargetDefinition {
        id: "user-logs",
        name: "用户日志",
        category: "cache",
        risk: "review",
        description: "macOS 用户日志目录。删除后可能影响应用故障排查。",
        relative_paths: &["Library/Logs"],
    },
    TargetDefinition {
        id: "safari-cache",
        name: "Safari 缓存",
        category: "browser",
        risk: "review",
        description: "Safari 页面资源缓存，不包含书签和密码。",
        relative_paths: &["Library/Caches/com.apple.Safari"],
    },
    TargetDefinition {
        id: "firefox-cache",
        name: "Firefox 缓存",
        category: "browser",
        risk: "review",
        description: "Firefox 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["Library/Caches/Firefox/Profiles"],
    },
    TargetDefinition {
        id: "chrome-cache",
        name: "Chrome 缓存",
        category: "browser",
        risk: "review",
        description: "Chrome 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["Library/Caches/Google/Chrome"],
    },
    TargetDefinition {
        id: "chromium-cache",
        name: "Chromium 缓存",
        category: "browser",
        risk: "review",
        description: "Chromium 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["Library/Caches/Chromium"],
    },
    TargetDefinition {
        id: "brave-cache",
        name: "Brave 缓存",
        category: "browser",
        risk: "review",
        description: "Brave 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["Library/Caches/BraveSoftware"],
    },
    TargetDefinition {
        id: "edge-cache",
        name: "Edge 缓存",
        category: "browser",
        risk: "review",
        description: "Microsoft Edge 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["Library/Caches/Microsoft Edge"],
    },
    TargetDefinition {
        id: "vscode-cache",
        name: "VS Code 缓存",
        category: "developer",
        risk: "review",
        description: "编辑器缓存、Webview 缓存和扩展缓存。删除后可能需要重新加载部分资源。",
        relative_paths: &[
            "Library/Application Support/Code/Cache",
            "Library/Application Support/Code/CachedData",
            "Library/Application Support/Code/GPUCache",
            "Library/Application Support/Code/logs",
        ],
    },
    TargetDefinition {
        id: "cargo-cache",
        name: "Cargo 缓存",
        category: "developer",
        risk: "review",
        description: "Cargo 包和 Git 依赖缓存。删除后构建 Rust 项目时会重新下载依赖。",
        relative_paths: &[".cargo/registry/cache", ".cargo/git/db"],
    },
    TargetDefinition {
        id: "go-cache",
        name: "Go 构建缓存",
        category: "developer",
        risk: "review",
        description: "Go 构建和模块下载缓存。删除后构建时会重新生成或下载依赖。",
        relative_paths: &["Library/Caches/go-build", "go/pkg/mod/cache"],
    },
    TargetDefinition {
        id: "playwright-cache",
        name: "Playwright 缓存",
        category: "developer",
        risk: "review",
        description: "Playwright 下载的浏览器缓存。删除后运行测试时会重新下载浏览器。",
        relative_paths: &["Library/Caches/ms-playwright"],
    },
    TargetDefinition {
        id: "uv-cache",
        name: "uv 缓存",
        category: "developer",
        risk: "review",
        description: "uv Python 包管理器缓存。删除后安装依赖时会重新下载包。",
        relative_paths: &["Library/Caches/uv"],
    },
];

pub const WINDOWS_CLEANUP_TARGETS: &[TargetDefinition] = &[
    TargetDefinition {
        id: "temp-files",
        name: "临时文件",
        category: "cache",
        risk: "review",
        description: "Windows 用户临时目录。正在使用的文件会清理失败并保留。",
        relative_paths: &["AppData/Local/Temp"],
    },
    TargetDefinition {
        id: "thumbnail-cache",
        name: "缩略图缓存",
        category: "cache",
        risk: "safe",
        description: "资源管理器缩略图缓存。删除后系统会在需要时重新生成。",
        relative_paths: &["AppData/Local/Microsoft/Windows/Explorer"],
    },
    TargetDefinition {
        id: "inet-cache",
        name: "系统网络缓存",
        category: "cache",
        risk: "review",
        description: "Windows 用户网络缓存。删除后系统会按需重建。",
        relative_paths: &["AppData/Local/Microsoft/Windows/INetCache"],
    },
    TargetDefinition {
        id: "firefox-cache",
        name: "Firefox 缓存",
        category: "browser",
        risk: "review",
        description: "Firefox 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["AppData/Local/Mozilla/Firefox/Profiles"],
    },
    TargetDefinition {
        id: "chrome-cache",
        name: "Chrome 缓存",
        category: "browser",
        risk: "review",
        description: "Chrome 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["AppData/Local/Google/Chrome/User Data/Default/Cache"],
    },
    TargetDefinition {
        id: "edge-cache",
        name: "Edge 缓存",
        category: "browser",
        risk: "review",
        description: "Microsoft Edge 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["AppData/Local/Microsoft/Edge/User Data/Default/Cache"],
    },
    TargetDefinition {
        id: "brave-cache",
        name: "Brave 缓存",
        category: "browser",
        risk: "review",
        description: "Brave 页面资源缓存，不包含书签、密码和历史记录。",
        relative_paths: &["AppData/Local/BraveSoftware/Brave-Browser/User Data/Default/Cache"],
    },
    TargetDefinition {
        id: "vscode-cache",
        name: "VS Code 缓存",
        category: "developer",
        risk: "review",
        description: "编辑器缓存、Webview 缓存和扩展缓存。删除后可能需要重新加载部分资源。",
        relative_paths: &[
            "AppData/Roaming/Code/Cache",
            "AppData/Roaming/Code/CachedData",
            "AppData/Roaming/Code/GPUCache",
            "AppData/Roaming/Code/logs",
        ],
    },
    TargetDefinition {
        id: "cargo-cache",
        name: "Cargo 缓存",
        category: "developer",
        risk: "review",
        description: "Cargo 包和 Git 依赖缓存。删除后构建 Rust 项目时会重新下载依赖。",
        relative_paths: &[".cargo/registry/cache", ".cargo/git/db"],
    },
    TargetDefinition {
        id: "go-cache",
        name: "Go 构建缓存",
        category: "developer",
        risk: "review",
        description: "Go 构建和模块下载缓存。删除后构建时会重新生成或下载依赖。",
        relative_paths: &["AppData/Local/go-build", "go/pkg/mod/cache"],
    },
    TargetDefinition {
        id: "playwright-cache",
        name: "Playwright 缓存",
        category: "developer",
        risk: "review",
        description: "Playwright 下载的浏览器缓存。删除后运行测试时会重新下载浏览器。",
        relative_paths: &["AppData/Local/ms-playwright"],
    },
    TargetDefinition {
        id: "uv-cache",
        name: "uv 缓存",
        category: "developer",
        risk: "review",
        description: "uv Python 包管理器缓存。删除后安装依赖时会重新下载包。",
        relative_paths: &["AppData/Local/uv/cache"],
    },
];

#[derive(Clone)]
struct CleanupTargetSpec {
    id: String,
    name: String,
    category: String,
    risk: String,
    description: String,
    paths: Vec<PathBuf>,
    commands: Vec<CleanupCommand>,
    clean_paths: bool,
    always_cleanable: bool,
}

#[derive(Clone)]
struct CleanupCommand {
    command: String,
    args: Vec<String>,
    privileged: bool,
}

pub fn cleanup_target_count(home: &Path) -> u64 {
    build_target_specs(home).len() as u64
}

pub fn scan_targets(home: &Path) -> CleanupScanResult {
    let mut targets: Vec<CleanupTarget> =
        build_target_specs(home).iter().map(scan_target).collect();
    sort_targets(&mut targets);

    let total_size = targets.iter().map(|target| target.size).sum();
    let total_files = targets.iter().map(|target| target.files).sum();

    CleanupScanResult {
        targets,
        total_size,
        total_files,
    }
}

fn sort_targets(targets: &mut [CleanupTarget]) {
    targets.sort_by(|left, right| {
        right
            .size
            .cmp(&left.size)
            .then_with(|| right.cleanable.cmp(&left.cleanable))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

pub fn clean_targets(home: &Path, ids: &[String]) -> CleanupRunResult {
    let specs = build_target_specs(home);
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

        let before = measure_existing_paths(&spec.paths);
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

fn build_target_specs(home: &Path) -> Vec<CleanupTargetSpec> {
    build_target_specs_for_platform(home, Platform::current())
}

fn build_target_specs_for_platform(home: &Path, platform: Platform) -> Vec<CleanupTargetSpec> {
    let definitions = match platform {
        Platform::Linux => LINUX_CLEANUP_TARGETS,
        Platform::MacOS => MACOS_CLEANUP_TARGETS,
        Platform::Windows => WINDOWS_CLEANUP_TARGETS,
    };
    let mut specs: Vec<CleanupTargetSpec> = definitions
        .iter()
        .map(|definition| CleanupTargetSpec {
            id: definition.id.to_string(),
            name: definition.name.to_string(),
            category: definition.category.to_string(),
            risk: definition.risk.to_string(),
            description: definition.description.to_string(),
            paths: relative_paths(home, definition.relative_paths),
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        })
        .collect();

    specs.extend(package_manager_targets(home, platform));
    if platform == Platform::Linux {
        specs.extend(flatpak_targets(home));
    }
    specs
}

fn package_manager_targets(home: &Path, platform: Platform) -> Vec<CleanupTargetSpec> {
    let mut specs = Vec::new();

    match platform {
        Platform::Linux => specs.extend(linux_package_manager_targets(home)),
        Platform::MacOS => specs.extend(macos_package_manager_targets(home)),
        Platform::Windows => {}
    }
    specs.extend(shared_package_manager_targets(home, platform));

    specs
}

fn linux_package_manager_targets(home: &Path) -> Vec<CleanupTargetSpec> {
    let mut specs = Vec::new();

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

fn macos_package_manager_targets(home: &Path) -> Vec<CleanupTargetSpec> {
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

fn shared_package_manager_targets(home: &Path, platform: Platform) -> Vec<CleanupTargetSpec> {
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

fn flatpak_targets(home: &Path) -> Vec<CleanupTargetSpec> {
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

fn scan_target(spec: &CleanupTargetSpec) -> CleanupTarget {
    let stats = measure_existing_paths(&spec.paths);
    let command_available = spec
        .commands
        .iter()
        .all(|command| command_exists(&command.command));
    let requires_privilege = spec.commands.iter().any(|command| command.privileged);
    let (exists, size, files, error) = match stats {
        Ok(stats) => {
            let has_paths = spec.paths.iter().any(|path| path.exists());
            let exists = has_paths || (!spec.commands.is_empty() && command_available);
            (exists, stats.size, stats.files, None)
        }
        Err(err) => (true, 0, 0, Some(err.to_string())),
    };
    let cleanable = error.is_none()
        && ((spec.clean_paths && exists && (size > 0 || files > 0))
            || (!spec.commands.is_empty()
                && command_available
                && (spec.always_cleanable || size > 0 || files > 0)));
    let paths = display_path_list(spec);

    CleanupTarget {
        id: spec.id.clone(),
        name: spec.name.clone(),
        category: spec.category.clone(),
        risk: spec.risk.clone(),
        description: spec.description.clone(),
        path: paths.join("\n"),
        paths,
        exists,
        cleanable,
        requires_privilege,
        size,
        files,
        error,
    }
}

fn relative_paths(home: &Path, relative_paths: &[&str]) -> Vec<PathBuf> {
    relative_paths.iter().map(|path| home.join(path)).collect()
}

fn existing_candidates(paths: &[PathBuf]) -> Vec<PathBuf> {
    dedupe_paths(paths.iter().cloned().collect())
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

fn measure_existing_paths(paths: &[PathBuf]) -> io::Result<PathStats> {
    let mut stats = PathStats::default();

    for path in paths {
        if !path.exists() {
            continue;
        }

        let child_stats = measure_cleanup_target(path)?;
        stats.size += child_stats.size;
        stats.files += child_stats.files;
    }

    Ok(stats)
}

fn measure_cleanup_target(path: &Path) -> io::Result<PathStats> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_dir() {
        measure_directory_contents(path)
    } else {
        Ok(PathStats {
            size: metadata.len(),
            files: 1,
        })
    }
}

fn measure_directory_contents(path: &Path) -> io::Result<PathStats> {
    let mut stats = PathStats::default();

    for entry in fs::read_dir(path)? {
        let child_stats = measure_path(&entry?.path())?;
        stats.size += child_stats.size;
        stats.files += child_stats.files;
    }

    Ok(stats)
}

fn measure_path(path: &Path) -> io::Result<PathStats> {
    let metadata = fs::symlink_metadata(path)?;

    if metadata.file_type().is_dir() {
        let mut stats = measure_directory_contents(path)?;
        stats.files += 1;
        Ok(stats)
    } else {
        Ok(PathStats {
            size: metadata.len(),
            files: 1,
        })
    }
}

fn clean_path_list(paths: &[PathBuf]) -> Result<PathStats, String> {
    let mut stats = PathStats::default();

    for path in paths {
        if !path.exists() {
            continue;
        }

        let path_stats = clean_path_contents(path)
            .map_err(|err| format!("清理 {} 失败：{err}", path.display()))?;
        stats.size += path_stats.size;
        stats.files += path_stats.files;
    }

    Ok(stats)
}

fn clean_path_contents(path: &Path) -> io::Result<PathStats> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        let stats = PathStats {
            size: metadata.len(),
            files: 1,
        };
        fs::remove_file(path)?;
        return Ok(stats);
    }

    let stats = measure_directory_contents(path)?;

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child_path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            fs::remove_dir_all(child_path)?;
        } else {
            fs::remove_file(child_path)?;
        }
    }

    Ok(stats)
}

fn run_cleanup_commands(commands: &[CleanupCommand]) -> Result<(), String> {
    for command in commands {
        if !command_exists(&command.command) {
            return Err(format!("找不到命令：{}", command.command));
        }

        let output = run_command(command)?;
        if !output.status.success() {
            return Err(command_error("清理命令失败", &output));
        }
    }

    Ok(())
}

fn run_command(command: &CleanupCommand) -> Result<Output, String> {
    if command.privileged && command_exists("pkexec") {
        let mut args = vec![command.command.as_str()];
        args.extend(command.args.iter().map(String::as_str));
        return Command::new("pkexec")
            .args(args)
            .output()
            .map_err(|err| format!("启动 pkexec 失败：{err}"));
    }

    Command::new(&command.command)
        .args(&command.args)
        .output()
        .map_err(|err| format!("启动 {} 失败：{err}", command.command))
}

fn display_path_list(spec: &CleanupTargetSpec) -> Vec<String> {
    let mut paths = spec
        .paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();

    if paths.is_empty() {
        paths = spec.commands.iter().map(command_line).collect();
    }

    paths
}

fn display_paths_or_commands(spec: &CleanupTargetSpec) -> String {
    display_path_list(spec).join("\n")
}

fn command_line(command: &CleanupCommand) -> String {
    let args = command.args.join(" ");
    if args.is_empty() {
        command.command.clone()
    } else {
        format!("{} {args}", command.command)
    }
}

fn first_available_command(commands: &[&str]) -> Option<String> {
    commands
        .iter()
        .find(|command| command_exists(command))
        .map(|command| (*command).to_string())
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            result.push(path);
        }
    }

    result
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
    fn measures_nested_directory_contents() {
        let root = temp_root("measure");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("a.txt"), b"abc").unwrap();
        fs::write(nested.join("b.txt"), b"defg").unwrap();

        let stats = measure_cleanup_target(&root).unwrap();

        assert_eq!(stats.size, 7);
        assert_eq!(stats.files, 3);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_contents_keeps_root_directory() {
        let root = temp_root("cleanup");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("a.txt"), b"abc").unwrap();
        fs::write(nested.join("b.txt"), b"defg").unwrap();

        let stats = clean_path_contents(&root).unwrap();

        assert_eq!(stats.size, 7);
        assert_eq!(stats.files, 3);
        assert!(root.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scan_missing_target_is_not_error() {
        let home = temp_root("missing");
        let spec = CleanupTargetSpec {
            id: "missing".to_string(),
            name: "缺失目标".to_string(),
            category: "cache".to_string(),
            risk: "safe".to_string(),
            description: "测试缺失目录".to_string(),
            paths: vec![home.join(".cache/missing")],
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        };
        let target = scan_target(&spec);

        assert_eq!(target.size, 0);
        assert_eq!(target.files, 0);
        assert!(!target.exists);
        assert!(!target.cleanable);
        assert!(target.error.is_none());

        let _ = fs::remove_dir_all(home);
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
    fn sorts_targets_by_size_then_cleanable_then_name() {
        let mut targets = vec![
            test_target("c", 10, false),
            test_target("b", 20, false),
            test_target("a", 20, true),
        ];

        sort_targets(&mut targets);

        assert_eq!(targets[0].name, "a");
        assert_eq!(targets[1].name, "b");
        assert_eq!(targets[2].name, "c");
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

    #[test]
    fn platform_targets_use_expected_roots() {
        let home = PathBuf::from("/Users/example");
        let macos = build_target_specs_for_platform(&home, Platform::MacOS);
        assert!(macos.iter().any(|target| target.id == "system-cache"
            && target.paths.contains(&home.join("Library/Caches"))));

        let windows_home = PathBuf::from(r"C:\Users\example");
        let windows = build_target_specs_for_platform(&windows_home, Platform::Windows);
        assert!(windows.iter().any(|target| target.id == "temp-files"
            && target
                .paths
                .contains(&windows_home.join("AppData/Local/Temp"))));

        let linux =
            build_target_specs_for_platform(&PathBuf::from("/home/example"), Platform::Linux);
        assert!(linux.iter().any(|target| target.id == "thumbnail-cache"));
    }

    fn test_target(name: &str, size: u64, cleanable: bool) -> CleanupTarget {
        CleanupTarget {
            id: name.to_string(),
            name: name.to_string(),
            category: "cache".to_string(),
            risk: "safe".to_string(),
            description: String::new(),
            path: String::new(),
            paths: Vec::new(),
            exists: cleanable,
            cleanable,
            requires_privilege: false,
            size,
            files: 0,
            error: None,
        }
    }
}
