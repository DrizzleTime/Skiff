use crate::models::DiskStatus;
use fs2::available_space;
use std::path::Path;
#[cfg(not(windows))]
use std::process::Command;

pub fn read_disk_status(path: &Path) -> Result<DiskStatus, String> {
    let total = fs2::total_space(path).map_err(|err| format!("读取磁盘总容量失败：{err}"))?;
    let available = available_space(path).map_err(|err| format!("读取磁盘可用空间失败：{err}"))?;
    let used = total.saturating_sub(available);
    let used_percent = if total == 0 { 0 } else { used * 100 / total };

    Ok(DiskStatus {
        total,
        used,
        available,
        used_percent,
        mount_point: mount_point(path),
    })
}

fn mount_point(path: &Path) -> String {
    #[cfg(windows)]
    {
        path.components()
            .next()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .unwrap_or_else(|| path.display().to_string())
    }

    #[cfg(not(windows))]
    {
        df_mount_point(path).unwrap_or_else(|| "/".to_string())
    }
}

#[cfg(not(windows))]
fn df_mount_point(path: &Path) -> Option<String> {
    let output = Command::new("df").arg("-P").arg(path).output().ok()?;
    if !output.status.success() {
        return None;
    }

    parse_df_mount_point(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(windows))]
fn parse_df_mount_point(output: &str) -> Option<String> {
    let mut lines = output.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next()?;
    let line = lines.next()?;
    let mount_index = header
        .split_whitespace()
        .position(|part| part == "Mounted")?;
    let parts: Vec<&str> = line.split_whitespace().collect();
    (parts.len() > mount_index).then(|| parts[mount_index..].join(" "))
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn parses_df_mount_point_output() {
        let output = "\
Filesystem     1K-blocks Used Available Use% Mounted on
/dev/nvme0n1p3 997491712 0 997491712 0% /home
";

        assert_eq!(parse_df_mount_point(output).unwrap(), "/home");
    }

    #[test]
    fn parses_macos_df_mount_point_output() {
        let output = "\
Filesystem     512-blocks      Used  Available Capacity   iused      ifree %iused  Mounted on
/dev/disk3s5s1 7815622624 1338466 3370299680     30%  1338466 3370299680    0%   /System/Volumes/Data
";

        assert_eq!(
            parse_df_mount_point(output).unwrap(),
            "/System/Volumes/Data"
        );
    }
}
