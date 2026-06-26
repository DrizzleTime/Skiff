use super::tools::{
    build_anthropic_tools, build_chat_tools, build_responses_tools, tool_arguments_json,
    tool_result_content,
};
use crate::models::{AiProtocol, SpaceAiAnalysisRequest, SpaceAiChatMessage, SpaceAiToolCall};
use serde_json::{json, Value};

#[derive(Clone, Copy)]
pub(super) enum ToolChoice {
    Auto,
    None,
}

#[derive(Clone)]
pub(super) enum ExtraMessage {
    AssistantToolCalls {
        content: String,
        tool_calls: Vec<SpaceAiToolCall>,
    },
    ToolResults {
        tool_calls: Vec<SpaceAiToolCall>,
    },
    UserText(String),
}

pub(super) fn build_completion_payload(
    request: &SpaceAiAnalysisRequest,
    protocol: AiProtocol,
    model: &str,
    stream: bool,
    tool_choice: ToolChoice,
    extra_messages: &[ExtraMessage],
) -> Value {
    match protocol {
        AiProtocol::OpenAiChatCompletions => {
            build_chat_completion_payload(request, model, stream, tool_choice, extra_messages)
        }
        AiProtocol::OpenAiResponses => {
            build_responses_payload(request, model, stream, tool_choice, extra_messages)
        }
        AiProtocol::AnthropicMessages => {
            build_anthropic_messages_payload(request, model, stream, tool_choice, extra_messages)
        }
    }
}

pub(super) fn assistant_tool_call_message(
    content: &str,
    tool_calls: &[SpaceAiToolCall],
) -> ExtraMessage {
    ExtraMessage::AssistantToolCalls {
        content: content.to_string(),
        tool_calls: tool_calls.to_vec(),
    }
}

pub(super) fn tool_result_message(tool_calls: &[SpaceAiToolCall]) -> ExtraMessage {
    ExtraMessage::ToolResults {
        tool_calls: tool_calls.to_vec(),
    }
}

pub(super) fn user_text_message(content: impl Into<String>) -> ExtraMessage {
    ExtraMessage::UserText(content.into())
}

fn build_chat_completion_payload(
    request: &SpaceAiAnalysisRequest,
    model: &str,
    stream: bool,
    tool_choice: ToolChoice,
    extra_messages: &[ExtraMessage],
) -> Value {
    let mut messages = build_chat_messages(request);
    messages.extend(build_chat_extra_messages(extra_messages));

    match tool_choice {
        ToolChoice::Auto => json!({
            "model": model,
            "messages": messages,
            "tools": build_chat_tools(&request.locale),
            "tool_choice": "auto",
            "temperature": 0.2,
            "stream": stream
        }),
        ToolChoice::None => json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": stream
        }),
    }
}

fn build_responses_payload(
    request: &SpaceAiAnalysisRequest,
    model: &str,
    stream: bool,
    tool_choice: ToolChoice,
    extra_messages: &[ExtraMessage],
) -> Value {
    let mut input = build_responses_input(request);
    input.extend(build_responses_extra_input(extra_messages));

    match tool_choice {
        ToolChoice::Auto => json!({
            "model": model,
            "instructions": build_system_message(request),
            "input": input,
            "tools": build_responses_tools(&request.locale),
            "tool_choice": "auto",
            "temperature": 0.2,
            "stream": stream
        }),
        ToolChoice::None => json!({
            "model": model,
            "instructions": build_system_message(request),
            "input": input,
            "temperature": 0.2,
            "stream": stream
        }),
    }
}

fn build_anthropic_messages_payload(
    request: &SpaceAiAnalysisRequest,
    model: &str,
    stream: bool,
    tool_choice: ToolChoice,
    extra_messages: &[ExtraMessage],
) -> Value {
    let mut messages = build_anthropic_messages(request);
    messages.extend(build_anthropic_extra_messages(extra_messages));

    match tool_choice {
        ToolChoice::Auto => json!({
            "model": model,
            "system": build_system_message(request),
            "messages": messages,
            "tools": build_anthropic_tools(&request.locale),
            "tool_choice": { "type": "auto" },
            "temperature": 0.2,
            "max_tokens": 1200,
            "stream": stream
        }),
        ToolChoice::None => json!({
            "model": model,
            "system": build_system_message(request),
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 1200,
            "stream": stream
        }),
    }
}

