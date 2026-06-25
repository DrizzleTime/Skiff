use super::{runtime::SpaceAiRuntime, tools::parse_space_tool_call};
use crate::models::{AiProtocol, SpaceAiAnalysisResult, SpaceAiToolCall};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct StreamAccumulator {
    content: String,
    chat_tool_calls: BTreeMap<usize, StreamToolCallAccumulator>,
    response_tool_calls: BTreeMap<String, StreamToolCallAccumulator>,
    anthropic_tool_calls: BTreeMap<usize, StreamToolCallAccumulator>,
}

#[derive(Default)]
struct StreamToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    pub(super) fn finish(self, ai: &SpaceAiRuntime) -> SpaceAiAnalysisResult {
        let mut tool_calls = Vec::new();
        tool_calls.extend(parse_indexed_tool_calls(self.chat_tool_calls));
        tool_calls.extend(parse_keyed_tool_calls(self.response_tool_calls));
        tool_calls.extend(parse_indexed_tool_calls(self.anthropic_tool_calls));

        ai.analysis_result(self.content.trim().to_string(), tool_calls)
    }
}

pub(super) fn handle_stream_line<F>(
    line: &str,
    protocol: AiProtocol,
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

    match protocol {
        AiProtocol::OpenAiChatCompletions => handle_chat_stream_data(data, state, on_delta),
        AiProtocol::OpenAiResponses => handle_responses_stream_data(data, state, on_delta),
        AiProtocol::AnthropicMessages => handle_anthropic_stream_data(data, state, on_delta),
    }
}

