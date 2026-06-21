use crate::models::{
    SpaceScanNode, SpaceScanRequest, SpaceScanResult, DEFAULT_SPACE_SCAN_CHILDREN,
    DEFAULT_SPACE_SCAN_DEPTH,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

const NODE_KIND_DIR: &str = "directory";
const NODE_KIND_FILE: &str = "file";

#[derive(Default)]
struct SpaceScanStats {
    inspected_entries: u64,
    unreadable_entries: u64,
    truncated_dirs: u64,
}

pub fn scan_directory_space(
    home: &Path,
    request: Option<SpaceScanRequest>,
) -> Result<SpaceScanResult, String> {
    let request = request.unwrap_or(SpaceScanRequest {
        path: None,
        max_depth: None,
        max_children: None,
    });
    let max_depth = request
        .max_depth
        .unwrap_or(DEFAULT_SPACE_SCAN_DEPTH)
        .clamp(1, 8);
    let max_children = request
        .max_children
        .unwrap_or(DEFAULT_SPACE_SCAN_CHILDREN)
        .clamp(8, 160);
    let root_path = resolve_scan_path(home, request.path.as_deref())?;
    let mut stats = SpaceScanStats::default();
    let root = scan_path(&root_path, 0, max_depth, max_children, &mut stats)?;

    Ok(SpaceScanResult {
        total_size: root.size,
        total_files: root.files,
        total_dirs: root.dirs,
        root,
        inspected_entries: stats.inspected_entries,
        unreadable_entries: stats.unreadable_entries,
        truncated_dirs: stats.truncated_dirs,
    })
}

fn resolve_scan_path(home: &Path, path_text: Option<&str>) -> Result<PathBuf, String> {
    let Some(path_text) = path_text.map(str::trim).filter(|value| !value.is_empty()) else {
        return home
            .canonicalize()
            .map_err(|err| format!("无法读取默认扫描目录：{err}"));
    };

    let path = if path_text == "~" {
        home.to_path_buf()
    } else if let Some(rest) = path_text
        .strip_prefix("~/")
        .or_else(|| path_text.strip_prefix("~\\"))
    {
        home.join(rest)
    } else {
        let path = PathBuf::from(path_text);
        if path.is_absolute() {
            path
        } else {
            home.join(path)
        }
    };

    let path = path
        .canonicalize()
        .map_err(|err| format!("扫描目录不存在或不可访问：{path_text}（{err}）"))?;
    if !path.is_dir() {
        return Err(format!("扫描路径不是目录：{path_text}"));
    }

    Ok(path)
}

fn scan_path(
    path: &Path,
    depth: u8,
    max_depth: u8,
    max_children: usize,
    stats: &mut SpaceScanStats,
) -> Result<SpaceScanNode, String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("读取路径失败：{err}"))?;
    if metadata.file_type().is_symlink() {
        return Err("空间分析不跟随符号链接。".to_string());
    }

    if metadata.file_type().is_file() {
        return Ok(file_node(path, metadata.len(), depth));
    }

    if !metadata.file_type().is_dir() {
        return Err("空间分析只支持普通文件夹。".to_string());
    }

    Ok(scan_dir(path, depth, max_depth, max_children, stats))
}

fn scan_dir(
    path: &Path,
    depth: u8,
    max_depth: u8,
    max_children: usize,
    stats: &mut SpaceScanStats,
) -> SpaceScanNode {
    let mut node = dir_node(path, depth);
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(err) => {
            stats.unreadable_entries += 1;
            node.read_error = Some(format!("读取目录失败：{err}"));
            return node;
        }
    };
    let mut child_count = 0usize;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                stats.unreadable_entries += 1;
                continue;
            }
        };
        let child_path = entry.path();
        let metadata = match fs::symlink_metadata(&child_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.unreadable_entries += 1;
                continue;
            }
        };
        let file_type = metadata.file_type();

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_file() {
            stats.inspected_entries += 1;
            node.size = node.size.saturating_add(metadata.len());
            node.files = node.files.saturating_add(1);

            if depth < max_depth {
                child_count += 1;
                push_limited_child(
                    &mut node.children,
                    file_node(&child_path, metadata.len(), depth.saturating_add(1)),
                    max_children,
                );
            }
            continue;
        }

        if file_type.is_dir() {
            stats.inspected_entries += 1;
            let child = scan_dir(
                &child_path,
                depth.saturating_add(1),
                max_depth,
                max_children,
                stats,
            );
            node.size = node.size.saturating_add(child.size);
            node.files = node.files.saturating_add(child.files);
            node.dirs = node.dirs.saturating_add(child.dirs).saturating_add(1);

            if depth < max_depth {
                child_count += 1;
                push_limited_child(&mut node.children, child, max_children);
            }
        }
    }

    sort_and_truncate_children(&mut node.children, max_children);
    if child_count > node.children.len() {
        stats.truncated_dirs += 1;
    }

    node
}

fn push_limited_child(
    children: &mut Vec<SpaceScanNode>,
    child: SpaceScanNode,
    max_children: usize,
) {
    children.push(child);
    let soft_limit = max_children.saturating_mul(4).max(64);
    if children.len() > soft_limit {
        sort_and_truncate_children(children, max_children);
    }
}

fn sort_and_truncate_children(children: &mut Vec<SpaceScanNode>, max_children: usize) {
    children.sort_by(|left, right| {
        right
            .size
            .cmp(&left.size)
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });
    children.truncate(max_children);
}

fn dir_node(path: &Path, depth: u8) -> SpaceScanNode {
    let path_text = path.display().to_string();

    SpaceScanNode {
        id: path_text.clone(),
        name: display_name(path),
        path: path_text,
        kind: NODE_KIND_DIR.to_string(),
        size: 0,
        files: 0,
        dirs: 0,
        depth,
        children: Vec::new(),
        read_error: None,
    }
}

fn file_node(path: &Path, size: u64, depth: u8) -> SpaceScanNode {
    let path_text = path.display().to_string();

    SpaceScanNode {
        id: path_text.clone(),
        name: display_name(path),
        path: path_text,
        kind: NODE_KIND_FILE.to_string(),
        size,
        files: 1,
        dirs: 0,
        depth,
        children: Vec::new(),
        read_error: None,
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn scans_directory_sizes_and_sorts_children() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path().join("root");
        let small = root.join("small");
        let large = root.join("large");
        fs::create_dir_all(&small).expect("small dir");
        fs::create_dir_all(&large).expect("large dir");
        fs::write(small.join("a.txt"), b"tiny").expect("small file");
        fs::write(large.join("b.txt"), b"larger-content").expect("large file");

        let result = scan_directory_space(
            dir.path(),
            Some(SpaceScanRequest {
                path: Some(root.display().to_string()),
                max_depth: Some(3),
                max_children: Some(8),
            }),
        )
        .expect("scan");

        assert_eq!(result.total_files, 2);
        assert_eq!(result.total_dirs, 2);
        assert_eq!(result.root.children[0].name, "large");
        assert!(result.total_size > 0);
    }

    #[test]
    fn relative_paths_resolve_against_home() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("Downloads")).expect("downloads");

        let result = scan_directory_space(
            dir.path(),
            Some(SpaceScanRequest {
                path: Some("Downloads".to_string()),
                max_depth: Some(1),
                max_children: Some(8),
            }),
        );

        assert!(result.is_ok());
    }
}
