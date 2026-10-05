# Triển khai cải thiện thời gian thanh toán — 05/10/2026

## Tình trạng triển khai

- Production project `jw-system-f2104`: `payosPayment` revision `payospayment-00025-vuv` và `payosWebhook` revision `payoswebhook-00020-huy` đều ACTIVE; xác minh sau deploy: minInstances 0, maxInstances 20.
- Shared Firestore release đã cập nhật bằng merge fragment, ruleset `1ebf1f03-0f09-4b37-9b59-15dfa32250c0`. Backup bộ rules trước deploy được lưu trong `.firebase/payment-rules`.
- 115 kiểm thử backend, 32 kiểm thử frontend, kiểm thử tích hợp Firestore Emulator, TypeScript, ESLint phần frontend thay đổi và build Next.js đều đạt.
- Chưa bật flag trên máy POS production; đang chờ chọn máy/cửa hàng pilot. Chưa phát hành qua updater. Bản frontend mới cần cài ở máy pilot trước khi có hiệu quả realtime/5 giây tại máy đó.
- Đã build bộ cài Windows x64 thử nghiệm `src-tauri/target/release/bundle/nsis/JPOS_0.1.56+payment-pilot.1_x64-setup.exe` (44.854.536 bytes). Build NSIS thành công; bản này dành cho cài thủ công chạy thử, không tạo artifact updater. Manifest SHA-256 lưu ở `.firebase/payment-latency-pilot-installer.json`. Không thay đổi phiên bản phát hành chính thức trong package.json/Cargo.toml.

## Những thay đổi đã thực hiện

- `payosPayment` dùng context cho từng invocation: cùng người dùng/phạm vi chỉ tải RBAC một lần; không cache quyền giữa các request. Tái sử dụng snapshot ngoài transaction và dữ liệu đơn đã reserve để dựng yêu cầu tạo QR. Các transaction vẫn đọc lại đơn; kiểm tra giá/voucher/quyền/creator vẫn giữ nguyên.
- Bản ghi `pos_payment_status/{opaqueSubscriptionId}` chứa trạng thái tối thiểu, không chứa khách hàng, sản phẩm, QR, token hóa đơn hoặc bí mật ngân hàng. Callable `watch` chỉ cấp cho creator và đúng thiết bị/cửa hàng đã xác minh. Subscription hết hạn sau 20 phút, được gia hạn khi cần.
- Rules kiểm tra Firebase Auth, tài khoản ACTIVE, thiết bị ACTIVE, cửa hàng STORE ACTIVE và quyền `pos.login` từ phiên bản RBAC `user_access` hiện hành. Chỉ được get đúng document; không list hoặc ghi từ client. ID ngẫu nhiên là capability của thiết bị đã xác minh, luôn phải đi cùng Auth và RBAC. Cần giữ ID nội bộ, không đưa vào URL hoặc log.
- Webhook/API check ghi đơn và trạng thái trong cùng transaction. Không có Firestore trigger mới trong đường báo đã nhận tiền. Snapshot ban đầu xử lý trường hợp thanh toán đến trước khi subscribe. Client bỏ qua snapshot cache và pending writes, dừng polling đơn 2 giây khi realtime khỏe; lỗi/offline sử dụng đường dự phòng.
- Các phiên bật tối ưu gọi PayOS theo chu kỳ danh nghĩa 5 giây, có một request đang chạy ở frontend. `pos_payment_checks/{orderCode}` giữ lease/freshness/backoff giữa Cloud Run instances. PayOS GET dùng timeout 4 giây, không tự retry; 429 tôn trọng Retry-After. Timeout hiển thị chờ request đang chạy và kiểm tra cuối có kết quả mới. PENDING không đổi không ghi lại toàn bộ đơn.
- Ghi thêm `qrReadyAt`, `createRequestStartedAt`, `confirmationSource`, `webhookReceivedAt`; không đổi ý nghĩa `createdAt` hoặc `paidAt` cũ. UI lưu event `payment_status_received` vào telemetry cục bộ, để đối chiếu thời điểm backend/UI.
- Giữ `minInstances = 0`, thời gian lời cảm ơn và quy trình tạo thẻ/nạp gói hiện có. MEMBER_PACKAGE vẫn phải qua bước finalize OpenAPI riêng.
- Sửa race hủy khi API tạo QR còn chạy: phản hồi tạo QR đến muộn không được khôi phục attempt đã hủy hoặc bật QR cố định; backend hủy tiếp link vừa xuất hiện trên PayOS. Đã kiểm thử với provider giả lập và transaction thật trên emulator.

