use crate::{
    models::{CleanupTarget, PathStats},
    services::{
        cleanup_targets::spec::{display_path_list, CleanupCommand, CleanupTargetSpec},
        system::{command_error, command_exists},
    },
};
use std::{
    fs, io,
    path::Path,
    process::{Command, Output},
};

pub(crate) fn scan_target(spec: &CleanupTargetSpec) -> CleanupTarget {
    let stats = measure_existing_paths(&spec.paths);
    let command_available = spec
        .commands
        .iter()
        .all(|command| command_exists(&command.command));
    let requires_privilege = spec.commands.iter().any(|command| command.privileged);
    let (exists, size, files, error) = match stats {
        Ok(stats) => {
            let has_paths = spec.paths.iter().any(|path| path.exists());
            let exists = has_paths || (!spec.commands.is_empty() && command_available);
            (exists, stats.size, stats.files, None)
        }
        Err(err) => (true, 0, 0, Some(err.to_string())),
    };
    let cleanable = error.is_none()
        && ((spec.clean_paths && exists && (size > 0 || files > 0))
            || (!spec.commands.is_empty()
                && command_available
                && (spec.always_cleanable || size > 0 || files > 0)));
    let paths = display_path_list(spec);

    CleanupTarget {
        id: spec.id.clone(),
        name: spec.name.clone(),
        category: spec.category.clone(),
        risk: spec.risk.clone(),
        description: spec.description.clone(),
        path: paths.join("\n"),
        paths,
        exists,
        cleanable,
        requires_privilege,
        size,
        files,
        error,
    }
}

pub(crate) fn sort_targets(targets: &mut [CleanupTarget]) {
    targets.sort_by(|left, right| {
        right
            .size
            .cmp(&left.size)
            .then_with(|| right.cleanable.cmp(&left.cleanable))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

pub(crate) fn measure_existing_paths(paths: &[std::path::PathBuf]) -> io::Result<PathStats> {
    let mut stats = PathStats::default();

    for path in paths {
        if !path.exists() {
            continue;
        }

        let child_stats = measure_cleanup_target(path)?;
        stats.size += child_stats.size;
        stats.files += child_stats.files;
    }

    Ok(stats)
}

fn measure_cleanup_target(path: &Path) -> io::Result<PathStats> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_dir() {
        measure_directory_contents(path)
    } else {
        Ok(PathStats {
            size: metadata.len(),
            files: 1,
        })
    }
}

fn measure_directory_contents(path: &Path) -> io::Result<PathStats> {
    let mut stats = PathStats::default();

    for entry in fs::read_dir(path)? {
        let child_stats = measure_path(&entry?.path())?;
        stats.size += child_stats.size;
        stats.files += child_stats.files;
    }

    Ok(stats)
}

fn measure_path(path: &Path) -> io::Result<PathStats> {
    let metadata = fs::symlink_metadata(path)?;

    if metadata.file_type().is_dir() {
        let mut stats = measure_directory_contents(path)?;
        stats.files += 1;
        Ok(stats)
    } else {
        Ok(PathStats {
            size: metadata.len(),
            files: 1,
        })
    }
}

pub(crate) fn clean_path_list(paths: &[std::path::PathBuf]) -> Result<PathStats, String> {
    let mut stats = PathStats::default();

    for path in paths {
        if !path.exists() {
            continue;
        }

        let path_stats = clean_path_contents(path)
            .map_err(|err| format!("清理 {} 失败：{err}", path.display()))?;
        stats.size += path_stats.size;
        stats.files += path_stats.files;
    }

    Ok(stats)
}

fn clean_path_contents(path: &Path) -> io::Result<PathStats> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        let stats = PathStats {
            size: metadata.len(),
            files: 1,
        };
        fs::remove_file(path)?;
        return Ok(stats);
    }

    let stats = measure_directory_contents(path)?;

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child_path = entry.path();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            fs::remove_dir_all(child_path)?;
        } else {
            fs::remove_file(child_path)?;
        }
    }

    Ok(stats)
}

pub(crate) fn run_cleanup_commands(commands: &[CleanupCommand]) -> Result<(), String> {
    for command in commands {
        if !command_exists(&command.command) {
            return Err(format!("找不到命令：{}", command.command));
        }

        let output = run_command(command)?;
        if !output.status.success() {
            return Err(command_error("清理命令失败", &output));
        }
    }

    Ok(())
}

fn run_command(command: &CleanupCommand) -> Result<Output, String> {
    if command.privileged && command_exists("pkexec") {
        let mut args = vec![command.command.as_str()];
        args.extend(command.args.iter().map(String::as_str));
        return Command::new("pkexec")
            .args(args)
            .output()
            .map_err(|err| format!("启动 pkexec 失败：{err}"));
    }

    Command::new(&command.command)
        .args(&command.args)
        .output()
        .map_err(|err| format!("启动 {} 失败：{err}", command.command))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, path::PathBuf};

    fn temp_root(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("skiff-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn measures_nested_directory_contents() {
        let root = temp_root("measure");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("a.txt"), b"abc").unwrap();
        fs::write(nested.join("b.txt"), b"defg").unwrap();

        let stats = measure_cleanup_target(&root).unwrap();

        assert_eq!(stats.size, 7);
        assert_eq!(stats.files, 3);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_contents_keeps_root_directory() {
        let root = temp_root("cleanup");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("a.txt"), b"abc").unwrap();
        fs::write(nested.join("b.txt"), b"defg").unwrap();

        let stats = clean_path_contents(&root).unwrap();

        assert_eq!(stats.size, 7);
        assert_eq!(stats.files, 3);
        assert!(root.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scan_missing_target_is_not_error() {
        let home = temp_root("missing");
        let spec = CleanupTargetSpec {
            id: "missing".to_string(),
            name: "缺失目标".to_string(),
            category: "cache".to_string(),
            risk: "safe".to_string(),
            description: "测试缺失目录".to_string(),
            paths: vec![home.join(".cache/missing")],
            commands: Vec::new(),
            clean_paths: true,
            always_cleanable: false,
        };
        let target = scan_target(&spec);

        assert_eq!(target.size, 0);
        assert_eq!(target.files, 0);
        assert!(!target.exists);
        assert!(!target.cleanable);
        assert!(target.error.is_none());

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sorts_targets_by_size_then_cleanable_then_name() {
        let mut targets = vec![
            test_target("c", 10, false),
            test_target("b", 20, false),
            test_target("a", 20, true),
        ];

        sort_targets(&mut targets);

        assert_eq!(targets[0].name, "a");
        assert_eq!(targets[1].name, "b");
        assert_eq!(targets[2].name, "c");
    }

    fn test_target(name: &str, size: u64, cleanable: bool) -> CleanupTarget {
        CleanupTarget {
            id: name.to_string(),
            name: name.to_string(),
            category: "cache".to_string(),
            risk: "safe".to_string(),
            description: String::new(),
            path: String::new(),
            paths: Vec::new(),
            exists: cleanable,
            cleanable,
            requires_privilege: false,
            size,
            files: 0,
            error: None,
        }
    }
}
