use crate::models::{
    AppSettings, SpaceAiAnalysisRequest, SpaceAiAnalysisResult, SpaceAiChatMessage,
    SpaceAiPathInfoResult, SpaceAiToolArguments, SpaceAiToolCall,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path, time::Duration};

const TOOL_DELETE_PATH: &str = "delete_path";
const TOOL_READ_PATH_INFO: &str = "read_path_info";
const MAX_TOOL_ROUNDS: usize = 3;

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Deserialize)]
struct ChatCompletionStreamResponse {
    choices: Vec<ChatCompletionStreamChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionStreamChoice {
    delta: ChatCompletionStreamDelta,
}

#[derive(Deserialize)]
struct ChatCompletionStreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ChatCompletionStreamToolCall>,
}

#[derive(Deserialize)]
struct ChatCompletionStreamToolCall {
    index: usize,
    id: Option<String>,
    function: Option<ChatCompletionStreamToolFunction>,
}

#[derive(Deserialize)]
struct ChatCompletionStreamToolFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Deserialize)]
struct ChatCompletionMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ChatCompletionToolCall>,
}

#[derive(Deserialize)]
struct ChatCompletionToolCall {
    id: Option<String>,
    function: ChatCompletionToolFunction,
}

#[derive(Deserialize)]
struct ChatCompletionToolFunction {
    name: String,
    arguments: String,
}

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

pub async fn analyze_space_report(
    settings: &AppSettings,
    request: SpaceAiAnalysisRequest,
) -> Result<SpaceAiAnalysisResult, String> {
    let ai = SpaceAiRuntime::from_settings(settings)?;
    let client = build_client()?;
    let mut extra_messages = Vec::new();
    let mut collected_tool_calls = Vec::new();

    for _ in 0..MAX_TOOL_ROUNDS {
        let mut result = request_completion_once(&client, &ai, &request, &extra_messages).await?;
        let needs_auto_tool = result
            .tool_calls
            .iter()
            .any(|tool_call| tool_call.name == TOOL_READ_PATH_INFO);

        if !needs_auto_tool {
            result.tool_calls = merge_tool_calls(collected_tool_calls, result.tool_calls);
            return Ok(result);
        }

        let resolved_tool_calls = resolve_space_tool_calls(&request, result.tool_calls);
        extra_messages.push(build_assistant_tool_call_message(
            result.content.as_str(),
            &resolved_tool_calls,
        ));
        extra_messages.extend(build_tool_result_messages(&resolved_tool_calls));
        collected_tool_calls = merge_tool_calls(collected_tool_calls, resolved_tool_calls);
    }

    Ok(SpaceAiAnalysisResult {
        provider: "openai-compatible".to_string(),
        model: ai.model,
        content: String::new(),
        tool_calls: collected_tool_calls,
    })
}

pub async fn stream_space_report<F>(
    settings: &AppSettings,
    request: SpaceAiAnalysisRequest,
    mut on_delta: F,
) -> Result<SpaceAiAnalysisResult, String>
where
    F: FnMut(String) + Send,
{
    let ai = SpaceAiRuntime::from_settings(settings)?;
    let client = build_client()?;
    let mut extra_messages = Vec::new();
    let mut collected_tool_calls = Vec::new();
    let mut streamed_content = String::new();

    for _ in 0..MAX_TOOL_ROUNDS {
        let result =
            stream_completion_once(&client, &ai, &request, &extra_messages, &mut on_delta).await?;
        streamed_content.push_str(&result.content);
        let needs_auto_tool = result
            .tool_calls
            .iter()
            .any(|tool_call| tool_call.name == TOOL_READ_PATH_INFO);

        if !needs_auto_tool {
            return Ok(SpaceAiAnalysisResult {
                provider: "openai-compatible".to_string(),
                model: ai.model,
                content: streamed_content.trim().to_string(),
                tool_calls: merge_tool_calls(collected_tool_calls, result.tool_calls),
            });
        }

        let resolved_tool_calls = resolve_space_tool_calls(&request, result.tool_calls);
        extra_messages.push(build_assistant_tool_call_message(
            result.content.as_str(),
            &resolved_tool_calls,
        ));
        extra_messages.extend(build_tool_result_messages(&resolved_tool_calls));
        collected_tool_calls = merge_tool_calls(collected_tool_calls, resolved_tool_calls);
    }

    Ok(SpaceAiAnalysisResult {
        provider: "openai-compatible".to_string(),
        model: ai.model,
        content: streamed_content.trim().to_string(),
        tool_calls: collected_tool_calls,
    })
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(75))
        .build()
        .map_err(|err| format!("创建 AI 客户端失败：{err}"))
}

