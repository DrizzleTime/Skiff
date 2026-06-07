use crate::{
    models::{
        InstalledPackage, PackageIconItem, PackageIconResult, PackageManagerStatus,
        PackageScanResult, PackageUninstallItemResult, PackageUninstallResult,
    },
    services::system::{command_error, command_exists, home_dir as system_home_dir, Platform},
};
use base64::{engine::general_purpose, Engine as _};
use plist::Value as PlistValue;
use std::{
    collections::HashMap,
    env, fs, io,
    path::{Path, PathBuf},
    process::{Command, Output},
};

pub fn scan_installed_packages_without_icons(
    include_system: bool,
) -> Result<PackageScanResult, String> {
    scan_installed_packages_with_icons(include_system, false)
}

pub fn load_package_icons(packages: &[InstalledPackage]) -> PackageIconResult {
    if packages.is_empty() {
        return PackageIconResult { items: Vec::new() };
    }

    let linux_index = (Platform::current() == Platform::Linux).then(DesktopIconIndex::load);
    let items = packages
        .iter()
        .map(|package| PackageIconItem {
            id: package.id.clone(),
            icon_url: package_icon_url(package, linux_index.as_ref()),
        })
        .collect();

    PackageIconResult { items }
}

fn package_icon_url(
    package: &InstalledPackage,
    linux_index: Option<&DesktopIconIndex>,
) -> Option<String> {
    match package.manager.as_str() {
        "macos-app" => macos_app_icon_data_url(Path::new(&package.package_id)),
        "windows-registry" => windows_registry_icon_data_url(&package.package_id),
        _ => linux_index?
            .icon_for_package(package)
            .and_then(|path| icon_data_url(&path)),
    }
}

fn scan_installed_packages_with_icons(
    include_system: bool,
    include_icons: bool,
) -> Result<PackageScanResult, String> {
    match Platform::current() {
        Platform::Linux => scan_linux_packages(include_system, include_icons),
        Platform::MacOS => scan_macos_packages(include_icons),
        Platform::Windows => scan_windows_packages(include_icons),
    }
}

