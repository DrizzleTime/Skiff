use std::{
    collections::HashMap,
    env, fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    models::{
        EnvChangeAction, EnvEntry, EnvEntryChange, EnvEntryKind, EnvEntrySource, EnvInventory,
        EnvInventorySaveRequest, EnvInventorySaveResult, EnvPathEntry, EnvShell, EnvShellConfig,
        EnvVariable,
    },
    services::system::{command_exists, Platform},
};

struct ShellTarget {
    shell: EnvShell,
    label: &'static str,
    config_path: PathBuf,
    available: bool,
    is_default: bool,
    activation_command: String,
    restart_hint: &'static str,
    requires_registry: bool,
}

pub fn scan_env_inventory(home: &Path) -> Result<EnvInventory, String> {
    let targets = shell_targets(home);
    let mut entries = scan_current_process_entries();

    for target in &targets {
        entries.extend(scan_shell_config_entries(target)?);
    }

    entries.extend(scan_windows_user_env_entries()?);

    Ok(EnvInventory {
        shells: targets
            .into_iter()
            .map(|target| target.into_config())
            .collect(),
        entries,
    })
}

pub fn save_env_inventory(
    home: &Path,
    request: EnvInventorySaveRequest,
) -> Result<EnvInventorySaveResult, String> {
    validate_changes(&request.changes)?;

    let mut backup_paths = Vec::new();
    let mut changed_count = 0;

    let mut line_changes: HashMap<PathBuf, Vec<EnvEntryChange>> = HashMap::new();
    let mut skiff_changes: HashMap<EnvShell, Vec<EnvEntryChange>> = HashMap::new();
    let mut windows_changes = Vec::new();

    for change in request.changes {
        match change.source {
            EnvEntrySource::ShellConfig => {
                let path = change
                    .config_path
                    .as_ref()
                    .map(PathBuf::from)
                    .ok_or_else(|| "缺少配置文件路径。".to_string())?;
                line_changes.entry(path).or_default().push(change);
            }
            EnvEntrySource::SkiffBlock => {
                let shell = change.shell.ok_or_else(|| "缺少目标 shell。".to_string())?;
                skiff_changes.entry(shell).or_default().push(change);
            }
            EnvEntrySource::WindowsUserEnv => {
                windows_changes.push(change);
            }
            EnvEntrySource::CurrentProcess => {
                return Err("当前进程环境变量不能直接保存，请先导入到某个 shell。".to_string());
            }
        }
    }

    for (path, changes) in line_changes {
        if let Some(backup_path) = backup_existing_file(home, &path)? {
            backup_paths.push(backup_path.display().to_string());
        }
        changed_count += apply_shell_config_changes(&path, &changes)?;
    }

    for (shell, changes) in skiff_changes {
        let target = shell_target(home, shell);
        if let Some(backup_path) = backup_existing_file(home, &target.config_path)? {
            backup_paths.push(backup_path.display().to_string());
        }
        changed_count += apply_skiff_block_changes(home, shell, &changes)?;
    }

    let registry_changed = if windows_changes.is_empty() {
        false
    } else {
        changed_count += apply_windows_user_env_changes(&windows_changes)?;
        true
    };

    Ok(EnvInventorySaveResult {
        changed_count,
        backup_paths,
        registry_changed,
    })
}

fn scan_current_process_entries() -> Vec<EnvEntry> {
    let mut variables: Vec<(String, String)> = env::vars().collect();
    variables.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));

    let mut entries = Vec::new();

    for (key, value) in variables {
        if is_path_key(&key) {
            for (index, path) in split_path_value(&value).into_iter().enumerate() {
                entries.push(EnvEntry {
                    id: format!("current:path:{index}:{path}"),
                    kind: EnvEntryKind::Path,
                    key: "PATH".to_string(),
                    value: path,
                    source: EnvEntrySource::CurrentProcess,
                    shell: None,
                    source_label: "Current process".to_string(),
                    config_path: None,
                    line_number: None,
                    editable: false,
                    importable: true,
                    enabled: true,
                    note: Some("当前 Skiff 进程继承到的 PATH 条目。".to_string()),
                });
            }
            continue;
        }

        entries.push(EnvEntry {
            id: format!("current:var:{key}"),
            kind: EnvEntryKind::Variable,
            key,
            value,
            source: EnvEntrySource::CurrentProcess,
            shell: None,
            source_label: "Current process".to_string(),
            config_path: None,
            line_number: None,
            editable: false,
            importable: true,
            enabled: true,
            note: Some("当前 Skiff 进程继承到的环境变量。".to_string()),
        });
    }

    entries
}

