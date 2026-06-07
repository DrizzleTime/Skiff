use crate::models::AppSettings;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn read_settings(home: &Path) -> Result<AppSettings, String> {
    let path = settings_path(home);
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(path).map_err(|err| format!("读取设置失败：{err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("解析设置失败：{err}"))
}

pub fn write_settings(home: &Path, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(home);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建设置目录失败：{err}"))?;
    }

    let content =
        serde_json::to_string_pretty(settings).map_err(|err| format!("序列化设置失败：{err}"))?;
    fs::write(path, content).map_err(|err| format!("保存设置失败：{err}"))
}

fn settings_path(home: &Path) -> PathBuf {
    home.join(".config").join("skiff").join("settings.json")
}