fn scan_linux_packages(
    include_system: bool,
    include_icons: bool,
) -> Result<PackageScanResult, String> {
    let mut packages = Vec::new();
    let mut managers = Vec::new();

    let apt_available = command_exists("dpkg-query");
    managers.push(PackageManagerStatus {
        id: "apt".to_string(),
        name: "APT".to_string(),
        available: apt_available,
        command: "dpkg-query".to_string(),
        note: "Debian/Ubuntu 系统包，卸载需要管理员权限。".to_string(),
    });
    if apt_available {
        packages.extend(scan_apt_packages()?);
    }

    let rpm_available = command_exists("rpm");
    managers.push(PackageManagerStatus {
        id: "rpm".to_string(),
        name: "RPM".to_string(),
        available: rpm_available,
        command: "rpm".to_string(),
        note: "Fedora/RHEL/openSUSE 系统包，卸载需要管理员权限。".to_string(),
    });
    if rpm_available {
        packages.extend(scan_rpm_packages()?);
    }

    let flatpak_available = command_exists("flatpak");
    managers.push(PackageManagerStatus {
        id: "flatpak".to_string(),
        name: "Flatpak".to_string(),
        available: flatpak_available,
        command: "flatpak".to_string(),
        note: "Flatpak 应用，用户安装项通常不需要管理员权限。".to_string(),
    });
    if flatpak_available {
        packages.extend(scan_flatpak_packages()?);
    }

    if !include_system {
        packages.retain(is_user_facing_package);
    }
    if include_icons {
        attach_package_icons(&mut packages);
    }
    packages.sort_by(|left, right| {
        left.manager
            .cmp(&right.manager)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let total_size = packages.iter().map(|package| package.size).sum();
    let total_count = packages.len() as u64;

    Ok(PackageScanResult {
        packages,
        managers,
        total_size,
        total_count,
    })
}

fn scan_macos_packages(include_icons: bool) -> Result<PackageScanResult, String> {
    let home = system_home_dir()?;
    let brew_available = command_exists("brew");
    let mut packages = scan_macos_app_bundles(&home, include_icons);
    let managers = vec![
        PackageManagerStatus {
            id: "macos-app".to_string(),
            name: "macOS Apps".to_string(),
            available: true,
            command: "Finder".to_string(),
            note: "扫描 /Applications 和 ~/Applications，卸载时移入废纸篓。".to_string(),
        },
        PackageManagerStatus {
            id: "homebrew".to_string(),
            name: "Homebrew".to_string(),
            available: brew_available,
            command: "brew".to_string(),
            note: "扫描 Homebrew formula 和 cask，卸载时调用 brew uninstall。".to_string(),
        },
    ];

    if brew_available {
        packages.extend(scan_homebrew_packages(
            "formula",
            "homebrew-formula",
            "Homebrew Formula",
        ));
        packages.extend(scan_homebrew_packages(
            "cask",
            "homebrew-cask",
            "Homebrew Cask",
        ));
    }
    packages.sort_by(|left, right| {
        left.manager
            .cmp(&right.manager)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let total_size = packages.iter().map(|package| package.size).sum();
    let total_count = packages.len() as u64;

    Ok(PackageScanResult {
        packages,
        managers,
        total_size,
        total_count,
    })
}

fn scan_macos_app_bundles(home: &Path, include_icons: bool) -> Vec<InstalledPackage> {
    let roots = [PathBuf::from("/Applications"), home.join("Applications")];
    let mut packages = Vec::new();

    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("app") {
                continue;
            }

            let (name, version) = read_macos_app_info(&path);
            let path_text = path.display().to_string();
            packages.push(InstalledPackage {
                id: format!("macos-app:{path_text}"),
                manager: "macos-app".to_string(),
                name,
                package_id: path_text.clone(),
                version,
                description: path_text,
                icon_url: if include_icons {
                    macos_app_icon_data_url(&path)
                } else {
                    None
                },
                size: measure_package_path(&path).unwrap_or(0),
                source: "applications".to_string(),
                requires_privilege: !path.starts_with(home),
            });
        }
    }

    packages
}

fn read_macos_app_info(app_path: &Path) -> (String, String) {
    let fallback_name = app_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown App")
        .to_string();
    let info_path = app_path.join("Contents/Info.plist");
    let Ok(value) = PlistValue::from_file(info_path) else {
        return (fallback_name, String::new());
    };
    let Some(dict) = value.as_dictionary() else {
        return (fallback_name, String::new());
    };

    let name = plist_string(dict, "CFBundleDisplayName")
        .or_else(|| plist_string(dict, "CFBundleName"))
        .unwrap_or(fallback_name);
    let version = plist_string(dict, "CFBundleShortVersionString")
        .or_else(|| plist_string(dict, "CFBundleVersion"))
        .unwrap_or_default();

    (name, version)
}

fn plist_string(dict: &plist::Dictionary, key: &str) -> Option<String> {
    dict.get(key)?.as_string().map(ToString::to_string)
}

fn macos_app_icon_data_url(app_path: &Path) -> Option<String> {
    let info_path = app_path.join("Contents/Info.plist");
    let value = PlistValue::from_file(info_path).ok()?;
    let dict = value.as_dictionary()?;
    let icon_name = plist_string(dict, "CFBundleIconFile")?;
    let icon_file = if icon_name.ends_with(".icns") {
        icon_name
    } else {
        format!("{icon_name}.icns")
    };
    icon_data_url(
        &app_path
            .join("Contents/Resources")
            .join(icon_file)
            .display()
            .to_string(),
    )
}

fn scan_homebrew_packages(kind: &str, manager: &str, label: &str) -> Vec<InstalledPackage> {
    let Ok(output) = Command::new("brew")
        .args(["list", &format!("--{kind}"), "--versions"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    parse_homebrew_packages(&String::from_utf8_lossy(&output.stdout), manager, label)
}

fn parse_homebrew_packages(output: &str, manager: &str, label: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let version = parts.collect::<Vec<_>>().join(" ");
            Some(InstalledPackage {
                id: format!("{manager}:{name}"),
                manager: manager.to_string(),
                name: name.to_string(),
                package_id: name.to_string(),
                version,
                description: label.to_string(),
                icon_url: None,
                size: 0,
                source: "homebrew".to_string(),
                requires_privilege: false,
            })
        })
        .collect()
}

fn measure_package_path(path: &Path) -> io::Result<u64> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }

    let mut size = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        let child_metadata = fs::symlink_metadata(&child)?;
        if child_metadata.file_type().is_symlink() {
            continue;
        }
        if child_metadata.is_dir() {
            size += measure_package_path(&child).unwrap_or(0);
        } else {
            size += child_metadata.len();
        }
    }
    Ok(size)
}