fn scan_shell_config_entries(target: &ShellTarget) -> Result<Vec<EnvEntry>, String> {
    let content = read_config_file(&target.config_path)?;
    let mut entries = Vec::new();
    let mut in_skiff_block = false;

    for (line_index, line) in content.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();
        let disabled_prefix = format!("{} skiff-disabled ", comment_prefix(target.shell));
        let (enabled, text) = if let Some(rest) = trimmed.strip_prefix(&disabled_prefix) {
            (false, rest.trim())
        } else {
            (true, trimmed)
        };

        if text == start_marker(target.shell) {
            in_skiff_block = true;
            continue;
        }

        if in_skiff_block {
            if text == end_marker(target.shell) {
                in_skiff_block = false;
            }
            continue;
        }

        let Some((kind, key, value)) = parse_shell_config_line(target.shell, text) else {
            continue;
        };

        entries.push(EnvEntry {
            id: format!(
                "config:{}:{line_number}:{}:{key}",
                shell_id(target.shell),
                kind_id(kind)
            ),
            kind,
            key,
            value,
            source: EnvEntrySource::ShellConfig,
            shell: Some(target.shell),
            source_label: format!("{} config", target.label),
            config_path: Some(target.config_path.display().to_string()),
            line_number: Some(line_number),
            editable: true,
            importable: false,
            enabled,
            note: Some("从配置文件中识别出的简单变量语句，可直接修改该行。".to_string()),
        });
    }

    if let Some(block) = extract_managed_block(&content, target.shell) {
        let (variables, path_entries) = parse_managed_block(block, target.shell);
        for (index, variable) in variables.into_iter().enumerate() {
            entries.push(EnvEntry {
                id: format!(
                    "skiff:{}:var:{index}:{}",
                    shell_id(target.shell),
                    variable.key
                ),
                kind: EnvEntryKind::Variable,
                key: variable.key,
                value: variable.value,
                source: EnvEntrySource::SkiffBlock,
                shell: Some(target.shell),
                source_label: format!("{} Skiff", target.label),
                config_path: Some(target.config_path.display().to_string()),
                line_number: None,
                editable: true,
                importable: false,
                enabled: variable.enabled,
                note: Some("Skiff 管理区块中的变量。".to_string()),
            });
        }

        for (index, entry) in path_entries.into_iter().enumerate() {
            entries.push(EnvEntry {
                id: format!(
                    "skiff:{}:path:{index}:{}",
                    shell_id(target.shell),
                    entry.path
                ),
                kind: EnvEntryKind::Path,
                key: "PATH".to_string(),
                value: entry.path,
                source: EnvEntrySource::SkiffBlock,
                shell: Some(target.shell),
                source_label: format!("{} Skiff", target.label),
                config_path: Some(target.config_path.display().to_string()),
                line_number: None,
                editable: true,
                importable: false,
                enabled: entry.enabled,
                note: Some("Skiff 管理区块中的 PATH 条目。".to_string()),
            });
        }
    }

    Ok(entries)
}

fn parse_shell_config_line(shell: EnvShell, line: &str) -> Option<(EnvEntryKind, String, String)> {
    if line.is_empty() || line.starts_with(comment_prefix(shell)) {
        return None;
    }

    if let Some(path) = parse_path_entry(shell, line) {
        return Some((EnvEntryKind::Path, "PATH".to_string(), path));
    }

    if let Some((key, value)) = parse_variable(shell, line) {
        if is_path_key(&key) {
            return split_path_assignment(&value, shell)
                .into_iter()
                .next()
                .map(|path| (EnvEntryKind::Path, "PATH".to_string(), path));
        }

        if is_valid_env_key(&key) {
            return Some((EnvEntryKind::Variable, key, value));
        }
    }

    match shell {
        EnvShell::Zsh | EnvShell::Bash => parse_unix_assignment(line),
        EnvShell::Fish => parse_fish_assignment(line),
        EnvShell::Powershell => parse_powershell_assignment(line),
        EnvShell::Cmd => parse_cmd_assignment(line),
    }
}

fn parse_unix_assignment(line: &str) -> Option<(EnvEntryKind, String, String)> {
    let rest = line.strip_prefix("export ").unwrap_or(line);
    let (key, value) = rest.split_once('=')?;
    let key = key.trim();
    if !is_valid_env_key(key) {
        return None;
    }

    let value = strip_wrapping_quotes(value.trim());
    if is_path_key(key) {
        let path = split_path_assignment(&value, EnvShell::Bash)
            .into_iter()
            .next()?;
        return Some((EnvEntryKind::Path, "PATH".to_string(), path));
    }

    Some((EnvEntryKind::Variable, key.to_string(), value))
}

fn parse_fish_assignment(line: &str) -> Option<(EnvEntryKind, String, String)> {
    if let Some(rest) = line.strip_prefix("fish_add_path ") {
        let value = strip_wrapping_quotes(rest.trim());
        if value.is_empty() {
            return None;
        }
        return Some((EnvEntryKind::Path, "PATH".to_string(), value));
    }

    let rest = line.strip_prefix("set -gx ")?;
    let (key, value) = rest.split_once(' ')?;
    let key = key.trim();
    let value = strip_wrapping_quotes(value.trim());
    if !is_valid_env_key(key) && !is_path_key(key) {
        return None;
    }

    if is_path_key(key) {
        let path = split_path_assignment(&value, EnvShell::Fish)
            .into_iter()
            .next()
            .unwrap_or(value);
        return Some((EnvEntryKind::Path, "PATH".to_string(), path));
    }

    Some((EnvEntryKind::Variable, key.to_string(), value))
}

