# Production release JPOS 0.1.60 — 06/10/2026

Firebase: **jw-system-f2104**. Commit release: **8241a8c**. Tag: **jpos-v0.1.60**.

## Backend và rollout

| Function | Revision sau deploy | Trạng thái |
|---|---|---|
| payosPayment | payospayment-00026-kom | ACTIVE |
| payosWebhook | payoswebhook-00021-dig | ACTIVE |
| getPosAuthSession | getposauthsession-00060-vav | ACTIVE |

Cả ba function giữ minInstances 0, maxInstances 20. Đã đối chiếu giá trị secret đang bind với bộ khóa PayOS test, không trùng; không ghi hoặc thay secret production. Không có cấu hình test trong compiled backend hoặc source frontend production.

Đã bật duy nhất field payment_latency_optimization_enabled cho **6/6 máy production ACTIVE**, theo yêu cầu người dùng. Trạng thái cờ trước rollout được lưu riêng trong .firebase/production-release-0.1.60/rollout.private.json; cập nhật dùng precondition updateTime. Shared Firestore rules giữ nguyên ruleset 1ebf1f03-0f09-4b37-9b59-15dfa32250c0, có fragment realtime đã hợp nhất. Không deploy rules POS riêng.

## Kiểm chứng

115 kiểm thử backend và 41 kiểm thử frontend đạt. Bốn readiness probe production đạt: webhook GET 405, chữ ký sai 400, payment và session/prepare-order thiếu credential thiết bị 403 PERMISSION_DENIED. Các probe không gửi thông tin đăng nhập, không tạo đơn/QR và không sửa doanh thu.

Người dùng đã manual test JPOS Test thành công trước khi yêu cầu release. Đường doanh thu thật trên toàn bộ production chưa được tái diễn bằng giao dịch benchmark trong lần phát hành này.

## Cold start quan sát tại production

- `payospayment-00026-kom`: 2493 ms từ “Starting new instance” đến TCP startup probe thành công.
- `payoswebhook-00021-dig`: 2408 ms từ “Starting new instance” đến TCP startup probe thành công.
- `getposauthsession-00060-vav`: 2120 ms từ “Starting new instance” đến TCP startup probe thành công.

Mỗi số đo trên là **một container boot do deploy**, lấy từ system log và ghép đúng instance. Đây là thời gian khởi động container; không phải thời gian chọn chuyển khoản → QR, không phải phép đo extra cold-vs-warm của giao dịch đầu tiên, và chưa bao gồm thời gian mạng/xử lý giao dịch. Phép đo paired cold-vs-warm và chuyển tiền thật trên Firebase test được ghi riêng trong báo cáo QA cloud.

## Bộ cài và updater

[GitHub Release](https://github.com/machhoai/JPOS/releases/tag/jpos-v0.1.60) đã phát hành. Installer: JPOS_0.1.60_x64-setup.exe (44863096 bytes). SHA-256: 075d61ace3308af667553d7dc57ee88dd04d4e292f9e6071c1600349b61d0ee6.

Đã xác minh chữ ký installer và chữ ký trusted comment bằng public key trong cấu hình JPOS hiện hành; detached .sig cũng hợp lệ. Manifest updater production trả version 0.1.60, URL tải trỏ Firebase Storage production, tải không cần đăng nhập và nội dung mirror trùng byte với installer đã ký trên GitHub.

Frontend production được build/ký bởi GitHub Actions run 37425044428. JPOS cũ cần nhận và cài bản 0.1.60 để sử dụng giao diện realtime.