#[cfg(windows)]
fn scan_windows_packages(include_icons: bool) -> Result<PackageScanResult, String> {
    use winreg::{enums::*, RegKey};

    let managers = vec![PackageManagerStatus {
        id: "windows-registry".to_string(),
        name: "Windows Apps".to_string(),
        available: true,
        command: "registry".to_string(),
        note: "读取 Windows Uninstall 注册表项，卸载时调用官方卸载命令。".to_string(),
    }];
    let roots = [
        (
            "HKCU",
            RegKey::predef(HKEY_CURRENT_USER),
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            false,
        ),
        (
            "HKLM",
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            true,
        ),
        (
            "HKLM",
            RegKey::predef(HKEY_LOCAL_MACHINE),
            "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            true,
        ),
    ];
    let mut packages = Vec::new();

    for (hive_name, hive, subkey_path, requires_privilege) in roots {
        let Ok(subkey) = hive.open_subkey_with_flags(subkey_path, KEY_READ) else {
            continue;
        };

        for key_name in subkey.enum_keys().flatten() {
            let Ok(app_key) = subkey.open_subkey_with_flags(&key_name, KEY_READ) else {
                continue;
            };
            let Some(package) = windows_package_from_key(
                hive_name,
                subkey_path,
                &key_name,
                &app_key,
                requires_privilege,
                include_icons,
            ) else {
                continue;
            };
            packages.push(package);
        }
    }

    packages.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    let total_size = packages.iter().map(|package| package.size).sum();
    let total_count = packages.len() as u64;

    Ok(PackageScanResult {
        packages,
        managers,
        total_size,
        total_count,
    })
}

#[cfg(windows)]
fn windows_package_from_key(
    hive_name: &str,
    subkey_path: &str,
    key_name: &str,
    key: &winreg::RegKey,
    requires_privilege: bool,
    include_icons: bool,
) -> Option<InstalledPackage> {
    let name: String = key.get_value("DisplayName").ok()?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let uninstall: Option<String> = key
        .get_value("QuietUninstallString")
        .ok()
        .or_else(|| key.get_value("UninstallString").ok());
    if uninstall
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return None;
    }

    let version: String = key.get_value("DisplayVersion").unwrap_or_default();
    let publisher: String = key.get_value("Publisher").unwrap_or_default();
    let estimated_size: u64 = key
        .get_value::<u32, _>("EstimatedSize")
        .map(parse_windows_estimated_size)
        .unwrap_or(0);
    let icon_path: Option<String> = key.get_value("DisplayIcon").ok();
    let package_id = format!("{hive_name}\\{subkey_path}\\{key_name}");

    Some(InstalledPackage {
        id: format!("windows-registry:{package_id}"),
        manager: "windows-registry".to_string(),
        name: name.to_string(),
        package_id,
        version,
        description: publisher,
        icon_url: if include_icons {
            icon_path.and_then(|path| windows_icon_data_url(&path))
        } else {
            None
        },
        size: estimated_size,
        source: hive_name.to_string(),
        requires_privilege,
    })
}

#[cfg(windows)]
fn windows_icon_data_url(value: &str) -> Option<String> {
    let path = value
        .split(',')
        .next()
        .map(str::trim)
        .map(|text| text.trim_matches('"'))?;
    icon_data_url(path)
}

#[cfg(windows)]
fn windows_registry_icon_data_url(package_id: &str) -> Option<String> {
    let key = open_windows_uninstall_key(package_id).ok()?;
    let icon_path: String = key.get_value("DisplayIcon").ok()?;
    windows_icon_data_url(&icon_path)
}

#[cfg(not(windows))]
fn windows_registry_icon_data_url(_package_id: &str) -> Option<String> {
    None
}

