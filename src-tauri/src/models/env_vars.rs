use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvShell {
    Zsh,
    Bash,
    Fish,
    Powershell,
    Cmd,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvEntryKind {
    Variable,
    Path,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvEntrySource {
    CurrentProcess,
    ShellConfig,
    SkiffBlock,
    WindowsUserEnv,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvChangeAction {
    Upsert,
    Delete,
}

#[derive(Serialize)]
pub struct EnvShellConfig {
    pub shell: EnvShell,
    pub label: String,
    pub config_path: String,
    pub exists: bool,
    pub available: bool,
    pub is_default: bool,
    pub activation_command: String,
    pub restart_hint: String,
    pub requires_registry: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct EnvPathEntry {
    pub path: String,
    pub enabled: bool,
}

#[derive(Clone, Serialize)]
pub struct EnvEntry {
    pub id: String,
    pub kind: EnvEntryKind,
    pub key: String,
    pub value: String,
    pub source: EnvEntrySource,
    pub shell: Option<EnvShell>,
    pub source_label: String,
    pub config_path: Option<String>,
    pub line_number: Option<usize>,
    pub editable: bool,
    pub importable: bool,
    pub enabled: bool,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct EnvInventory {
    pub shells: Vec<EnvShellConfig>,
    pub entries: Vec<EnvEntry>,
}

#[derive(Clone, Deserialize)]
pub struct EnvEntryChange {
    pub action: EnvChangeAction,
    pub kind: EnvEntryKind,
    pub key: String,
    pub value: String,
    pub source: EnvEntrySource,
    pub shell: Option<EnvShell>,
    pub config_path: Option<String>,
    pub line_number: Option<usize>,
    pub original_key: Option<String>,
    pub original_value: Option<String>,
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct EnvInventorySaveRequest {
    pub changes: Vec<EnvEntryChange>,
}

#[derive(Serialize)]
pub struct EnvInventorySaveResult {
    pub changed_count: usize,
    pub backup_paths: Vec<String>,
    pub registry_changed: bool,
}
