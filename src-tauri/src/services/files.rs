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

pub fn scan_roots(home: &Path, configured_paths: &[String]) -> Vec<PathBuf> {
    if configured_paths.is_empty() {
        return default_scan_roots(home);
    }

    configured_scan_roots(home, configured_paths)
}

pub fn normalize_scan_paths(
    home: &Path,
    configured_paths: &[String],
) -> Result<Vec<String>, String> {
    let home = home
        .canonicalize()
        .map_err(|err| format!("无法校验 HOME 目录：{err}"))?;
    let mut paths = Vec::new();

    for path_text in configured_paths {
        let path = resolve_scan_path(&home, path_text)?;
        if !paths.iter().any(|item| item == &path) {
            paths.push(path);
        }
    }

    Ok(paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

fn default_scan_roots(home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    push_existing_dirs(
        &mut roots,
        home,
        &[
            "Desktop",
            "Documents",
            "Downloads",
            "Music",
            "Pictures",
            "Videos",
            "Movies",
            "Public",
            "Templates",
            "Code",
            "Projects",
            "Workspace",
            "Developer",
            "OneDrive",
            "Dropbox",
            "Google Drive",
            "iCloudDrive",
            "iCloud Drive",
            "桌面",
            "文档",
            "下载",
            "音乐",
            "图片",
            "视频",
            "影片",
            "电影",
            "公共",
            "模板",
            "代码",
            "项目",
        ],
    );

    push_cloud_storage_roots(&mut roots, home);

    if roots.is_empty() {
        roots.push(home.to_path_buf());
    }

    roots
}

fn configured_scan_roots(home: &Path, configured_paths: &[String]) -> Vec<PathBuf> {
    let Ok(home) = home.canonicalize() else {
        return Vec::new();
    };
    let mut roots = Vec::new();

    for path_text in configured_paths {
        if let Ok(path) = resolve_scan_path(&home, path_text) {
            push_scan_root(&mut roots, path);
        }
    }

    roots
}

fn push_existing_dirs(roots: &mut Vec<PathBuf>, home: &Path, candidates: &[&str]) {
    for name in candidates {
        push_scan_root(roots, home.join(name));
    }
}

fn push_scan_root(roots: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_dir() && !roots.iter().any(|root| root == &path) {
        roots.push(path);
    }
}

fn resolve_scan_path(home: &Path, path_text: &str) -> Result<PathBuf, String> {
    let path_text = path_text.trim();
    if path_text.is_empty() {
        return Err("扫描路径不能为空。".to_string());
    }

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
        .map_err(|err| format!("扫描路径不存在或不可访问：{path_text}（{err}）"))?;
    if !path.is_dir() {
        return Err(format!("扫描路径不是目录：{path_text}"));
    }
    if !path.starts_with(home) {
        return Err(format!("扫描路径必须位于当前用户目录内：{path_text}"));
    }

    Ok(path)
}

fn push_cloud_storage_roots(roots: &mut Vec<PathBuf>, home: &Path) {
    let Ok(entries) = fs::read_dir(home) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if is_cloud_storage_dir_name(name) {
            push_scan_root(roots, path);
        }
    }
}

fn is_cloud_storage_dir_name(name: &str) -> bool {
    let lower_name = name.to_lowercase();

    lower_name == "dropbox"
        || lower_name == "box"
        || lower_name == "icloud drive"
        || lower_name == "iclouddrive"
        || lower_name == "synologydrive"
        || lower_name == "google drive"
        || lower_name.starts_with("onedrive")
        || lower_name.starts_with("google drive")
}

fn should_skip_scan_dir(path: &Path, home: &Path, skip_platform_roots: bool) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | ".git" | ".cache"
        )
        || (skip_platform_roots && is_platform_scan_root(path, home))
}

fn is_platform_scan_root(path: &Path, home: &Path) -> bool {
    let Ok(relative_path) = path.strip_prefix(home) else {
        return false;
    };
    let Some(first_path_segment) = first_normal_component(relative_path) else {
        return false;
    };

    platform_scan_root_candidates().iter().any(|candidate| {
        first_normal_component(Path::new(candidate))
            .is_some_and(|candidate_segment| path_segment_eq(first_path_segment, candidate_segment))
    })
}

fn first_normal_component(path: &Path) -> Option<&str> {
    path.components().find_map(|component| match component {
        std::path::Component::Normal(value) => value.to_str(),
        _ => None,
    })
}

