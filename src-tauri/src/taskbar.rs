use tauri::AppHandle;
#[cfg(not(target_os = "linux"))]
use tauri::Manager;

#[cfg(target_os = "linux")]
mod unity {
    use std::collections::HashMap;
    use std::sync::OnceLock;

    use zbus::blocking::Connection;
    use zbus::zvariant::Value;

    static CONN: OnceLock<Option<Connection>> = OnceLock::new();

    pub fn update(desktop_file: &str, progress: Option<f64>, urgent: bool) {
        let Some(conn) = CONN.get_or_init(|| Connection::session().ok()) else { return };
        let uri = format!("application://{desktop_file}");
        let mut props: HashMap<&str, Value> = HashMap::new();
        props.insert("progress-visible", Value::Bool(progress.is_some()));
        props.insert("progress", Value::F64(progress.unwrap_or(0.0).clamp(0.0, 1.0)));
        props.insert("urgent", Value::Bool(urgent));
        let _ = conn.emit_signal(
            None::<()>,
            "/com/zlogic/zvideoconverter/launcherentry",
            "com.canonical.Unity.LauncherEntry",
            "Update",
            &(uri, props),
        );
    }
}

#[tauri::command]
pub fn set_taskbar_progress(app: AppHandle, progress: Option<f64>, paused: bool, error: bool) {
    #[cfg(target_os = "linux")]
    {
        let _ = paused;
        unity::update(&format!("{}.desktop", app.package_info().name), progress, error);
    }
    #[cfg(not(target_os = "linux"))]
    if let Some(w) = app.get_webview_window("main") {
        use tauri::window::{ProgressBarState, ProgressBarStatus};
        let status = match (progress, paused, error) {
            (None, _, _) => ProgressBarStatus::None,
            (_, true, _) => ProgressBarStatus::Paused,
            (_, _, true) => ProgressBarStatus::Error,
            _ => ProgressBarStatus::Normal,
        };
        let _ = w.set_progress_bar(ProgressBarState { status: Some(status), progress: progress.map(|p| (p * 100.0).round() as u64) });
    }
}
