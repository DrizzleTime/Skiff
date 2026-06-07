use crate::models::{
    DeleteFileItemResult, DeleteFilesResult, DuplicateFileGroup, DuplicateFileScanResult, FileItem,
    LargeFileScanResult,
};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::Hasher,
    io,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub fn scan_roots(home: &Path) -> Vec<PathBuf> {
    let candidates = [
        "Desktop",
        "Documents",
        "Downloads",
        "Music",
        "Pictures",
        "Videos",
        "桌面",
        "文档",
        "下载",
        "音乐",
        "图片",
        "视频",
    ];
    let mut roots = Vec::new();

    for name in candidates {
        let path = home.join(name);
        if path.is_dir() && !roots.iter().any(|root: &PathBuf| root == &path) {
            roots.push(path);
        }
    }

    if roots.is_empty() {
        roots.push(home.to_path_buf());
    }

    roots
}

pub fn find_large_files(
    home: &Path,
    min_size: u64,
    limit: usize,
) -> Result<LargeFileScanResult, String> {
    let (mut files, scanned_files) =
        collect_scan_files(home, min_size).map_err(|err| format!("扫描大文件失败：{err}"))?;

    files.sort_by(|left, right| right.size.cmp(&left.size));
    files.truncate(limit);

    let total_size = files.iter().map(|file| file.size).sum();
    let total_files = files.len() as u64;

    Ok(LargeFileScanResult {
        items: files,
        total_size,
        total_files,
        scanned_files,
    })
}

pub fn find_duplicate_files(
    home: &Path,
    min_size: u64,
    group_limit: usize,
) -> Result<DuplicateFileScanResult, String> {
    let (files, scanned_files) =
        collect_scan_files(home, min_size).map_err(|err| format!("扫描重复文件失败：{err}"))?;
    let mut by_size: HashMap<u64, Vec<FileItem>> = HashMap::new();

    for file in files {
        by_size.entry(file.size).or_default().push(file);
    }

    let mut groups = Vec::new();

    for (size, same_size_files) in by_size {
        if same_size_files.len() < 2 {
            continue;
        }

        let mut by_hash: HashMap<u64, Vec<FileItem>> = HashMap::new();
        for file in same_size_files {
            if let Ok(hash) = hash_file(Path::new(&file.path)) {
                by_hash.entry(hash).or_default().push(file);
            }
        }

        for (hash, mut hash_files) in by_hash {
            if hash_files.len() < 2 {
                continue;
            }

            hash_files.sort_by(|left, right| left.path.cmp(&right.path));
            let count = hash_files.len() as u64;
            groups.push(DuplicateFileGroup {
                id: format!("{size}-{hash}"),
                size,
                count,
                reclaimable_size: size * (count - 1),
                files: hash_files,
            });
        }
    }

    groups.sort_by(|left, right| right.reclaimable_size.cmp(&left.reclaimable_size));
    groups.truncate(group_limit);

    let total_reclaimable_size = groups.iter().map(|group| group.reclaimable_size).sum();
    let total_files = groups.iter().map(|group| group.count).sum();

    Ok(DuplicateFileScanResult {
        groups,
        total_reclaimable_size,
        total_files,
        scanned_files,
    })
}

pub fn delete_files(home: &Path, paths: &[String]) -> Result<DeleteFilesResult, String> {
    let home = home
        .canonicalize()
        .map_err(|err| format!("无法校验 HOME 目录：{err}"))?;
    let mut items = Vec::new();

    for path_text in paths {
        let path = PathBuf::from(path_text);
        let item = match delete_one_file(&home, &path) {
            Ok(size) => DeleteFileItemResult {
                path: path_text.clone(),
                released_size: size,
                success: true,
                error: None,
            },
            Err(err) => DeleteFileItemResult {
                path: path_text.clone(),
                released_size: 0,
                success: false,
                error: Some(err),
            },
        };
        items.push(item);
    }

    let released_size = items.iter().map(|item| item.released_size).sum();
    let deleted_files = items.iter().filter(|item| item.success).count() as u64;
    let failed_count = items.iter().filter(|item| !item.success).count() as u64;

    Ok(DeleteFilesResult {
        items,
        released_size,
        deleted_files,
        failed_count,
    })
}

fn collect_scan_files(home: &Path, min_size: u64) -> io::Result<(Vec<FileItem>, u64)> {
    let mut files = Vec::new();
    let mut scanned_files = 0;

    for root in scan_roots(home) {
        collect_scan_files_from_dir(&root, min_size, &mut files, &mut scanned_files)?;
    }

    Ok((files, scanned_files))
}

fn collect_scan_files_from_dir(
    dir: &Path,
    min_size: u64,
    files: &mut Vec<FileItem>,
    scanned_files: &mut u64,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let file_type = metadata.file_type();

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if should_skip_scan_dir(&path) {
                continue;
            }
            let _ = collect_scan_files_from_dir(&path, min_size, files, scanned_files);
            continue;
        }

        if file_type.is_file() {
            *scanned_files += 1;
            if metadata.len() >= min_size {
                files.push(file_item_from_path(&path, &metadata));
            }
        }
    }

    Ok(())
}

fn should_skip_scan_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | ".git" | ".cache"
        )
}

fn file_item_from_path(path: &Path, metadata: &fs::Metadata) -> FileItem {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());
    let path_text = path.display().to_string();

    FileItem {
        id: path_text.clone(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名文件")
            .to_string(),
        path: path_text,
        size: metadata.len(),
        modified,
    }
}

fn hash_file(path: &Path) -> io::Result<u64> {
    let mut file = fs::File::open(path)?;
    let mut buffer = [0; 8192];
    let mut hasher = DefaultHasher::new();

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.write(&buffer[..read]);
    }

    Ok(hasher.finish())
}

fn delete_one_file(home: &Path, path: &Path) -> Result<u64, String> {
    if !path.is_absolute() {
        return Err("只能删除绝对路径文件。".to_string());
    }

    let metadata = fs::symlink_metadata(path).map_err(|err| format!("读取文件失败：{err}"))?;
    if !metadata.file_type().is_file() {
        return Err("只能删除普通文件。".to_string());
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|err| format!("校验文件路径失败：{err}"))?;
    if !canonical_path.starts_with(home) {
        return Err("只能删除当前用户目录下的文件。".to_string());
    }

    let size = metadata.len();
    fs::remove_file(path).map_err(|err| format!("删除文件失败：{err}"))?;

    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn large_file_scan_filters_below_min_size_while_counting_all_files() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("small.txt"), b"tiny").expect("write small");
        fs::write(dir.path().join("large.txt"), b"large-enough").expect("write large");

        let result = find_large_files(dir.path(), 8, 20).expect("scan large files");

        assert_eq!(result.scanned_files, 2);
        assert_eq!(result.total_files, 1);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].name, "large.txt");
    }
}