fn parse_powershell_assignment(line: &str) -> Option<(EnvEntryKind, String, String)> {
    let rest = line.strip_prefix("$env:")?;
    let (key, value) = rest.split_once('=')?;
    let key = key.trim();
    if !is_valid_env_key(key) && !is_path_key(key) {
        return None;
    }

    let value = value.trim();
    if is_path_key(key) {
        if let Some(path) = parse_path_entry(EnvShell::Powershell, line) {
            return Some((EnvEntryKind::Path, "PATH".to_string(), path));
        }

        let path = strip_wrapping_quotes(value)
            .split(';')
            .find(|item| !item.trim().is_empty() && !item.contains("$env:Path"))?
            .trim()
            .to_string();
        return Some((EnvEntryKind::Path, "PATH".to_string(), path));
    }

    Some((
        EnvEntryKind::Variable,
        key.to_string(),
        strip_wrapping_quotes(value),
    ))
}

fn parse_cmd_assignment(line: &str) -> Option<(EnvEntryKind, String, String)> {
    let rest = line.strip_prefix("set ")?;
    let rest = rest
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(rest);
    let (key, value) = rest.split_once('=')?;
    let key = key.trim();
    if !is_valid_env_key(key) && !is_path_key(key) {
        return None;
    }

    if is_path_key(key) {
        let path = value
            .split(';')
            .find(|item| !item.trim().is_empty() && !item.contains("%PATH%"))?
            .trim()
            .to_string();
        return Some((EnvEntryKind::Path, "PATH".to_string(), path));
    }

    Some((EnvEntryKind::Variable, key.to_string(), value.to_string()))
}

fn split_path_assignment(value: &str, shell: EnvShell) -> Vec<String> {
    let value = strip_wrapping_quotes(value);
    let marker = match shell {
        EnvShell::Powershell | EnvShell::Cmd => ";",
        EnvShell::Zsh | EnvShell::Bash | EnvShell::Fish => ":",
    };
    let cleaned = value
        .replace("$PATH:", "")
        .replace("${PATH}:", "")
        .replace("$PATH ", "")
        .replace("$env:Path + ';' +", "")
        .replace("%PATH%;", "");

    cleaned
        .split(marker)
        .map(|item| strip_wrapping_quotes(item.trim()))
        .filter(|item| !item.is_empty() && !item.contains("$PATH") && !item.contains("%PATH%"))
        .collect()
}

fn strip_wrapping_quotes(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }

    value.to_string()
}

fn split_path_value(value: &str) -> Vec<String> {
    env::split_paths(value)
        .map(|path| path.display().to_string())
        .filter(|path| !path.trim().is_empty())
        .collect()
}

fn is_path_key(key: &str) -> bool {
    key.eq_ignore_ascii_case("PATH")
}

fn shell_id(shell: EnvShell) -> &'static str {
    match shell {
        EnvShell::Zsh => "zsh",
        EnvShell::Bash => "bash",
        EnvShell::Fish => "fish",
        EnvShell::Powershell => "powershell",
        EnvShell::Cmd => "cmd",
    }
}

fn kind_id(kind: EnvEntryKind) -> &'static str {
    match kind {
        EnvEntryKind::Variable => "variable",
        EnvEntryKind::Path => "path",
    }
}

fn validate_changes(changes: &[EnvEntryChange]) -> Result<(), String> {
    for change in changes {
        match change.kind {
            EnvEntryKind::Variable => {
                let key = change.key.trim();
                if !is_valid_env_key(key) {
                    return Err(format!("变量名无效：{key}"));
                }
            }
            EnvEntryKind::Path => {
                if change.value.trim().is_empty() {
                    return Err("PATH 不能为空。".to_string());
                }
            }
        }

        if change.action == EnvChangeAction::Upsert
            && change.source != EnvEntrySource::WindowsUserEnv
            && change.source != EnvEntrySource::CurrentProcess
            && change.shell.is_none()
        {
            return Err("缺少目标 shell。".to_string());
        }
    }

    Ok(())
}

