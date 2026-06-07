// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().len() > 1 {
        std::process::exit(skiff_lib::run_cli(std::env::args()));
    }

    skiff_lib::run()
}