#[cfg(not(windows))]
fn scan_windows_packages(_include_icons: bool) -> Result<PackageScanResult, String> {
    Ok(PackageScanResult {
        packages: Vec::new(),
        managers: vec![PackageManagerStatus {
            id: "windows-registry".to_string(),
            name: "Windows Apps".to_string(),
            available: false,
            command: "registry".to_string(),
            note: "仅在 Windows 上可用。".to_string(),
        }],
        total_size: 0,
        total_count: 0,
    })
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn parse_windows_estimated_size(value_kib: u32) -> u64 {
    u64::from(value_kib) * 1024
}

pub fn uninstall_selected_packages(ids: &[String]) -> Result<PackageUninstallResult, String> {
    let installed = scan_installed_packages_without_icons(true)?;
    let by_id: HashMap<&str, &InstalledPackage> = installed
        .packages
        .iter()
        .map(|package| (package.id.as_str(), package))
        .collect();
    let mut items = Vec::new();

    for id in ids {
        let Some(package) = by_id.get(id.as_str()) else {
            items.push(PackageUninstallItemResult {
                id: id.clone(),
                name: "未知软件包".to_string(),
                manager: String::new(),
                released_size: 0,
                success: false,
                error: Some("软件包不存在或已卸载。".to_string()),
            });
            continue;
        };

        match uninstall_one_package(package) {
            Ok(()) => items.push(PackageUninstallItemResult {
                id: package.id.clone(),
                name: package.name.clone(),
                manager: package.manager.clone(),
                released_size: package.size,
                success: true,
                error: None,
            }),
            Err(err) => items.push(PackageUninstallItemResult {
                id: package.id.clone(),
                name: package.name.clone(),
                manager: package.manager.clone(),
                released_size: 0,
                success: false,
                error: Some(err),
            }),
        }
    }

    let released_size = items.iter().map(|item| item.released_size).sum();
    let removed_count = items.iter().filter(|item| item.success).count() as u64;
    let failed_count = items.iter().filter(|item| !item.success).count() as u64;

    Ok(PackageUninstallResult {
        items,
        released_size,
        removed_count,
        failed_count,
    })
}

fn is_user_facing_package(package: &InstalledPackage) -> bool {
    if package.manager == "flatpak" {
        return true;
    }

    let name = package.name.to_ascii_lowercase();
    let description = package.description.to_ascii_lowercase();

    if name == "gpg-pubkey"
        || name.starts_with("kernel")
        || name.starts_with("lib")
        || name.ends_with("-libs")
        || name.ends_with("-devel")
        || name.ends_with("-dev")
        || name.ends_with("-data")
        || name.ends_with("-common")
        || name.ends_with("-filesystem")
        || name.ends_with("-langpack")
        || name.contains("-plugin-")
        || name.contains("-firmware")
    {
        return false;
    }

    let hidden_description_terms = [
        "public key",
        "library",
        "libraries",
        "runtime",
        "firmware",
        "filesystem",
        "locale",
        "localization",
        "development files",
        "header files",
        "shared files",
        "common files",
    ];

    !hidden_description_terms
        .iter()
        .any(|term| description.contains(term))
}

fn scan_apt_packages() -> Result<Vec<InstalledPackage>, String> {
    let output = Command::new("dpkg-query")
        .args([
            "-W",
            "-f=${Package}\t${Version}\t${Installed-Size}\t${binary:Summary}\n",
        ])
        .output()
        .map_err(|err| format!("读取 APT 包失败：{err}"))?;

    if !output.status.success() {
        return Err(command_error("读取 APT 包失败", &output));
    }

    Ok(parse_apt_packages(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_apt_packages(output: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let package_id = parts.next()?.trim();
            let version = parts.next().unwrap_or("").trim();
            let size = parts
                .next()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(0)
                * 1024;
            let description = parts.next().unwrap_or("").trim();

            if package_id.is_empty() {
                return None;
            }

            Some(InstalledPackage {
                id: format!("apt:{package_id}"),
                manager: "apt".to_string(),
                name: package_id.to_string(),
                package_id: package_id.to_string(),
                version: version.to_string(),
                description: description.to_string(),
                icon_url: None,
                size,
                source: "system".to_string(),
                requires_privilege: true,
            })
        })
        .collect()
}

fn scan_rpm_packages() -> Result<Vec<InstalledPackage>, String> {
    let output = Command::new("rpm")
        .args([
            "-qa",
            "--qf",
            "%{NAME}\t%{VERSION}-%{RELEASE}\t%{SIZE}\t%{SUMMARY}\n",
        ])
        .output()
        .map_err(|err| format!("读取 RPM 包失败：{err}"))?;

    if !output.status.success() {
        return Err(command_error("读取 RPM 包失败", &output));
    }

    Ok(parse_rpm_packages(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_rpm_packages(output: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let package_id = parts.next()?.trim();
            let version = parts.next().unwrap_or("").trim();
            let size = parts
                .next()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(0);
            let description = parts.next().unwrap_or("").trim();

            if package_id.is_empty() {
                return None;
            }

            Some(InstalledPackage {
                id: format!("rpm:{package_id}"),
                manager: "rpm".to_string(),
                name: package_id.to_string(),
                package_id: package_id.to_string(),
                version: version.to_string(),
                description: description.to_string(),
                icon_url: None,
                size,
                source: "system".to_string(),
                requires_privilege: true,
            })
        })
        .collect()
}

fn scan_flatpak_packages() -> Result<Vec<InstalledPackage>, String> {
    let output = Command::new("flatpak")
        .args([
            "list",
            "--app",
            "--columns=application,name,version,installation,size",
        ])
        .output()
        .map_err(|err| format!("读取 Flatpak 应用失败：{err}"))?;

    if !output.status.success() {
        return Err(command_error("读取 Flatpak 应用失败", &output));
    }

    Ok(parse_flatpak_packages(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_flatpak_packages(output: &str) -> Vec<InstalledPackage> {
    output
        .lines()
        .filter_map(|line| {
            let columns: Vec<&str> = line.split('\t').collect();
            let package_id = columns.first()?.trim();
            if package_id.is_empty() {
                return None;
            }

            let name = columns.get(1).copied().unwrap_or(package_id).trim();
            let version = columns.get(2).copied().unwrap_or("").trim();
            let source = columns.get(3).copied().unwrap_or("system").trim();
            let size = columns
                .get(4)
                .map(|value| parse_flatpak_size(value))
                .unwrap_or(0);

            Some(InstalledPackage {
                id: format!("flatpak:{source}:{package_id}"),
                manager: "flatpak".to_string(),
                name: if name.is_empty() { package_id } else { name }.to_string(),
                package_id: package_id.to_string(),
                version: version.to_string(),
                description: package_id.to_string(),
                icon_url: None,
                size,
                source: source.to_string(),
                requires_privilege: source != "user",
            })
        })
        .collect()
}

fn parse_flatpak_size(value: &str) -> u64 {
    let text = value.trim();
    if text.is_empty() || text == "-" {
        return 0;
    }

    let mut parts = text.split_whitespace();
    let number = parts
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let unit = parts.next().unwrap_or("B").to_ascii_uppercase();
    let factor = match unit.as_str() {
        "KB" | "K" => 1024.0,
        "MB" | "M" => 1024.0 * 1024.0,
        "GB" | "G" => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };

    (number * factor) as u64
}

#[derive(Default)]
struct DesktopIconIndex {
    by_desktop_id: HashMap<String, String>,
    by_icon_name: HashMap<String, String>,
    by_name: HashMap<String, String>,
}

struct DesktopEntry {
    desktop_id: String,
    name: String,
    icon: String,
    exec: String,
}

fn attach_package_icons(packages: &mut [InstalledPackage]) {
    if packages.is_empty() {
        return;
    }

    let index = DesktopIconIndex::load();
    for package in packages {
        package.icon_url = index
            .icon_for_package(package)
            .and_then(|path| icon_data_url(&path));
    }
}

impl DesktopIconIndex {
    fn load() -> Self {
        let icon_paths = load_icon_paths();
        let mut index = Self {
            by_icon_name: icon_paths,
            ..Self::default()
        };

        for dir in desktop_search_dirs() {
            let Ok(entries) = fs::read_dir(dir) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("desktop") {
                    continue;
                }

                let Some(desktop_entry) = parse_desktop_entry(&path) else {
                    continue;
                };
                let Some(icon_path) = resolve_icon_path(&desktop_entry.icon, &index.by_icon_name)
                else {
                    continue;
                };

                index
                    .by_desktop_id
                    .entry(normalize_key(&desktop_entry.desktop_id))
                    .or_insert_with(|| icon_path.clone());

                if !desktop_entry.name.is_empty() {
                    index
                        .by_name
                        .entry(normalize_key(&desktop_entry.name))
                        .or_insert_with(|| icon_path.clone());
                }

                if let Some(exec_name) = desktop_entry.exec.split_whitespace().next() {
                    let exec_name = exec_name.rsplit('/').next().unwrap_or(exec_name);
                    index
                        .by_name
                        .entry(normalize_key(exec_name))
                        .or_insert_with(|| icon_path.clone());
                }
            }
        }

        index
    }

    fn icon_for_package(&self, package: &InstalledPackage) -> Option<String> {
        let package_id = normalize_key(&package.package_id);
        if let Some(path) = self.by_desktop_id.get(&package_id) {
            return Some(path.clone());
        }

        let name = normalize_key(&package.name);
        if let Some(path) = self.by_name.get(&name) {
            return Some(path.clone());
        }

        self.by_name
            .get(&package_id)
            .cloned()
            .or_else(|| self.by_icon_name.get(&package_id).cloned())
    }
}

fn parse_desktop_entry(path: &Path) -> Option<DesktopEntry> {
    let content = fs::read_to_string(path).ok()?;
    parse_desktop_entry_content(path, &content)
}

fn parse_desktop_entry_content(path: &Path, content: &str) -> Option<DesktopEntry> {
    let desktop_id = path.file_stem()?.to_string_lossy().to_string();
    let mut in_desktop_entry = false;
    let mut name = String::new();
    let mut icon = String::new();
    let mut exec = String::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }

        if !in_desktop_entry {
            continue;
        }

        if let Some(value) = line.strip_prefix("Name=") {
            name = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("Icon=") {
            icon = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("Exec=") {
            exec = value.trim().to_string();
        }
    }

    if icon.is_empty() {
        return None;
    }

    Some(DesktopEntry {
        desktop_id,
        name,
        icon,
        exec,
    })
}

fn resolve_icon_path(icon: &str, icon_paths: &HashMap<String, String>) -> Option<String> {
    let icon = icon.trim();
    if icon.is_empty() {
        return None;
    }

    let path = Path::new(icon);
    if path.is_absolute() && path.exists() {
        return Some(path.to_string_lossy().to_string());
    }

    icon_paths
        .get(icon)
        .cloned()
        .or_else(|| icon_paths.get(&normalize_key(icon)).cloned())
}

fn load_icon_paths() -> HashMap<String, String> {
    let mut icon_paths = HashMap::new();

    for dir in icon_search_dirs() {
        collect_icon_paths(&dir, &mut icon_paths, 0);
    }

    icon_paths
}

fn collect_icon_paths(dir: &Path, icon_paths: &mut HashMap<String, String>, depth: usize) {
    if depth > 8 {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_icon_paths(&path, icon_paths, depth + 1);
            continue;
        }

        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if !matches!(
            extension.to_ascii_lowercase().as_str(),
            "png" | "svg" | "xpm"
        ) {
            continue;
        }

        let path_text = path.to_string_lossy().to_string();
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            icon_paths
                .entry(stem.to_string())
                .or_insert_with(|| path_text.clone());
            icon_paths
                .entry(normalize_key(stem))
                .or_insert_with(|| path_text.clone());
        }
        if let Some(file_name) = path.file_name().and_then(|value| value.to_str()) {
            icon_paths
                .entry(file_name.to_string())
                .or_insert_with(|| path_text.clone());
        }
    }
}

fn desktop_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/share/applications"));
        dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
    }
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    dirs.push(PathBuf::from("/usr/local/share/applications"));
    dirs.push(PathBuf::from("/usr/share/applications"));
    dirs
}

fn icon_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/share/icons"));
        dirs.push(home.join(".local/share/flatpak/exports/share/icons"));
    }
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/icons"));
    dirs.push(PathBuf::from("/usr/local/share/icons"));
    dirs.push(PathBuf::from("/usr/share/icons"));
    dirs.push(PathBuf::from("/usr/share/pixmaps"));
    dirs
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn normalize_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn icon_data_url(path: &str) -> Option<String> {
    let path = Path::new(path);
    let mime = icon_mime_type(path)?;
    let bytes = fs::read(path).ok()?;
    if bytes.len() > 512 * 1024 {
        return None;
    }

    Some(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn icon_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("svg") => Some("image/svg+xml"),
        Some("ico") => Some("image/x-icon"),
        Some("icns") => Some("image/icns"),
        Some("xpm") => Some("image/x-xpixmap"),
        _ => None,
    }
}