fn apply_shell_config_changes(path: &Path, changes: &[EnvEntryChange]) -> Result<usize, String> {
    let content = read_config_file(path)?;
    let mut lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let ended_with_newline = content.ends_with('\n');
    let mut ordered = changes.to_vec();
    ordered.sort_by(|left, right| right.line_number.cmp(&left.line_number));
    let mut changed_count = 0;

    for change in ordered {
        let line_number = change
            .line_number
            .ok_or_else(|| "缺少配置行号。".to_string())?;
        if line_number == 0 || line_number > lines.len() {
            return Err(format!("配置行号无效：{line_number}"));
        }
        let index = line_number - 1;

        match change.action {
            EnvChangeAction::Delete => {
                lines.remove(index);
                changed_count += 1;
            }
            EnvChangeAction::Upsert => {
                let shell = change.shell.ok_or_else(|| "缺少目标 shell。".to_string())?;
                lines[index] = render_change_line(shell, &change);
                changed_count += 1;
            }
        }
    }

    let mut next = lines.join("\n");
    if ended_with_newline || !next.is_empty() {
        next.push('\n');
    }
    fs::write(path, next).map_err(|err| format!("保存配置失败：{err}"))?;

    Ok(changed_count)
}

fn apply_skiff_block_changes(
    home: &Path,
    shell: EnvShell,
    changes: &[EnvEntryChange],
) -> Result<usize, String> {
    let target = shell_target(home, shell);
    let content = read_config_file(&target.config_path)?;
    let (mut variables, mut path_entries) = extract_managed_block(&content, shell)
        .map(|block| parse_managed_block(block, shell))
        .unwrap_or_default();
    let mut changed_count = 0;

    for change in changes {
        match change.kind {
            EnvEntryKind::Variable => {
                let original_key = change.original_key.as_deref().unwrap_or(&change.key);
                match change.action {
                    EnvChangeAction::Delete => {
                        let before = variables.len();
                        variables.retain(|variable| variable.key != original_key);
                        changed_count += usize::from(before != variables.len());
                    }
                    EnvChangeAction::Upsert => {
                        if let Some(variable) = variables
                            .iter_mut()
                            .find(|variable| variable.key == original_key)
                        {
                            variable.key = change.key.trim().to_string();
                            variable.value = change.value.clone();
                            variable.enabled = change.enabled;
                        } else {
                            variables.push(EnvVariable {
                                key: change.key.trim().to_string(),
                                value: change.value.clone(),
                                enabled: change.enabled,
                            });
                        }
                        changed_count += 1;
                    }
                }
            }
            EnvEntryKind::Path => {
                let original_value = change.original_value.as_deref().unwrap_or(&change.value);
                match change.action {
                    EnvChangeAction::Delete => {
                        let before = path_entries.len();
                        path_entries.retain(|entry| entry.path != original_value);
                        changed_count += usize::from(before != path_entries.len());
                    }
                    EnvChangeAction::Upsert => {
                        if let Some(entry) = path_entries
                            .iter_mut()
                            .find(|entry| entry.path == original_value)
                        {
                            entry.path = change.value.trim().to_string();
                            entry.enabled = change.enabled;
                        } else {
                            path_entries.push(EnvPathEntry {
                                path: change.value.trim().to_string(),
                                enabled: change.enabled,
                            });
                        }
                        changed_count += 1;
                    }
                }
            }
        }
    }

    if let Some(parent) = target.config_path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建配置目录失败：{err}"))?;
    }
    let block = build_managed_block(shell, &variables, &path_entries);
    let next_content = upsert_managed_block(&content, shell, &block);
    fs::write(&target.config_path, next_content).map_err(|err| format!("保存配置失败：{err}"))?;

    if shell == EnvShell::Cmd {
        ensure_cmd_autorun(&target.config_path)?;
    }

    Ok(changed_count)
}

fn render_change_line(shell: EnvShell, change: &EnvEntryChange) -> String {
    let line = match change.kind {
        EnvEntryKind::Variable => render_variable(
            shell,
            &EnvVariable {
                key: change.key.trim().to_string(),
                value: change.value.clone(),
                enabled: change.enabled,
            },
        ),
        EnvEntryKind::Path => render_path_entry(
            shell,
            &EnvPathEntry {
                path: change.value.trim().to_string(),
                enabled: change.enabled,
            },
        ),
    };

    render_enabled_line(shell, change.enabled, line)
}

#[cfg(windows)]
fn scan_windows_user_env_entries() -> Result<Vec<EnvEntry>, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey("Environment") else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::new();

    for value in key.enum_values() {
        let (name, _) = value.map_err(|err| format!("读取 Windows 用户环境失败：{err}"))?;
        let Ok(data) = key.get_value::<String, _>(&name) else {
            continue;
        };

        if is_path_key(&name) {
            for (index, path) in data
                .split(';')
                .filter(|item| !item.trim().is_empty())
                .enumerate()
            {
                entries.push(EnvEntry {
                    id: format!("windows:user:path:{index}:{}", path.trim()),
                    kind: EnvEntryKind::Path,
                    key: "PATH".to_string(),
                    value: path.trim().to_string(),
                    source: EnvEntrySource::WindowsUserEnv,
                    shell: None,
                    source_label: "Windows user env".to_string(),
                    config_path: Some("HKCU\\Environment".to_string()),
                    line_number: None,
                    editable: true,
                    importable: false,
                    enabled: true,
                    note: Some(
                        "Windows 当前用户环境变量，CMD 和 PowerShell 新进程都会继承。".to_string(),
                    ),
                });
            }
            continue;
        }

        entries.push(EnvEntry {
            id: format!("windows:user:var:{name}"),
            kind: EnvEntryKind::Variable,
            key: name,
            value: data,
            source: EnvEntrySource::WindowsUserEnv,
            shell: None,
            source_label: "Windows user env".to_string(),
            config_path: Some("HKCU\\Environment".to_string()),
            line_number: None,
            editable: true,
            importable: false,
            enabled: true,
            note: Some("Windows 当前用户环境变量，CMD 和 PowerShell 新进程都会继承。".to_string()),
        });
    }

    Ok(entries)
}

