use super::shared::{
    agent_item_id, cleanup_result, display_title, empty_scan_result, file_modified_at_ms, json_str,
    path_file_count, remove_jsonl_lines_by_str, safe_file_size, safe_path_size, unique_ids,
};
use crate::models::{
    AgentCleanupItemResult, AgentCleanupResult, AgentProviderStatus, AgentThread,
    AgentThreadScanResult,
};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

pub(super) const AGENT_ID: &str = "claude";
const AGENT_NAME: &str = "Claude Code";

#[derive(Clone, Default)]
struct HistoryRecord {
    title: String,
    cwd: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    count: u64,
}

#[derive(Clone)]
struct ThreadRecord {
    id: String,
    title: String,
    cwd: String,
    path: PathBuf,
    source: String,
    model: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    size: u64,
    log_count: u64,
}

pub(super) fn status(home: &Path) -> AgentProviderStatus {
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");

    AgentProviderStatus {
        id: AGENT_ID.to_string(),
        name: AGENT_NAME.to_string(),
        available: projects_dir.is_dir(),
        path: claude_dir.display().to_string(),
        note: "Claude Code 本地会话 JSONL、历史记录和按会话保存的运行记录。".to_string(),
    }
}

pub(super) fn scan(home: &Path) -> Result<AgentThreadScanResult, String> {
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");
    if !projects_dir.is_dir() {
        return Ok(empty_scan_result());
    }

    let history = read_history_records(&claude_dir.join("history.jsonl"))?;
    let threads = read_threads(&claude_dir, &history)?;
    let mut items = Vec::new();

    for thread in threads {
        items.push(AgentThread {
            id: agent_item_id(AGENT_ID, &thread.id),
            agent: AGENT_ID.to_string(),
            title: display_title(&thread.title),
            cwd: thread.cwd,
            rollout_path: thread.path.display().to_string(),
            source: thread.source,
            model: thread.model,
            archived: false,
            created_at_ms: thread.created_at_ms,
            updated_at_ms: thread.updated_at_ms,
            size: thread.size,
            log_count: thread.log_count,
            goal_count: 0,
        });
    }

    items.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));

    Ok(AgentThreadScanResult {
        total_size: items.iter().map(|item| item.size).sum(),
        total_logs: items.iter().map(|item| item.log_count).sum(),
        agents: Vec::new(),
        threads: items,
    })
}

pub(super) fn clean(home: &Path, ids: &[String]) -> Result<AgentCleanupResult, String> {
    let claude_dir = home.join(".claude");
    let projects_dir = claude_dir.join("projects");
    if !projects_dir.is_dir() {
        return Err("未找到 Claude Code 会话目录。".to_string());
    }

    let before_size = storage_size(&claude_dir);
    let mut items = Vec::new();

    for id in unique_ids(ids) {
        items.push(clean_one_thread(home, &id));
    }

    let after_size = storage_size(&claude_dir);
    let released_size = before_size
        .saturating_sub(after_size)
        .max(items.iter().map(|item| item.released_size).sum::<u64>());

    Ok(cleanup_result(items, released_size))
}

fn clean_one_thread(home: &Path, id: &str) -> AgentCleanupItemResult {
    let claude_dir = home.join(".claude");
    let thread = match read_thread(&claude_dir, id) {
        Ok(Some(thread)) => thread,
        Ok(None) => {
            return AgentCleanupItemResult {
                id: agent_item_id(AGENT_ID, id),
                agent: AGENT_ID.to_string(),
                title: "未知会话".to_string(),
                path: String::new(),
                released_size: 0,
                deleted_logs: 0,
                success: false,
                error: Some("未找到对应 Claude Code 会话。".to_string()),
            }
        }
        Err(err) => {
            return AgentCleanupItemResult {
                id: agent_item_id(AGENT_ID, id),
                agent: AGENT_ID.to_string(),
                title: "读取失败".to_string(),
                path: String::new(),
                released_size: 0,
                deleted_logs: 0,
                success: false,
                error: Some(err),
            }
        }
    };

    let title = display_title(&thread.title);
    let path = thread.path.display().to_string();
    let released_size = thread.size;
    let deleted_logs = thread.log_count;

    match delete_thread_data(&claude_dir, &thread) {
        Ok(()) => AgentCleanupItemResult {
            id: agent_item_id(AGENT_ID, &thread.id),
            agent: AGENT_ID.to_string(),
            title,
            path,
            released_size,
            deleted_logs,
            success: true,
            error: None,
        },
        Err(err) => AgentCleanupItemResult {
            id: agent_item_id(AGENT_ID, &thread.id),
            agent: AGENT_ID.to_string(),
            title,
            path,
            released_size: 0,
            deleted_logs: 0,
            success: false,
            error: Some(err),
        },
    }
}