## Namespace và rules dùng chung

Không tìm thấy checkout bduck-system ở hai đường dẫn được tài liệu chỉ ra. Đã đối chiếu namespace với source POS và rules production lấy qua Firebase Rules API. Bộ rules hiện hành chứa quyền đọc các đơn cho bduck-system; các quyền đó được giữ nguyên.

`firestore.payment-status.rules` là fragment mới. `scripts/payment-rules.cjs` lấy ruleset đang chạy, hợp nhất riêng fragment, lưu backup trong `.firebase/payment-rules`, compile qua Firebase Rules API và kiểm tra release chưa thay đổi trước khi cập nhật. Không deploy file `firestore.rules` riêng của POS.

## Bật thử và rollback

Flag trong document `pos_devices/{deviceId}`: `payment_latency_optimization_enabled` (boolean). Backend đã xác minh thiết bị trước khi trả `paymentRuntime` cho client.

- `true`: client mới bật realtime và PayOS 5 giây.
- `false` hoặc thiếu field: giữ polling đơn và PayOS 15 giây cho thiết bị đó.
- Client cũ bỏ qua metadata mới, tiếp tục dùng cách xử lý hiện có.
- Rollback bằng cách đặt flag false; client mới nhận cấu hình ở response thanh toán tiếp theo. Không sửa/xóa đơn và không sửa paidAt.

Frontend phải được phát hành/cài vào JPOS để các máy nhận thay đổi. Bật flag backend không tự cập nhật JavaScript trong ứng dụng Tauri đang cài. Chọn một máy/cửa hàng pilot, chạy qua một ca, đối chiếu telemetry và lỗi 429 trước khi bật rộng.

Sau khi chọn device ID, dùng script chỉ cập nhật flag với precondition updateTime:

```powershell
node scripts/payment-latency-pilot.cjs --project jw-system-f2104 --device DEVICE_ID --enable
node scripts/payment-latency-pilot.cjs --project jw-system-f2104 --device DEVICE_ID --disable
```

Không bật TTL trong lần triển khai này. `expiresAt` đã giới hạn quyền đọc nhưng không tự xóa document. Nếu mở rộng pilot, cần chốt retention và bật TTL/dọn bản ghi `pos_payment_status`, `pos_payment_checks`; hiện không tạo cron dọn hoặc function mới.

## Kiểm thử

- `npm --prefix functions test`: kiểm thử backend và policy.
- `node --test test/*.test.mjs`: kiểm thử frontend; Node hiện tại là 23.11.0, không hỗ trợ flag `--experimental-default-type=module` trong script test cũ.
- `npx tsc --noEmit`, ESLint các file thay đổi và `npm run build`.
- Firestore Emulator với project `demo-pos-payment`: dùng `functions/test/paymentLatency.emulator.js`, chỉ chấp nhận host localhost và project demo. Kiểm tra owner khác, anonymous, client write/list, device lock, account lock, RBAC revoke/version, subscription expiry, webhook/API race, idempotent paidAt/source, thanh toán trước subscription và distributed lease/final check.

Không dùng đơn production để giả lập PAID hoặc chạy giao dịch chuyển tiền thật. Số đo cải thiện tại cửa hàng cần lấy sau pilot trên bản JPOS mới.