fn uninstall_one_package(package: &InstalledPackage) -> Result<(), String> {
    match package.manager.as_str() {
        "apt" => run_privileged_package_command("apt-get", &["remove", "-y", &package.package_id]),
        "rpm" => uninstall_rpm_package(&package.package_id),
        "flatpak" => uninstall_flatpak_package(package),
        "macos-app" => return uninstall_macos_app_package(package),
        "homebrew-formula" => run_homebrew_uninstall("--formula", &package.package_id),
        "homebrew-cask" => run_homebrew_uninstall("--cask", &package.package_id),
        "windows-registry" => uninstall_windows_registry_package(&package.package_id),
        _ => Err("暂不支持该包管理器。".to_string()),
    }
    .and_then(|output| ensure_success("卸载失败", output))
}

fn ensure_success(prefix: &str, output: Output) -> Result<(), String> {
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(prefix, &output))
    }
}

fn uninstall_macos_app_package(package: &InstalledPackage) -> Result<(), String> {
    let path = Path::new(&package.package_id);
    trash::delete(path).map_err(|err| format!("移入废纸篓失败：{err}"))
}

fn run_homebrew_uninstall(kind: &str, package_id: &str) -> Result<Output, String> {
    Command::new("brew")
        .args(["uninstall", kind, package_id])
        .output()
        .map_err(|err| format!("启动 brew 卸载失败：{err}"))
}

