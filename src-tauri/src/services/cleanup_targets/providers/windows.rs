use crate::services::cleanup_targets::spec::CleanupTargetSpec;
use std::path::Path;

pub(crate) fn package_manager_targets(_home: &Path) -> Vec<CleanupTargetSpec> {
    Vec::new()
}
