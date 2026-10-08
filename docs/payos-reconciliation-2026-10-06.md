# Đối soát đơn PayOS xác nhận thủ công

## Phạm vi

Chỉ đơn `paymentMethod = QR_CODE` có `paymentDetails.provider = payos` và
ít nhất một payment link PayOS hợp lệ được theo dõi. Không cảnh báo tiền mặt,
QR tài khoản cố định đã xác nhận thủ công, đơn nháp, đã hủy hoặc đang/đã hoàn tiền.
QR cố định có thể giữ phiên PayOS cũ nên phải loại trừ bằng
`fixedTransferDetails.status = MANUALLY_CONFIRMED`, không chỉ kiểm tra provider.

## Hành vi

- Xác nhận thủ công đặt `UNVERIFIED`, lưu lịch sử người xác nhận và hạn kiểm tra
  bằng thời điểm hoàn thành đơn cộng 5 phút.
- Webhook hợp lệ hoặc API xác nhận đủ tiền chuyển đơn sang `VERIFIED` trong
  transaction, lưu nguồn và thời điểm đối soát. Giữ nguyên `paidAt`, trạng thái
  đồng bộ và lịch sử thủ công. Không thực hiện checkout hoặc tạo hóa đơn lần nữa.
- Webhook gửi lặp giữ nguyên dữ liệu của lần xác nhận đầu tiên.
- Kiểm tra API bao gồm QR hiện tại và QR cũ, kể cả link đã hết hạn/hủy. Chữ ký,
  mã đơn, link, tiền tệ và số tiền vẫn phải hợp lệ.
- Scheduler kiểm tra mỗi phút, theo lô tối đa 12 đơn, đồng thời tối đa 4 đơn.
  Các máy dùng chung lease kiểm tra PayOS để hạn chế gọi trùng và tuân thủ backoff.
  Sau một giờ chưa đối soát, kiểm tra nền cách 5 phút; sau 24 giờ cách 30 phút.
- Giao diện tại quầy kiểm tra mỗi 15 giây và khi có mạng trở lại. Đơn mới
  quá hạn được kiểm tra lại trước khi cảnh báo; cảnh báo nền có thể trễ khoảng
  một chu kỳ scheduler khi ứng dụng không mở hoặc hàng đợi nhiều đơn.
- Cảnh báo dùng toast hiện có của hệ thống, mỗi đơn có action “Xem đơn”. Không
  có nút hoặc danh sách nổi riêng. Action mở lịch sử theo ngày tạo đơn tại Việt
  Nam, bỏ bộ lọc cũ, chờ tải dữ liệu rồi cuộn đến và tô sáng đúng đơn.
- Mục Đơn hàng trên sidebar có badge đỏ đếm đơn PayOS được tạo hôm nay theo giờ
  Việt Nam còn chờ xác nhận trong cửa hàng đang chọn, kể cả chưa đủ 5 phút và
  thông báo đã xem. Toast dùng cùng phạm vi hôm nay; đơn cũ vẫn được đối soát
  nền và xuất hiện trong báo cáo kết ca đúng kỳ. Badge dùng
  chung kết quả kiểm tra của monitor, không gọi thêm API. Ẩn khi bằng 0, hiển thị
  `99+` nếu lớn hơn 99; tooltip giữ số lượng đầy đủ. Không dùng số của cửa hàng
  hoặc nhân viên trước sau khi đổi phiên.
- Bấm “Xem đơn” hoặc đóng toast đánh dấu đã xem theo nhân viên ở backend, không
  xác nhận thanh toán. Nếu toast tự hết thời gian và chưa được xem, cảnh báo có
  thể nhắc lại sau 5 phút. PayOS xác nhận thì toast đang hiện được đóng ở lần
  kiểm tra tiếp theo. Tối đa 3 cảnh báo mới mỗi chu kỳ để không dồn quá nhiều.
- Khi tải hoặc in báo cáo kết ca, hệ thống kiểm tra lại PayOS và dùng dữ liệu mới.
  Mọi đơn trong kỳ còn chờ đối soát đều được liệt kê, kể cả chưa đủ 5 phút.
  Bản in có cảnh báo và nhân viên xác nhận đã xem cảnh báo trước khi in.
