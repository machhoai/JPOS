# Kế hoạch cải thiện tốc độ thanh toán JPOS

Ngày lập: 05/10/2026. Phạm vi được chọn: đẩy trạng thái về giao diện khi backend ghi nhận, kiểm tra PayOS dự phòng mỗi 5 giây, giảm đọc và xác minh lặp trong cùng request. Giữ nguyên `minInstances = 0`. Tài liệu này là kế hoạch; chưa thay đổi mã ứng dụng hoặc triển khai production.

## 1. Kết quả cần đạt

- Giao diện thu ngân nhận trạng thái đã thanh toán từ sự kiện realtime thay cho chờ lượt hỏi trạng thái sau 2 giây.
- Màn hình khách tiếp tục nhận sự kiện nội bộ từ ứng dụng thu ngân; giữ nguyên thời gian lời cảm ơn. Phân biệt đã nhận tiền và đã nạp gói thành công.
- PayOS được kiểm tra dự phòng theo chu kỳ danh nghĩa 5 giây, chỉ trong phiên đang chờ thanh toán, không chồng request và không tiếp tục sau khi hoàn tất.
- Mỗi request tạo QR tải đầy đủ thông tin phiên/quyền một lần ở đường xử lý thông thường. Giữ kiểm tra thiết bị, giá từ nguồn chính thức, quyền bán hàng và transaction bảo vệ cạnh tranh.
- Thêm số đo rõ ràng để so sánh trước/sau. Cold start và thời gian ngân hàng/PayOS vẫn có thể tồn tại.

## 2. Kiến trúc realtime dự kiến

Ưu tiên Firestore listener vào một bản ghi nhỏ, riêng cho phiên thanh toán. Không dùng một HTTP stream giữ Cloud Functions hoạt động dài; không đưa một Firestore trigger mới vào đường thông báo PAID vì trigger có thể khởi động chậm.

Luồng: webhook hoặc API check xác minh thanh toán → transaction cập nhật đơn và bản ghi trạng thái cùng lúc → Firestore listener ở máy thu ngân nhận trạng thái đã commit → cập nhật payment store một lần → phát sự kiện nội bộ sang màn hình khách.

Collection dự kiến: `pos_payment_status`, backend POS sở hữu schema và quyền ghi. Chốt tên/schema sau khi đối chiếu repository bduck-system và rules đang chạy. Hiện chưa thấy tên này trong POS; hai đường dẫn bduck-system được tài liệu nhắc tới không tồn tại trên máy hiện tại, nên đối chiếu hệ thống dùng chung là bước phải hoàn tất trước khi thêm collection/rules.

Bản ghi dự kiến dùng ID subscription ngẫu nhiên khó đoán; backend chỉ trả ID qua callable đã xác thực người dùng và thiết bị. Liên kết subscription với đơn/attempt ở phía backend. Trường tối thiểu:

- `ownerUid`, `deviceId`, `warehouseId`: phạm vi được cấp quyền.
- `localOrderId`, `payosOrderCode`, `orderKind`: nhận diện đúng đơn và attempt.
- `orderStatus`, trạng thái thanh toán, `paidAt`, nguồn xác nhận.
- `revision`, `updatedAt`, `expiresAt`: chống sự kiện cũ và giới hạn vòng đời.

Không đưa thông tin khách, chi tiết hàng hóa, QR, token hóa đơn hoặc bí mật PayOS vào bản ghi này. Không dùng bản tóm tắt `pos_order_summaries` hiện có vì chứa nhiều dữ liệu hơn cần thiết và được cập nhật qua trigger bất đồng bộ.

### Quyền đọc

Giữ `pos_orders` chỉ cho backend. Client không được ghi trạng thái và không được list collection trạng thái. Chỉ được theo dõi đúng document mà backend cấp, với Firebase Auth khớp chủ phiên và checks phù hợp về tài khoản/thiết bị/cửa hàng/vòng đời phiên. ID khó đoán không thay thế kiểm tra Auth/RBAC.

Firestore listener không gửi `device_credential` theo giao thức callable hiện tại. Vì vậy bước thiết kế phải chứng minh cơ chế cấp subscription và Security Rules vẫn đáp ứng mô hình quyền thiết bị hiện tại, bao gồm thu hồi quyền. Nếu cần bổ sung quyền đọc gắn với phiên, chốt cơ chế đó trước khi bật realtime. Không chuyển sang đọc trực tiếp toàn bộ đơn để tránh bước này.

Lấy và hợp nhất ruleset dùng chung đang chạy; không deploy riêng file firestore.rules của POS để thay thế rules của bduck-system. Dùng hằng số collection tập trung. Bản ghi hết hạn có thể dọn bằng TTL; thời hạn lưu chốt theo nhu cầu phục hồi phiên, không tạo tác vụ dọn chạy liên tục.

## 3. Thay đổi backend

### 3.1. Giảm xác minh và đọc lặp

Tạo context cho từng request: thiết bị đã xác thực, session người dùng, quyền tại cửa hàng và snapshot cần thiết. Truyền context xuống các hàm chuẩn bị đơn/tạo attempt; không cache quyền giữa các request theo cách bỏ qua thu hồi quyền.

