use serde::{Deserialize, Serialize};
use std::sync::Mutex;

static DISPATCH_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum DrawerProtocol {
    Escpos,
    Tspl,
}

fn drawer_command(pin: u8, protocol: DrawerProtocol) -> Result<Vec<u8>, String> {
    match protocol {
        DrawerProtocol::Escpos => kick_command(pin).map(|bytes| bytes.to_vec()),
        DrawerProtocol::Tspl if pin == 2 => Ok(b"\r\nCASHDRAWER 0,25,250\r\n".to_vec()),
        DrawerProtocol::Tspl => {
            Err("Lệnh TSPL hiện hỗ trợ chân kích 2. Vui lòng chọn chân 2.".into())
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DrawerDispatch {
    printer_name: String,
    already_attempted: bool,
}

fn kick_command(pin: u8) -> Result<[u8; 5], String> {
    let channel = match pin {
        2 => 0,
        5 => 1,
        _ => return Err("Chân kích két chỉ có thể là 2 hoặc 5.".into()),
    };
    // ESC p: ON 50 ms, OFF 500 ms (units of 2 ms).
    Ok([0x1b, 0x70, channel, 25, 250])
}

fn claim_order(directory: &std::path::Path, order_id: &str) -> Result<bool, String> {
    if order_id.is_empty()
        || order_id.len() > 128
        || !order_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Mã đơn mở két không hợp lệ.".into());
    }
    std::fs::create_dir_all(directory).map_err(|e| format!("Không thể lưu lịch sử mở két: {e}"))?;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(order_id))
    {
        Ok(file) => {
            file.sync_all()
                .map_err(|e| format!("Không thể lưu lịch sử mở két: {e}"))?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("Không thể lưu lịch sử mở két: {e}")),
    }
}

fn assert_manual_permission(warehouse_id: &str) -> Result<(), String> {
    let cache = crate::secure_credential::load_pos_auth_session_cache()?
        .ok_or("Vui lòng đăng nhập trước khi mở két.")?;
    if !manual_permission_allowed(&cache.session, &cache.user_id, warehouse_id) {
        return Err("Bạn không có quyền mở két tiền tại điểm bán này.".into());
    }
    Ok(())
}

fn manual_permission_allowed(
    session: &serde_json::Value,
    user_id: &str,
    warehouse_id: &str,
) -> bool {
    let user = &session["user"];
    if user["status"] != "ACTIVE" || user["is_deleted"] != false || user["id"] != user_id {
        return false;
    }
    let has_warehouse = session["warehouses"]
        .as_array()
        .is_some_and(|warehouses| warehouses.iter().any(|w| w["id"] == warehouse_id));
    let permissions = &session["permissions"];
    let allowed = ["global", warehouse_id].into_iter().any(|scope| {
        permissions[scope]["*"] == true || permissions[scope]["pos.cash_drawer.open"] == true
    });
    allowed && has_warehouse && !warehouse_id.is_empty()
}

#[cfg(windows)]
fn send_raw(printer_name: &str, bytes: &[u8]) -> Result<(), String> {
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::Graphics::Printing::{
            AbortPrinter, ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW,
            StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_HANDLE,
        },
    };
    let name: Vec<u16> = printer_name.encode_utf16().chain(Some(0)).collect();
    let mut handle = PRINTER_HANDLE::default();
    unsafe { OpenPrinterW(PCWSTR(name.as_ptr()), &mut handle, None) }
        .map_err(|e| format!("Không thể kết nối máy in điều khiển két: {e}"))?;
    let mut title: Vec<u16> = "JPOS - Mở két tiền".encode_utf16().chain(Some(0)).collect();
    let mut datatype: Vec<u16> = "RAW".encode_utf16().chain(Some(0)).collect();
    let doc = DOC_INFO_1W {
        pDocName: PWSTR(title.as_mut_ptr()),
        pOutputFile: PWSTR::null(),
        pDatatype: PWSTR(datatype.as_mut_ptr()),
    };
    let result = (|| {
        if unsafe { StartDocPrinterW(handle, 1, &doc) } == 0 {
            return Err("Driver không nhận lệnh mở két. Vui lòng kiểm tra máy in.".into());
        }
        if !unsafe { StartPagePrinter(handle) }.as_bool() {
            return Err("Không thể bắt đầu gửi lệnh mở két.".into());
        }
        let mut written = 0;
        if !unsafe {
            WritePrinter(
                handle,
                bytes.as_ptr().cast(),
                bytes.len() as u32,
                &mut written,
            )
        }
        .as_bool()
            || written != bytes.len() as u32
        {
            return Err("Không thể gửi đủ lệnh mở két tới máy in.".into());
        }
        if !unsafe { EndPagePrinter(handle) }.as_bool()
            || !unsafe { EndDocPrinter(handle) }.as_bool()
        {
            return Err("Máy in chưa xác nhận nhận lệnh mở két.".into());
        }
        Ok(())
    })();
    if result.is_err() {
        unsafe {
            let _ = AbortPrinter(handle);
        }
    }
    unsafe {
        let _ = ClosePrinter(handle);
    }
    result
}

