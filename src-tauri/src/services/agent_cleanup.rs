use crate::models::{
    AgentCleanupItemResult, AgentCleanupResult, AgentProviderStatus, AgentThread,
    AgentThreadScanResult,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

const CODEX_AGENT_ID: &str = "codex";
const CODEX_AGENT_NAME: &str = "Codex";

#[derive(Clone)]
struct ThreadRecord {
    id: String,
    title: String,
    cwd: String,
    rollout_path: String,
    source: String,
    model: String,
    archived: bool,
    created_at_ms: i64,
    updated_at_ms: i64,
}

#[derive(Clone, Copy, Default)]
struct LogStats {
    count: u64,
    size: u64,
}

fn agent_providers(home: &Path) -> Vec<AgentProviderStatus> {
    let codex_dir = home.join(".codex");
    let state_db = codex_dir.join("state_5.sqlite");

    vec![AgentProviderStatus {
        id: CODEX_AGENT_ID.to_string(),
        name: CODEX_AGENT_NAME.to_string(),
        available: state_db.is_file(),
        path: codex_dir.display().to_string(),
        note: "Codex 本地会话、SQLite 日志和 JSONL 索引。".to_string(),
    }]
}

fn agent_item_id(agent: &str, native_id: &str) -> String {
    format!("{agent}:{native_id}")
}

fn split_agent_item_id(id: &str) -> (String, String) {
    let id = id.trim();
    if let Some((agent, native_id)) = id.split_once(':') {
        if !agent.trim().is_empty() && !native_id.trim().is_empty() {
            return (agent.trim().to_string(), native_id.trim().to_string());
        }
    }

    (CODEX_AGENT_ID.to_string(), id.to_string())
}

pub fn scan_agent_threads(home: &Path) -> Result<AgentThreadScanResult, String> {
    let agents = agent_providers(home);
    let mut threads = Vec::new();

    if agents
        .iter()
        .any(|agent| agent.id == CODEX_AGENT_ID && agent.available)
    {
        threads.extend(scan_codex_threads(home)?.threads);
    }

    threads.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));

    Ok(AgentThreadScanResult {
        total_size: threads.iter().map(|item| item.size).sum(),
        total_logs: threads.iter().map(|item| item.log_count).sum(),
        agents,
        threads,
    })
}

pub fn clean_agent_threads(home: &Path, ids: &[String]) -> Result<AgentCleanupResult, String> {
    let mut codex_ids = Vec::new();
    let mut items = Vec::new();
    let mut released_size = 0;

    for id in ids {
        let (agent, native_id) = split_agent_item_id(id);
        match agent.as_str() {
            CODEX_AGENT_ID => codex_ids.push(native_id),
            _ => items.push(AgentCleanupItemResult {
                id: id.clone(),
                agent,
                title: "未知 Agent 会话".to_string(),
                path: String::new(),
                released_size: 0,
                deleted_logs: 0,
                success: false,
                error: Some("暂不支持清理该 Agent。".to_string()),
            }),
        }
    }

    if !codex_ids.is_empty() {
        let mut result = clean_codex_threads(home, &codex_ids)?;
        released_size += result.released_size;
        items.append(&mut result.items);
    }

    let deleted_threads = items.iter().filter(|item| item.success).count() as u64;
    let deleted_logs = items.iter().map(|item| item.deleted_logs).sum();
    let failed_count = items.iter().filter(|item| !item.success).count() as u64;

    Ok(AgentCleanupResult {
        items,
        released_size,
        deleted_threads,
        deleted_logs,
        failed_count,
    })
}

