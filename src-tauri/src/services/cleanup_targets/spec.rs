use std::path::PathBuf;

#[derive(Clone)]
pub(crate) struct CleanupTargetSpec {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) category: String,
    pub(crate) risk: String,
    pub(crate) description: String,
    pub(crate) paths: Vec<PathBuf>,
    pub(crate) commands: Vec<CleanupCommand>,
    pub(crate) clean_paths: bool,
    pub(crate) always_cleanable: bool,
}

#[derive(Clone)]
pub(crate) struct CleanupCommand {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) privileged: bool,
}

pub(crate) fn display_path_list(spec: &CleanupTargetSpec) -> Vec<String> {
    let mut paths = spec
        .paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();

    if paths.is_empty() {
        paths = spec.commands.iter().map(command_line).collect();
    }

    paths
}

pub(crate) fn display_paths_or_commands(spec: &CleanupTargetSpec) -> String {
    display_path_list(spec).join("\n")
}

fn command_line(command: &CleanupCommand) -> String {
    let args = command.args.join(" ");
    if args.is_empty() {
        command.command.clone()
    } else {
        format!("{} {args}", command.command)
    }
}
