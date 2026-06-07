use serde::{Deserialize, Serialize};

pub const DEFAULT_LARGE_FILE_MIN_SIZE: u64 = 500 * 1024 * 1024;
pub const DEFAULT_DUPLICATE_MIN_SIZE: u64 = 10 * 1024 * 1024;
pub const DEFAULT_CLOSE_TO_TRAY: bool = true;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppSettings {
    pub large_file_min_size: u64,
    pub duplicate_min_size: u64,
    pub close_to_tray: bool,
    pub language: LanguagePreference,
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

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            large_file_min_size: DEFAULT_LARGE_FILE_MIN_SIZE,
            duplicate_min_size: DEFAULT_DUPLICATE_MIN_SIZE,
            close_to_tray: DEFAULT_CLOSE_TO_TRAY,
            language: LanguagePreference::System,
        }
    }
}
