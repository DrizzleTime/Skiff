mod client;
mod payload;
mod runtime;
mod stream;
mod tools;

use crate::models::{AppSettings, SpaceAiAnalysisRequest, SpaceAiAnalysisResult, SpaceAiToolCall};
use client::{build_client, request_completion_once, stream_completion_once};
use runtime::SpaceAiRuntime;
use tools::{
    build_assistant_tool_call_message, build_tool_result_messages, has_auto_tool_call,
    merge_tool_calls, resolve_space_tool_calls,
};

const MAX_TOOL_ROUNDS: usize = 3;

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

        if !has_auto_tool_call(&result.tool_calls) {
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

    Ok(ai.analysis_result(String::new(), collected_tool_calls))
}

pub async fn stream_space_report<F, G>(
    settings: &AppSettings,
    request: SpaceAiAnalysisRequest,
    mut on_delta: F,
    mut on_tool_calls: G,
) -> Result<SpaceAiAnalysisResult, String>
where
    F: FnMut(String) + Send,
    G: FnMut(Vec<SpaceAiToolCall>) + Send,
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

        if !has_auto_tool_call(&result.tool_calls) {
            return Ok(ai.analysis_result(
                streamed_content.trim().to_string(),
                merge_tool_calls(collected_tool_calls, result.tool_calls),
            ));
        }

        let resolved_tool_calls = resolve_space_tool_calls(&request, result.tool_calls);
        if !resolved_tool_calls.is_empty() {
            on_tool_calls(resolved_tool_calls.clone());
        }
        extra_messages.push(build_assistant_tool_call_message(
            result.content.as_str(),
            &resolved_tool_calls,
        ));
        extra_messages.extend(build_tool_result_messages(&resolved_tool_calls));
        collected_tool_calls = merge_tool_calls(collected_tool_calls, resolved_tool_calls);
    }

    Ok(ai.analysis_result(streamed_content.trim().to_string(), collected_tool_calls))
}