fn build_chat_messages(request: &SpaceAiAnalysisRequest) -> Vec<Value> {
    let mut messages = vec![json!({
        "role": "system",
        "content": build_system_message(request),
    })];

    let message_start = request.messages.len().saturating_sub(24);
    let mut chat_messages = request
        .messages
        .get(message_start..)
        .unwrap_or(&[])
        .iter()
        .filter_map(to_chat_payload_message)
        .collect::<Vec<_>>();

    if chat_messages.is_empty() {
        chat_messages.push(json!({
            "role": "user",
            "content": default_analysis_prompt(&request.locale),
        }));
    }

    messages.extend(chat_messages);
    messages
}

fn build_responses_input(request: &SpaceAiAnalysisRequest) -> Vec<Value> {
    build_text_messages(request)
        .into_iter()
        .map(|message| {
            json!({
                "type": "message",
                "role": message.role,
                "content": message.content,
            })
        })
        .collect()
}

fn build_anthropic_messages(request: &SpaceAiAnalysisRequest) -> Vec<Value> {
    build_text_messages(request)
        .into_iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect()
}

fn build_chat_extra_messages(extra_messages: &[ExtraMessage]) -> Vec<Value> {
    let mut messages = Vec::new();
    for message in extra_messages {
        match message {
            ExtraMessage::AssistantToolCalls {
                content,
                tool_calls,
            } => messages.push(build_chat_assistant_tool_call_message(content, tool_calls)),
            ExtraMessage::ToolResults { tool_calls } => {
                messages.extend(build_chat_tool_result_messages(tool_calls));
            }
            ExtraMessage::UserText(content) => messages.push(json!({
                "role": "user",
                "content": content,
            })),
        }
    }

    messages
}

fn build_responses_extra_input(extra_messages: &[ExtraMessage]) -> Vec<Value> {
    let mut input = Vec::new();
    for message in extra_messages {
        match message {
            ExtraMessage::AssistantToolCalls {
                content,
                tool_calls,
            } => {
                if !content.trim().is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "assistant",
                        "content": content,
                    }));
                }
                input.extend(tool_calls.iter().map(|tool_call| {
                    json!({
                        "type": "function_call",
                        "call_id": tool_call.id,
                        "name": tool_call.name,
                        "arguments": tool_arguments_json(tool_call),
                    })
                }));
            }
            ExtraMessage::ToolResults { tool_calls } => {
                input.extend(tool_calls.iter().map(|tool_call| {
                    json!({
                        "type": "function_call_output",
                        "call_id": tool_call.id,
                        "output": tool_result_content(tool_call),
                    })
                }));
            }
            ExtraMessage::UserText(content) => input.push(json!({
                "type": "message",
                "role": "user",
                "content": content,
            })),
        }
    }

    input
}

fn build_anthropic_extra_messages(extra_messages: &[ExtraMessage]) -> Vec<Value> {
    let mut messages = Vec::new();
    for message in extra_messages {
        match message {
            ExtraMessage::AssistantToolCalls {
                content,
                tool_calls,
            } => {
                let mut blocks = Vec::new();
                if !content.trim().is_empty() {
                    blocks.push(json!({
                        "type": "text",
                        "text": content,
                    }));
                }
                blocks.extend(tool_calls.iter().map(|tool_call| {
                    let input = serde_json::from_str::<Value>(&tool_arguments_json(tool_call))
                        .unwrap_or_else(|_| json!({}));
                    json!({
                        "type": "tool_use",
                        "id": tool_call.id,
                        "name": tool_call.name,
                        "input": input,
                    })
                }));
                messages.push(json!({
                    "role": "assistant",
                    "content": blocks,
                }));
            }
            ExtraMessage::ToolResults { tool_calls } => {
                let blocks = tool_calls
                    .iter()
                    .map(|tool_call| {
                        json!({
                            "type": "tool_result",
                            "tool_use_id": tool_call.id,
                            "content": tool_result_content(tool_call),
                        })
                    })
                    .collect::<Vec<_>>();
                messages.push(json!({
                    "role": "user",
                    "content": blocks,
                }));
            }
            ExtraMessage::UserText(content) => messages.push(json!({
                "role": "user",
                "content": content,
            })),
        }
    }

    messages
}