#[cfg(not(windows))]
fn send_raw(_printer_name: &str, _bytes: &[u8]) -> Result<(), String> {
    Err("Mở két tiền chỉ hỗ trợ JPOS desktop trên Windows.".into())
}

#[tauri::command]
pub(crate) async fn open_cash_drawer(
    app: tauri::AppHandle,
    window: tauri::Window,
    printer_name: String,
    pin: u8,
    protocol: Option<DrawerProtocol>,
    warehouse_id: String,
    order_id: Option<String>,
) -> Result<DrawerDispatch, String> {
    use tauri::Manager;
    if window.label() != "main" {
        return Err("Chỉ màn hình thu ngân được điều khiển két tiền.".into());
    }
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Không thể đọc thư mục lịch sử mở két: {e}"))?
        .join("cash-drawer-attempts");
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DISPATCH_LOCK
            .lock()
            .map_err(|_| "Không thể khóa tác vụ mở két.")?;
        let bytes = drawer_command(pin, protocol.unwrap_or(DrawerProtocol::Escpos))?;
        if order_id.is_none() {
            assert_manual_permission(&warehouse_id)?;
        }
        // Claim before dispatch: an uncertain or failed dispatch is never retried automatically.
        if let Some(id) = order_id.as_deref() {
            if !claim_order(&directory, id)? {
                return Ok(DrawerDispatch {
                    printer_name,
                    already_attempted: true,
                });
            }
        }
        let printers = crate::printer::list_printers()?;
        let selected = printers
            .iter()
            .find(|p| p.name == printer_name)
            .ok_or("Không tìm thấy máy in điều khiển két đã chọn.")?;
        if !selected.is_available
            || !matches!(
                selected.status,
                crate::printer::PrinterStatus::Ready | crate::printer::PrinterStatus::Busy
            )
        {
            return Err("Máy in điều khiển két chưa sẵn sàng. Vui lòng kiểm tra kết nối.".into());
        }
        send_raw(&printer_name, &bytes)?;
        Ok(DrawerDispatch {
            printer_name,
            already_attempted: false,
        })
    })
    .await
    .map_err(|e| format!("Tác vụ mở két thất bại: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_correct_pin_and_pulse() {
        assert_eq!(kick_command(2).unwrap(), [27, 112, 0, 25, 250]);
        assert_eq!(kick_command(5).unwrap(), [27, 112, 1, 25, 250]);
        assert!(kick_command(3).is_err());
    }

    #[test]
    fn keeps_escpos_and_adds_the_tspl_command_tested_on_365b() {
        assert_eq!(
            drawer_command(2, DrawerProtocol::Escpos).unwrap(),
            [27, 112, 0, 25, 250]
        );
        assert_eq!(
            drawer_command(5, DrawerProtocol::Escpos).unwrap(),
            [27, 112, 1, 25, 250]
        );
        assert_eq!(
            drawer_command(2, DrawerProtocol::Tspl).unwrap(),
            b"\r\nCASHDRAWER 0,25,250\r\n"
        );
        assert!(drawer_command(5, DrawerProtocol::Tspl).is_err());
    }

    #[test]
    fn manual_open_requires_active_user_and_permission_in_current_scope() {
        let mut session = serde_json::json!({
            "user": { "id": "u1", "status": "ACTIVE", "is_deleted": false },
            "warehouses": [{ "id": "w1" }, { "id": "w2" }],
            "permissions": { "w1": { "pos.cash_drawer.open": true } }
        });
        assert!(manual_permission_allowed(&session, "u1", "w1"));
        assert!(!manual_permission_allowed(&session, "u1", "w2"));
        assert!(!manual_permission_allowed(&session, "u2", "w1"));
        session["permissions"] = serde_json::json!({ "global": { "*": true } });
        assert!(manual_permission_allowed(&session, "u1", "w2"));
        assert!(!manual_permission_allowed(&session, "u1", "w3"));
        session["user"]["status"] = serde_json::json!("SUSPENDED");
        assert!(!manual_permission_allowed(&session, "u1", "w1"));
    }

    #[test]
    fn claims_each_order_once_across_dispatches() {
        let dir = std::env::temp_dir().join(format!("jpos-drawer-test-{}", uuid::Uuid::new_v4()));
        assert!(claim_order(&dir, "JPOS-123").unwrap());
        assert!(!claim_order(&dir, "JPOS-123").unwrap());
        assert!(claim_order(&dir, "JPOS-124").unwrap());
        assert!(claim_order(&dir, "../escape").is_err());
        std::fs::remove_file(dir.join("JPOS-123")).unwrap();
        std::fs::remove_file(dir.join("JPOS-124")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
