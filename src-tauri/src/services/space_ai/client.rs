use super::{
    payload::{build_completion_payload, ExtraMessage, ToolChoice},
    runtime::{build_client as build_runtime_client, SpaceAiRuntime},
    stream::{handle_stream_line, StreamAccumulator},
    tools::parse_space_tool_call,
};
use crate::models::{AiProtocol, SpaceAiAnalysisRequest, SpaceAiAnalysisResult, SpaceAiToolCall};
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
    extra_messages: &[ExtraMessage],
) -> Result<SpaceAiAnalysisResult, String> {
    let payload = build_completion_payload(
        request,
        ai.protocol(),
        ai.model(),
        false,
        tool_choice,
        extra_messages,
    );
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

    parse_completion_response(ai, &text)
}

pub(super) async fn stream_completion_once<F>(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    tool_choice: ToolChoice,
    extra_messages: &[ExtraMessage],
    on_delta: &mut F,
) -> Result<SpaceAiAnalysisResult, String>
where
    F: FnMut(String),
{
    let payload = build_completion_payload(
        request,
        ai.protocol(),
        ai.model(),
        true,
        tool_choice,
        extra_messages,
    );
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
            if handle_stream_line(&line, ai.protocol(), &mut state, on_delta)? {
                return Ok(state.finish(ai));
            }
        }
    }

    if !buffer.trim().is_empty() {
        handle_stream_line(buffer.trim(), ai.protocol(), &mut state, on_delta)?;
    }

    Ok(state.finish(ai))
}

fn parse_completion_response(
    ai: &SpaceAiRuntime,
    text: &str,
) -> Result<SpaceAiAnalysisResult, String> {
    match ai.protocol() {
        AiProtocol::OpenAiChatCompletions => parse_chat_completion_response(ai, text),
        AiProtocol::OpenAiResponses => parse_responses_response(ai, text),
        AiProtocol::AnthropicMessages => parse_anthropic_message_response(ai, text),
    }
}

fn parse_chat_completion_response(
    ai: &SpaceAiRuntime,
    text: &str,
) -> Result<SpaceAiAnalysisResult, String> {
    let parsed: ChatCompletionResponse =
        serde_json::from_str(text).map_err(|err| format!("解析 AI 响应失败：{err}"))?;
    let message = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .ok_or_else(|| "AI 响应为空。".to_string())?;
    let content = message.content.unwrap_or_default().trim().to_string();
    let tool_calls = parse_chat_tool_calls(message.tool_calls);

    Ok(ai.analysis_result(content, tool_calls))
}

fn parse_responses_response(
    ai: &SpaceAiRuntime,
    text: &str,
) -> Result<SpaceAiAnalysisResult, String> {
    let parsed: ResponsesResponse =
        serde_json::from_str(text).map_err(|err| format!("解析 AI 响应失败：{err}"))?;
    let (content, tool_calls) = parse_responses_output(parsed);
    Ok(ai.analysis_result(content, tool_calls))
}

