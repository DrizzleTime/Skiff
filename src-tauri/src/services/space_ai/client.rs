use super::{
    payload::{build_completion_payload, ToolChoice},
    runtime::{build_client as build_runtime_client, SpaceAiRuntime},
    stream::{handle_stream_line, StreamAccumulator},
    tools::parse_space_tool_call,
};
use crate::models::{SpaceAiAnalysisRequest, SpaceAiAnalysisResult, SpaceAiToolCall};
use serde::Deserialize;
use serde_json::Value;

pub(super) fn build_client() -> Result<reqwest::Client, String> {
    build_runtime_client()
}

pub(super) async fn request_completion_once(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    tool_choice: ToolChoice,
    extra_messages: &[Value],
) -> Result<SpaceAiAnalysisResult, String> {
    let payload = build_completion_payload(request, ai.model(), false, tool_choice, extra_messages);
    let response = ai
        .request(client, &payload)
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

    Ok(ai.analysis_result(content, tool_calls))
}

pub(super) async fn stream_completion_once<F>(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    tool_choice: ToolChoice,
    extra_messages: &[Value],
    on_delta: &mut F,
) -> Result<SpaceAiAnalysisResult, String>
where
    F: FnMut(String),
{
    let payload = build_completion_payload(request, ai.model(), true, tool_choice, extra_messages);
    let response = ai
        .request(client, &payload)
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
                return Ok(state.finish(ai));
            }
        }
    }

    if !buffer.trim().is_empty() {
        handle_stream_line(buffer.trim(), &mut state, on_delta)?;
    }

    Ok(state.finish(ai))
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
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

fn compact_error_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 500 {
        return trimmed.to_string();
    }

    trimmed.chars().take(500).collect()
}
