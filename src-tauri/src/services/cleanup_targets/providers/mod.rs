mod linux;
mod macos;
mod shared;
mod windows;

use crate::{
    models::TargetDefinition,
    services::{
        cleanup_targets::{
            definitions::{LINUX_CLEANUP_TARGETS, MACOS_CLEANUP_TARGETS, WINDOWS_CLEANUP_TARGETS},
            spec::CleanupTargetSpec,
        },
        system::Platform,
    },
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

pub(crate) fn build_target_specs(home: &Path) -> Vec<CleanupTargetSpec> {
    build_target_specs_for_platform(home, Platform::current())
}

pub(crate) fn build_target_specs_for_platform(
    home: &Path,
    platform: Platform,
) -> Vec<CleanupTargetSpec> {
    let mut specs = static_target_specs(home, platform);

    match platform {
        Platform::Linux => {
            specs.extend(linux::package_manager_targets(home));
            specs.extend(linux::flatpak_targets(home));
        }
        Platform::MacOS => specs.extend(macos::package_manager_targets(home)),
        Platform::Windows => specs.extend(windows::package_manager_targets(home)),
    }
    specs.extend(shared::package_manager_targets(home, platform));

    specs
}

fn static_target_specs(home: &Path, platform: Platform) -> Vec<CleanupTargetSpec> {
    let definitions = match platform {
        Platform::Linux => LINUX_CLEANUP_TARGETS,
        Platform::MacOS => MACOS_CLEANUP_TARGETS,
        Platform::Windows => WINDOWS_CLEANUP_TARGETS,
    };

    definitions
        .iter()
        .map(|definition| target_definition_spec(home, definition))
        .collect()
}

fn target_definition_spec(home: &Path, definition: &TargetDefinition) -> CleanupTargetSpec {
    CleanupTargetSpec {
        id: definition.id.to_string(),
        name: definition.name.to_string(),
        category: definition.category.to_string(),
        risk: definition.risk.to_string(),
        description: definition.description.to_string(),
        paths: relative_paths(home, definition.relative_paths),
        commands: Vec::new(),
        clean_paths: true,
        always_cleanable: false,
    }
}

fn relative_paths(home: &Path, relative_paths: &[&str]) -> Vec<PathBuf> {
    relative_paths.iter().map(|path| home.join(path)).collect()
}

pub(super) fn existing_candidates(paths: &[PathBuf]) -> Vec<PathBuf> {
    dedupe_paths(paths.iter().cloned().collect())
}

pub(super) fn first_available_command(commands: &[&str]) -> Option<String> {
    commands
        .iter()
        .find(|command| crate::services::system::command_exists(command))
        .map(|command| (*command).to_string())
}

pub(super) fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

pub(super) fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            result.push(path);
        }
    }

    result
}