fn handle_chat_stream_data<F>(
    data: &str,
    state: &mut StreamAccumulator,
    on_delta: &mut F,
) -> Result<bool, String>
where
    F: FnMut(String),
{
    let parsed: ChatCompletionStreamResponse =
        serde_json::from_str(data).map_err(|err| format!("解析 AI 流响应失败：{err}"))?;
    for choice in parsed.choices {
        if let Some(content) = choice.delta.content {
            append_delta(state, on_delta, content);
        }
        for tool_call in choice.delta.tool_calls {
            let entry = state.chat_tool_calls.entry(tool_call.index).or_default();
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

fn handle_responses_stream_data<F>(
    data: &str,
    state: &mut StreamAccumulator,
    on_delta: &mut F,
) -> Result<bool, String>
where
    F: FnMut(String),
{
    let parsed: ResponsesStreamEvent =
        serde_json::from_str(data).map_err(|err| format!("解析 AI 流响应失败：{err}"))?;
    match parsed.kind.as_str() {
        "response.output_text.delta" => {
            if let Some(delta) = parsed.delta {
                append_delta(state, on_delta, delta);
            }
        }
        "response.output_item.done" => {
            if let Some(item) = parsed.item {
                append_responses_output_item(state, item, false, on_delta);
            }
        }
        "response.completed" => {
            if let Some(response) = parsed.response {
                for item in response.output {
                    append_responses_output_item(state, item, true, on_delta);
                }
            }
            return Ok(true);
        }
        _ => {}
    }

    Ok(false)
}

fn handle_anthropic_stream_data<F>(
    data: &str,
    state: &mut StreamAccumulator,
    on_delta: &mut F,
) -> Result<bool, String>
where
    F: FnMut(String),
{
    let parsed: AnthropicStreamEvent =
        serde_json::from_str(data).map_err(|err| format!("解析 AI 流响应失败：{err}"))?;
    match parsed.kind.as_str() {
        "content_block_start" => {
            if let (Some(index), Some(block)) = (parsed.index, parsed.content_block) {
                if block.kind == "tool_use" {
                    let entry = state.anthropic_tool_calls.entry(index).or_default();
                    if let Some(id) = block.id {
                        entry.id = id;
                    }
                    if let Some(name) = block.name {
                        entry.name = name;
                    }
                }
            }
        }
        "content_block_delta" => {
            if let Some(delta) = parsed.delta {
                match delta.kind.as_str() {
                    "text_delta" => {
                        if let Some(text) = delta.text {
                            append_delta(state, on_delta, text);
                        }
                    }
                    "input_json_delta" => {
                        if let (Some(index), Some(partial_json)) =
                            (parsed.index, delta.partial_json)
                        {
                            let entry = state.anthropic_tool_calls.entry(index).or_default();
                            entry.arguments.push_str(&partial_json);
                        }
                    }
                    _ => {}
                }
            }
        }
        "message_stop" => return Ok(true),
        _ => {}
    }

    Ok(false)
}

fn append_delta<F>(state: &mut StreamAccumulator, on_delta: &mut F, delta: String)
where
    F: FnMut(String),
{
    if delta.is_empty() {
        return;
    }

    state.content.push_str(&delta);
    on_delta(delta);
}

fn append_responses_output_item<F>(
    state: &mut StreamAccumulator,
    item: ResponsesOutputItem,
    allow_text_fallback: bool,
    on_delta: &mut F,
) where
    F: FnMut(String),
{
    match item.kind.as_str() {
        "message" if allow_text_fallback && state.content.trim().is_empty() => {
            for content in item.content {
                if (content.kind == "output_text" || content.kind == "text")
                    && content
                        .text
                        .as_ref()
                        .is_some_and(|text| !text.trim().is_empty())
                {
                    append_delta(state, on_delta, content.text.unwrap_or_default());
                }
            }
        }
        "function_call" => {
            if let (Some(name), Some(arguments)) = (item.name, item.arguments) {
                let id = item
                    .call_id
                    .or(item.id)
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| format!("{}_{}", name, state.response_tool_calls.len()));
                state.response_tool_calls.insert(
                    id.clone(),
                    StreamToolCallAccumulator {
                        id,
                        name,
                        arguments,
                    },
                );
            }
        }
        _ => {}
    }
}

fn parse_indexed_tool_calls(
    tool_calls: BTreeMap<usize, StreamToolCallAccumulator>,
) -> Vec<SpaceAiToolCall> {
    tool_calls
        .into_iter()
        .filter_map(|(index, value)| parse_accumulated_tool_call(index, value))
        .collect()
}

fn parse_keyed_tool_calls(
    tool_calls: BTreeMap<String, StreamToolCallAccumulator>,
) -> Vec<SpaceAiToolCall> {
    tool_calls
        .into_iter()
        .enumerate()
        .filter_map(|(index, (_, value))| parse_accumulated_tool_call(index, value))
        .collect()
}

fn parse_accumulated_tool_call(
    index: usize,
    value: StreamToolCallAccumulator,
) -> Option<SpaceAiToolCall> {
    let id = if value.id.trim().is_empty() {
        format!("{}_{}", value.name, index)
    } else {
        value.id
    };
    parse_space_tool_call(id, value.name, &value.arguments)
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
struct ResponsesStreamEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    delta: Option<String>,
    #[serde(default)]
    item: Option<ResponsesOutputItem>,
    #[serde(default)]
    response: Option<ResponsesStreamResponse>,
}

#[derive(Deserialize)]
struct ResponsesStreamResponse {
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

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    content_block: Option<AnthropicContentBlock>,
    #[serde(default)]
    delta: Option<AnthropicDelta>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicDelta {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    partial_json: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppSettings, DEFAULT_AI_ENDPOINT};

    #[test]
    fn accumulates_chat_stream_content_and_tool_call_chunks() {
        let mut state = StreamAccumulator::default();
        let mut deltas = Vec::new();

        let done = handle_stream_line(
            r#"data: {"choices":[{"delta":{"content":"清理","tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_path_info","arguments":"{\"path\":\"/tmp"}}]}}]}"#,
            AiProtocol::OpenAiChatCompletions,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("line");
        assert!(!done);

        handle_stream_line(
            r#"data: {"choices":[{"delta":{"content":"建议","tool_calls":[{"index":0,"function":{"arguments":"\",\"reason\":\"inspect\"}"}}]}}]}"#,
            AiProtocol::OpenAiChatCompletions,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("line");
        assert!(handle_stream_line(
            "data: [DONE]",
            AiProtocol::OpenAiChatCompletions,
            &mut state,
            &mut |_| {}
        )
        .expect("done"));

        let ai = runtime(AiProtocol::OpenAiChatCompletions);
        let result = state.finish(&ai);

        assert_eq!(deltas, vec!["清理".to_string(), "建议".to_string()]);
        assert_eq!(result.content, "清理建议");
        assert_eq!(result.model, "test-model");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].name, "read_path_info");
        assert_eq!(result.tool_calls[0].arguments.path, "/tmp");
    }

    #[test]
    fn accumulates_responses_stream_text_and_function_call() {
        let mut state = StreamAccumulator::default();
        let mut deltas = Vec::new();

        handle_stream_line(
            r#"data: {"type":"response.output_text.delta","delta":"清理"}"#,
            AiProtocol::OpenAiResponses,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("delta");
        let done = handle_stream_line(
            r#"data: {"type":"response.completed","response":{"output":[{"type":"function_call","call_id":"call_1","name":"read_path_info","arguments":"{\"path\":\"/tmp\",\"reason\":\"inspect\"}"}]}}"#,
            AiProtocol::OpenAiResponses,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("completed");

        let result = state.finish(&runtime(AiProtocol::OpenAiResponses));

        assert!(done);
        assert_eq!(deltas, vec!["清理".to_string()]);
        assert_eq!(result.content, "清理");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_1");
        assert_eq!(result.tool_calls[0].arguments.path, "/tmp");
    }

    #[test]
    fn accumulates_anthropic_stream_text_and_tool_use() {
        let mut state = StreamAccumulator::default();
        let mut deltas = Vec::new();

        handle_stream_line(
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            AiProtocol::AnthropicMessages,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("text start");
        handle_stream_line(
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"建议"}}"#,
            AiProtocol::AnthropicMessages,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("text delta");
        handle_stream_line(
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_path_info","input":{}}}"#,
            AiProtocol::AnthropicMessages,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("tool start");
        handle_stream_line(
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/tmp\",\"reason\":\"inspect\"}"}}"#,
            AiProtocol::AnthropicMessages,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("tool delta");
        let done = handle_stream_line(
            r#"data: {"type":"message_stop"}"#,
            AiProtocol::AnthropicMessages,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("stop");

        let result = state.finish(&runtime(AiProtocol::AnthropicMessages));

        assert!(done);
        assert_eq!(deltas, vec!["建议".to_string()]);
        assert_eq!(result.content, "建议");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "toolu_1");
        assert_eq!(result.tool_calls[0].arguments.path, "/tmp");
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
