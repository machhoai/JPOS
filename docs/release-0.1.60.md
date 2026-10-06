# JPOS 0.1.60

Phiên bản này phát hành thay đổi tối ưu thanh toán trong commit `70fbd09` qua updater production. Danh tính ứng dụng giữ nguyên `JPOS` / `com.jpos.system`, Firebase production là `jw-system-f2104` và installer dùng khóa ký updater hiện hành.

## Hành vi thanh toán

- Tái sử dụng kết quả đọc quyền trong cùng invocation để giảm công việc khi tạo QR; các transaction vẫn đọc lại đơn trước khi cập nhật.
- Nhận trạng thái thanh toán qua Firestore realtime với projection tối thiểu, được kiểm tra quyền người dùng và thiết bị.
- Máy bật `payment_latency_optimization_enabled` dùng chu kỳ kiểm tra PayOS danh nghĩa 5 giây, distributed lease/backoff và polling dự phòng khi realtime lỗi.
- Giữ kiểm tra chữ ký webhook, số tiền, người tạo và trạng thái đơn. Hủy hoặc tạo lại QR không được khôi phục phiên đã hủy khi phản hồi tạo QR đến muộn.
- Không thay đổi `minInstances = 0`, thời điểm `paidAt`, bước finalize gói thành viên hoặc quy trình đồng bộ đơn sang hệ thống ngoài.

## Kiểm chứng và rollout

Trước release đã chạy lại 115 kiểm thử backend và 41 kiểm thử frontend, tất cả đạt. Các ca emulator về quyền, race/idempotency, distributed lease, hủy khi provider lỗi và chữ ký webhook đã được kiểm tra trong đợt QA. Người dùng đã manual test JPOS Test và xác nhận chức năng hoạt động tốt trước khi yêu cầu phát hành production.

Deploy các endpoint thanh toán và callable `getPosAuthSession` chứa luồng chuẩn bị đơn. Giữ nguyên shared Firestore rules đã hợp nhất; không deploy rules riêng của POS đè lên database dùng chung. Bật tối ưu cho các máy production ACTIVE theo yêu cầu người dùng, chỉ cập nhật field cờ bằng precondition `updateTime` và lưu trạng thái trước rollout để rollback.

GitHub Actions kiểm tra Firebase project/auth domain, danh tính ứng dụng và cấu hình ký updater trước build. Các bộ khóa PayOS test, Firebase Admin test và source JPOS Test nằm ngoài release; không sửa secrets production. Installer và chữ ký được xuất bản lên GitHub Releases, installer được mirror sang Firebase Storage và `latest.json` trỏ đến mirror.

Các số đo cold start/QR trước đây lấy từ môi trường test và log đã đọc, không phải benchmark giao dịch trên toàn bộ quầy production. Lần release này xác minh readiness và các đường từ chối yêu cầu không hợp lệ; không tạo giao dịch giả hay chuyển trạng thái PAID trên đơn production.

Rollback tối ưu theo từng máy bằng `scripts/payment-latency-pilot.cjs --project jw-system-f2104 --device DEVICE_ID --disable`. Máy dùng app cũ tiếp tục luồng polling cũ; giao diện realtime cần được cập nhật lên 0.1.60.