#[cfg(not(windows))]
fn scan_windows_user_env_entries() -> Result<Vec<EnvEntry>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
fn apply_windows_user_env_changes(changes: &[EnvEntryChange]) -> Result<usize, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Environment")
        .map_err(|err| format!("打开 Windows 用户环境失败：{err}"))?;
    let mut path_entries: Vec<String> = key
        .get_value::<String, _>("Path")
        .unwrap_or_default()
        .split(';')
        .filter(|item| !item.trim().is_empty())
        .map(|item| item.trim().to_string())
        .collect();
    let mut path_changed = false;
    let mut changed_count = 0;

    for change in changes {
        match change.kind {
            EnvEntryKind::Variable => {
                let name = change
                    .original_key
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(&change.key);

                if change.action == EnvChangeAction::Delete {
                    let _ = key.delete_value(name);
                } else {
                    if name != change.key {
                        let _ = key.delete_value(name);
                    }
                    key.set_value(change.key.trim(), &change.value)
                        .map_err(|err| format!("保存 Windows 用户环境失败：{err}"))?;
                }
                changed_count += 1;
            }
            EnvEntryKind::Path => {
                let original = change.original_value.as_deref().unwrap_or(&change.value);
                match change.action {
                    EnvChangeAction::Delete => {
                        let before = path_entries.len();
                        path_entries.retain(|item| item != original);
                        path_changed |= before != path_entries.len();
                    }
                    EnvChangeAction::Upsert => {
                        if let Some(item) = path_entries.iter_mut().find(|item| *item == original) {
                            *item = change.value.trim().to_string();
                        } else {
                            path_entries.push(change.value.trim().to_string());
                        }
                        path_changed = true;
                    }
                }
                changed_count += 1;
            }
        }
    }

    if path_changed {
        key.set_value("Path", &path_entries.join(";"))
            .map_err(|err| format!("保存 Windows 用户 PATH 失败：{err}"))?;
    }

    Ok(changed_count)
}

#[cfg(not(windows))]
fn apply_windows_user_env_changes(_changes: &[EnvEntryChange]) -> Result<usize, String> {
    Err("Windows 用户环境只在 Windows 上可用。".to_string())
}

impl ShellTarget {
    fn into_config(self) -> EnvShellConfig {
        EnvShellConfig {
            shell: self.shell,
            label: self.label.to_string(),
            config_path: self.config_path.display().to_string(),
            exists: self.config_path.exists(),
            available: self.available,
            is_default: self.is_default,
            activation_command: self.activation_command,
            restart_hint: self.restart_hint.to_string(),
            requires_registry: self.requires_registry,
        }
    }
}

fn shell_targets(home: &Path) -> Vec<ShellTarget> {
    match Platform::current() {
        Platform::Windows => vec![
            shell_target(home, EnvShell::Powershell),
            shell_target(home, EnvShell::Cmd),
        ],
        Platform::Linux | Platform::MacOS => vec![
            shell_target(home, EnvShell::Zsh),
            shell_target(home, EnvShell::Bash),
            shell_target(home, EnvShell::Fish),
        ],
    }
}

