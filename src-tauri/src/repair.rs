#[cfg(windows)]
use serde::Serialize;
#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use tauri::ipc::Channel;
#[cfg(windows)]
use tauri::AppHandle;
#[cfg(windows)]
use tauri_plugin_updater::UpdaterExt;

#[cfg(windows)]
static REPAIR_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
struct RepairGuard;

#[cfg(windows)]
impl Drop for RepairGuard {
    fn drop(&mut self) {
        REPAIR_IN_PROGRESS.store(false, Ordering::Release);
    }
}

#[cfg(windows)]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairProgress {
    stage: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[cfg(windows)]
#[tauri::command]
pub async fn repair_app(app: AppHandle, on_event: Channel<RepairProgress>) -> Result<(), String> {
    REPAIR_IN_PROGRESS
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "JPOS đang thực hiện một lần sửa chữa khác.".to_string())?;
    let _guard = RepairGuard;

    let _ = on_event.send(RepairProgress {
        stage: "checking",
        downloaded_bytes: 0,
        total_bytes: None,
    });

    // The normal updater only accepts a newer release. Repair must also accept
    // the currently installed version so its signed installer can be run again.
    let updater = app
        .updater_builder()
        .version_comparator(|current, release| release.version >= current)
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Không thể khởi tạo bộ sửa chữa: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Không thể kiểm tra bản phát hành JPOS: {error}"))?
        .ok_or_else(|| "Không tìm thấy bản phát hành phù hợp để cài lại JPOS.".to_string())?;

    let mut downloaded_bytes = 0_u64;
    let download_events = on_event.clone();
    update
        .download_and_install(
            |chunk_length, total_bytes| {
                downloaded_bytes += chunk_length as u64;
                let _ = download_events.send(RepairProgress {
                    stage: "downloading",
                    downloaded_bytes,
                    total_bytes,
                });
            },
            || {
                let _ = on_event.send(RepairProgress {
                    stage: "installing",
                    downloaded_bytes: 0,
                    total_bytes: None,
                });
            },
        )
        .await
        .map_err(|error| format!("Không thể tải hoặc cài lại JPOS: {error}"))?;

    Ok(())
}