fn parse_anthropic_message_response(
    ai: &SpaceAiRuntime,
    text: &str,
) -> Result<SpaceAiAnalysisResult, String> {
    let parsed: AnthropicMessageResponse =
        serde_json::from_str(text).map_err(|err| format!("解析 AI 响应失败：{err}"))?;
    let (content, tool_calls) = parse_anthropic_content(parsed.content);
    Ok(ai.analysis_result(content, tool_calls))
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

fn parse_chat_tool_calls(tool_calls: Vec<ChatCompletionToolCall>) -> Vec<SpaceAiToolCall> {
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

#[derive(Deserialize)]
struct ResponsesResponse {
    #[serde(default)]
    output_text: Option<String>,
    #[serde(default)]
    output: Vec<ResponsesOutputItem>,
}

#[derive(Deserialize)]
struct ResponsesOutputItem {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    call_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
    #[serde(default)]
    content: Vec<ResponsesContentItem>,
}

#[derive(Deserialize)]
struct ResponsesContentItem {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

fn parse_responses_output(response: ResponsesResponse) -> (String, Vec<SpaceAiToolCall>) {
    let mut content_parts = Vec::new();
    let mut tool_calls = Vec::new();
    let mut has_output_text = false;

    if let Some(output_text) = response.output_text {
        if !output_text.trim().is_empty() {
            content_parts.push(output_text);
            has_output_text = true;
        }
    }

    for item in response.output {
        match item.kind.as_str() {
            "message" if !has_output_text => {
                for content in item.content {
                    if content.kind == "output_text" || content.kind == "text" {
                        if let Some(text) = content.text {
                            if !text.trim().is_empty() {
                                content_parts.push(text);
                            }
                        }
                    }
                }
            }
            "function_call" => {
                if let (Some(name), Some(arguments)) = (item.name, item.arguments) {
                    let id = item
                        .call_id
                        .or(item.id)
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| format!("{}_{}", name, tool_calls.len()));
                    if let Some(tool_call) = parse_space_tool_call(id, name, &arguments) {
                        tool_calls.push(tool_call);
                    }
                }
            }
            _ => {}
        }
    }

    (content_parts.join("").trim().to_string(), tool_calls)
}

#[derive(Deserialize)]
struct AnthropicMessageResponse {
    #[serde(default)]
    content: Vec<AnthropicContentBlock>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<Value>,
}

fn parse_anthropic_content(content: Vec<AnthropicContentBlock>) -> (String, Vec<SpaceAiToolCall>) {
    let mut content_parts = Vec::new();
    let mut tool_calls = Vec::new();

    for block in content {
        match block.kind.as_str() {
            "text" => {
                if let Some(text) = block.text {
                    if !text.trim().is_empty() {
                        content_parts.push(text);
                    }
                }
            }
            "tool_use" => {
                if let (Some(id), Some(name), Some(input)) = (block.id, block.name, block.input) {
                    let arguments = input.to_string();
                    if let Some(tool_call) = parse_space_tool_call(id, name, &arguments) {
                        tool_calls.push(tool_call);
                    }
                }
            }
            _ => {}
        }
    }

    (content_parts.join("").trim().to_string(), tool_calls)
}

fn compact_error_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 500 {
        return trimmed.to_string();
    }

    trimmed.chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppSettings, DEFAULT_AI_ENDPOINT};

    #[test]
    fn parses_responses_text_and_function_call() {
        let ai = runtime(AiProtocol::OpenAiResponses);
        let result = parse_completion_response(
            &ai,
            r#"{
                "output": [
                    {
                        "type": "message",
                        "content": [
                            { "type": "output_text", "text": "可以清理。" }
                        ]
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_1",
                        "name": "read_path_info",
                        "arguments": "{\"path\":\"/tmp/cache\",\"reason\":\"inspect\"}"
                    }
                ]
            }"#,
        )
        .expect("response");

        assert_eq!(result.content, "可以清理。");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_1");
        assert_eq!(result.tool_calls[0].name, "read_path_info");
        assert_eq!(result.tool_calls[0].arguments.path, "/tmp/cache");
    }

    #[test]
    fn parses_anthropic_text_and_tool_use() {
        let ai = runtime(AiProtocol::AnthropicMessages);
        let result = parse_completion_response(
            &ai,
            r#"{
                "content": [
                    { "type": "text", "text": "需要查看目录。" },
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "read_path_info",
                        "input": { "path": "/tmp/cache", "reason": "inspect" }
                    }
                ]
            }"#,
        )
        .expect("response");

        assert_eq!(result.content, "需要查看目录。");
        assert_eq!(result.provider, "anthropic-messages");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "toolu_1");
        assert_eq!(result.tool_calls[0].arguments.path, "/tmp/cache");
    }

    fn runtime(protocol: AiProtocol) -> SpaceAiRuntime {
        SpaceAiRuntime::from_settings(&AppSettings {
            ai_protocol: protocol,
            ai_endpoint: DEFAULT_AI_ENDPOINT.to_string(),
            ai_model: "test-model".to_string(),
            ..AppSettings::default()
        })
        .expect("runtime")
    }
}