fn path_segment_eq(left: &str, right: &str) -> bool {
    if cfg!(target_os = "windows") {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn platform_scan_root_candidates() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &[
            "3D Objects",
            "Contacts",
            "Favorites",
            "Links",
            "Saved Games",
            "Searches",
            "AppData/Local",
            "AppData/LocalLow",
            "AppData/Roaming",
        ]
    }

    #[cfg(target_os = "macos")]
    {
        &[
            "Applications",
            "Library/Application Support",
            "Library/Caches",
            "Library/CloudStorage",
            "Library/Containers",
            "Library/Developer",
            "Library/Group Containers",
            "Library/Mobile Documents",
        ]
    }

    #[cfg(target_os = "linux")]
    {
        &[
            ".cache",
            ".config",
            ".local/share",
            ".local/state",
            ".var/app",
            "snap",
        ]
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        &[]
    }
}

pub fn find_large_files(
    home: &Path,
    min_size: u64,
    limit: usize,
    configured_paths: &[String],
) -> Result<LargeFileScanResult, String> {
    let (mut files, scanned_files) = collect_scan_files(home, min_size, configured_paths)
        .map_err(|err| format!("扫描大文件失败：{err}"))?;

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
    configured_paths: &[String],
) -> Result<DuplicateFileScanResult, String> {
    let (files, scanned_files) = collect_scan_files(home, min_size, configured_paths)
        .map_err(|err| format!("扫描重复文件失败：{err}"))?;
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

        for (hash, hash_files) in by_hash {
            if hash_files.len() < 2 {
                continue;
            }

            for (index, mut exact_files) in partition_exact_duplicates(hash_files)
                .into_iter()
                .enumerate()
            {
                if exact_files.len() < 2 {
                    continue;
                }

                exact_files.sort_by(|left, right| left.path.cmp(&right.path));
                let count = exact_files.len() as u64;
                groups.push(DuplicateFileGroup {
                    id: format!("{size}-{hash}-{index}"),
                    size,
                    count,
                    reclaimable_size: size * (count - 1),
                    files: exact_files,
                });
            }
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
                trashed: true,
                success: true,
                error: None,
            },
            Err(err) => DeleteFileItemResult {
                path: path_text.clone(),
                released_size: 0,
                trashed: false,
                success: false,
                error: Some(err),
            },
        };
        items.push(item);
    }

    let released_size = items.iter().map(|item| item.released_size).sum();
    let deleted_files = items.iter().filter(|item| item.success).count() as u64;
    let trashed_files = items.iter().filter(|item| item.trashed).count() as u64;
    let failed_count = items.iter().filter(|item| !item.success).count() as u64;

    Ok(DeleteFilesResult {
        items,
        released_size,
        deleted_files,
        trashed_files,
        failed_count,
    })
}

fn collect_scan_files(
    home: &Path,
    min_size: u64,
    configured_paths: &[String],
) -> io::Result<(Vec<FileItem>, u64)> {
    let mut files = Vec::new();
    let mut scanned_files = 0;
    let home = home.canonicalize()?;
    let skip_platform_roots = configured_paths.is_empty();

    for root in scan_roots(&home, configured_paths) {
        collect_scan_files_from_dir(
            &root,
            &home,
            min_size,
            skip_platform_roots,
            &mut files,
            &mut scanned_files,
        )?;
    }

    Ok((files, scanned_files))
}