fn shell_target(home: &Path, shell: EnvShell) -> ShellTarget {
    let default_shell = default_shell_name();

    match shell {
        EnvShell::Zsh => {
            let path = home.join(".zshrc");
            ShellTarget {
                shell,
                label: "zsh",
                config_path: path.clone(),
                available: command_exists("zsh"),
                is_default: default_shell.as_deref() == Some("zsh"),
                activation_command: format!("source {}", display_user_path(home, &path)),
                restart_hint: "新开的 zsh 会自动读取该配置；当前终端需要手动执行 source。",
                requires_registry: false,
            }
        }
        EnvShell::Bash => {
            let path = home.join(".bashrc");
            ShellTarget {
                shell,
                label: "bash",
                config_path: path.clone(),
                available: command_exists("bash"),
                is_default: default_shell.as_deref() == Some("bash"),
                activation_command: format!("source {}", display_user_path(home, &path)),
                restart_hint: "新开的 bash 会自动读取该配置；当前终端需要手动执行 source。",
                requires_registry: false,
            }
        }
        EnvShell::Fish => {
            let path = home.join(".config").join("fish").join("config.fish");
            ShellTarget {
                shell,
                label: "fish",
                config_path: path.clone(),
                available: command_exists("fish"),
                is_default: default_shell.as_deref() == Some("fish"),
                activation_command: format!("source {}", display_user_path(home, &path)),
                restart_hint: "新开的 fish 会自动读取该配置；当前终端需要手动执行 source。",
                requires_registry: false,
            }
        }
        EnvShell::Powershell => {
            let path = powershell_profile_path(home);
            ShellTarget {
                shell,
                label: "PowerShell",
                config_path: path.clone(),
                available: command_exists("pwsh")
                    || command_exists("powershell")
                    || command_exists("powershell.exe"),
                is_default: default_shell
                    .as_deref()
                    .is_some_and(|name| name.contains("powershell") || name == "pwsh"),
                activation_command: format!(". \"{}\"", path.display()),
                restart_hint: "新开的 PowerShell 会自动读取 profile；当前会话可以点源该 profile。",
                requires_registry: false,
            }
        }
        EnvShell::Cmd => {
            let path = home
                .join(".config")
                .join("skiff")
                .join("env")
                .join("cmd-env.cmd");
            ShellTarget {
                shell,
                label: "CMD",
                config_path: path.clone(),
                available: command_exists("cmd") || command_exists("cmd.exe"),
                is_default: default_shell
                    .as_deref()
                    .is_some_and(|name| name == "cmd" || name == "cmd.exe"),
                activation_command: format!("call \"{}\"", path.display()),
                restart_hint:
                    "新开的 CMD 会通过当前用户 AutoRun 执行该脚本；当前窗口可以手动 call。",
                requires_registry: true,
            }
        }
    }
}

fn powershell_profile_path(home: &Path) -> PathBuf {
    let modern = home
        .join("Documents")
        .join("PowerShell")
        .join("Microsoft.PowerShell_profile.ps1");
    let legacy = home
        .join("Documents")
        .join("WindowsPowerShell")
        .join("Microsoft.PowerShell_profile.ps1");

    if modern.exists() || command_exists("pwsh") {
        modern
    } else {
        legacy
    }
}

fn default_shell_name() -> Option<String> {
    env::var_os("SHELL")
        .and_then(|value| {
            Path::new(&value)
                .file_name()
                .map(|name| name.to_string_lossy().to_lowercase())
        })
        .or_else(|| {
            env::var_os("COMSPEC").and_then(|value| {
                Path::new(&value)
                    .file_name()
                    .map(|name| name.to_string_lossy().to_lowercase())
            })
        })
}

fn read_config_file(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("读取配置失败：{err}")),
    }
}

fn backup_existing_file(home: &Path, path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "env-config".to_string());
    let backup_dir = home
        .join(".config")
        .join("skiff")
        .join("backups")
        .join("env");
    let backup_path = backup_dir.join(format!("{file_name}.{timestamp}.bak"));

    fs::create_dir_all(&backup_dir).map_err(|err| format!("创建备份目录失败：{err}"))?;
    fs::copy(path, &backup_path).map_err(|err| format!("备份配置失败：{err}"))?;

    Ok(Some(backup_path))
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|char| char == '_' || char.is_ascii_alphanumeric())
}

fn build_managed_block(
    shell: EnvShell,
    variables: &[EnvVariable],
    path_entries: &[EnvPathEntry],
) -> String {
    let mut lines = vec![
        start_marker(shell).to_string(),
        format!(
            "{} Managed by Skiff. Review this block before changing it by hand.",
            comment_prefix(shell)
        ),
    ];

    for variable in variables {
        let line = render_variable(shell, variable);
        lines.push(render_enabled_line(shell, variable.enabled, line));
    }

    if !variables.is_empty() && !path_entries.is_empty() {
        lines.push(String::new());
    }

    for entry in path_entries {
        if entry.path.trim().is_empty() {
            continue;
        }

        let line = render_path_entry(shell, entry);
        lines.push(render_enabled_line(shell, entry.enabled, line));
    }

    lines.push(end_marker(shell).to_string());
    lines.push(String::new());
    lines.join("\n")
}

fn render_enabled_line(shell: EnvShell, enabled: bool, line: String) -> String {
    if enabled {
        line
    } else {
        format!("{} skiff-disabled {}", comment_prefix(shell), line)
    }
}

fn render_variable(shell: EnvShell, variable: &EnvVariable) -> String {
    let key = variable.key.trim();
    match shell {
        EnvShell::Zsh | EnvShell::Bash => {
            format!(
                "export {key}=\"{}\"",
                escape_double_shell(&normalize_unix_home(&variable.value))
            )
        }
        EnvShell::Fish => {
            format!(
                "set -gx {key} \"{}\"",
                escape_double_shell(&normalize_unix_home(&variable.value))
            )
        }
        EnvShell::Powershell => {
            format!(
                "$env:{key} = '{}'",
                escape_powershell_single(&variable.value)
            )
        }
        EnvShell::Cmd => format!("set \"{key}={}\"", escape_cmd_value(&variable.value)),
    }
}