struct SpaceAiRuntime {
    endpoint: String,
    model: String,
    api_key: String,
}

impl SpaceAiRuntime {
    fn from_settings(settings: &AppSettings) -> Result<Self, String> {
        let endpoint = settings.ai_endpoint.trim();
        let model = settings.ai_model.trim();
        let api_key = settings.ai_api_key.trim();

        if endpoint.is_empty() {
            return Err(
                "未配置 AI Endpoint。请在设置中填写 OpenAI-compatible Chat Completions 地址。"
                    .to_string(),
            );
        }
        if model.is_empty() {
            return Err("未配置 AI Model。请在设置中填写模型名称。".to_string());
        }

        Ok(Self {
            endpoint: endpoint.to_string(),
            model: model.to_string(),
            api_key: api_key.to_string(),
        })
    }
}

async fn request_completion_once(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    extra_messages: &[Value],
) -> Result<SpaceAiAnalysisResult, String> {
    let payload = build_completion_payload(request, &ai.model, false, extra_messages);
    let response = build_request(client, ai, &payload)
        .send()
        .await
        .map_err(|err| format!("AI 分析请求失败：{err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 AI 响应失败：{err}"))?;

    if !status.is_success() {
        return Err(format!(
            "AI 分析请求失败（{}）：{}",
            status.as_u16(),
            compact_error_text(&text)
        ));
    }

    let parsed: ChatCompletionResponse =
        serde_json::from_str(&text).map_err(|err| format!("解析 AI 响应失败：{err}"))?;
    let message = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .ok_or_else(|| "AI 响应为空。".to_string())?;
    let content = message.content.unwrap_or_default().trim().to_string();
    let tool_calls = parse_tool_calls(message.tool_calls);

    Ok(SpaceAiAnalysisResult {
        provider: "openai-compatible".to_string(),
        model: ai.model.clone(),
        content,
        tool_calls,
    })
}

async fn stream_completion_once<F>(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    extra_messages: &[Value],
    on_delta: &mut F,
) -> Result<SpaceAiAnalysisResult, String>
where
    F: FnMut(String),
{
    let payload = build_completion_payload(request, &ai.model, true, extra_messages);
    let response = build_request(client, ai, &payload)
        .send()
        .await
        .map_err(|err| format!("AI 分析请求失败：{err}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .map_err(|err| format!("读取 AI 响应失败：{err}"))?;
        return Err(format!(
            "AI 分析请求失败（{}）：{}",
            status.as_u16(),
            compact_error_text(&text)
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut state = StreamAccumulator::default();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| format!("读取 AI 流失败：{err}"))?;
        let text = std::str::from_utf8(&chunk).map_err(|err| format!("解析 AI 流失败：{err}"))?;
        buffer.push_str(text);
        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim_end_matches('\r').to_string();
            buffer.replace_range(..=index, "");
            if handle_stream_line(&line, &mut state, on_delta)? {
                return Ok(state.finish(&ai.model));
            }
        }
    }

    if !buffer.trim().is_empty() {
        handle_stream_line(buffer.trim(), &mut state, on_delta)?;
    }

    Ok(state.finish(&ai.model))
}

fn build_completion_payload(
    request: &SpaceAiAnalysisRequest,
    model: &str,
    stream: bool,
    extra_messages: &[Value],
) -> Value {
    let mut messages = build_chat_payload(request);
    messages.extend(extra_messages.iter().cloned());

    json!({
        "model": model,
        "messages": messages,
        "tools": build_tools(),
        "tool_choice": "auto",
        "temperature": 0.2,
        "stream": stream
    })
}

fn build_request<'a>(
    client: &'a reqwest::Client,
    ai: &'a SpaceAiRuntime,
    payload: &'a Value,
) -> reqwest::RequestBuilder {
    let builder = client.post(&ai.endpoint).json(payload);
    if ai.api_key.is_empty() {
        builder
    } else {
        builder.bearer_auth(&ai.api_key)
    }
}

fn build_chat_payload(request: &SpaceAiAnalysisRequest) -> Vec<Value> {
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
            "content": default_analysis_prompt(),
        }));
    }

    messages.extend(chat_messages);
    messages
}

