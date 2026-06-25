use serde::{Deserialize, Serialize};

pub const DEFAULT_LARGE_FILE_MIN_SIZE: u64 = 500 * 1024 * 1024;
pub const DEFAULT_DUPLICATE_MIN_SIZE: u64 = 10 * 1024 * 1024;
pub const DEFAULT_CLOSE_TO_TRAY: bool = true;
pub const DEFAULT_SHOW_ADVANCED_FEATURES: bool = true;
pub const DEFAULT_AI_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
pub const DEFAULT_AI_MODEL: &str = "gpt-4o-mini";
pub const DEFAULT_AI_PROTOCOL: AiProtocol = AiProtocol::OpenAiChatCompletions;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppSettings {
    pub large_file_min_size: u64,
    pub duplicate_min_size: u64,
    pub file_scan_paths: Vec<String>,
    pub close_to_tray: bool,
    pub show_advanced_features: bool,
    pub language: LanguagePreference,
    pub ai_protocol: AiProtocol,
    pub ai_endpoint: String,
    pub ai_api_key: String,
    pub ai_model: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub enum LanguagePreference {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en-US")]
    EnUs,
}

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub enum AiProtocol {
    #[default]
    #[serde(rename = "openai_chat_completions")]
    OpenAiChatCompletions,
    #[serde(rename = "openai_responses")]
    OpenAiResponses,
    #[serde(rename = "anthropic_messages")]
    AnthropicMessages,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            large_file_min_size: DEFAULT_LARGE_FILE_MIN_SIZE,
            duplicate_min_size: DEFAULT_DUPLICATE_MIN_SIZE,
            file_scan_paths: Vec::new(),
            close_to_tray: DEFAULT_CLOSE_TO_TRAY,
            show_advanced_features: DEFAULT_SHOW_ADVANCED_FEATURES,
            language: LanguagePreference::System,
            ai_protocol: DEFAULT_AI_PROTOCOL,
            ai_endpoint: DEFAULT_AI_ENDPOINT.to_string(),
            ai_api_key: String::new(),
            ai_model: DEFAULT_AI_MODEL.to_string(),
        }
    }
}
