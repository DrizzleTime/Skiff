use crate::{
    models::{AppInfo, AppSettings, DEFAULT_DUPLICATE_GROUP_LIMIT, DEFAULT_LARGE_FILE_LIMIT},
    services::{
        agent_cleanup::{clean_agent_threads, scan_agent_threads},
        cleanup_targets::{clean_targets, cleanup_target_count, scan_targets},
        disk::read_disk_status,
        files::{delete_files, find_duplicate_files, find_large_files, scan_roots},
        packages::{scan_installed_packages_without_icons, uninstall_selected_packages},
        settings::read_settings,
        system::{home_dir, Platform},
    },
};
use serde::Serialize;
use std::path::PathBuf;

type CliResult<T> = Result<T, CliError>;

#[derive(Debug)]
struct CliError {
    code: i32,
    message: String,
}

struct GlobalOptions {
    json: bool,
    help: bool,
    home: Option<PathBuf>,
}

struct ParsedArgs {
    options: GlobalOptions,
    command: Vec<String>,
}

pub fn run(args: impl IntoIterator<Item = String>) -> i32 {
    let args = args.into_iter().skip(1).collect::<Vec<_>>();

    match run_inner(args) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("{}", err.message);
            err.code
        }
    }
}

fn run_inner(args: Vec<String>) -> CliResult<i32> {
    let parsed = parse_global_args(args)?;

    if parsed.options.help || parsed.command.is_empty() {
        print_help(&parsed.command);
        return Ok(0);
    }

    match parsed.command[0].as_str() {
        "info" => run_info(&parsed.options),
        "disk" => run_disk(&parsed.options),
        "cleanup" => run_cleanup_command(&parsed.options, &parsed.command[1..]),
        "files" => run_files_command(&parsed.options, &parsed.command[1..]),
        "agents" => run_agents_command(&parsed.options, &parsed.command[1..]),
        "packages" => run_packages_command(&parsed.options, &parsed.command[1..]),
        command => Err(fail(2, format!("未知命令：{command}"))),
    }
}

fn parse_global_args(args: Vec<String>) -> CliResult<ParsedArgs> {
    let mut options = GlobalOptions {
        json: false,
        help: false,
        home: None,
    };
    let mut command = Vec::new();
    let mut index = 0;

    while index < args.len() {
        let arg = &args[index];
        if arg == "--json" {
            options.json = true;
        } else if arg == "--help" || arg == "-h" {
            options.help = true;
        } else if arg == "--home" {
            index += 1;
            let Some(value) = args.get(index) else {
                return Err(fail(2, "--home 需要路径参数。"));
            };
            options.home = Some(PathBuf::from(value));
        } else if let Some(value) = arg.strip_prefix("--home=") {
            if value.is_empty() {
                return Err(fail(2, "--home 需要路径参数。"));
            }
            options.home = Some(PathBuf::from(value));
        } else {
            command.push(arg.clone());
        }

        index += 1;
    }

    Ok(ParsedArgs { options, command })
}

fn run_info(options: &GlobalOptions) -> CliResult<i32> {
    let home = resolve_home(options)?;
    let settings = read_settings(&home).unwrap_or_else(|_| AppSettings::default());
    let scan_roots = scan_roots(&home, &settings.file_scan_paths)
        .into_iter()
        .map(|path| path.display().to_string())
        .collect();
    let info = AppInfo {
        name: "skiff".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: Platform::current().id().to_string(),
        scan_roots,
        cleanup_targets: cleanup_target_count(&home),
    };

    if options.json {
        print_json(&info)?;
    } else {
        println!("Skiff {}", info.version);
        println!("平台：{}", info.platform);
        println!("清理项目：{}", info.cleanup_targets);
        println!("扫描目录：");
        for root in info.scan_roots {
            println!("  {root}");
        }
    }

    Ok(0)
}

fn run_disk(options: &GlobalOptions) -> CliResult<i32> {
    let home = resolve_home(options)?;
    let status = read_disk_status(&home).map_err(|err| fail(1, err))?;

    if options.json {
        print_json(&status)?;
    } else {
        println!("挂载点：{}", status.mount_point);
        println!("总容量：{}", format_size(status.total));
        println!("已用空间：{}", format_size(status.used));
        println!("可用空间：{}", format_size(status.available));
        println!("使用比例：{}%", status.used_percent);
    }

    Ok(0)
}