fn build_system_message(request: &SpaceAiAnalysisRequest) -> String {
    format!(
        "{}\n\n当前扫描结果：\n{}",
        "你是磁盘空间分析助手。只基于用户提供的扫描结果判断，不编造未扫描路径。回答使用 Markdown，不要把整段回答包进代码块。输出中文，直说结论、风险和下一步操作。不要建议直接删除系统目录、应用主目录或未知业务数据；高风险项必须提示通过官方卸载器、应用内清理或先备份。你可以调用 read_path_info 工具读取当前扫描结果中某个文件或目录的详细信息，这是只读操作，会自动执行。你可以调用 delete_path 工具请求删除扫描结果中的文件或目录，但工具请求只会进入用户对话内确认卡片，不会自动执行。需要删除时必须调用 delete_path，不要输出 rm、del、Remove-Item 或其他 shell 删除命令。",
        build_space_context(request)
    )
}

fn build_tools() -> Vec<Value> {
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

fn parse_tool_calls(tool_calls: Vec<ChatCompletionToolCall>) -> Vec<SpaceAiToolCall> {
    tool_calls
        .into_iter()
        .enumerate()
        .filter_map(|(index, tool_call)| {
            let id = tool_call
                .id
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| format!("{}_{}", tool_call.function.name, index));
            parse_space_tool_call(id, tool_call.function.name, &tool_call.function.arguments)
        })
        .collect()
}

fn parse_space_tool_call(
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

fn resolve_space_tool_calls(
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

fn build_assistant_tool_call_message(content: &str, tool_calls: &[SpaceAiToolCall]) -> Value {
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

fn build_tool_result_messages(tool_calls: &[SpaceAiToolCall]) -> Vec<Value> {
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

fn merge_tool_calls(
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

#[derive(Default)]
struct StreamAccumulator {
    content: String,
    tool_calls: BTreeMap<usize, StreamToolCallAccumulator>,
}

#[derive(Default)]
struct StreamToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    fn finish(self, model: &str) -> SpaceAiAnalysisResult {
        let tool_calls = self
            .tool_calls
            .into_iter()
            .filter_map(|(index, value)| {
                let id = if value.id.trim().is_empty() {
                    format!("{}_{}", value.name, index)
                } else {
                    value.id
                };
                parse_space_tool_call(id, value.name, &value.arguments)
            })
            .collect();

        SpaceAiAnalysisResult {
            provider: "openai-compatible".to_string(),
            model: model.to_string(),
            content: self.content.trim().to_string(),
            tool_calls,
        }
    }
}

fn handle_stream_line<F>(
    line: &str,
    state: &mut StreamAccumulator,
    on_delta: &mut F,
) -> Result<bool, String>
where
    F: FnMut(String),
{
    let line = line.trim();
    if line.is_empty() || !line.starts_with("data:") {
        return Ok(false);
    }

    let data = line.trim_start_matches("data:").trim();
    if data == "[DONE]" {
        return Ok(true);
    }

    let parsed: ChatCompletionStreamResponse =
        serde_json::from_str(data).map_err(|err| format!("解析 AI 流响应失败：{err}"))?;
    for choice in parsed.choices {
        if let Some(content) = choice.delta.content {
            if !content.is_empty() {
                state.content.push_str(&content);
                on_delta(content);
            }
        }
        for tool_call in choice.delta.tool_calls {
            let entry = state.tool_calls.entry(tool_call.index).or_default();
            if let Some(id) = tool_call.id {
                entry.id.push_str(&id);
            }
            if let Some(function) = tool_call.function {
                if let Some(name) = function.name {
                    entry.name.push_str(&name);
                }
                if let Some(arguments) = function.arguments {
                    entry.arguments.push_str(&arguments);
                }
            }
        }
    }

    Ok(false)
}

fn to_chat_payload_message(message: &SpaceAiChatMessage) -> Option<Value> {
    let role = match message.role.as_str() {
        "user" | "assistant" => message.role.as_str(),
        _ => return None,
    };
    let content = message.content.trim();
    if content.is_empty() {
        return None;
    }

    Some(json!({
        "role": role,
        "content": truncate_chars(content, 6_000),
    }))
}

fn default_analysis_prompt() -> &'static str {
    "请基于当前扫描结果做一次空间占用分析，优先指出可清理项、风险和下一步。"
}

fn build_space_context(request: &SpaceAiAnalysisRequest) -> String {
    let mut lines = vec![
        format!("扫描目录：{}", request.path),
        format!("总占用：{} bytes", request.total_size),
        format!("文件数：{}", request.total_files),
        format!("目录数：{}", request.total_dirs),
        format!("不可读取项：{}", request.unreadable_entries),
        "占用最大的扫描项：".to_string(),
    ];

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

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }

    value.chars().take(limit).collect()
}

fn compact_error_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 500 {
        return trimmed.to_string();
    }

    trimmed.chars().take(500).collect::<String>()
}
