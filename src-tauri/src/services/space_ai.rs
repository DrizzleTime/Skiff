use crate::models::{
    AppSettings, SpaceAiAnalysisRequest, SpaceAiAnalysisResult, SpaceAiChatMessage,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

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
    content: String,
}

pub async fn analyze_space_report(
    settings: &AppSettings,
    request: SpaceAiAnalysisRequest,
) -> Result<SpaceAiAnalysisResult, String> {
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(75))
        .build()
        .map_err(|err| format!("创建 AI 客户端失败：{err}"))?;
    let messages = build_chat_payload(&request);
    let payload = json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2
    });
    let mut builder = client.post(endpoint).json(&payload);
    if !api_key.is_empty() {
        builder = builder.bearer_auth(api_key);
    }

    let response = builder
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
    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "AI 响应为空。".to_string())?;

    Ok(SpaceAiAnalysisResult {
        provider: "openai-compatible".to_string(),
        model: model.to_string(),
        content,
    })
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
        "你是磁盘空间分析助手。只基于用户提供的扫描结果判断，不编造未扫描路径。回答使用 Markdown，不要把整段回答包进代码块。输出中文，直说结论、风险和下一步操作。不要建议直接删除系统目录、应用主目录或未知业务数据；高风险项必须提示通过官方卸载器、应用内清理或先备份。",
        build_space_context(request)
    )
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
