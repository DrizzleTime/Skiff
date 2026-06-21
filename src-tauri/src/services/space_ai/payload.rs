use super::tools::build_tools;
use crate::models::{SpaceAiAnalysisRequest, SpaceAiChatMessage};
use serde_json::{json, Value};

pub(super) fn build_completion_payload(
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