fn build_chat_assistant_tool_call_message(content: &str, tool_calls: &[SpaceAiToolCall]) -> Value {
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

fn build_chat_tool_result_messages(tool_calls: &[SpaceAiToolCall]) -> Vec<Value> {
    tool_calls
        .iter()
        .map(|tool_call| {
            json!({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": tool_result_content(tool_call),
            })
        })
        .collect()
}

fn build_text_messages(request: &SpaceAiAnalysisRequest) -> Vec<SpaceAiChatMessage> {
    let message_start = request.messages.len().saturating_sub(24);
    let mut messages = request
        .messages
        .get(message_start..)
        .unwrap_or(&[])
        .iter()
        .filter_map(to_text_payload_message)
        .collect::<Vec<_>>();

    if messages.is_empty() {
        messages.push(SpaceAiChatMessage {
            role: "user".to_string(),
            content: default_analysis_prompt(&request.locale).to_string(),
        });
    }

    messages
}

fn build_system_message(request: &SpaceAiAnalysisRequest) -> String {
    format!(
        "{}\n\n{}:\n{}",
        system_instructions(&request.locale),
        scan_result_heading(&request.locale),
        build_space_context(request)
    )
}

fn to_chat_payload_message(message: &SpaceAiChatMessage) -> Option<Value> {
    let message = to_text_payload_message(message)?;
    Some(json!({
        "role": message.role,
        "content": message.content,
    }))
}

fn to_text_payload_message(message: &SpaceAiChatMessage) -> Option<SpaceAiChatMessage> {
    let role = match message.role.as_str() {
        "user" | "assistant" => message.role.as_str(),
        _ => return None,
    };
    let content = message.content.trim();
    if content.is_empty() {
        return None;
    }

    Some(SpaceAiChatMessage {
        role: role.to_string(),
        content: truncate_chars(content, 6_000),
    })
}

fn system_instructions(locale: &str) -> &'static str {
    if is_english_locale(locale) {
        "You are a disk space analysis assistant. Judge only from the scan result provided by the user, and do not invent paths that were not scanned. Use Markdown, and do not wrap the whole answer in a code block. Answer in English, even if file names, paths, or earlier messages contain another language. State conclusions, risks, and next steps directly.\n\nUse a ReAct-style workflow internally: first decide whether the current information is enough; when more information is needed, call read_path_info as the Action to inspect a path; after an Observation, continue the judgment; when cleanup is needed, call delete_path to create a user confirmation request. Do not print the words Thought, Action, or Observation, and do not expose internal reasoning.\n\nSafety boundaries: do not recommend directly deleting system directories, application roots, or unknown business data. High-risk items must mention using the official uninstaller, in-app cleanup, or making a backup first. read_path_info is read-only and runs automatically. delete_path only creates an in-chat confirmation card and never runs automatically. When deletion is needed, call delete_path; do not output rm, del, Remove-Item, or other shell deletion commands."
    } else {
        "你是磁盘空间分析助手。只基于用户提供的扫描结果判断，不编造未扫描路径。回答使用 Markdown，不要把整段回答包进代码块。输出中文，即使文件名、路径或历史消息包含其他语言也必须用中文。直说结论、风险和下一步操作。\n\n工作方式使用 ReAct：先判断当前信息是否足够；信息不足时调用 read_path_info 作为 Action 读取路径信息；收到 Observation 后继续判断；需要清理时调用 delete_path 生成用户确认请求。不要输出 Thought、Action、Observation 字样，也不要暴露内部推理过程。\n\n安全边界：不要建议直接删除系统目录、应用主目录或未知业务数据；高风险项必须提示通过官方卸载器、应用内清理或先备份。read_path_info 是只读操作，会自动执行。delete_path 只会进入用户对话内确认卡片，不会自动执行。需要删除时必须调用 delete_path，不要输出 rm、del、Remove-Item 或其他 shell 删除命令。"
    }
}

fn scan_result_heading(locale: &str) -> &'static str {
    if is_english_locale(locale) {
        "Current scan result"
    } else {
        "当前扫描结果"
    }
}

fn default_analysis_prompt(locale: &str) -> &'static str {
    if is_english_locale(locale) {
        "Analyze the current scan result, with priority cleanup targets, risks, and next steps."
    } else {
        "请基于当前扫描结果做一次空间占用分析，优先指出可清理项、风险和下一步。"
    }
}