- Tổng doanh thu giữ cách tính hiện hành; số PayOS đã xác nhận/chờ xác nhận là
  thông tin đối soát bổ sung. Màn hình kết ca hiện là báo cáo, chưa có nghiệp vụ
  chốt ca lưu trạng thái hoặc quyền quản lý duyệt ngoại lệ.

## Dữ liệu và quyền

Mở rộng `pos_orders.payosReconciliation`; không tạo collection mới.
Các trường: `dueAt`, `nextCheckAt`, `lastCheckedAt`, `lastError`, `alertedAt`,
`verifiedAt`, `confirmationSource`, `orderCode`, `acknowledgedBy`.

Danh sách/kiểm tra/đánh dấu đã xem yêu cầu máy POS hoạt động, nhân viên có quyền
`pos.orders.read` tại cửa hàng của máy. Báo cáo yêu cầu `pos.shift.close`.
Backend không cho máy POS đối soát đơn cửa hàng khác. Frontend không viết
Firestore và không nhận API secret. Màn hình khách không chạy monitor.

## Triển khai

1. Build Functions và kiểm thử trước khi deploy.
2. Hợp nhất index `pos_orders(warehouseId ASC, paymentVerificationStatus ASC, createdAt ASC)`
   vào cấu hình index của database dùng chung, hoặc tạo riêng index này theo
   quy trình vận hành của project. Không deploy riêng rules/index toàn bộ POS
   thay cho cấu hình dùng chung; không xóa index của `bduck-system`.
3. Deploy có chọn lọc `payosPayment`, `payosWebhook` và
   `reconcilePendingPayOSPayments` vào Firebase project đang dùng. Scheduler
   dùng cùng ba secret PayOS hiện có. Ví dụ với project được chỉ định rõ:

   ```powershell
   firebase deploy --project PROJECT_ID --only functions:payosPayment,functions:payosWebhook,functions:reconcilePendingPayOSPayments
   ```

4. Rà soát dữ liệu cũ bằng script chỉ đọc mặc định, sau khi build Functions:

   ```powershell
   node scripts/backfill-payos-reconciliation.cjs --project=PROJECT_ID
   node scripts/backfill-payos-reconciliation.cjs --project=PROJECT_ID --apply
   ```

   Script chỉ sửa đơn PayOS `UNVERIFIED`, không gọi PayOS và không đổi thời điểm
   hoàn thành đơn. Có bằng chứng `PAID` hợp lệ thì sửa trạng thái đối soát; chưa
   có thì khởi tạo lịch kiểm tra nền. Các đơn cũ được mở qua danh sách cũng tự
   khởi tạo theo dõi. Chạy lại script an toàn.
5. Build/phát hành frontend sau khi backend và index sẵn sàng. Tải/in báo cáo
   hiện gọi action `reconcile-closeout` của `payosPayment`, nên không phát hành
   frontend trước backend.

## Kiểm chứng

- Build production Next.js và build TypeScript Functions thành công.
- Kiểm thử backend policy, frontend tổng hợp báo cáo và đối chiếu quy tắc lọc.
- Firestore emulator với dữ liệu giả: webhook đến muộn, gửi lặp, QR cũ, sửa đơn
  legacy `PAID` nhưng `UNVERIFIED`, mất kết nối/sai số tiền, trước hạn 5 phút,
  webhook đồng thời với lỗi API, đánh dấu đã xem và truy cập khác cửa hàng.
- Browser kiểm tra toast có action với component thật: “Xem đơn” mở đúng ngày
  của đơn từ hôm trước; đợi dữ liệu tải xong rồi cuộn/focus đúng hàng. Không có
  nút hoặc danh sách nổi riêng. Kiểm thử link kiểm tra cả trường hợp hoàn thành
  qua nửa đêm và bấm thông báo cho cùng đơn lần nữa.
- Kiểm tra trực quan bản in kết ca có khoản chờ đối soát và danh sách đơn.

Không gọi API PayOS thật, không sửa dữ liệu production và không deploy trong
quá trình kiểm thử này.
