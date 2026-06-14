mod claude;
mod codex;
mod shared;

use crate::models::{
    AgentCleanupItemResult, AgentCleanupResult, AgentProviderStatus, AgentThreadScanResult,
};
use std::{collections::HashMap, path::Path};

struct AgentProvider {
    id: &'static str,
    status: fn(&Path) -> AgentProviderStatus,
    scan: fn(&Path) -> Result<AgentThreadScanResult, String>,
    clean: fn(&Path, &[String]) -> Result<AgentCleanupResult, String>,
}

const PROVIDERS: &[AgentProvider] = &[
    AgentProvider {
        id: codex::AGENT_ID,
        status: codex::status,
        scan: codex::scan,
        clean: codex::clean,
    },
    AgentProvider {
        id: claude::AGENT_ID,
        status: claude::status,
        scan: claude::scan,
        clean: claude::clean,
    },
];

pub fn scan_agent_threads(home: &Path) -> Result<AgentThreadScanResult, String> {
    let statuses = agent_providers(home);
    let mut threads = Vec::new();

    for (provider, status) in PROVIDERS.iter().zip(statuses.iter()) {
        if status.available {
            threads.extend((provider.scan)(home)?.threads);
        }
    }

    threads.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));

    Ok(AgentThreadScanResult {
        total_size: threads.iter().map(|item| item.size).sum(),
        total_logs: threads.iter().map(|item| item.log_count).sum(),
        agents: statuses,
        threads,
    })
}

pub fn clean_agent_threads(home: &Path, ids: &[String]) -> Result<AgentCleanupResult, String> {
    let mut grouped_ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut items = Vec::new();
    let mut released_size = 0;

    for id in ids {
        let (agent, native_id) = split_agent_item_id(id);
        if provider_by_id(&agent).is_some() {
            grouped_ids.entry(agent).or_default().push(native_id);
        } else {
            items.push(unsupported_item(id, agent));
        }
    }

    for provider in PROVIDERS {
        let Some(provider_ids) = grouped_ids.remove(provider.id) else {
            continue;
        };
        if provider_ids.is_empty() {
            continue;
        }

        let mut result = (provider.clean)(home, &provider_ids)?;
        released_size += result.released_size;
        items.append(&mut result.items);
    }

    Ok(shared::cleanup_result(items, released_size))
}

fn agent_providers(home: &Path) -> Vec<AgentProviderStatus> {
    PROVIDERS
        .iter()
        .map(|provider| (provider.status)(home))
        .collect()
}

fn split_agent_item_id(id: &str) -> (String, String) {
    let id = id.trim();
    if let Some((agent, native_id)) = id.split_once(':') {
        if !agent.trim().is_empty() && !native_id.trim().is_empty() {
            return (agent.trim().to_string(), native_id.trim().to_string());
        }
    }

    (codex::AGENT_ID.to_string(), id.to_string())
}

fn provider_by_id(id: &str) -> Option<&'static AgentProvider> {
    PROVIDERS.iter().find(|provider| provider.id == id)
}

fn unsupported_item(id: &str, agent: String) -> AgentCleanupItemResult {
    AgentCleanupItemResult {
        id: id.to_string(),
        agent,
        title: "未知 Agent 会话".to_string(),
        path: String::new(),
        released_size: 0,
        deleted_logs: 0,
        success: false,
        error: Some("暂不支持清理该 Agent。".to_string()),
    }
}
