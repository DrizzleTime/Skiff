use std::{env, path::PathBuf};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Platform {
    Linux,
    MacOS,
    Windows,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::MacOS
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Linux
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Linux => "linux",
            Self::MacOS => "macos",
            Self::Windows => "windows",
        }
    }
}

pub fn home_dir() -> Result<PathBuf, String> {
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(home));
    }

    if let Some(profile) = env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(profile));
    }

    match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
        (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
            let mut text = drive.to_string_lossy().to_string();
            text.push_str(&path.to_string_lossy());
            Ok(PathBuf::from(text))
        }
        _ => Err("找不到用户主目录，无法定位用户缓存目录。".to_string()),
    }
}

pub fn command_exists(command: &str) -> bool {
    if command.trim().is_empty() || command.contains('/') {
        return false;
    }

    let Some(paths) = env::var_os("PATH") else {
        return false;
    };

    let candidates = command_candidates(command);

    env::split_paths(&paths).any(|dir| {
        candidates
            .iter()
            .map(|candidate| dir.join(candidate))
            .any(|path| path.is_file() && executable_file(&path))
    })
}

fn command_candidates(command: &str) -> Vec<String> {
    if cfg!(windows) && !command.contains('.') {
        let extensions = env::var_os("PATHEXT")
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_string());
        extensions
            .split(';')
            .filter(|extension| !extension.trim().is_empty())
            .map(|extension| format!("{command}{extension}"))
            .chain(std::iter::once(command.to_string()))
            .collect()
    } else {
        vec![command.to_string()]
    }
}

#[cfg(unix)]
fn executable_file(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn executable_file(path: &std::path::Path) -> bool {
    path.is_file()
}

pub fn command_error(prefix: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}：{stderr}")
    }
}
