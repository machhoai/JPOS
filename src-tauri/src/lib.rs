// =============================================================================
// Tauri Backend — Khởi tạo ứng dụng và quản lý màn hình khách
// =============================================================================

use serde::Serialize;
mod card_reader;
mod cash_drawer;
mod printer;
#[cfg(windows)]
mod repair;
mod secure_credential;
#[cfg(windows)]
use std::{sync::mpsc, time::Duration};
use tauri::{
    window::Monitor, AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder,
};
#[cfg(windows)]
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_16,
        COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE, COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
    },
    PrintCompletedHandler,
};
#[cfg(windows)]
use windows::core::{Interface, HSTRING};

const MAIN_WINDOW_LABEL: &str = "main";
const CUSTOMER_DISPLAY_LABEL: &str = "customer-display";
const CUSTOMER_DISPLAY_WARNING_EVENT: &str = "customer-display-warning";
const NO_SECONDARY_MONITOR_WARNING: &str =
    "Không tìm thấy màn hình phụ. Màn hình khách chưa được mở để tránh che giao diện thu ngân.";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CustomerDisplayOpenStatus {
    Opened,
    AlreadyOpen,
    NoSecondaryMonitor,
}

fn is_same_monitor(left: &Monitor, right: &Monitor) -> bool {
    let left_position = left.position();
    let right_position = right.position();
    let left_size = left.size();
    let right_size = right.size();

    left_position.x == right_position.x
        && left_position.y == right_position.y
        && left_size.width == right_size.width
        && left_size.height == right_size.height
}

fn find_secondary_monitor(app: &AppHandle) -> Result<Option<Monitor>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if monitors.len() < 2 {
        return Ok(None);
    }

    let reference_monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| {
            app.get_webview_window(MAIN_WINDOW_LABEL)
                .and_then(|window| window.current_monitor().ok().flatten())
        });

    let Some(reference_monitor) = reference_monitor else {
        return Ok(None);
    };

    Ok(monitors
        .into_iter()
        .find(|monitor| !is_same_monitor(monitor, &reference_monitor)))
}

fn monitor_logical_position(monitor: &Monitor) -> LogicalPosition<f64> {
    let position = monitor.position();
    let scale_factor = monitor.scale_factor();

    LogicalPosition::new(
        f64::from(position.x) / scale_factor,
        f64::from(position.y) / scale_factor,
    )
}

fn focus_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window.set_focus().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn notify_main_window(app: &AppHandle, message: &str) {
    eprintln!("[Màn hình khách] {message}");
    if let Err(error) = app.emit_to(MAIN_WINDOW_LABEL, CUSTOMER_DISPLAY_WARNING_EVENT, message) {
        eprintln!("[Màn hình khách] Không thể gửi cảnh báo tới cửa sổ chính: {error}");
    }
}