fn build_space_context(request: &SpaceAiAnalysisRequest) -> String {
    let mut lines = if is_english_locale(&request.locale) {
        vec![
            format!("Scan path: {}", request.path),
            format!("Total usage: {} bytes", request.total_size),
            format!("Files: {}", request.total_files),
            format!("Directories: {}", request.total_dirs),
            format!("Unreadable entries: {}", request.unreadable_entries),
            "Largest scanned items:".to_string(),
        ]
    } else {
        vec![
            format!("扫描目录：{}", request.path),
            format!("总占用：{} bytes", request.total_size),
            format!("文件数：{}", request.total_files),
            format!("目录数：{}", request.total_dirs),
            format!("不可读取项：{}", request.unreadable_entries),
            "占用最大的扫描项：".to_string(),
        ]
    };

    for (index, item) in request.top_items.iter().take(40).enumerate() {
        lines.push(format!(
            "{}. [{}] {} | {} bytes | files={} dirs={} depth={} | {}",
            index + 1,
            item.kind,
            item.name,
            item.size,
            item.files,
            item.dirs,
            item.depth,
            item.path
        ));
    }

    lines.join("\n")
}

fn is_english_locale(locale: &str) -> bool {
    locale.eq_ignore_ascii_case("en-US") || locale.to_ascii_lowercase().starts_with("en")
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }

    value.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_payload_includes_tools() {
        let payload = build_completion_payload(
            &request(),
            AiProtocol::OpenAiChatCompletions,
            "test-model",
            false,
            ToolChoice::Auto,
            &[],
        );

        assert_eq!(payload["tool_choice"], "auto");
        assert!(payload["tools"].is_array());
    }

    #[test]
    fn final_payload_omits_tools() {
        let payload = build_completion_payload(
            &request(),
            AiProtocol::OpenAiChatCompletions,
            "test-model",
            true,
            ToolChoice::None,
            &[],
        );

        assert!(payload.get("tool_choice").is_none());
        assert!(payload.get("tools").is_none());
        assert_eq!(payload["stream"], true);
    }

    #[test]
    fn responses_payload_uses_message_input_and_flat_tools() {
        let payload = build_completion_payload(
            &request(),
            AiProtocol::OpenAiResponses,
            "test-model",
            false,
            ToolChoice::Auto,
            &[],
        );

        assert_eq!(payload["input"][0]["type"], "message");
        assert_eq!(payload["input"][0]["role"], "user");
        assert_eq!(payload["tools"][0]["type"], "function");
        assert_eq!(payload["tools"][0]["name"], "read_path_info");
        assert!(payload["tools"][0].get("function").is_none());
    }

    #[test]
    fn anthropic_payload_uses_messages_and_input_schema_tools() {
        let payload = build_completion_payload(
            &request(),
            AiProtocol::AnthropicMessages,
            "claude-test",
            true,
            ToolChoice::Auto,
            &[],
        );

        assert_eq!(payload["model"], "claude-test");
        assert_eq!(payload["messages"][0]["role"], "user");
        assert_eq!(payload["tools"][0]["name"], "read_path_info");
        assert!(payload["tools"][0]["input_schema"].is_object());
        assert_eq!(payload["stream"], true);
    }

    fn request() -> SpaceAiAnalysisRequest {
        SpaceAiAnalysisRequest {
            locale: "zh-CN".to_string(),
            path: "/tmp/root".to_string(),
            total_size: 0,
            total_files: 0,
            total_dirs: 0,
            unreadable_entries: 0,
            top_items: Vec::new(),
            items: Vec::new(),
            messages: Vec::new(),
        }
    }

    #[test]
    fn english_payload_requests_english_answer() {
        let mut request = request();
        request.locale = "en-US".to_string();

        let payload = build_completion_payload(
            &request,
            AiProtocol::OpenAiChatCompletions,
            "test-model",
            false,
            ToolChoice::Auto,
            &[],
        );

        let system = payload["messages"][0]["content"].as_str().unwrap();
        let user = payload["messages"][1]["content"].as_str().unwrap();
        assert!(system.contains("Answer in English"));
        assert!(system.contains("Current scan result"));
        assert!(user.contains("Analyze the current scan result"));
        assert!(payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap()
            .contains("Read-only information"));
    }
}