fn render_path_entry(shell: EnvShell, entry: &EnvPathEntry) -> String {
    match shell {
        EnvShell::Zsh | EnvShell::Bash => {
            format!(
                "export PATH=\"$PATH:{}\"",
                escape_double_shell(&normalize_unix_home(&entry.path))
            )
        }
        EnvShell::Fish => {
            format!(
                "set -gx PATH $PATH \"{}\"",
                escape_double_shell(&normalize_unix_home(&entry.path))
            )
        }
        EnvShell::Powershell => {
            format!(
                "$env:Path = $env:Path + ';' + '{}'",
                escape_powershell_single(&entry.path)
            )
        }
        EnvShell::Cmd => format!("set \"PATH=%PATH%;{}\"", escape_cmd_value(&entry.path)),
    }
}

fn upsert_managed_block(content: &str, shell: EnvShell, block: &str) -> String {
    let start = start_marker(shell);
    let end = end_marker(shell);

    if let Some(start_index) = content.find(start) {
        let search_from = start_index + start.len();
        if let Some(end_offset) = content[search_from..].find(end) {
            let end_index = search_from + end_offset + end.len();
            let mut next = String::new();
            next.push_str(&content[..start_index]);
            next.push_str(block);
            next.push_str(content[end_index..].trim_start_matches(['\r', '\n']));
            return next;
        }
    }

    let mut next = content.to_string();
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    if !next.is_empty() {
        next.push('\n');
    }
    next.push_str(block);
    next
}

fn extract_managed_block(content: &str, shell: EnvShell) -> Option<&str> {
    let start = start_marker(shell);
    let end = end_marker(shell);
    let start_index = content.find(start)? + start.len();
    let end_offset = content[start_index..].find(end)?;

    Some(&content[start_index..start_index + end_offset])
}

fn parse_managed_block(block: &str, shell: EnvShell) -> (Vec<EnvVariable>, Vec<EnvPathEntry>) {
    let mut variables = Vec::new();
    let mut path_entries = Vec::new();

    for line in block.lines() {
        let mut text = line.trim();
        if text.is_empty() || text == comment_prefix(shell) {
            continue;
        }

        let mut enabled = true;
        let disabled_prefix = format!("{} skiff-disabled ", comment_prefix(shell));
        if let Some(rest) = text.strip_prefix(&disabled_prefix) {
            enabled = false;
            text = rest.trim();
        } else if text.starts_with(comment_prefix(shell)) {
            continue;
        }

        if let Some(path) = parse_path_entry(shell, text) {
            path_entries.push(EnvPathEntry { path, enabled });
            continue;
        }

        if let Some((key, value)) = parse_variable(shell, text) {
            variables.push(EnvVariable {
                key,
                value,
                enabled,
            });
        }
    }

    (variables, path_entries)
}

fn parse_variable(shell: EnvShell, line: &str) -> Option<(String, String)> {
    match shell {
        EnvShell::Zsh | EnvShell::Bash => {
            let rest = line.strip_prefix("export ")?;
            let (key, quoted) = rest.split_once('=')?;
            parse_double_quoted(quoted).map(|value| (key.trim().to_string(), value))
        }
        EnvShell::Fish => {
            let rest = line.strip_prefix("set -gx ")?;
            if rest.starts_with("PATH ") {
                return None;
            }
            let (key, quoted) = rest.split_once(' ')?;
            parse_double_quoted(quoted.trim()).map(|value| (key.trim().to_string(), value))
        }
        EnvShell::Powershell => {
            let rest = line.strip_prefix("$env:")?;
            let (key, quoted) = rest.split_once(" = ")?;
            parse_single_quoted(quoted).map(|value| (key.trim().to_string(), value))
        }
        EnvShell::Cmd => {
            let rest = line.strip_prefix("set \"")?.strip_suffix('"')?;
            let (key, value) = rest.split_once('=')?;
            if key.eq_ignore_ascii_case("PATH") {
                return None;
            }
            Some((key.trim().to_string(), value.to_string()))
        }
    }
}

fn parse_path_entry(shell: EnvShell, line: &str) -> Option<String> {
    match shell {
        EnvShell::Zsh | EnvShell::Bash => line
            .strip_prefix("export PATH=\"$PATH:")
            .and_then(|value| value.strip_suffix('"'))
            .map(unescape_double_shell),
        EnvShell::Fish => line
            .strip_prefix("set -gx PATH $PATH ")
            .and_then(parse_double_quoted),
        EnvShell::Powershell => line
            .strip_prefix("$env:Path = $env:Path + ';' + ")
            .and_then(parse_single_quoted),
        EnvShell::Cmd => line
            .strip_prefix("set \"PATH=%PATH%;")
            .and_then(|value| value.strip_suffix('"'))
            .map(ToString::to_string),
    }
}

fn parse_double_quoted(value: &str) -> Option<String> {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .map(unescape_double_shell)
}