pub fn scan_codex_threads(home: &Path) -> Result<AgentThreadScanResult, String> {
    let codex_dir = home.join(".codex");
    let state_db = codex_dir.join("state_5.sqlite");
    if !state_db.is_file() {
        return Ok(AgentThreadScanResult {
            threads: Vec::new(),
            agents: Vec::new(),
            total_size: 0,
            total_logs: 0,
        });
    }

    let threads = read_threads(&state_db)?;
    let log_stats = read_log_stats(&codex_dir.join("logs_2.sqlite"))?;
    let goal_counts = read_goal_counts(&codex_dir.join("goals_1.sqlite"))?;
    let mut items = Vec::new();

    for thread in threads {
        let rollout_size = safe_file_size(&thread.rollout_path);
        let log_stats = *log_stats.get(&thread.id).unwrap_or(&LogStats::default());
        let goal_count = *goal_counts.get(&thread.id).unwrap_or(&0);

        items.push(AgentThread {
            id: agent_item_id(CODEX_AGENT_ID, &thread.id),
            agent: CODEX_AGENT_ID.to_string(),
            title: display_title(&thread.title),
            cwd: thread.cwd,
            rollout_path: thread.rollout_path,
            source: thread.source,
            model: thread.model,
            archived: thread.archived,
            created_at_ms: thread.created_at_ms,
            updated_at_ms: thread.updated_at_ms,
            size: rollout_size + log_stats.size,
            log_count: log_stats.count,
            goal_count,
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

pub fn clean_codex_threads(home: &Path, ids: &[String]) -> Result<AgentCleanupResult, String> {
    let codex_dir = home.join(".codex");
    let state_db = codex_dir.join("state_5.sqlite");
    if !state_db.is_file() {
        return Err("未找到 Codex 会话数据库。".to_string());
    }

    let unique_ids: Vec<String> = ids
        .iter()
        .filter(|id| !id.trim().is_empty())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let mut items = Vec::new();
    let before_size = codex_storage_size(&codex_dir);

    for id in unique_ids {
        let item = clean_one_codex_thread(&codex_dir, &state_db, &id);
        items.push(item);
    }

    compact_codex_databases(&codex_dir);

    let after_size = codex_storage_size(&codex_dir);
    let released_size = before_size.saturating_sub(after_size)
        + items.iter().map(|item| item.released_size).sum::<u64>();
    let deleted_threads = items.iter().filter(|item| item.success).count() as u64;
    let deleted_logs = items.iter().map(|item| item.deleted_logs).sum();
    let failed_count = items.iter().filter(|item| !item.success).count() as u64;

    Ok(AgentCleanupResult {
        items,
        released_size,
        deleted_threads,
        deleted_logs,
        failed_count,
    })
}

fn clean_one_codex_thread(codex_dir: &Path, state_db: &Path, id: &str) -> AgentCleanupItemResult {
    let thread = match read_thread(state_db, id) {
        Ok(Some(thread)) => thread,
        Ok(None) => {
            return AgentCleanupItemResult {
                id: agent_item_id(CODEX_AGENT_ID, id),
                agent: CODEX_AGENT_ID.to_string(),
                title: "未知会话".to_string(),
                path: String::new(),
                released_size: 0,
                deleted_logs: 0,
                success: false,
                error: Some("未找到对应 Codex 会话。".to_string()),
            }
        }
        Err(err) => {
            return AgentCleanupItemResult {
                id: agent_item_id(CODEX_AGENT_ID, id),
                agent: CODEX_AGENT_ID.to_string(),
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
    let path = thread.rollout_path.clone();
    let rollout_size = safe_file_size(&thread.rollout_path);

    let result = delete_thread_data(codex_dir, state_db, &thread);

    match result {
        Ok(deleted_logs) => AgentCleanupItemResult {
            id: agent_item_id(CODEX_AGENT_ID, &thread.id),
            agent: CODEX_AGENT_ID.to_string(),
            title,
            path,
            released_size: rollout_size,
            deleted_logs,
            success: true,
            error: None,
        },
        Err(err) => AgentCleanupItemResult {
            id: agent_item_id(CODEX_AGENT_ID, &thread.id),
            agent: CODEX_AGENT_ID.to_string(),
            title,
            path,
            released_size: 0,
            deleted_logs: 0,
            success: false,
            error: Some(err),
        },
    }
}

fn delete_thread_data(
    codex_dir: &Path,
    state_db: &Path,
    thread: &ThreadRecord,
) -> Result<u64, String> {
    remove_rollout_file(codex_dir, &thread.rollout_path)?;
    remove_index_lines(&codex_dir.join("session_index.jsonl"), "id", &thread.id)?;
    remove_index_lines(&codex_dir.join("history.jsonl"), "session_id", &thread.id)?;

    let deleted_logs = delete_logs(&codex_dir.join("logs_2.sqlite"), &thread.id)?;
    delete_goals(&codex_dir.join("goals_1.sqlite"), &thread.id)?;
    delete_thread_rows(state_db, &thread.id)?;

    Ok(deleted_logs)
}

fn read_threads(state_db: &Path) -> Result<Vec<ThreadRecord>, String> {
    let connection = open_connection(state_db)?;
    let mut statement = connection
        .prepare(
            "select id, title, cwd, rollout_path, source, coalesce(model, ''), archived,
                    coalesce(created_at_ms, created_at * 1000),
                    coalesce(updated_at_ms, updated_at * 1000)
             from threads",
        )
        .map_err(|err| format!("读取 Codex 会话结构失败：{err}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ThreadRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                cwd: row.get(2)?,
                rollout_path: row.get(3)?,
                source: row.get(4)?,
                model: row.get(5)?,
                archived: row.get::<_, i64>(6)? == 1,
                created_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
            })
        })
        .map_err(|err| format!("读取 Codex 会话失败：{err}"))?;

    collect_rows(rows)
}

fn read_thread(state_db: &Path, id: &str) -> Result<Option<ThreadRecord>, String> {
    let connection = open_connection(state_db)?;
    connection
        .query_row(
            "select id, title, cwd, rollout_path, source, coalesce(model, ''), archived,
                    coalesce(created_at_ms, created_at * 1000),
                    coalesce(updated_at_ms, updated_at * 1000)
             from threads where id = ?1",
            params![id],
            |row| {
                Ok(ThreadRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    cwd: row.get(2)?,
                    rollout_path: row.get(3)?,
                    source: row.get(4)?,
                    model: row.get(5)?,
                    archived: row.get::<_, i64>(6)? == 1,
                    created_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|err| format!("读取 Codex 会话失败：{err}"))
}

fn read_log_stats(log_db: &Path) -> Result<HashMap<String, LogStats>, String> {
    if !log_db.is_file() {
        return Ok(HashMap::new());
    }

    let connection = open_connection(log_db)?;
    let mut statement = connection
        .prepare(
            "select thread_id, count(*), coalesce(sum(estimated_bytes), 0)
             from logs
             where thread_id is not null
             group by thread_id",
        )
        .map_err(|err| format!("读取 Codex 日志结构失败：{err}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                LogStats {
                    count: count_to_u64(row.get::<_, i64>(1)?),
                    size: count_to_u64(row.get::<_, i64>(2)?),
                },
            ))
        })
        .map_err(|err| format!("读取 Codex 日志失败：{err}"))?;

    let mut counts = HashMap::new();
    for row in rows {
        let (id, count) = row.map_err(|err| format!("读取 Codex 日志失败：{err}"))?;
        counts.insert(id, count);
    }

    Ok(counts)
}

fn read_goal_counts(goal_db: &Path) -> Result<HashMap<String, u64>, String> {
    if !goal_db.is_file() {
        return Ok(HashMap::new());
    }

    let connection = open_connection(goal_db)?;
    let mut statement = connection
        .prepare("select thread_id, count(*) from thread_goals group by thread_id")
        .map_err(|err| format!("读取 Codex 目标结构失败：{err}"))?;
    let rows = statement
        .query_map([], |row| {
            let count = count_to_u64(row.get::<_, i64>(1)?);
            Ok((row.get::<_, String>(0)?, count))
        })
        .map_err(|err| format!("读取 Codex 目标失败：{err}"))?;

    let mut counts = HashMap::new();
    for row in rows {
        let (id, count) = row.map_err(|err| format!("读取 Codex 目标失败：{err}"))?;
        counts.insert(id, count);
    }

    Ok(counts)
}

fn delete_logs(log_db: &Path, id: &str) -> Result<u64, String> {
    if !log_db.is_file() {
        return Ok(0);
    }

    let connection = open_connection(log_db)?;
    let count: i64 = connection
        .query_row(
            "select count(*) from logs where thread_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|err| format!("统计 Codex 日志失败：{err}"))?;
    connection
        .execute("delete from logs where thread_id = ?1", params![id])
        .map_err(|err| format!("删除 Codex 日志失败：{err}"))?;

    Ok(count_to_u64(count))
}

fn delete_goals(goal_db: &Path, id: &str) -> Result<(), String> {
    if !goal_db.is_file() {
        return Ok(());
    }

    let connection = open_connection(goal_db)?;
    connection
        .execute("delete from thread_goals where thread_id = ?1", params![id])
        .map_err(|err| format!("删除 Codex 目标记录失败：{err}"))?;
    Ok(())
}

fn delete_thread_rows(state_db: &Path, id: &str) -> Result<(), String> {
    let connection = open_connection(state_db)?;
    connection
        .execute("pragma foreign_keys = on", [])
        .map_err(|err| format!("启用 Codex 外键检查失败：{err}"))?;
    connection
        .execute(
            "delete from thread_spawn_edges where parent_thread_id = ?1 or child_thread_id = ?1",
            params![id],
        )
        .map_err(|err| format!("删除 Codex 子会话关系失败：{err}"))?;
    connection
        .execute("delete from threads where id = ?1", params![id])
        .map_err(|err| format!("删除 Codex 会话记录失败：{err}"))?;
    Ok(())
}

fn remove_rollout_file(codex_dir: &Path, rollout_path: &str) -> Result<(), String> {
    if rollout_path.trim().is_empty() {
        return Ok(());
    }

    let path = PathBuf::from(rollout_path);
    if !path.exists() {
        return Ok(());
    }

    ensure_inside_codex(codex_dir, &path)?;
    fs::remove_file(&path).map_err(|err| format!("删除 Codex 会话文件失败：{err}"))
}

fn remove_index_lines(path: &Path, id_key: &str, id: &str) -> Result<(), String> {
    if !path.is_file() {
        return Ok(());
    }

    let content = fs::read_to_string(path).map_err(|err| format!("读取索引文件失败：{err}"))?;
    let mut output = String::new();

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
        }
    }

    fs::write(path, output).map_err(|err| format!("写入索引文件失败：{err}"))
}

fn compact_codex_databases(codex_dir: &Path) {
    for name in ["state_5.sqlite", "logs_2.sqlite", "goals_1.sqlite"] {
        let path = codex_dir.join(name);
        if !path.is_file() {
            continue;
        }

        let Ok(connection) = open_connection(&path) else {
            continue;
        };
        let _ = connection.execute_batch("pragma wal_checkpoint(TRUNCATE); vacuum;");
    }
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    Connection::open(path)
        .map_err(|err| format!("打开 SQLite 数据库失败：{}：{err}", path.display()))
}

fn collect_rows<T, F>(rows: rusqlite::MappedRows<'_, F>) -> Result<Vec<T>, String>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("读取 SQLite 行失败：{err}"))?);
    }
    Ok(items)
}

fn safe_file_size(path: impl AsRef<Path>) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn count_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn codex_storage_size(codex_dir: &Path) -> u64 {
    [
        "state_5.sqlite",
        "state_5.sqlite-wal",
        "state_5.sqlite-shm",
        "logs_2.sqlite",
        "logs_2.sqlite-wal",
        "logs_2.sqlite-shm",
        "goals_1.sqlite",
        "goals_1.sqlite-wal",
        "goals_1.sqlite-shm",
        "session_index.jsonl",
        "history.jsonl",
    ]
    .iter()
    .map(|name| safe_file_size(codex_dir.join(name)))
    .sum()
}

fn ensure_inside_codex(codex_dir: &Path, path: &Path) -> Result<(), String> {
    let codex_dir = codex_dir
        .canonicalize()
        .map_err(|err| format!("校验 Codex 目录失败：{err}"))?;
    let path = path
        .canonicalize()
        .map_err(|err| format!("校验 Codex 文件失败：{err}"))?;

    if path.starts_with(&codex_dir) {
        return Ok(());
    }

    Err("拒绝删除 Codex 目录外的文件。".to_string())
}

fn display_title(value: &str) -> String {
    let title = value.trim();
    if title.is_empty() {
        "未命名会话".to_string()
    } else {
        title.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn cleans_selected_thread_and_keeps_other_thread() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path();
        let codex_dir = home.join(".codex");
        let sessions_dir = codex_dir.join("sessions");
        fs::create_dir_all(&sessions_dir).expect("create sessions");

        let thread_a_file = sessions_dir.join("thread-a.jsonl");
        let thread_b_file = sessions_dir.join("thread-b.jsonl");
        fs::write(&thread_a_file, "thread a").expect("write a");
        fs::write(&thread_b_file, "thread b").expect("write b");

        create_state_db(
            &codex_dir.join("state_5.sqlite"),
            &thread_a_file,
            &thread_b_file,
        );
        create_logs_db(&codex_dir.join("logs_2.sqlite"));
        create_goals_db(&codex_dir.join("goals_1.sqlite"));
        fs::write(
            codex_dir.join("session_index.jsonl"),
            "{\"id\":\"thread-a\",\"thread_name\":\"A\"}\n{\"id\":\"thread-b\",\"thread_name\":\"B\"}\n",
        )
        .expect("write session index");
        fs::write(
            codex_dir.join("history.jsonl"),
            "{\"session_id\":\"thread-a\",\"text\":\"A\"}\n{\"session_id\":\"thread-b\",\"text\":\"B\"}\n",
        )
        .expect("write history");

        let result = clean_codex_threads(home, &[String::from("thread-a")]).expect("clean");

        assert_eq!(result.deleted_threads, 1);
        assert_eq!(result.failed_count, 0);
        assert!(!thread_a_file.exists());
        assert!(thread_b_file.exists());
        assert_eq!(
            scalar_count(
                &codex_dir.join("state_5.sqlite"),
                "select count(*) from threads where id = 'thread-a'"
            )
            .expect("count a"),
            0
        );
        assert_eq!(
            scalar_count(
                &codex_dir.join("state_5.sqlite"),
                "select count(*) from threads where id = 'thread-b'"
            )
            .expect("count b"),
            1
        );
        assert_eq!(
            scalar_count(
                &codex_dir.join("logs_2.sqlite"),
                "select count(*) from logs where thread_id = 'thread-a'"
            )
            .expect("logs a"),
            0
        );
        assert_eq!(
            scalar_count(
                &codex_dir.join("logs_2.sqlite"),
                "select count(*) from logs where thread_id = 'thread-b'"
            )
            .expect("logs b"),
            1
        );
        assert!(!fs::read_to_string(codex_dir.join("session_index.jsonl"))
            .expect("read session index")
            .contains("thread-a"));
        assert!(fs::read_to_string(codex_dir.join("history.jsonl"))
            .expect("read history")
            .contains("thread-b"));
    }

    fn create_state_db(path: &Path, thread_a_file: &Path, thread_b_file: &Path) {
        let connection = Connection::open(path).expect("state db");
        connection
            .execute_batch(
                "
                create table threads (
                    id text primary key,
                    rollout_path text not null,
                    created_at integer not null,
                    updated_at integer not null,
                    source text not null,
                    model_provider text not null,
                    cwd text not null,
                    title text not null,
                    sandbox_policy text not null,
                    approval_mode text not null,
                    archived integer not null default 0,
                    model text,
                    created_at_ms integer,
                    updated_at_ms integer
                );
                create table thread_dynamic_tools (
                    thread_id text not null,
                    position integer not null,
                    name text not null,
                    description text not null,
                    input_schema text not null,
                    primary key(thread_id, position),
                    foreign key(thread_id) references threads(id) on delete cascade
                );
                create table thread_spawn_edges (
                    parent_thread_id text not null,
                    child_thread_id text not null primary key,
                    status text not null
                );
                ",
            )
            .expect("schema");
        connection
            .execute(
                "insert into threads
                 (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
                  sandbox_policy, approval_mode, archived, model, created_at_ms, updated_at_ms)
                 values (?1, ?2, 1, 2, 'cli', 'our', '/tmp/a', 'A', 'workspace-write', 'never', 0, 'gpt', 1000, 2000)",
                params!["thread-a", thread_a_file.display().to_string()],
            )
            .expect("insert a");
        connection
            .execute(
                "insert into threads
                 (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
                  sandbox_policy, approval_mode, archived, model, created_at_ms, updated_at_ms)
                 values (?1, ?2, 1, 3, 'cli', 'our', '/tmp/b', 'B', 'workspace-write', 'never', 0, 'gpt', 1000, 3000)",
                params!["thread-b", thread_b_file.display().to_string()],
            )
            .expect("insert b");
        connection
            .execute(
                "insert into thread_dynamic_tools
                 (thread_id, position, name, description, input_schema)
                 values ('thread-a', 0, 'tool', 'tool', '{}')",
                [],
            )
            .expect("insert tool");
    }

    fn create_logs_db(path: &Path) {
        let connection = Connection::open(path).expect("logs db");
        connection
            .execute_batch(
                "
                create table logs (
                    id integer primary key autoincrement,
                    ts integer not null,
                    ts_nanos integer not null,
                    level text not null,
                    target text not null,
                    thread_id text,
                    estimated_bytes integer not null default 0
                );
                insert into logs (ts, ts_nanos, level, target, thread_id)
                values (1, 1, 'INFO', 'test', 'thread-a');
                insert into logs (ts, ts_nanos, level, target, thread_id)
                values (2, 2, 'INFO', 'test', 'thread-b');
                ",
            )
            .expect("logs schema");
    }

    fn create_goals_db(path: &Path) {
        let connection = Connection::open(path).expect("goals db");
        connection
            .execute_batch(
                "
                create table thread_goals (
                    thread_id text primary key not null,
                    goal_id text not null,
                    objective text not null,
                    status text not null,
                    created_at_ms integer not null,
                    updated_at_ms integer not null
                );
                insert into thread_goals
                (thread_id, goal_id, objective, status, created_at_ms, updated_at_ms)
                values ('thread-a', 'goal-a', 'A', 'active', 1, 2);
                insert into thread_goals
                (thread_id, goal_id, objective, status, created_at_ms, updated_at_ms)
                values ('thread-b', 'goal-b', 'B', 'active', 1, 2);
                ",
            )
            .expect("goals schema");
    }

    fn scalar_count(path: &Path, sql: &str) -> Result<u64, String> {
        let count: i64 = Connection::open(path)
            .map_err(|err| err.to_string())?
            .query_row(sql, [], |row| row.get(0))
            .map_err(|err| err.to_string())?;

        Ok(count_to_u64(count))
    }
}