fn run_cleanup_command(options: &GlobalOptions, args: &[String]) -> CliResult<i32> {
    let Some(subcommand) = args.first().map(String::as_str) else {
        print_cleanup_help();
        return Ok(0);
    };

    match subcommand {
        "scan" => {
            ensure_no_args(&args[1..], "cleanup scan")?;
            let home = resolve_home(options)?;
            let result = scan_targets(&home);

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "可释放：{}，文件：{}",
                    format_size(result.total_size),
                    result.total_files
                );
                for target in result.targets {
                    let marker = if target.cleanable {
                        "可清理"
                    } else {
                        "跳过"
                    };
                    println!(
                        "{}\t{}\t{}\t{}\t{}",
                        target.id,
                        target.name,
                        format_size(target.size),
                        target.files,
                        marker
                    );
                }
            }

            Ok(0)
        }
        "run" => {
            let params = parse_ids_and_yes(&args[1..], "cleanup run")?;
            require_yes(params.yes, "cleanup run")?;
            let home = resolve_home(options)?;
            let result = clean_targets(&home, &params.ids);
            let code = if result.failed_count > 0 { 1 } else { 0 };

            if options.json {
                print_json(&result)?;
            } else {
                print_cleanup_run_result(&result);
            }

            Ok(code)
        }
        _ => Err(fail(2, format!("未知 cleanup 子命令：{subcommand}"))),
    }
}

fn run_files_command(options: &GlobalOptions, args: &[String]) -> CliResult<i32> {
    let Some(subcommand) = args.first().map(String::as_str) else {
        print_files_help();
        return Ok(0);
    };

    match subcommand {
        "large" => {
            let params = parse_large_file_args(&args[1..])?;
            let home = resolve_home(options)?;
            let settings = read_settings(&home).unwrap_or_else(|_| AppSettings::default());
            let min_size = params.min_size.unwrap_or(settings.large_file_min_size);
            let limit = params.limit.unwrap_or(DEFAULT_LARGE_FILE_LIMIT);
            let result = find_large_files(&home, min_size, limit, &settings.file_scan_paths)
                .map_err(|err| fail(1, err))?;

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "大文件：{} 个，合计 {}，已扫描 {} 个文件",
                    result.total_files,
                    format_size(result.total_size),
                    result.scanned_files
                );
                for item in result.items {
                    println!("{}\t{}\t{}", item.path, item.name, format_size(item.size));
                }
            }

            Ok(0)
        }
        "duplicates" => {
            let params = parse_duplicate_file_args(&args[1..])?;
            let home = resolve_home(options)?;
            let settings = read_settings(&home).unwrap_or_else(|_| AppSettings::default());
            let min_size = params.min_size.unwrap_or(settings.duplicate_min_size);
            let group_limit = params.group_limit.unwrap_or(DEFAULT_DUPLICATE_GROUP_LIMIT);
            let result =
                find_duplicate_files(&home, min_size, group_limit, &settings.file_scan_paths)
                    .map_err(|err| fail(1, err))?;

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "重复文件组：{}，可释放 {}，已扫描 {} 个文件",
                    result.groups.len(),
                    format_size(result.total_reclaimable_size),
                    result.scanned_files
                );
                for group in result.groups {
                    println!(
                        "{}\t{} 个\t可释放 {}",
                        group.id,
                        group.count,
                        format_size(group.reclaimable_size)
                    );
                    for file in group.files {
                        println!("  {}\t{}", file.path, format_size(file.size));
                    }
                }
            }

            Ok(0)
        }
        "delete" => {
            let params = parse_paths_and_yes(&args[1..], "files delete")?;
            require_yes(params.yes, "files delete")?;
            let home = resolve_home(options)?;
            let result = delete_files(&home, &params.paths).map_err(|err| fail(1, err))?;
            let code = if result.failed_count > 0 { 1 } else { 0 };

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "已删除：{} 个，释放 {}，失败 {} 个",
                    result.deleted_files,
                    format_size(result.released_size),
                    result.failed_count
                );
                for item in result.items {
                    let status = if item.success { "成功" } else { "失败" };
                    println!(
                        "{}\t{}\t{}",
                        status,
                        item.path,
                        item.error
                            .unwrap_or_else(|| format_size(item.released_size))
                    );
                }
            }

            Ok(code)
        }
        _ => Err(fail(2, format!("未知 files 子命令：{subcommand}"))),
    }
}

