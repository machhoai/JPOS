# Phạm vi quyền đơn hàng và kết ca

Áp dụng tại cửa hàng được gán quyền. Không phân biệt theo tên vai trò admin/thu
ngân; backend kiểm tra các quyền thực tế và quyền truy cập cửa hàng của máy POS.

| Chức năng | Của mình hôm nay | Tất cả |
| --- | --- | --- |
| Xem lịch sử/chi tiết đơn | `pos.orders.read_own_today` | `pos.orders.read` |
| Xem kết ca | `pos.shift.read_own_today` | `pos.shift.close` |
| In kết ca | `pos.shift.print_own_today` | `pos.shift.print` |

- **Của mình**: `createdBy` bằng Firebase UID đang đăng nhập, backend tự xác định;
  không lấy mã nhân viên do client truyền lên làm căn cứ cấp quyền.
- **Hôm nay**: 00:00 đến trước 00:00 ngày tiếp theo theo giờ Việt Nam, do server
  xác định. Đơn hàng tính theo `createdAt`; kết ca tính theo `paidAt` như trước.
  Đơn tạo hôm qua nhưng thanh toán hôm nay xuất hiện trong kết ca hôm nay của
  người tạo. Quyền này không cho xem ca vắt qua ngày trước, kể cả ca của mình.
- **Tất cả**: mọi nhân viên và các ngày khác trong cửa hàng được cấp quyền.
  Không phải quyền xem mọi cửa hàng. Giới hạn sẵn có vẫn áp dụng: lịch sử chọn
  một ngày, báo cáo kết ca tối đa 48 giờ, không trả báo cáo bị cắt bớt quá 5.000 đơn.
- Quyền tất cả bao gồm phạm vi hẹp cùng chức năng. Gán cả hai quyền không thu hẹp
  quyền tất cả. Các quyền từ nhiều vai trò được cộng lại; wildcard `*` vẫn cho toàn
  quyền trong phạm vi được gán.
- Không có quyền xem tương ứng thì ẩn menu và chặn trang/API. Quyền hẹp khóa ngày
  và tài khoản tại giao diện, đồng thời kiểm tra lại ở backend. Dữ liệu lịch sử
  được tách theo tài khoản/phạm vi và bỏ phản hồi cũ sau khi đổi tài khoản/quyền.
- Danh sách, badge và kiểm tra PayOS theo phạm vi quyền đọc đơn tương ứng. Việc
  tải/in kết ca vẫn kiểm tra PayOS cho các đơn được phép đưa vào báo cáo.

## Xem và in kết ca độc lập

In yêu cầu **đồng thời** có quyền xem và quyền in cho phạm vi yêu cầu. Request in
gửi `purpose: "PRINT"` và được backend kiểm tra trước khi tải dữ liệu mới để in.
Request thiếu `purpose` giữ hành vi xem (`VIEW`) cho các luồng đọc hiện có.

| Quyền xem | Quyền in | Kết quả |
| --- | --- | --- |
| Của mình hôm nay | Không | Chỉ xem của mình hôm nay |
| Của mình hôm nay | Của mình hôm nay | Xem và in của mình hôm nay |
| Tất cả | Không | Xem mọi phạm vi, không dùng được nút in kết ca |
| Tất cả | Của mình hôm nay | Xem mọi phạm vi; chỉ in khi chọn Của tôi trong hôm nay |
| Của mình hôm nay | Tất cả | Vẫn chỉ xem và in của mình hôm nay |
| Tất cả | Tất cả | Xem và in mọi phạm vi được cấp tại cửa hàng |
| Không | Bất kỳ | Không mở/tải/in được báo cáo |

Quyền in điều khiển chức năng In báo cáo của JPOS và kiểm tra trước in ở backend.
Dữ liệu đã được cấp quyền xem vẫn có thể được chụp màn hình, sao chép hoặc in
bằng công cụ bên ngoài; đây không phải cơ chế chống sao chép dữ liệu đã hiển thị.
In hóa đơn bán hàng là luồng khác: người có `pos.sales.create` vẫn lấy được hóa
đơn của chính đơn mình tạo hôm nay để bán/in tại quầy, không được cấp lịch sử
ngày cũ hay hóa đơn của người khác qua ngoại lệ này. Trạng thái đơn đang xử lý
và khôi phục đơn nháp vẫn thuộc luồng bán hàng.

## Cấp quyền trong JPULSE

Trong màn hình thêm/sửa vai trò, mở **JPOS — Đơn hàng và kết ca**. Ba mục độc lập:
**Xem đơn hàng**, **Xem kết ca**, **In kết ca**. Nhãn và mô tả có cả tiếng Việt và
tiếng Trung. Gán vai trò vào đúng cửa hàng theo cơ chế phân quyền hiện có.

- Thu ngân chỉ tra cứu: `pos.orders.read_own_today`, `pos.shift.read_own_today`.
- Thu ngân có in kết ca: thêm `pos.shift.print_own_today`.
- Quản lý xem toàn cửa hàng, không in: `pos.orders.read`, `pos.shift.close`.
- Quản lý xem/in đầy đủ: thêm `pos.shift.print`.
- Giữ các quyền đăng nhập, bán hàng và thanh toán riêng theo công việc.

## Chuyển từ quyền cũ và triển khai

1. `pos.orders.read` giữ nghĩa xem tất cả. `pos.shift.close` giữ mã để các vai trò
   cũ vẫn xem đầy đủ, nhưng **không tự cấp quyền in** nữa. Không tự chuyển dữ liệu
   vai trò đang dùng hoặc đoán vai trò nào là thu ngân.
2. Cập nhật đồng bộ backend Functions, ứng dụng JPOS và JPULSE/shared-types.
   Không cấp quyền hẹp trước khi backend đã hỗ trợ; ứng dụng JPOS cũ không có
   giao diện tương ứng và chưa kiểm tra quyền in riêng.
3. Với thu ngân cần giới hạn, bỏ các quyền rộng cũ, thay bằng quyền hẹp tương ứng.
   Kiểm tra cả những vai trò khác đang gán cho tài khoản và wildcard.
4. Cấp quyền in rõ ràng cho những người trước đây dùng `pos.shift.close` để in.
5. Đăng nhập lại/tải lại phiên để nhận bản quyền mới. Backend tải quyền hiện tại
   cho từng request, không tin quyền đã lưu phía client.

Không thêm collection, không thay schema dữ liệu vai trò/đơn hàng và không cần
deploy Firestore Rules. Không deploy riêng rules của POS lên database dùng chung.

## Kiểm chứng

- Policy tests: các tổ hợp quyền xem/in; ngày cũ, qua nửa đêm Việt Nam; UID khác;
  quyền cửa hàng, global và wildcard.
- Emulator tests: gọi các hàm lịch sử, lấy đơn theo ID, xem/in kết ca và PayOS với
  dữ liệu giả; kiểm tra từ chối vượt phạm vi và giữ luồng hóa đơn bán hàng.
- UI/store tests: khóa bộ lọc, nút in theo quyền, tách cache người dùng/phạm vi và
  bỏ response đến trễ sau khi reset.
