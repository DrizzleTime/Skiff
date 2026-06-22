use crate::models::{
    SpaceAiAnalysisRequest, SpaceAiPathInfoResult, SpaceAiToolArguments, SpaceAiToolCall,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

pub(super) const TOOL_DELETE_PATH: &str = "delete_path";
pub(super) const TOOL_READ_PATH_INFO: &str = "read_path_info";

#[derive(Deserialize)]
struct DeletePathToolArguments {
    path: String,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ReadPathInfoToolArguments {
    path: String,
    #[serde(default)]
    reason: Option<String>,
}

pub(super) fn needs_react_observation(tool_calls: &[SpaceAiToolCall]) -> bool {
    tool_calls
        .iter()
        .any(|tool_call| tool_call.name == TOOL_READ_PATH_INFO)
}

pub(super) fn build_tools() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": TOOL_READ_PATH_INFO,
                "description": "读取当前空间扫描结果中某个文件或目录的只读信息，包括大小、文件数、目录数和已扫描的直接子项。不会删除或修改任何内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "要读取的绝对路径，必须来自当前扫描结果或用户引用的路径。"
                        },
                        "reason": {
                            "type": "string",
                            "description": "为什么需要读取该路径的信息。"
                        }
                    },
                    "required": ["path", "reason"],
                    "additionalProperties": false
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": TOOL_DELETE_PATH,
                "description": "请求删除当前空间扫描结果中的一个文件或目录。应用会先展示对话内确认卡片，用户确认后才执行。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "要删除的绝对路径，必须来自当前扫描结果。"
                        },
                        "mode": {
                            "type": "string",
                            "enum": ["trash", "permanent"],
                            "description": "trash 表示移入系统回收站；permanent 表示永久删除。默认使用 trash。"
                        },
                        "reason": {
                            "type": "string",
                            "description": "为什么建议删除该路径。"
                        }
                    },
                    "required": ["path", "mode", "reason"],
                    "additionalProperties": false
                }
            }
        }),
    ]
}

pub(super) fn parse_space_tool_call(
    id: String,
    name: String,
    arguments_json: &str,
) -> Option<SpaceAiToolCall> {
    match name.as_str() {
        TOOL_DELETE_PATH => {
            let arguments: DeletePathToolArguments = serde_json::from_str(arguments_json).ok()?;
            let path = arguments.path.trim();
            if path.is_empty() {
                return None;
            }
            let mode = match arguments.mode.as_deref() {
                Some("permanent") => "permanent",
                _ => "trash",
            };

            Some(SpaceAiToolCall {
                id,
                name,
                arguments: SpaceAiToolArguments {
                    path: path.to_string(),
                    mode: Some(mode.to_string()),
                    reason: arguments.reason.unwrap_or_default(),
                },
                result: None,
            })
        }
        TOOL_READ_PATH_INFO => {
            let arguments: ReadPathInfoToolArguments = serde_json::from_str(arguments_json).ok()?;
            let path = arguments.path.trim();
            if path.is_empty() {
                return None;
            }

            Some(SpaceAiToolCall {
                id,
                name,
                arguments: SpaceAiToolArguments {
                    path: path.to_string(),
                    mode: None,
                    reason: arguments.reason.unwrap_or_default(),
                },
                result: None,
            })
        }
        _ => None,
    }
}

pub(super) fn resolve_space_tool_calls(
    request: &SpaceAiAnalysisRequest,
    tool_calls: Vec<SpaceAiToolCall>,
) -> Vec<SpaceAiToolCall> {
    tool_calls
        .into_iter()
        .map(|mut tool_call| {
            if tool_call.name == TOOL_READ_PATH_INFO {
                tool_call.result = Some(read_path_info_from_request(
                    request,
                    tool_call.arguments.path.as_str(),
                ));
            }
            tool_call
        })
        .collect()
}

fn read_path_info_from_request(
    request: &SpaceAiAnalysisRequest,
    path: &str,
) -> SpaceAiPathInfoResult {
    let items = if request.items.is_empty() {
        request.top_items.as_slice()
    } else {
        request.items.as_slice()
    };
    let normalized_path = path.trim();
    let Some(item) = items
        .iter()
        .find(|item| item.path == normalized_path)
        .cloned()
    else {
        return SpaceAiPathInfoResult {
            item: None,
            children: Vec::new(),
            error: Some(format!("当前扫描结果中没有找到路径：{normalized_path}")),
        };
    };

    let children = items
        .iter()
        .filter(|candidate| is_direct_child_path(&item.path, &candidate.path))
        .take(24)
        .cloned()
        .collect();

    SpaceAiPathInfoResult {
        item: Some(item),
        children,
        error: None,
    }
}

fn is_direct_child_path(parent: &str, child: &str) -> bool {
    Path::new(child)
        .parent()
        .is_some_and(|candidate_parent| candidate_parent == Path::new(parent))
}