fn run_agents_command(options: &GlobalOptions, args: &[String]) -> CliResult<i32> {
    let Some(subcommand) = args.first().map(String::as_str) else {
        print_agents_help();
        return Ok(0);
    };

    match subcommand {
        "scan" => {
            ensure_no_args(&args[1..], "agents scan")?;
            let home = resolve_home(options)?;
            let result = scan_agent_threads(&home).map_err(|err| fail(1, err))?;

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "Agent 会话：{} 个，日志 {} 条，合计 {}",
                    result.threads.len(),
                    result.total_logs,
                    format_size(result.total_size)
                );
                for agent in result.agents {
                    let status = if agent.available {
                        "可用"
                    } else {
                        "不可用"
                    };
                    println!("{}：{} ({})", agent.name, status, agent.path);
                }
                for thread in result.threads {
                    println!(
                        "{}\t{}\t{}\t{}",
                        thread.id,
                        thread.title,
                        thread.cwd,
                        format_size(thread.size)
                    );
                }
            }

            Ok(0)
        }
        "clean" => {
            let params = parse_ids_and_yes(&args[1..], "agents clean")?;
            require_yes(params.yes, "agents clean")?;
            let home = resolve_home(options)?;
            let result = clean_agent_threads(&home, &params.ids).map_err(|err| fail(1, err))?;
            let code = if result.failed_count > 0 { 1 } else { 0 };

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "已删除会话：{} 个，日志 {} 条，释放 {}，失败 {} 个",
                    result.deleted_threads,
                    result.deleted_logs,
                    format_size(result.released_size),
                    result.failed_count
                );
                for item in result.items {
                    let status = if item.success { "成功" } else { "失败" };
                    println!(
                        "{}\t{}\t{}",
                        status,
                        item.title,
                        item.error
                            .unwrap_or_else(|| format_size(item.released_size))
                    );
                }
            }

            Ok(code)
        }
        _ => Err(fail(2, format!("未知 agents 子命令：{subcommand}"))),
    }
}

fn run_packages_command(options: &GlobalOptions, args: &[String]) -> CliResult<i32> {
    let Some(subcommand) = args.first().map(String::as_str) else {
        print_packages_help();
        return Ok(0);
    };

    match subcommand {
        "list" | "scan" => {
            let include_system = parse_package_list_args(&args[1..])?;
            let result = scan_installed_packages_without_icons(include_system)
                .map_err(|err| fail(1, err))?;

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "软件包：{} 个，合计 {}",
                    result.total_count,
                    format_size(result.total_size)
                );
                for manager in result.managers {
                    let status = if manager.available {
                        "可用"
                    } else {
                        "不可用"
                    };
                    println!("{}：{} ({})", manager.name, status, manager.command);
                }
                for package in result.packages {
                    println!(
                        "{}\t{}\t{}\t{}",
                        package.id,
                        package.name,
                        package.version,
                        format_size(package.size)
                    );
                }
            }

            Ok(0)
        }
        "uninstall" => {
            let params = parse_ids_and_yes(&args[1..], "packages uninstall")?;
            require_yes(params.yes, "packages uninstall")?;
            let result = uninstall_selected_packages(&params.ids).map_err(|err| fail(1, err))?;
            let code = if result.failed_count > 0 { 1 } else { 0 };

            if options.json {
                print_json(&result)?;
            } else {
                println!(
                    "已卸载：{} 个，释放 {}，失败 {} 个",
                    result.removed_count,
                    format_size(result.released_size),
                    result.failed_count
                );
                for item in result.items {
                    let status = if item.success { "成功" } else { "失败" };
                    println!(
                        "{}\t{}\t{}",
                        status,
                        item.name,
                        item.error
                            .unwrap_or_else(|| format_size(item.released_size))
                    );
                }
            }

            Ok(code)
        }
        _ => Err(fail(2, format!("未知 packages 子命令：{subcommand}"))),
    }
}

struct IdsAndYes {
    ids: Vec<String>,
    yes: bool,
}

struct PathsAndYes {
    paths: Vec<String>,
    yes: bool,
}

struct LargeFileArgs {
    min_size: Option<u64>,
    limit: Option<usize>,
}

struct DuplicateFileArgs {
    min_size: Option<u64>,
    group_limit: Option<usize>,
}

fn parse_ids_and_yes(args: &[String], command: &str) -> CliResult<IdsAndYes> {
    let mut ids = Vec::new();
    let mut yes = false;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--yes" | "-y" => yes = true,
            "--id" | "--ids" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, format!("{command} 的 --ids 需要参数。")));
                };
                push_csv_values(&mut ids, value);
            }
            value if value.starts_with("--ids=") => {
                push_csv_values(&mut ids, value.trim_start_matches("--ids="));
            }
            value if value.starts_with("--id=") => {
                push_csv_values(&mut ids, value.trim_start_matches("--id="));
            }
            other => return Err(fail(2, format!("{command} 不支持参数：{other}"))),
        }

        index += 1;
    }

    if ids.is_empty() {
        return Err(fail(2, format!("{command} 需要 --ids 参数。")));
    }

    Ok(IdsAndYes { ids, yes })
}

