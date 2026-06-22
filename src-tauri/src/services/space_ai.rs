mod client;
mod payload;
mod runtime;
mod stream;
mod tools;

use crate::models::{AppSettings, SpaceAiAnalysisRequest, SpaceAiAnalysisResult, SpaceAiToolCall};
use client::{build_client, request_completion_once, stream_completion_once};
use payload::ToolChoice;
use runtime::SpaceAiRuntime;
use serde_json::{json, Value};
use tools::needs_react_observation;
use tools::{
    build_assistant_tool_call_message, build_tool_result_messages, merge_tool_calls,
    resolve_space_tool_calls,
};

const MAX_REACT_TOOL_ROUNDS: usize = 5;

pub async fn analyze_space_report(
    settings: &AppSettings,
    request: SpaceAiAnalysisRequest,
) -> Result<SpaceAiAnalysisResult, String> {
    let ai = SpaceAiRuntime::from_settings(settings)?;
    let client = build_client()?;
    let mut extra_messages = Vec::new();
    let mut collected_tool_calls = Vec::new();

    for _ in 0..MAX_REACT_TOOL_ROUNDS {
        let mut result =
            request_completion_once(&client, &ai, &request, ToolChoice::Auto, &extra_messages)
                .await?;

        if !needs_react_observation(&result.tool_calls) {
            result.tool_calls = merge_tool_calls(collected_tool_calls, result.tool_calls);
            return Ok(result);
        }

        let resolved_tool_calls = resolve_space_tool_calls(&request, result.tool_calls);
        append_react_observation_messages(
            &mut extra_messages,
            result.content.as_str(),
            &resolved_tool_calls,
        );
        collected_tool_calls = merge_tool_calls(collected_tool_calls, resolved_tool_calls);
    }

    request_final_react_answer(
        &client,
        &ai,
        &request,
        &extra_messages,
        collected_tool_calls,
    )
    .await
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

    for _ in 0..MAX_REACT_TOOL_ROUNDS {
        let result = stream_completion_once(
            &client,
            &ai,
            &request,
            ToolChoice::Auto,
            &extra_messages,
            &mut on_delta,
        )
        .await?;
        append_streamed_content(&mut streamed_content, &result.content);

        if !needs_react_observation(&result.tool_calls) {
            return Ok(ai.analysis_result(
                streamed_content.trim().to_string(),
                merge_tool_calls(collected_tool_calls, result.tool_calls),
            ));
        }

        let resolved_tool_calls = resolve_space_tool_calls(&request, result.tool_calls);
        if !resolved_tool_calls.is_empty() {
            on_tool_calls(resolved_tool_calls.clone());
        }
        append_react_observation_messages(
            &mut extra_messages,
            result.content.as_str(),
            &resolved_tool_calls,
        );
        collected_tool_calls = merge_tool_calls(collected_tool_calls, resolved_tool_calls);
    }

    stream_final_react_answer(
        &client,
        &ai,
        &request,
        &extra_messages,
        collected_tool_calls,
        &mut streamed_content,
        &mut on_delta,
    )
    .await
}

async fn request_final_react_answer(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    extra_messages: &[Value],
    collected_tool_calls: Vec<SpaceAiToolCall>,
) -> Result<SpaceAiAnalysisResult, String> {
    let final_messages = final_react_messages(extra_messages);
    let mut result =
        request_completion_once(client, ai, request, ToolChoice::None, &final_messages).await?;
    result.tool_calls = merge_tool_calls(collected_tool_calls, result.tool_calls);
    Ok(result)
}

async fn stream_final_react_answer<F>(
    client: &reqwest::Client,
    ai: &SpaceAiRuntime,
    request: &SpaceAiAnalysisRequest,
    extra_messages: &[Value],
    collected_tool_calls: Vec<SpaceAiToolCall>,
    streamed_content: &mut String,
    on_delta: &mut F,
) -> Result<SpaceAiAnalysisResult, String>
where
    F: FnMut(String),
{
    let final_messages = final_react_messages(extra_messages);
    let result = stream_completion_once(
        client,
        ai,
        request,
        ToolChoice::None,
        &final_messages,
        on_delta,
    )
    .await?;
    append_streamed_content(streamed_content, &result.content);

    Ok(ai.analysis_result(
        streamed_content.trim().to_string(),
        merge_tool_calls(collected_tool_calls, result.tool_calls),
    ))
}

fn append_react_observation_messages(
    extra_messages: &mut Vec<Value>,
    action_content: &str,
    tool_calls: &[SpaceAiToolCall],
) {
    extra_messages.push(build_assistant_tool_call_message(
        action_content,
        tool_calls,
    ));
    extra_messages.extend(build_tool_result_messages(tool_calls));
}

fn final_react_messages(extra_messages: &[Value]) -> Vec<Value> {
    let mut messages = extra_messages.to_vec();
    messages.push(json!({
        "role": "user",
        "content": "工具观察轮次已达到上限。请停止调用工具，直接基于当前扫描结果和已经返回的工具观察结果，输出最终中文结论、风险和下一步操作。",
    }));
    messages
}

fn append_streamed_content(content: &mut String, segment: &str) {
    let segment = segment.trim();
    if segment.is_empty() {
        return;
    }
    if !content.trim().is_empty() {
        content.push_str("\n\n");
    }
    content.push_str(segment);
}
