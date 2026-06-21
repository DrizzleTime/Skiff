use crate::models::{AppSettings, SpaceAiAnalysisResult, SpaceAiToolCall};
use serde_json::Value;
use std::time::Duration;

const PROVIDER_ID: &str = "openai-compatible";
const CLIENT_TIMEOUT_SECONDS: u64 = 75;

pub(super) struct SpaceAiRuntime {
    endpoint: String,
    model: String,
    api_key: String,
}

impl SpaceAiRuntime {
    pub(super) fn from_settings(settings: &AppSettings) -> Result<Self, String> {
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

    pub(super) fn model(&self) -> &str {
        &self.model
    }

    pub(super) fn request<'a>(
        &'a self,
        client: &'a reqwest::Client,
        payload: &'a Value,
    ) -> reqwest::RequestBuilder {
        let builder = client.post(&self.endpoint).json(payload);
        if self.api_key.is_empty() {
            builder
        } else {
            builder.bearer_auth(&self.api_key)
        }
    }

    pub(super) fn analysis_result(
        &self,
        content: String,
        tool_calls: Vec<SpaceAiToolCall>,
    ) -> SpaceAiAnalysisResult {
        SpaceAiAnalysisResult {
            provider: PROVIDER_ID.to_string(),
            model: self.model.clone(),
            content,
            tool_calls,
        }
    }
}

pub(super) fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(CLIENT_TIMEOUT_SECONDS))
        .build()
        .map_err(|err| format!("创建 AI 客户端失败：{err}"))
}