- Tái sử dụng lần đọc đơn ban đầu cho các kiểm tra không cần dữ liệu mới.
- Tái sử dụng session từ bước kiểm tra quyền bán hàng ở bước reserve attempt; vẫn kiểm tra đúng creator và warehouse.
- Truyền dữ liệu đơn đã được chuẩn bị/reserve sang bước gọi PayOS, giảm lần đọc chỉ phục vụ dựng payload.
- Giữ transaction đọc lại dữ liệu cần chống race: trạng thái DRAFT, attempt hiện hành, voucher, PAID, hủy và tạo lại QR.
- Không giữ transaction Firestore mở trong lúc gọi mạng PayOS.
- Chỉ hợp nhất stage/reserve khi chứng minh các trường hợp đơn thường, MEMBER_PACKAGE, voucher và retry vẫn đúng.

Mục tiêu đầu tiên là giảm session load từ 2 xuống 1 ở luồng tạo mới thông thường. Sáu lần đọc đơn là baseline của luồng đã kiểm tra; số đọc cuối cùng chốt sau refactor, không đặt mục tiêu loại bỏ cả các lần đọc transaction bắt buộc.

### 3.2. Cập nhật trạng thái realtime nguyên tử

Tạo bản ghi subscription trong luồng khởi tạo phiên và trả metadata tương thích ngược trong response. Cập nhật bản ghi cùng transaction khi trạng thái có thay đổi thực sự, đặc biệt khi ghi PAID. Áp dụng cho webhook, API check, hủy/tạo lại, xác nhận thủ công và QR cố định nếu phiên thuộc các đường này.

Không cập nhật bản ghi realtime mỗi lần kiểm tra thấy PENDING không đổi. Không biến updatedAt/lastCheckedAt thành sự kiện UI liên tục. Webhook lặp không ghi lại paidAt, không tăng trạng thái hoặc chạy hậu xử lý lần hai. Attempt cũ không được kéo giao diện của attempt mới lùi trạng thái.

## 4. Thay đổi frontend

- Thêm service/hook subscribe bản ghi thanh toán bằng Firestore `onSnapshot`.
- Chỉ một listener ở ứng dụng thu ngân cho phiên hiện hành; màn hình khách dùng bridge hiện có, không mở listener và không gọi PayOS riêng.
- Dùng snapshot đầu tiên để phục hồi nếu PAID xảy ra trước khi listener được đăng ký.
- Chỉ xác nhận hoàn tất từ trạng thái server đã commit; xử lý metadata cache/offline rõ ràng.
- Dùng một đường cập nhật payment store cho realtime, callable và fallback. Chặn callback trùng; không in biên lai, nạp gói hoặc phát lời cảm ơn hai lần.
- Unsubscribe khi đổi đơn/attempt, hủy, hoàn tất, logout và unmount.
- Khi realtime hoạt động, bỏ polling trạng thái đơn mỗi 2 giây. Khi không có subscription hoặc listener lỗi, giữ đường polling cũ làm fallback để phiên bản cũ và sự cố vẫn thanh toán được.
- Listener lỗi không tạo lại QR, không đánh dấu PAID, không tự xác nhận thủ công.
- MEMBER_PACKAGE vẫn tách đã nhận tiền khỏi nạp gói thành công; realtime PAID kích hoạt luồng finalize hiện có một lần, không hiển thị đã nạp thành công quá sớm.

## 5. Kiểm tra PayOS mỗi 5 giây

Thay chu kỳ dự phòng 15 giây bằng 5 giây trong phiên WAIT còn hiệu lực. Không tạo một request mới khi request trước đang chạy. Dừng ngay khi PAID, hủy, thay attempt hoặc rời phiên.

Client chống chồng request; backend cần gộp/chặn các API check đồng thời cho cùng orderCode trên nhiều instance/máy, bằng cơ chế freshness hoặc lease có thời hạn. Dùng chu kỳ tối đa khoảng một lượt check mỗi 5 giây cho cùng phiên, không dựa vào biến trong bộ nhớ một instance để bảo đảm giới hạn toàn hệ thống.

Tôn trọng Retry-After và backoff khi HTTP 429; ghi nhận giới hạn từ response. Không coi header `limit: 5` đã quan sát là bằng chứng 5 request/giây hay giới hạn theo key; phạm vi/cửa sổ vẫn cần làm rõ. Theo dõi tổng lưu lượng và lỗi 429 trước khi mở rộng nhiều cửa hàng. Chu kỳ 5 giây là lịch danh nghĩa; mạng, in-flight và backoff có thể làm lượt check thưa hơn.

Giữ lần kiểm tra cuối khi hết hạn QR. Với guard hiện có bỏ check 35 giây cuối, điều chỉnh để không vô tình mất fallback trong một đoạn dài: check mỗi 5 giây khi WAIT, phối hợp timeout bằng cùng khóa request và thực hiện một lần kiểm tra cuối, không chồng lên nhau.