fn delete_thread_data(claude_dir: &Path, thread: &ThreadRecord) -> Result<(), String> {
    remove_claude_path(claude_dir, &thread.path)?;
    remove_jsonl_lines_by_str(&claude_dir.join("history.jsonl"), "sessionId", &thread.id)?;

    for path in related_paths(claude_dir, &thread.path, &thread.id) {
        remove_claude_path(claude_dir, &path)?;
    }

    Ok(())
}

fn read_thread(claude_dir: &Path, id: &str) -> Result<Option<ThreadRecord>, String> {
    let history = read_history_records(&claude_dir.join("history.jsonl"))?;
    for thread in read_threads(claude_dir, &history)? {
        if thread.id == id {
            return Ok(Some(thread));
        }
    }

    Ok(None)
}

fn read_threads(
    claude_dir: &Path,
    history: &HashMap<String, HistoryRecord>,
) -> Result<Vec<ThreadRecord>, String> {
    let projects_dir = claude_dir.join("projects");
    let entries = fs::read_dir(&projects_dir)
        .map_err(|err| format!("读取 Claude Code 项目目录失败：{err}"))?;
    let mut threads = Vec::new();

    for entry in entries {
        let project_dir = entry
            .map_err(|err| format!("读取 Claude Code 项目目录失败：{err}"))?
            .path();
        if !project_dir.is_dir() {
            continue;
        }

        let session_entries = fs::read_dir(&project_dir)
            .map_err(|err| format!("读取 Claude Code 会话目录失败：{err}"))?;
        for session_entry in session_entries {
            let path = session_entry
                .map_err(|err| format!("读取 Claude Code 会话目录失败：{err}"))?
                .path();
            if !is_jsonl_file(&path) {
                continue;
            }

            let fallback_id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if fallback_id.trim().is_empty() {
                continue;
            }

            threads.push(read_session_file(claude_dir, &path, fallback_id, history)?);
        }
    }

    Ok(threads)
}

fn read_session_file(
    claude_dir: &Path,
    path: &Path,
    fallback_id: &str,
    history: &HashMap<String, HistoryRecord>,
) -> Result<ThreadRecord, String> {
    let file = File::open(path)
        .map_err(|err| format!("读取 Claude Code 会话文件失败：{}：{err}", path.display()))?;
    let reader = BufReader::new(file);
    let mut id = fallback_id.to_string();
    let mut title = String::new();
    let mut cwd = String::new();
    let mut source = String::new();
    let mut model = String::new();
    let mut line_count = 0;

    for line in reader.lines() {
        let line = line
            .map_err(|err| format!("读取 Claude Code 会话文件失败：{}：{err}", path.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        line_count += 1;

        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if let Some(session_id) = json_str(&value, "sessionId") {
            if !session_id.trim().is_empty() {
                id = session_id.to_string();
            }
        }
        if let Some(entrypoint) = json_str(&value, "entrypoint") {
            if source.trim().is_empty() && !entrypoint.trim().is_empty() {
                source = entrypoint.to_string();
            }
        }
        if let Some(value_cwd) = json_str(&value, "cwd") {
            if cwd.trim().is_empty() && !value_cwd.trim().is_empty() {
                cwd = value_cwd.to_string();
            }
        }
        if let Some(last_prompt) = json_str(&value, "lastPrompt") {
            let normalized = normalize_title(last_prompt);
            if !normalized.is_empty() {
                title = normalized;
            }
        }
        if title.trim().is_empty() {
            if let Some(summary) = json_str(&value, "summary") {
                title = normalize_title(summary);
            } else if json_str(&value, "type") == Some("user") {
                title = message_text(&value).unwrap_or_default();
            }
        }
        if model.trim().is_empty() || model == "<synthetic>" {
            if let Some(message_model) = value
                .pointer("/message/model")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && *value != "<synthetic>")
            {
                model = message_model.to_string();
            }
        }
    }

    let file_time = file_modified_at_ms(path);
    let history_record = history.get(&id);
    if title.trim().is_empty() {
        title = history_record
            .map(|record| record.title.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_id.to_string());
    }
    if cwd.trim().is_empty() {
        cwd = history_record
            .map(|record| record.cwd.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "未知目录".to_string());
    }
    if source.trim().is_empty() {
        source = "cli".to_string();
    }

    let created_at_ms = history_record
        .map(|record| record.created_at_ms)
        .filter(|value| *value > 0)
        .unwrap_or(file_time);
    let updated_at_ms = history_record
        .map(|record| record.updated_at_ms.max(file_time))
        .filter(|value| *value > 0)
        .unwrap_or(file_time);
    let related_paths = related_paths(claude_dir, path, &id);
    let related_size = related_paths
        .iter()
        .map(|path| safe_path_size(path))
        .sum::<u64>();
    let related_logs = related_paths
        .iter()
        .map(|path| path_file_count(path))
        .sum::<u64>();
    let history_count = history_record.map(|record| record.count).unwrap_or(0);

    Ok(ThreadRecord {
        id,
        title,
        cwd,
        path: path.to_path_buf(),
        source,
        model,
        created_at_ms,
        updated_at_ms,
        size: safe_file_size(path) + related_size,
        log_count: line_count + history_count + related_logs,
    })
}

fn read_history_records(path: &Path) -> Result<HashMap<String, HistoryRecord>, String> {
    if !path.is_file() {
        return Ok(HashMap::new());
    }

    let file = File::open(path)
        .map_err(|err| format!("读取 Claude Code 历史文件失败：{}：{err}", path.display()))?;
    let reader = BufReader::new(file);
    let mut records = HashMap::new();

    for line in reader.lines() {
        let line = line
            .map_err(|err| format!("读取 Claude Code 历史文件失败：{}：{err}", path.display()))?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(session_id) = json_str(&value, "sessionId") else {
            continue;
        };
        if session_id.trim().is_empty() {
            continue;
        }

        let record = records
            .entry(session_id.to_string())
            .or_insert_with(HistoryRecord::default);
        record.count += 1;
        if let Some(display) = json_str(&value, "display") {
            let title = normalize_title(display);
            if !title.is_empty() {
                record.title = title;
            }
        }
        if let Some(project) = json_str(&value, "project") {
            if !project.trim().is_empty() {
                record.cwd = project.to_string();
            }
        }
        if let Some(timestamp) = value.get("timestamp").and_then(Value::as_i64) {
            if record.created_at_ms == 0 || timestamp < record.created_at_ms {
                record.created_at_ms = timestamp;
            }
            record.updated_at_ms = record.updated_at_ms.max(timestamp);
        }
    }

    Ok(records)
}

fn remove_claude_path(claude_dir: &Path, path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    ensure_inside_claude(claude_dir, path)?;
    let size = safe_path_size(path);
    if path.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|err| format!("删除 Claude Code 目录失败：{}：{err}", path.display()))?;
    } else {
        fs::remove_file(path)
            .map_err(|err| format!("删除 Claude Code 文件失败：{}：{err}", path.display()))?;
    }

    Ok(size)
}