fn parse_paths_and_yes(args: &[String], command: &str) -> CliResult<PathsAndYes> {
    let mut paths = Vec::new();
    let mut yes = false;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--yes" | "-y" => yes = true,
            "--path" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, format!("{command} 的 --path 需要参数。")));
                };
                paths.push(value.clone());
            }
            "--paths" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, format!("{command} 的 --paths 需要参数。")));
                };
                push_csv_values(&mut paths, value);
            }
            value if value.starts_with("--path=") => {
                paths.push(value.trim_start_matches("--path=").to_string());
            }
            value if value.starts_with("--paths=") => {
                push_csv_values(&mut paths, value.trim_start_matches("--paths="));
            }
            other => return Err(fail(2, format!("{command} 不支持参数：{other}"))),
        }

        index += 1;
    }

    if paths.is_empty() {
        return Err(fail(2, format!("{command} 需要 --path 或 --paths 参数。")));
    }

    Ok(PathsAndYes { paths, yes })
}

fn parse_large_file_args(args: &[String]) -> CliResult<LargeFileArgs> {
    let mut min_size = None;
    let mut limit = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--min-size" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, "files large 的 --min-size 需要参数。"));
                };
                min_size = Some(parse_size(value)?);
            }
            "--limit" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, "files large 的 --limit 需要参数。"));
                };
                limit = Some(parse_usize(value, "--limit")?);
            }
            value if value.starts_with("--min-size=") => {
                min_size = Some(parse_size(value.trim_start_matches("--min-size="))?);
            }
            value if value.starts_with("--limit=") => {
                limit = Some(parse_usize(
                    value.trim_start_matches("--limit="),
                    "--limit",
                )?);
            }
            other => return Err(fail(2, format!("files large 不支持参数：{other}"))),
        }

        index += 1;
    }

    Ok(LargeFileArgs { min_size, limit })
}

fn parse_duplicate_file_args(args: &[String]) -> CliResult<DuplicateFileArgs> {
    let mut min_size = None;
    let mut group_limit = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--min-size" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, "files duplicates 的 --min-size 需要参数。"));
                };
                min_size = Some(parse_size(value)?);
            }
            "--group-limit" | "--limit" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err(fail(2, "files duplicates 的 --group-limit 需要参数。"));
                };
                group_limit = Some(parse_usize(value, "--group-limit")?);
            }
            value if value.starts_with("--min-size=") => {
                min_size = Some(parse_size(value.trim_start_matches("--min-size="))?);
            }
            value if value.starts_with("--group-limit=") => {
                group_limit = Some(parse_usize(
                    value.trim_start_matches("--group-limit="),
                    "--group-limit",
                )?);
            }
            value if value.starts_with("--limit=") => {
                group_limit = Some(parse_usize(
                    value.trim_start_matches("--limit="),
                    "--limit",
                )?);
            }
            other => return Err(fail(2, format!("files duplicates 不支持参数：{other}"))),
        }

        index += 1;
    }

    Ok(DuplicateFileArgs {
        min_size,
        group_limit,
    })
}

fn parse_package_list_args(args: &[String]) -> CliResult<bool> {
    let mut include_system = false;

    for arg in args {
        match arg.as_str() {
            "--include-system" => include_system = true,
            other => return Err(fail(2, format!("packages list 不支持参数：{other}"))),
        }
    }

    Ok(include_system)
}

fn require_yes(yes: bool, command: &str) -> CliResult<()> {
    if yes {
        Ok(())
    } else {
        Err(fail(
            2,
            format!("{command} 会执行真实删除或卸载操作，请加 --yes 确认。"),
        ))
    }
}

fn ensure_no_args(args: &[String], command: &str) -> CliResult<()> {
    if args.is_empty() {
        Ok(())
    } else {
        Err(fail(2, format!("{command} 不支持参数：{}", args[0])))
    }
}

fn resolve_home(options: &GlobalOptions) -> CliResult<PathBuf> {
    if let Some(home) = options.home.clone() {
        std::env::set_var("HOME", &home);
        Ok(home)
    } else {
        home_dir().map_err(|err| fail(1, err))
    }
}

