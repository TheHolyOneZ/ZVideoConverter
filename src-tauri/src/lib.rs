mod commands;
mod state;
mod taskbar;
mod watch;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths: Vec<String> = argv
                .iter()
                .skip(1)
                .map(|a| {
                    let p = PathBuf::from(a);
                    if p.is_absolute() { p } else { PathBuf::from(&cwd).join(p) }
                })
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit(commands::OPEN_EVENT, paths);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let portable = std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|d| d.to_path_buf()))
                .filter(|dir| dir.join("portable").exists() || dir.join("portable.txt").exists())
                .map(|dir| dir.join("data"));
            let (config, data, cache) = match &portable {
                Some(root) => (root.join("config"), root.join("data"), root.join("cache")),
                None => {
                    let p = app.path();
                    (p.app_config_dir()?, p.app_data_dir()?, p.app_cache_dir()?)
                }
            };
            app.manage(AppState::new(config, data, cache));

            let conf = app.config().app.windows.first().cloned().ok_or("no window config")?;
            let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &conf)?;
            if let Some(root) = &portable {
                builder = builder.data_directory(root.join("webview"));
            }
            builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::startup_paths,
            commands::ffmpeg_status,
            commands::ffmpeg_download,
            commands::ffmpeg_download_cancel,
            commands::hw_info,
            commands::expand_paths,
            commands::probe_file,
            commands::thumbnail,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::duplicate_profile,
            commands::reorder_profiles,
            commands::import_profile,
            commands::export_profile,
            commands::profile_warnings,
            commands::preview_jobs,
            commands::start_jobs,
            commands::cancel_job,
            commands::cancel_all,
            commands::set_paused,
            commands::set_parallel,
            commands::restore_original,
            commands::detect_crop,
            commands::preview_job,
            commands::save_session,
            commands::load_session,
            commands::remove_partials,
            commands::check_space,
            commands::power_action,
            commands::compare_frames,
            commands::set_watch_folders,
            commands::check_update,
            commands::make_samples,
            commands::remove_samples,
            taskbar::set_taskbar_progress,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZVideoConverter");
}