fn parse_single_quoted(value: &str) -> Option<String> {
    value
        .strip_prefix('\'')
        .and_then(|value| value.strip_suffix('\''))
        .map(|value| value.replace("''", "'"))
}

fn normalize_unix_home(value: &str) -> String {
    if value == "~" {
        "$HOME".to_string()
    } else if let Some(rest) = value.strip_prefix("~/") {
        format!("$HOME/{rest}")
    } else {
        value.to_string()
    }
}

fn escape_double_shell(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
}

fn unescape_double_shell(value: &str) -> String {
    let mut output = String::new();
    let mut escaped = false;

    for char in value.chars() {
        if escaped {
            output.push(char);
            escaped = false;
        } else if char == '\\' {
            escaped = true;
        } else {
            output.push(char);
        }
    }

    if escaped {
        output.push('\\');
    }

    output
}

fn escape_powershell_single(value: &str) -> String {
    value.replace('\'', "''")
}

fn escape_cmd_value(value: &str) -> String {
    value.replace('"', "\\\"")
}

fn comment_prefix(shell: EnvShell) -> &'static str {
    match shell {
        EnvShell::Cmd => "rem",
        EnvShell::Zsh | EnvShell::Bash | EnvShell::Fish | EnvShell::Powershell => "#",
    }
}

fn start_marker(shell: EnvShell) -> &'static str {
    match shell {
        EnvShell::Cmd => "rem >>> skiff env >>>",
        EnvShell::Zsh | EnvShell::Bash | EnvShell::Fish | EnvShell::Powershell => {
            "# >>> skiff env >>>"
        }
    }
}

fn end_marker(shell: EnvShell) -> &'static str {
    match shell {
        EnvShell::Cmd => "rem <<< skiff env <<<",
        EnvShell::Zsh | EnvShell::Bash | EnvShell::Fish | EnvShell::Powershell => {
            "# <<< skiff env <<<"
        }
    }
}

fn display_user_path(home: &Path, path: &Path) -> String {
    path.strip_prefix(home)
        .ok()
        .map(|rest| {
            let rest = rest.display().to_string();
            if rest.is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", rest)
            }
        })
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(windows)]
fn ensure_cmd_autorun(script_path: &Path) -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Command Processor")
        .map_err(|err| format!("打开 CMD AutoRun 注册表失败：{err}"))?;
    let script = script_path.display().to_string();
    let autorun_command = format!("call \"{script}\"");
    let current = key.get_value::<String, _>("AutoRun").unwrap_or_default();
    let next = if current.to_lowercase().contains(&script.to_lowercase()) {
        current
    } else if current.trim().is_empty() {
        autorun_command
    } else {
        format!("{current} & {autorun_command}")
    };

    key.set_value("AutoRun", &next)
        .map_err(|err| format!("保存 CMD AutoRun 失败：{err}"))
}

#[cfg(not(windows))]
fn ensure_cmd_autorun(_script_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_managed_block() {
        let block = build_managed_block(
            EnvShell::Bash,
            &[EnvVariable {
                key: "JAVA_HOME".to_string(),
                value: "/opt/java".to_string(),
                enabled: true,
            }],
            &[EnvPathEntry {
                path: "/opt/bin".to_string(),
                enabled: true,
            }],
        );
        let content = "before\n# >>> skiff env >>>\nold\n# <<< skiff env <<<\nafter\n";
        let next = upsert_managed_block(content, EnvShell::Bash, &block);

        assert!(next.contains("before\n# >>> skiff env >>>"));
        assert!(next.contains("export JAVA_HOME=\"/opt/java\""));
        assert!(next.contains("export PATH=\"$PATH:/opt/bin\""));
        assert!(next.ends_with("after\n"));
        assert!(!next.contains("\nold\n"));
    }

    #[test]
    fn parses_disabled_entries_from_managed_block() {
        let block = r#"
# Managed by Skiff.
export FOO="bar"
# skiff-disabled export PATH="$PATH:/tmp/bin"
"#;
        let (variables, paths) = parse_managed_block(block, EnvShell::Zsh);

        assert_eq!(variables.len(), 1);
        assert_eq!(variables[0].key, "FOO");
        assert_eq!(variables[0].value, "bar");
        assert!(variables[0].enabled);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].path, "/tmp/bin");
        assert!(!paths[0].enabled);
    }

    #[test]
    fn renders_windows_shell_syntax() {
        let variable = EnvVariable {
            key: "SDK_HOME".to_string(),
            value: "C:\\SDK".to_string(),
            enabled: true,
        };
        let path = EnvPathEntry {
            path: "C:\\SDK\\bin".to_string(),
            enabled: true,
        };

        assert_eq!(
            render_variable(EnvShell::Powershell, &variable),
            "$env:SDK_HOME = 'C:\\SDK'"
        );
        assert_eq!(
            render_path_entry(EnvShell::Cmd, &path),
            "set \"PATH=%PATH%;C:\\SDK\\bin\""
        );
    }
}