Giảm ghi Firestore khi API trả trạng thái không đổi; tách timestamp phục vụ freshness khỏi document realtime. Không bật gọi mỗi 5 giây cho màn hình khách, phiên đã hoàn tất hoặc toàn bộ đơn lịch sử.

## 6. Đo lường

Thêm mốc bất biến cho bắt đầu xử lý request và QR sẵn sàng; ghi timestamp nhận webhook, nguồn xác nhận WEBHOOK/API_CHECK/MANUAL và thời điểm UI nhận/hiển thị. Giữ nguyên ý nghĩa createdAt/paidAt hiện có, không sửa dữ liệu lịch sử.

Đo trước/sau: độ trễ tạo QR; commit PAID tới UI nhận; lượt đọc/session load mỗi request tạo QR; số check PayOS/phiên; lỗi 429; số lần fallback; xác nhận/nạp gói/in biên lai trùng. Tách cold/warm và đơn thường/MEMBER_PACKAGE.

Mục tiêu nghiệm thu cho realtime trên mạng ổn định: loại bỏ chờ polling 2 giây, hướng tới p95 commit PAID→UI nhận dưới 1 giây. Đây là mục tiêu đo kiểm, không cam kết SLA trước khi chạy tại cửa hàng. Việc giữ minInstances=0 không loại được cold start trước khi backend ghi PAID.

## 7. Kiểm thử bắt buộc

- Webhook đến trước response tạo QR/listener đăng ký; callback lặp; webhook và API check cùng xác nhận.
- QR cũ báo PAID sau khi tạo lại; hủy và thanh toán xảy ra gần nhau; voucher chỉ commit một lần.
- Mất mạng, reconnect, snapshot cache, reload ứng dụng, listener lỗi, logout/đổi người dùng/thiết bị bị khóa.
- MEMBER_PACKAGE finalize một lần và không báo nạp thành công trước xác nhận remote.
- API check không chồng request, dừng khi PAID, phục hồi lease hết hạn, tôn trọng 429/Retry-After; timer hết hạn không bỏ check cuối.
- Security Rules: đúng người được đọc document được cấp; người khác, list collection và mọi client write bị từ chối; tài khoản/phiên không hợp lệ không giữ quyền đọc.
- Chạy tests backend phù hợp, typecheck/build frontend và rules emulator; kiểm tra Tauri hai màn hình ở các luồng liên quan. Phép thử tạo/hủy PayOS không thay thế test nhận tiền thật; test nhận tiền dùng sandbox phù hợp hoặc giao dịch thử được thống nhất.

## 8. Thứ tự triển khai và quay lui

1. Chốt schema/quyền subscription, đối chiếu bduck-system và rules production; đo baseline, thêm instrumentation.
2. Refactor context/xác minh trong request và kiểm thử cạnh tranh.
3. Thêm backend ghi trạng thái nguyên tử và response metadata tùy chọn. Bản client cũ tiếp tục dùng luồng cũ.
4. Hợp nhất/deploy rules dùng chung với checks quyền đã kiểm thử.
5. Thêm frontend listener và lịch PayOS 5 giây, đặt cờ cấu hình để bật thử tại một điểm bán.
6. Theo dõi ít nhất một ca hoạt động trước khi mở rộng: độ trễ, lỗi, trùng hậu xử lý, 429, reads/writes và số request.

Rollback bằng cờ: tắt realtime để dùng polling cũ, đưa PayOS về 15 giây nếu cần; backend/metadata mới giữ tương thích với client cũ. Không xóa đơn hoặc thay đổi paidAt để rollback. Chưa deploy hay thay đổi rules trong bước lập kế hoạch.

Ước lượng sơ bộ: 3–5 ngày làm việc cho thiết kế quyền, backend/frontend và kiểm thử; thời gian chạy thử một ca và lịch phát hành tính riêng. Điều kiện cần hoàn tất: quyền subscription được kiểm chứng và tiếp cận rules/repository dùng chung, phiên JPOS test với thiết bị hợp lệ.

## 9. Chi phí và phạm vi

Không tăng chi phí duy trì minInstances. Listener vẫn tính phí đọc Firestore khi đăng ký/có cập nhật và bản ghi realtime phát sinh write/storage/TTL nếu bật. Chu kỳ PayOS 5 giây tăng số check dự phòng danh nghĩa gấp 3 so với 15 giây; bỏ polling backend 2 giây có thể bù một phần request/read. Cần dùng số đo pilot để xác định chi phí ròng, không cam kết hoàn toàn miễn phí.

Các nhóm file chính: functions/src/payment/payosFunctions.ts, payosCallable.ts, payosWebhook.ts, fixedTransferFunctions.ts; functions/src/order/functions.ts; functions/src/config/collections.ts; các type payment/order hai phía; src/lib/stores/usePayOSPaymentStore.ts; src/lib/hooks/usePayOSPaymentTimer.ts, usePayOSCheckoutController.ts; service/hook subscription mới; rules dùng chung; tests liên quan. Không thay đổi thời gian lời cảm ơn hoặc luồng tạo thẻ/nạp gói ngoài việc nhận trạng thái sớm và chống xử lý trùng.