fn related_paths(claude_dir: &Path, session_path: &Path, id: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(project_dir) = session_path.parent() {
        push_existing_path(&mut paths, project_dir.join(id));
    }

    for dirname in ["tasks", "file-history", "session-env"] {
        push_existing_path(&mut paths, claude_dir.join(dirname).join(id));
    }

    for dirname in ["sessions", "plans", "telemetry"] {
        push_named_children(&mut paths, &claude_dir.join(dirname), id);
    }

    paths
}

fn push_existing_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if path.exists() {
        paths.push(path);
    }
}

fn push_named_children(paths: &mut Vec<PathBuf>, dir: &Path, id: &str) {
    if !dir.is_dir() {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if name == id || name.starts_with(&format!("{id}.")) || name.contains(id) {
            paths.push(path);
        }
    }
}

fn storage_size(claude_dir: &Path) -> u64 {
    [
        "history.jsonl",
        "projects",
        "tasks",
        "file-history",
        "session-env",
        "sessions",
        "plans",
        "telemetry",
    ]
    .iter()
    .map(|name| safe_path_size(claude_dir.join(name)))
    .sum()
}

fn ensure_inside_claude(claude_dir: &Path, path: &Path) -> Result<(), String> {
    let claude_dir = claude_dir
        .canonicalize()
        .map_err(|err| format!("校验 Claude Code 目录失败：{err}"))?;
    let path = path
        .canonicalize()
        .map_err(|err| format!("校验 Claude Code 文件失败：{err}"))?;

    if path.starts_with(&claude_dir) {
        return Ok(());
    }

    Err("拒绝删除 Claude Code 目录外的文件。".to_string())
}

fn message_text(value: &Value) -> Option<String> {
    let content = value.pointer("/message/content")?;
    match content {
        Value::String(text) => Some(normalize_title(text)),
        Value::Array(items) => items
            .iter()
            .find_map(|item| item.get("text").and_then(Value::as_str))
            .map(normalize_title),
        _ => None,
    }
}

fn normalize_title(value: &str) -> String {
    let line = value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    let mut title = String::new();

    for (index, ch) in line.chars().enumerate() {
        if index >= 120 {
            title.push_str("...");
            return title;
        }
        title.push(ch);
    }

    title
}