pub(super) fn build_assistant_tool_call_message(
    content: &str,
    tool_calls: &[SpaceAiToolCall],
) -> Value {
    let content_value = if content.trim().is_empty() {
        Value::Null
    } else {
        json!(content)
    };

    json!({
        "role": "assistant",
        "content": content_value,
        "tool_calls": tool_calls
            .iter()
            .map(|tool_call| {
                json!({
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.name,
                        "arguments": tool_arguments_json(tool_call),
                    }
                })
            })
            .collect::<Vec<_>>(),
    })
}

pub(super) fn build_tool_result_messages(tool_calls: &[SpaceAiToolCall]) -> Vec<Value> {
    tool_calls
        .iter()
        .map(|tool_call| {
            let content = match tool_call.name.as_str() {
                TOOL_READ_PATH_INFO => {
                    serde_json::to_string(&tool_call.result).unwrap_or_else(|_| {
                        "{\"error\":\"serialize read_path_info result failed\"}".to_string()
                    })
                }
                TOOL_DELETE_PATH => json!({
                    "queued_for_user_confirmation": true,
                    "path": tool_call.arguments.path,
                    "mode": tool_call.arguments.mode.as_deref().unwrap_or("trash"),
                    "reason": tool_call.arguments.reason,
                })
                .to_string(),
                _ => "{}".to_string(),
            };

            json!({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": content,
            })
        })
        .collect()
}

fn tool_arguments_json(tool_call: &SpaceAiToolCall) -> String {
    match tool_call.name.as_str() {
        TOOL_DELETE_PATH => json!({
            "path": tool_call.arguments.path,
            "mode": tool_call.arguments.mode.as_deref().unwrap_or("trash"),
            "reason": tool_call.arguments.reason,
        })
        .to_string(),
        TOOL_READ_PATH_INFO => json!({
            "path": tool_call.arguments.path,
            "reason": tool_call.arguments.reason,
        })
        .to_string(),
        _ => "{}".to_string(),
    }
}

pub(super) fn merge_tool_calls(
    mut existing: Vec<SpaceAiToolCall>,
    next: Vec<SpaceAiToolCall>,
) -> Vec<SpaceAiToolCall> {
    for tool_call in next {
        if existing
            .iter()
            .any(|value| value.id == tool_call.id && value.name == tool_call.name)
        {
            continue;
        }
        existing.push(tool_call);
    }
    existing
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SpaceAiReportItem;

    #[test]
    fn parses_delete_tool_call_with_default_trash_mode() {
        let call = parse_space_tool_call(
            "tool-1".to_string(),
            TOOL_DELETE_PATH.to_string(),
            r#"{"path":"/tmp/cache","reason":"cache"}"#,
        )
        .expect("tool call");

        assert_eq!(call.id, "tool-1");
        assert_eq!(call.name, TOOL_DELETE_PATH);
        assert_eq!(call.arguments.path, "/tmp/cache");
        assert_eq!(call.arguments.mode.as_deref(), Some("trash"));
        assert_eq!(call.arguments.reason, "cache");
        assert!(call.result.is_none());
    }

    #[test]
    fn resolves_read_path_info_with_direct_children() {
        let request = SpaceAiAnalysisRequest {
            path: "/tmp/root".to_string(),
            total_size: 3,
            total_files: 2,
            total_dirs: 1,
            unreadable_entries: 0,
            top_items: Vec::new(),
            items: vec![
                report_item("/tmp/root", "root", "directory"),
                report_item("/tmp/root/a.txt", "a.txt", "file"),
                report_item("/tmp/root/nested", "nested", "directory"),
                report_item("/tmp/root/nested/b.txt", "b.txt", "file"),
            ],
            messages: Vec::new(),
        };
        let tool_call = parse_space_tool_call(
            "tool-1".to_string(),
            TOOL_READ_PATH_INFO.to_string(),
            r#"{"path":"/tmp/root","reason":"inspect"}"#,
        )
        .expect("tool call");

        let resolved = resolve_space_tool_calls(&request, vec![tool_call]);
        let result = resolved[0].result.as_ref().expect("result");

        assert_eq!(result.item.as_ref().unwrap().path, "/tmp/root");
        assert_eq!(result.children.len(), 2);
        assert!(result
            .children
            .iter()
            .any(|child| child.path == "/tmp/root/a.txt"));
        assert!(result
            .children
            .iter()
            .any(|child| child.path == "/tmp/root/nested"));
    }

    fn report_item(path: &str, name: &str, kind: &str) -> SpaceAiReportItem {
        SpaceAiReportItem {
            name: name.to_string(),
            path: path.to_string(),
            kind: kind.to_string(),
            size: 1,
            files: 1,
            dirs: 0,
            depth: 0,
        }
    }
}