fn collect_scan_files_from_dir(
    dir: &Path,
    home: &Path,
    min_size: u64,
    skip_platform_roots: bool,
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
            if should_skip_scan_dir(&path, home, skip_platform_roots) {
                continue;
            }
            let _ = collect_scan_files_from_dir(
                &path,
                home,
                min_size,
                skip_platform_roots,
                files,
                scanned_files,
            );
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

fn partition_exact_duplicates(files: Vec<FileItem>) -> Vec<Vec<FileItem>> {
    let mut groups: Vec<Vec<FileItem>> = Vec::new();

    for file in files {
        let mut pending_file = Some(file);

        for group in &mut groups {
            let Some(candidate) = pending_file.as_ref() else {
                break;
            };
            let representative = Path::new(&group[0].path);
            if files_have_same_contents(representative, Path::new(&candidate.path)).unwrap_or(false)
            {
                if let Some(file) = pending_file.take() {
                    group.push(file);
                }
                break;
            }
        }

        if let Some(file) = pending_file {
            groups.push(vec![file]);
        }
    }

    groups
}

fn files_have_same_contents(left: &Path, right: &Path) -> io::Result<bool> {
    let mut left_file = fs::File::open(left)?;
    let mut right_file = fs::File::open(right)?;
    let mut left_buffer = [0; 8192];
    let mut right_buffer = [0; 8192];

    loop {
        let left_read = left_file.read(&mut left_buffer)?;
        let right_read = right_file.read(&mut right_buffer)?;

        if left_read != right_read {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
        if left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
    }
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
    trash::delete(path).map_err(|err| format!("移入回收站失败：{err}"))?;

    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn scan_roots_falls_back_to_home_when_no_candidates_exist() {
        let dir = tempdir().expect("tempdir");

        let roots = scan_roots(dir.path(), &[]);

        assert_eq!(roots, vec![dir.path().to_path_buf()]);
    }

    #[test]
    fn scan_roots_includes_common_and_cloud_dirs() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("Documents")).expect("create documents");
        fs::create_dir(dir.path().join("Projects")).expect("create projects");
        fs::create_dir(dir.path().join("OneDrive - Work")).expect("create onedrive");

        let roots = scan_roots(dir.path(), &[]);

        assert!(roots.contains(&dir.path().join("Documents")));
        assert!(roots.contains(&dir.path().join("Projects")));
        assert!(roots.contains(&dir.path().join("OneDrive - Work")));
    }

    #[test]
    fn default_scan_roots_skip_platform_application_data() {
        let Some(candidate) = platform_scan_root_candidates().first() else {
            return;
        };
        let dir = tempdir().expect("tempdir");
        let home = dir.path().canonicalize().expect("canonical home");
        let root = home.join(candidate);
        fs::create_dir_all(&root).expect("create platform root");
        fs::write(root.join("large.txt"), b"large-enough").expect("write large");

        let result = find_large_files(&home, 8, 20, &[]).expect("scan large files");

        assert_eq!(result.total_files, 0);
    }

    #[test]
    fn custom_scan_roots_can_read_platform_application_data() {
        let Some(candidate) = platform_scan_root_candidates().first() else {
            return;
        };
        let dir = tempdir().expect("tempdir");
        let root = dir.path().join(candidate);
        fs::create_dir_all(&root).expect("create platform root");
        fs::write(root.join("large.txt"), b"large-enough").expect("write large");

        let result = find_large_files(dir.path(), 8, 20, &[candidate.to_string()])
            .expect("scan large files");

        assert_eq!(result.total_files, 1);
        assert_eq!(result.items[0].name, "large.txt");
    }

    #[test]
    fn custom_scan_roots_replace_default_roots() {
        let dir = tempdir().expect("tempdir");
        let documents = dir.path().join("Documents");
        let projects = dir.path().join("Projects");
        fs::create_dir(&documents).expect("create documents");
        fs::create_dir(&projects).expect("create projects");
        fs::write(documents.join("document.txt"), b"large-enough").expect("write document");
        fs::write(projects.join("project.txt"), b"large-enough").expect("write project");

        let configured_paths = vec!["Projects".to_string()];
        let result =
            find_large_files(dir.path(), 8, 20, &configured_paths).expect("scan large files");

        assert_eq!(result.total_files, 1);
        assert_eq!(result.items[0].name, "project.txt");
    }

    #[test]
    fn normalize_scan_paths_accepts_home_relative_paths_and_deduplicates() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir(dir.path().join("Downloads")).expect("create downloads");
        let expected = dir
            .path()
            .join("Downloads")
            .canonicalize()
            .expect("canonical downloads");

        let paths = normalize_scan_paths(
            dir.path(),
            &["~/Downloads".to_string(), "Downloads".to_string()],
        )
        .expect("normalize paths");

        assert_eq!(paths, vec![expected.display().to_string()]);
    }

    #[test]
    fn normalize_scan_paths_rejects_paths_outside_home() {
        let home = tempdir().expect("home");
        let outside = tempdir().expect("outside");

        let result = normalize_scan_paths(home.path(), &[outside.path().display().to_string()]);

        assert!(result.is_err());
    }

    #[test]
    fn large_file_scan_filters_below_min_size_while_counting_all_files() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("small.txt"), b"tiny").expect("write small");
        fs::write(dir.path().join("large.txt"), b"large-enough").expect("write large");

        let result = find_large_files(dir.path(), 8, 20, &[]).expect("scan large files");

        assert_eq!(result.scanned_files, 2);
        assert_eq!(result.total_files, 1);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].name, "large.txt");
    }

    #[test]
    fn exact_duplicate_partition_splits_files_with_different_contents() {
        let dir = tempdir().expect("tempdir");
        let first = dir.path().join("first.txt");
        let second = dir.path().join("second.txt");
        let different = dir.path().join("different.txt");
        fs::write(&first, b"same-content").expect("write first");
        fs::write(&second, b"same-content").expect("write second");
        fs::write(&different, b"other-content").expect("write different");

        let groups = partition_exact_duplicates(vec![
            file_item(&first, "first.txt"),
            file_item(&second, "second.txt"),
            file_item(&different, "different.txt"),
        ]);
        let group_lengths: Vec<usize> = groups.iter().map(Vec::len).collect();

        assert_eq!(group_lengths, vec![2, 1]);
    }

    fn file_item(path: &Path, name: &str) -> FileItem {
        FileItem {
            id: path.display().to_string(),
            name: name.to_string(),
            path: path.display().to_string(),
            size: fs::metadata(path).expect("metadata").len(),
            modified: None,
        }
    }
}