#[cfg(windows)]
fn uninstall_windows_registry_package(package_id: &str) -> Result<Output, String> {
    let key = open_windows_uninstall_key(package_id)?;
    let command: String = key
        .get_value("QuietUninstallString")
        .or_else(|_| key.get_value("UninstallString"))
        .map_err(|_| "注册表项缺少卸载命令。".to_string())?;
    let command = command.trim();
    if command.is_empty() {
        return Err("注册表项缺少卸载命令。".to_string());
    }

    Command::new("cmd")
        .args(["/C", command])
        .output()
        .map_err(|err| format!("启动 Windows 卸载命令失败：{err}"))
}

#[cfg(not(windows))]
fn uninstall_windows_registry_package(_package_id: &str) -> Result<Output, String> {
    Err("Windows 注册表卸载仅在 Windows 上可用。".to_string())
}

#[cfg(windows)]
fn open_windows_uninstall_key(package_id: &str) -> Result<winreg::RegKey, String> {
    use winreg::{enums::*, RegKey};

    let (hive_name, subkey_path) = package_id
        .split_once('\\')
        .ok_or_else(|| "Windows 注册表包 ID 无法解析。".to_string())?;
    let hive = match hive_name {
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => return Err("Windows 注册表包 ID 的 hive 不受支持。".to_string()),
    };

    hive.open_subkey_with_flags(subkey_path, KEY_READ)
        .map_err(|err| format!("读取 Windows 卸载注册表项失败：{err}"))
}