fn is_jsonl_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent_cleanup::{clean_agent_threads, scan_agent_threads};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn cleans_selected_claude_thread_and_keeps_other_thread() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path();
        let claude_dir = home.join(".claude");
        let project_dir = claude_dir.join("projects").join("-tmp-project");
        fs::create_dir_all(&project_dir).expect("create project");

        let thread_a_file = project_dir.join("thread-a.jsonl");
        let thread_b_file = project_dir.join("thread-b.jsonl");
        fs::write(
            &thread_a_file,
            [
                "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"Prompt A\"},\"timestamp\":\"2026-06-14T00:00:00.000Z\",\"cwd\":\"/tmp/project\",\"entrypoint\":\"cli\",\"sessionId\":\"thread-a\"}",
                "{\"type\":\"assistant\",\"message\":{\"model\":\"claude-sonnet-4-5\",\"content\":[]},\"timestamp\":\"2026-06-14T00:00:01.000Z\",\"cwd\":\"/tmp/project\",\"entrypoint\":\"cli\",\"sessionId\":\"thread-a\"}",
                "{\"type\":\"last-prompt\",\"lastPrompt\":\"Clean A\",\"sessionId\":\"thread-a\"}",
            ]
            .join("\n"),
        )
        .expect("write a");
        fs::write(
            &thread_b_file,
            [
                "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"Prompt B\"},\"timestamp\":\"2026-06-14T00:00:00.000Z\",\"cwd\":\"/tmp/project\",\"entrypoint\":\"cli\",\"sessionId\":\"thread-b\"}",
                "{\"type\":\"last-prompt\",\"lastPrompt\":\"Keep B\",\"sessionId\":\"thread-b\"}",
            ]
            .join("\n"),
        )
        .expect("write b");
        fs::write(
            claude_dir.join("history.jsonl"),
            "{\"display\":\"Prompt A\",\"timestamp\":1781411900000,\"project\":\"/tmp/project\",\"sessionId\":\"thread-a\"}\n{\"display\":\"Prompt B\",\"timestamp\":1781412000000,\"project\":\"/tmp/project\",\"sessionId\":\"thread-b\"}\n",
        )
        .expect("write history");

        fs::create_dir_all(project_dir.join("thread-a").join("subagents"))
            .expect("create subagent dir");
        fs::write(
            project_dir
                .join("thread-a")
                .join("subagents")
                .join("agent.jsonl"),
            "{}",
        )
        .expect("write subagent");
        fs::create_dir_all(claude_dir.join("tasks").join("thread-a")).expect("create task");
        fs::write(
            claude_dir.join("tasks").join("thread-a").join("1.json"),
            "{}",
        )
        .expect("write task");
        fs::create_dir_all(claude_dir.join("file-history").join("thread-a"))
            .expect("create file history");
        fs::write(
            claude_dir
                .join("file-history")
                .join("thread-a")
                .join("file@v1"),
            "snapshot",
        )
        .expect("write file history");
        fs::create_dir_all(claude_dir.join("session-env").join("thread-a"))
            .expect("create session env");
        fs::create_dir_all(claude_dir.join("telemetry")).expect("create telemetry");
        fs::write(
            claude_dir
                .join("telemetry")
                .join("1p_failed_events.thread-a.extra.json"),
            "{}",
        )
        .expect("write telemetry");
        fs::write(claude_dir.join("settings.json"), "{}").expect("write settings");

        let scan = scan_agent_threads(home).expect("scan");
        assert!(scan
            .agents
            .iter()
            .any(|agent| agent.id == AGENT_ID && agent.available));
        assert!(scan
            .threads
            .iter()
            .any(|thread| thread.id == "claude:thread-a" && thread.title == "Clean A"));

        let result = clean_agent_threads(home, &[String::from("claude:thread-a")]).expect("clean");

        assert_eq!(result.deleted_threads, 1);
        assert_eq!(result.failed_count, 0);
        assert!(!thread_a_file.exists());
        assert!(thread_b_file.exists());
        assert!(!project_dir.join("thread-a").exists());
        assert!(!claude_dir.join("tasks").join("thread-a").exists());
        assert!(!claude_dir.join("file-history").join("thread-a").exists());
        assert!(!claude_dir.join("session-env").join("thread-a").exists());
        assert!(!claude_dir
            .join("telemetry")
            .join("1p_failed_events.thread-a.extra.json")
            .exists());
        assert!(claude_dir.join("settings.json").exists());

        let history = fs::read_to_string(claude_dir.join("history.jsonl")).expect("read history");
        assert!(!history.contains("thread-a"));
        assert!(history.contains("thread-b"));
    }
}
