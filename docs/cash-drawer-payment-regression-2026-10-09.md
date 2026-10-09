# Hồi quy két tiền và phạm vi thanh toán — 09/10/2026

## Kết luận trong phạm vi đã kiểm thử

Các file thanh toán của JPOS giống `origin/main`: trang thu ngân, CheckoutModal,
cart store, PayOS store/service/controller, bán gói thành viên, reconciliation
monitor và toàn bộ `functions/`. Callback xác minh thiết bị và đồng bộ cấu hình
chung cũng được trả về nguyên bản `main`. Không đổi giá/tổng tiền, phương thức
thanh toán, trạng thái đơn, QR, chữ ký webhook hoặc logic ghi nhận doanh thu.

Các thay đổi chạy trên client nằm ở module két tiền và một component đồng bộ
riêng gắn vào layout. Lỗi bind thiết bị/lưu cache/cảnh báo két được bắt riêng.
Cache chưa xác minh thiết bị không được bật tự mở két. Máy chưa có cấu hình
tập trung giữ cấu hình local. Không đặt đồng bộ két trong luồng thanh toán.

JPULSE có bổ sung phòng lỗi cho phép đọc cấu hình két: chỉ đọc khi client có
`known_versions.cash_drawer_settings`. Client cũ không thêm truy vấn két;
truy vấn két lỗi không làm lỗi hoặc xóa cấu hình QR/thanh toán trong response.
Phòng lỗi này có kiểm thử riêng và chưa tự deploy vào production ở lượt QA này.

## Kết quả

| Nhóm | Đạt |
| --- | --- |
| JPOS unit/hồi quy source callback | 66/66 |
| Functions unit/policy | 118/118 |
| Transaction/webhook/reconciliation trên emulator, provider giả | 43/43 |
| Rust, bao gồm lệnh két và chống lặp theo mã đơn | 7/7 |
| JPULSE config: lỗi đọc két, client cũ, client chủ động yêu cầu két | 3/3 |

Build JPOS, TypeScript và ESLint của phần thay đổi đã đạt.

Kiểm thử hồi quy gọi callback lấy trực tiếp từ source thu ngân và bán gói,
kết hợp cart store thực tế với backend/printer adapter giả: tiền mặt thành
công vẫn xóa giỏ/in bill khi két lỗi hoặc lệnh két chưa trả về; thanh toán lỗi
giữ giỏ và không mở két/in; PayOS và gói QR không mở két; lỗi cache/toast két
không làm reject thao tác đã thanh toán.

Emulator kiểm tra số tiền/mã đơn/currency sai, chữ ký thiếu/sai, 10 xác nhận
đồng thời, webhook phát lại, lịch sử attempt, quyền mở subscription, QR hết hạn,
đối soát và backfill chỉ trên dữ liệu demo. Đã hiệu chỉnh cấu hình harness nạp
rules và đường dẫn script khi sao chép test sang thư mục tạm; không sửa assertion
hoặc logic thanh toán để làm test qua.

## Cách ly và giới hạn

Project emulator `demo-pos-payment`, chỉ loopback, không chạy Functions emulator
hay worker đồng bộ đơn lên production. Provider giả dùng dữ liệu/chữ ký tổng
hợp. Không đọc secrets test PayOS riêng, không tạo QR thật, không chuyển tiền
hoặc ghi doanh thu production. Các test gốc trong `functions/test` không đổi;
bản sao tạm chỉ điều chỉnh cổng loopback, đường dẫn import và script QA.

Đây không phải một giao dịch ngân hàng thật hoặc kiểm thử đầy đủ UI Tauri với
máy in/két vật lý. Không khẳng định mọi tình huống vận hành đã được bao phủ.
Lượt này chưa merge JPOS vào main, chưa tăng version và chưa release.
