use crate::models::{AgentCleanupResult, AgentThreadScanResult};
use serde_json::Value;
use std::{collections::HashSet, fs, path::Path, time::UNIX_EPOCH};

pub(super) fn agent_item_id(agent: &str, native_id: &str) -> String {
    format!("{agent}:{native_id}")
}

pub(super) fn empty_scan_result() -> AgentThreadScanResult {
    AgentThreadScanResult {
        threads: Vec::new(),
        agents: Vec::new(),
        total_size: 0,
        total_logs: 0,
    }
}

pub(super) fn cleanup_result(
    items: Vec<crate::models::AgentCleanupItemResult>,
    released_size: u64,
) -> AgentCleanupResult {
    AgentCleanupResult {
        deleted_threads: items.iter().filter(|item| item.success).count() as u64,
        deleted_logs: items.iter().map(|item| item.deleted_logs).sum(),
        failed_count: items.iter().filter(|item| !item.success).count() as u64,
        items,
        released_size,
    }
}

pub(super) fn unique_ids(ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter(|id| !id.trim().is_empty())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

pub(super) fn remove_jsonl_lines_by_str(
    path: &Path,
    id_key: &str,
    id: &str,
) -> Result<u64, String> {
    if !path.is_file() {
        return Ok(0);
    }

    let content = fs::read_to_string(path).map_err(|err| format!("读取索引文件失败：{err}"))?;
    let mut output = String::new();
    let mut removed = 0;

    for line in content.lines() {
        let should_remove = serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|value| {
                value
                    .get(id_key)
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .map(|value| value == id)
            .unwrap_or(false);

        if !should_remove {
            output.push_str(line);
            output.push('\n');
        } else {
            removed += 1;
        }
    }

    fs::write(path, output).map_err(|err| format!("写入索引文件失败：{err}"))?;
    Ok(removed)
}

pub(super) fn safe_file_size(path: impl AsRef<Path>) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

pub(super) fn safe_path_size(path: impl AsRef<Path>) -> u64 {
    let path = path.as_ref();
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };

    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .flatten()
        .map(|entry| safe_path_size(entry.path()))
        .sum()
}

pub(super) fn path_file_count(path: impl AsRef<Path>) -> u64 {
    let path = path.as_ref();
    if path.is_file() {
        return 1;
    }
    if !path.is_dir() {
        return 0;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .flatten()
        .map(|entry| path_file_count(entry.path()))
        .sum()
}

pub(super) fn file_modified_at_ms(path: impl AsRef<Path>) -> i64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

pub(super) fn count_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

pub(super) fn display_title(value: &str) -> String {
    let title = value.trim();
    if title.is_empty() {
        "未命名会话".to_string()
    } else {
        title.to_string()
    }
}

pub(super) fn json_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str).map(str::trim)
}
