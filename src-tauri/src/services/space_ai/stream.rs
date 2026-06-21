use super::{runtime::SpaceAiRuntime, tools::parse_space_tool_call};
use crate::models::SpaceAiAnalysisResult;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct StreamAccumulator {
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
    pub(super) fn finish(self, ai: &SpaceAiRuntime) -> SpaceAiAnalysisResult {
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

        ai.analysis_result(self.content.trim().to_string(), tool_calls)
    }
}

pub(super) fn handle_stream_line<F>(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppSettings, DEFAULT_AI_ENDPOINT};

    #[test]
    fn accumulates_stream_content_and_tool_call_chunks() {
        let mut state = StreamAccumulator::default();
        let mut deltas = Vec::new();

        let done = handle_stream_line(
            r#"data: {"choices":[{"delta":{"content":"清理","tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_path_info","arguments":"{\"path\":\"/tmp"}}]}}]}"#,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("line");
        assert!(!done);

        handle_stream_line(
            r#"data: {"choices":[{"delta":{"content":"建议","tool_calls":[{"index":0,"function":{"arguments":"\",\"reason\":\"inspect\"}"}}]}}]}"#,
            &mut state,
            &mut |delta| deltas.push(delta),
        )
        .expect("line");
        assert!(handle_stream_line("data: [DONE]", &mut state, &mut |_| {}).expect("done"));

        let ai = SpaceAiRuntime::from_settings(&AppSettings {
            ai_endpoint: DEFAULT_AI_ENDPOINT.to_string(),
            ai_model: "test-model".to_string(),
            ..AppSettings::default()
        })
        .expect("runtime");
        let result = state.finish(&ai);

        assert_eq!(deltas, vec!["清理".to_string(), "建议".to_string()]);
        assert_eq!(result.content, "清理建议");
        assert_eq!(result.model, "test-model");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].name, "read_path_info");
        assert_eq!(result.tool_calls[0].arguments.path, "/tmp");
    }
}