fn print_json<T: Serialize>(value: &T) -> CliResult<()> {
    let text = serde_json::to_string_pretty(value).map_err(|err| fail(1, err.to_string()))?;
    println!("{text}");
    Ok(())
}

fn print_cleanup_run_result(result: &crate::models::CleanupRunResult) {
    println!(
        "已清理：{} 个项目，释放 {}，删除 {} 个文件，失败 {} 个",
        result.items.len() as u64 - result.failed_count,
        format_size(result.released_size),
        result.deleted_files,
        result.failed_count
    );
    for item in &result.items {
        let status = if item.success { "成功" } else { "失败" };
        println!(
            "{}\t{}\t{}",
            status,
            item.name,
            item.error
                .clone()
                .unwrap_or_else(|| format_size(item.released_size))
        );
    }
}

fn print_help(command: &[String]) {
    match command.first().map(String::as_str) {
        Some("cleanup") => print_cleanup_help(),
        Some("files") => print_files_help(),
        Some("agents") => print_agents_help(),
        Some("packages") => print_packages_help(),
        _ => print_general_help(),
    }
}

fn print_general_help() {
    println!(
        "\
Skiff CLI

用法：
  skiff [--home <path>] [--json] <command>

命令：
  info
  disk
  cleanup scan
  cleanup run --ids <id,id> --yes
  files large [--min-size 500M] [--limit 80]
  files duplicates [--min-size 10M] [--group-limit 40]
  files delete --path <path> --yes
  agents scan
  agents clean --ids <id,id> --yes
  packages scan [--include-system]
  packages list [--include-system]
  packages uninstall --ids <id,id> --yes

全局参数：
  --home <path>  指定 HOME 目录
  --json         输出 JSON
  --help, -h     显示帮助
"
    );
}

fn print_cleanup_help() {
    println!(
        "\
Skiff cleanup

用法：
  skiff cleanup scan [--json]
  skiff cleanup run --ids <id,id> --yes [--json]
"
    );
}

fn print_files_help() {
    println!(
        "\
Skiff files

用法：
  skiff files large [--min-size 500M] [--limit 80] [--json]
  skiff files duplicates [--min-size 10M] [--group-limit 40] [--json]
  skiff files delete --path <path> --yes [--json]
"
    );
}

fn print_agents_help() {
    println!(
        "\
Skiff agents

用法：
  skiff agents scan [--json]
  skiff agents clean --ids <id,id> --yes [--json]
"
    );
}

fn print_packages_help() {
    println!(
        "\
Skiff packages

用法：
  skiff packages scan [--include-system] [--json]
  skiff packages list [--include-system] [--json]
  skiff packages uninstall --ids <id,id> --yes [--json]
"
    );
}

fn push_csv_values(values: &mut Vec<String>, text: &str) {
    values.extend(
        text.split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
    );
}

fn parse_usize(value: &str, name: &str) -> CliResult<usize> {
    value
        .parse::<usize>()
        .map_err(|_| fail(2, format!("{name} 需要正整数。")))
}

fn parse_size(value: &str) -> CliResult<u64> {
    let value = value.trim();
    if value.is_empty() {
        return Err(fail(2, "大小参数不能为空。"));
    }

    let number_len = value
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    if number_len == 0 {
        return Err(fail(2, format!("无效大小：{value}")));
    }

    let number = value[..number_len]
        .parse::<u64>()
        .map_err(|_| fail(2, format!("无效大小：{value}")))?;
    let suffix = value[number_len..].trim().to_ascii_lowercase();
    let multiplier = match suffix.as_str() {
        "" | "b" => 1,
        "k" | "kb" => 1024,
        "m" | "mb" => 1024 * 1024,
        "g" | "gb" => 1024 * 1024 * 1024,
        "t" | "tb" => 1024_u64.pow(4),
        _ => return Err(fail(2, format!("无效大小单位：{suffix}"))),
    };

    number
        .checked_mul(multiplier)
        .ok_or_else(|| fail(2, format!("大小超出范围：{value}")))
}

fn format_size(size: u64) -> String {
    if size >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", size as f64 / 1024.0 / 1024.0 / 1024.0)
    } else if size >= 1024 * 1024 {
        format!("{} MB", size / 1024 / 1024)
    } else if size >= 1024 {
        format!("{} KB", size / 1024)
    } else {
        format!("{size} B")
    }
}

fn fail(code: i32, message: impl Into<String>) -> CliError {
    CliError {
        code,
        message: message.into(),
    }
}