fn position_existing_window(
    window: &tauri::WebviewWindow,
    monitor: &Monitor,
) -> Result<(), String> {
    let current_monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?;
    let is_on_target = current_monitor
        .as_ref()
        .map(|current| is_same_monitor(current, monitor))
        .unwrap_or(false);
    let is_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;

    window
        .set_decorations(false)
        .map_err(|error| error.to_string())?;

    if !is_on_target || !is_fullscreen {
        window
            .set_fullscreen(false)
            .map_err(|error| error.to_string())?;
        window
            .set_position(monitor_logical_position(monitor))
            .map_err(|error| error.to_string())?;
        window
            .set_fullscreen(true)
            .map_err(|error| error.to_string())?;
    }

    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_customer_display(app: &AppHandle) -> Result<CustomerDisplayOpenStatus, String> {
    let Some(secondary_monitor) = find_secondary_monitor(app)? else {
        if let Some(window) = app.get_webview_window(CUSTOMER_DISPLAY_LABEL) {
            window.hide().map_err(|error| error.to_string())?;
        }
        focus_main_window(app)?;
        return Ok(CustomerDisplayOpenStatus::NoSecondaryMonitor);
    };

    if let Some(window) = app.get_webview_window(CUSTOMER_DISPLAY_LABEL) {
        position_existing_window(&window, &secondary_monitor)?;
        focus_main_window(app)?;
        return Ok(CustomerDisplayOpenStatus::AlreadyOpen);
    }

    let position = monitor_logical_position(&secondary_monitor);
    let size = secondary_monitor.size();
    let scale_factor = secondary_monitor.scale_factor();
    let window = WebviewWindowBuilder::new(
        app,
        CUSTOMER_DISPLAY_LABEL,
        WebviewUrl::App("/display".into()),
    )
    .title("Màn hình khách hàng")
    .position(position.x, position.y)
    .inner_size(
        f64::from(size.width) / scale_factor,
        f64::from(size.height) / scale_factor,
    )
    .resizable(false)
    .decorations(false)
    .focused(false)
    .always_on_top(false)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;

    window
        .set_fullscreen(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    focus_main_window(app)?;

    Ok(CustomerDisplayOpenStatus::Opened)
}

/// Mở hoặc khôi phục màn hình khách trên monitor phụ theo hướng idempotent.
#[tauri::command]
async fn open_customer_display(app: AppHandle) -> Result<CustomerDisplayOpenStatus, String> {
    let status = ensure_customer_display(&app)?;
    if matches!(status, CustomerDisplayOpenStatus::NoSecondaryMonitor) {
        notify_main_window(&app, NO_SECONDARY_MONITOR_WARNING);
    }
    Ok(status)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintDispatchResult {
    requested_printer_name: Option<String>,
    effective_printer_name: String,
    used_fallback: bool,
}

#[cfg(windows)]
enum DirectPrintError {
    PrinterUnavailable,
    Other(String),
}

#[cfg(windows)]
impl DirectPrintError {
    fn message(self, printer_name: &str) -> String {
        match self {
            Self::PrinterUnavailable => {
                format!("Máy in “{printer_name}” không khả dụng.")
            }
            Self::Other(message) => message,
        }
    }
}

#[cfg(windows)]
async fn print_webview_once(
    webview: tauri::WebviewWindow,
    page_width_mm: f64,
    page_height_mm: f64,
    printer_name: String,
) -> Result<(), DirectPrintError> {
    let (result_sender, result_receiver) = mpsc::channel::<Result<(), DirectPrintError>>();
    let setup_sender = result_sender.clone();
    let page_width_inches = page_width_mm / 25.4;
    let page_height_inches = page_height_mm / 25.4;

    webview
        .with_webview(move |platform_webview| {
            let setup_result = (|| -> Result<(), DirectPrintError> {
                let controller = platform_webview.controller();
                let core_webview = unsafe { controller.CoreWebView2() }.map_err(|error| {
                    DirectPrintError::Other(format!("Không thể truy cập WebView2: {error}"))
                })?;
                let printable_webview: ICoreWebView2_16 = core_webview.cast().map_err(|error| {
                    DirectPrintError::Other(format!("WebView2 chưa hỗ trợ in trực tiếp: {error}"))
                })?;
                let print_environment: ICoreWebView2Environment6 =
                    platform_webview.environment().cast().map_err(|error| {
                        DirectPrintError::Other(format!("Không thể khởi tạo cấu hình in: {error}"))
                    })?;
                let print_settings =
                    unsafe { print_environment.CreatePrintSettings() }.map_err(|error| {
                        DirectPrintError::Other(format!("Không thể tạo cấu hình in: {error}"))
                    })?;
                let targeted_settings: ICoreWebView2PrintSettings2 =
                    print_settings.cast().map_err(|error| {
                        DirectPrintError::Other(format!(
                            "WebView2 chưa hỗ trợ chọn máy in: {error}"
                        ))
                    })?;

                unsafe {
                    targeted_settings
                        .SetPrinterName(&HSTRING::from(&printer_name))
                        .map_err(|error| {
                            DirectPrintError::Other(format!(
                                "Không thể chọn máy in “{printer_name}”: {error}"
                            ))
                        })?;
                    targeted_settings
                        .SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)
                        .map_err(|error| {
                            DirectPrintError::Other(format!(
                                "Không thể chọn khổ giấy tùy chỉnh cho máy in “{printer_name}”: {error}"
                            ))
                        })?;
                    print_settings
                        .SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetScaleFactor(1.0)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetPageWidth(page_width_inches)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetPageHeight(page_height_inches)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetMarginTop(0.0)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetMarginBottom(0.0)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetMarginLeft(0.0)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetMarginRight(0.0)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetShouldPrintSelectionOnly(false)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                    print_settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|error| DirectPrintError::Other(error.to_string()))?;
                }

                let callback_sender = result_sender.clone();
                let handler =
                    PrintCompletedHandler::create(Box::new(move |error_code, print_status| {
                        let outcome = match error_code {
                            Err(error) => Err(DirectPrintError::Other(format!(
                                "Lệnh in WebView2 thất bại: {error}"
                            ))),
                            Ok(()) if print_status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED => Ok(()),
                            Ok(())
                                if print_status
                                    == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE =>
                            {
                                Err(DirectPrintError::PrinterUnavailable)
                            }
                            Ok(()) => Err(DirectPrintError::Other(
                                "Windows không thể hoàn tất lệnh in.".to_string(),
                            )),
                        };
                        let _ = callback_sender.send(outcome);
                        Ok(())
                    }));

                unsafe { printable_webview.Print(&print_settings, &handler) }.map_err(|error| {
                    DirectPrintError::Other(format!(
                        "Không thể gửi lệnh tới máy in “{printer_name}”: {error}"
                    ))
                })?;
                Ok(())
            })();

            if let Err(error) = setup_result {
                let _ = setup_sender.send(Err(error));
            }
        })
        .map_err(|error| {
            DirectPrintError::Other(format!("Không thể truy cập cửa sổ in: {error}"))
        })?;

    tauri::async_runtime::spawn_blocking(move || {
        result_receiver.recv_timeout(Duration::from_secs(30))
    })
    .await
    .map_err(|error| DirectPrintError::Other(format!("Tiến trình in bị gián đoạn: {error}")))?
    .map_err(|_| DirectPrintError::Other("Máy in không phản hồi sau 30 giây.".to_string()))?
}

/// In nội dung hiện tại của WebView tới máy in đã cấu hình, không mở hộp thoại Windows.
#[tauri::command]
async fn print_receipt_silent(
    webview: tauri::WebviewWindow,
    page_width_mm: f64,
    page_height_mm: f64,
    printer_name: Option<String>,
) -> Result<PrintDispatchResult, String> {
    if !(40.0..=100.0).contains(&page_width_mm) {
        return Err("Khổ giấy in không hợp lệ.".to_string());
    }
    if !(20.0..=2_000.0).contains(&page_height_mm) {
        return Err("Chiều dài biên lai không hợp lệ.".to_string());
    }

    #[cfg(windows)]
    {
        let resolution = printer::resolve_printer(printer_name)?;
        let first_printer = resolution.effective_name.clone();
        let first_result = print_webview_once(
            webview.clone(),
            page_width_mm,
            page_height_mm,
            first_printer.clone(),
        )
        .await;

        match first_result {
            Ok(()) => {
                eprintln!("[In] Đã gửi tài liệu tới máy in “{first_printer}”.");
                return Ok(PrintDispatchResult {
                    requested_printer_name: resolution.requested_name,
                    effective_printer_name: first_printer,
                    used_fallback: resolution.used_fallback,
                });
            }
            Err(DirectPrintError::PrinterUnavailable) if !resolution.used_fallback => {
                if let Some(fallback_name) = printer::find_default_fallback(&first_printer)
                    .map_err(|error| format!("Máy in “{first_printer}” mất kết nối. {error}"))?
                {
                    print_webview_once(
                        webview,
                        page_width_mm,
                        page_height_mm,
                        fallback_name.clone(),
                    )
                    .await
                    .map_err(|error| error.message(&fallback_name))?;
                    eprintln!(
                        "[In] Máy in “{first_printer}” mất kết nối; đã chuyển sang “{fallback_name}”."
                    );
                    return Ok(PrintDispatchResult {
                        requested_printer_name: resolution.requested_name,
                        effective_printer_name: fallback_name,
                        used_fallback: true,
                    });
                }
            }
            Err(error) => return Err(error.message(&first_printer)),
        }

        Err(format!(
            "Máy in “{first_printer}” mất kết nối và máy in mặc định của Windows không khả dụng."
        ))
    }

    #[cfg(not(windows))]
    {
        let _ = (webview, printer_name);
        Err("In trực tiếp hiện chỉ hỗ trợ ứng dụng POS trên Windows.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL
                || !matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                return;
            }

            let app = window.app_handle();
            if let Some(customer_display) = app.get_webview_window(CUSTOMER_DISPLAY_LABEL) {
                if let Err(error) = customer_display.close() {
                    eprintln!(
                        "[Màn hình khách] Không thể đóng cửa sổ phụ trước khi thoát: {error}"
                    );
                }
            }

            // Kết thúc toàn bộ tiến trình để mọi WebView và tác vụ nền cùng được dọn dẹp.
            app.exit(0);
        })
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            match ensure_customer_display(app.handle()) {
                Ok(CustomerDisplayOpenStatus::NoSecondaryMonitor) => {
                    notify_main_window(app.handle(), NO_SECONDARY_MONITOR_WARNING);
                }
                Ok(_) => {}
                Err(error) => {
                    eprintln!("[Màn hình khách] Không thể mở cửa sổ: {error}");
                    notify_main_window(
                        app.handle(),
                        "Không thể mở màn hình khách. Vui lòng kiểm tra kết nối màn hình và thử lại.",
                    );
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_customer_display,
            printer::list_printers,
            cash_drawer::open_cash_drawer,
            print_receipt_silent,
            card_reader::read_member_card,
            card_reader::cancel_member_card_read,
            #[cfg(windows)]
            repair::repair_app,
            secure_credential::get_or_create_pos_installation_id,
            secure_credential::save_pos_device_credential,
            secure_credential::load_pos_device_credential,
            secure_credential::clear_pos_device_credential,
            secure_credential::save_pos_auth_session_cache,
            secure_credential::load_pos_auth_session_cache,
            secure_credential::clear_pos_auth_session_cache
        ])
        .run(tauri::generate_context!())
        .expect("Không thể khởi chạy ứng dụng Tauri");
}