fn uninstall_rpm_package(package_id: &str) -> Result<std::process::Output, String> {
    if command_exists("dnf") {
        return run_privileged_package_command("dnf", &["remove", "-y", package_id]);
    }

    if command_exists("yum") {
        return run_privileged_package_command("yum", &["remove", "-y", package_id]);
    }

    if command_exists("zypper") {
        return run_privileged_package_command(
            "zypper",
            &["--non-interactive", "remove", package_id],
        );
    }

    run_privileged_package_command("rpm", &["-e", package_id])
}

fn uninstall_flatpak_package(package: &InstalledPackage) -> Result<std::process::Output, String> {
    let mut args = vec!["uninstall", "-y", "--app"];
    if package.source == "user" {
        args.push("--user");
    } else if package.source == "system" {
        args.push("--system");
    }
    args.push(package.package_id.as_str());

    Command::new("flatpak")
        .args(args)
        .output()
        .map_err(|err| format!("启动 flatpak 卸载失败：{err}"))
}

fn run_privileged_package_command(
    command: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    if command_exists("pkexec") {
        let mut pkexec_args = vec![command];
        pkexec_args.extend_from_slice(args);
        return Command::new("pkexec")
            .args(pkexec_args)
            .output()
            .map_err(|err| format!("启动 pkexec 失败：{err}"));
    }

    Command::new(command)
        .args(args)
        .output()
        .map_err(|err| format!("启动 {command} 失败：{err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_apt_package_rows() {
        let output = "curl\t8.5.0-2ubuntu10\t512\tcommand line tool for transferring data\n";
        let packages = parse_apt_packages(output);

        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, "apt:curl");
        assert_eq!(packages[0].size, 512 * 1024);
        assert_eq!(packages[0].requires_privilege, true);
    }

    #[test]
    fn parses_rpm_package_rows() {
        let output = "coreutils\t9.10-3.fc44\t11167846\tcoreutils common optional components\n";
        let packages = parse_rpm_packages(output);

        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, "rpm:coreutils");
        assert_eq!(packages[0].size, 11167846);
        assert_eq!(packages[0].manager, "rpm");
    }

    #[test]
    fn parses_flatpak_package_rows() {
        let output = "com.example.App\tExample App\t1.2.3\tuser\t11.8 MB\n";
        let packages = parse_flatpak_packages(output);

        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, "flatpak:user:com.example.App");
        assert_eq!(packages[0].name, "Example App");
        assert_eq!(packages[0].size, 12_373_196);
        assert_eq!(packages[0].requires_privilege, false);
    }

    #[test]
    fn parses_homebrew_package_rows() {
        let output = "bat 0.25.0\nvisual-studio-code 1.100.0\n";
        let packages = parse_homebrew_packages(output, "homebrew-cask", "Homebrew Cask");

        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].id, "homebrew-cask:bat");
        assert_eq!(packages[0].manager, "homebrew-cask");
        assert_eq!(packages[0].version, "0.25.0");
    }

    #[test]
    fn parses_windows_estimated_size_as_bytes() {
        assert_eq!(parse_windows_estimated_size(1024), 1_048_576);
    }

    #[test]
    fn hides_system_packages_from_application_cleanup() {
        let hidden = InstalledPackage {
            id: "rpm:gpg-pubkey".to_string(),
            manager: "rpm".to_string(),
            name: "gpg-pubkey".to_string(),
            package_id: "gpg-pubkey".to_string(),
            version: "1".to_string(),
            description: "Fedora public key".to_string(),
            icon_url: None,
            size: 0,
            source: "system".to_string(),
            requires_privilege: true,
        };
        let kernel = InstalledPackage {
            name: "kernel".to_string(),
            id: "rpm:kernel".to_string(),
            package_id: "kernel".to_string(),
            description: "The Linux kernel".to_string(),
            ..hidden.clone()
        };

        assert_eq!(is_user_facing_package(&hidden), false);
        assert_eq!(is_user_facing_package(&kernel), false);
    }

    #[test]
    fn keeps_flatpak_apps_in_application_cleanup() {
        let app = InstalledPackage {
            id: "flatpak:system:com.example.App".to_string(),
            manager: "flatpak".to_string(),
            name: "Example App".to_string(),
            package_id: "com.example.App".to_string(),
            version: "1.2.3".to_string(),
            description: "com.example.App".to_string(),
            icon_url: None,
            size: 1024,
            source: "system".to_string(),
            requires_privilege: true,
        };

        assert_eq!(is_user_facing_package(&app), true);
    }

    #[test]
    fn parses_desktop_entry_icon_fields() {
        let content =
            "[Desktop Entry]\nName=Example App\nIcon=example-app\nExec=/usr/bin/example %U\n";
        let entry = parse_desktop_entry_content(
            Path::new("/usr/share/applications/example-app.desktop"),
            content,
        )
        .unwrap();

        assert_eq!(entry.desktop_id, "example-app");
        assert_eq!(entry.name, "Example App");
        assert_eq!(entry.icon, "example-app");
        assert_eq!(entry.exec, "/usr/bin/example %U");
    }

    #[test]
    fn encodes_icon_data_url() {
        let path = env::temp_dir().join("skiff-test-icon.png");
        fs::write(&path, [0x89, b'P', b'N', b'G']).unwrap();

        let data_url = icon_data_url(path.to_str().unwrap()).unwrap();

        assert!(data_url.starts_with("data:image/png;base64,"));
        assert!(data_url.len() > "data:image/png;base64,".len());

        let _ = fs::remove_file(path);
    }
}
