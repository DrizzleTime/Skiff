use crate::{
    models::LanguagePreference,
    services::{settings::read_settings, system::home_dir},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const TRAY_ID: &str = "skiff-tray";
const SHOW_ID: &str = "tray-show";
const HIDE_ID: &str = "tray-hide";
const QUIT_ID: &str = "tray-quit";

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_tray_menu(app, current_language_preference())?;

    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(icon)
        .show_menu_on_left_click(false)
        .tooltip("Skiff")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => show_main_window(app),
            HIDE_ID => hide_main_window(app),
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn refresh_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    language: LanguagePreference,
) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app, language)?;
        tray.set_menu(Some(menu))?;
    }

    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    language: LanguagePreference,
) -> tauri::Result<Menu<R>> {
    let labels = tray_labels(language);

    MenuBuilder::new(app)
        .text(SHOW_ID, labels.show)
        .text(HIDE_ID, labels.hide)
        .separator()
        .text(QUIT_ID, labels.quit)
        .build()
}

fn current_language_preference() -> LanguagePreference {
    let Ok(home) = home_dir() else {
        return LanguagePreference::System;
    };

    read_settings(&home)
        .map(|settings| settings.language)
        .unwrap_or(LanguagePreference::System)
}

fn tray_labels(language: LanguagePreference) -> TrayLabels {
    match resolve_language(language) {
        ResolvedLanguage::ZhCn => TrayLabels {
            show: "显示 Skiff",
            hide: "隐藏窗口",
            quit: "退出 Skiff",
        },
        ResolvedLanguage::EnUs => TrayLabels {
            show: "Show Skiff",
            hide: "Hide window",
            quit: "Quit Skiff",
        },
    }
}

fn resolve_language(language: LanguagePreference) -> ResolvedLanguage {
    match language {
        LanguagePreference::ZhCn => ResolvedLanguage::ZhCn,
        LanguagePreference::EnUs => ResolvedLanguage::EnUs,
        LanguagePreference::System => {
            let system_locale = std::env::var("LC_ALL")
                .ok()
                .filter(|value| !value.is_empty())
                .or_else(|| std::env::var("LANG").ok())
                .unwrap_or_default()
                .to_lowercase();

            if system_locale.starts_with("zh") {
                ResolvedLanguage::ZhCn
            } else {
                ResolvedLanguage::EnUs
            }
        }
    }
}

struct TrayLabels {
    show: &'static str,
    hide: &'static str,
    quit: &'static str,
}

enum ResolvedLanguage {
    ZhCn,
    EnUs,
}

pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
