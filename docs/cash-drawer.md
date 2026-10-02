# Két tiền qua máy in

Trong **Cài đặt → Máy in**, chọn đúng máy in đang nối dây két ở danh sách
máy in phía trên. Két luôn dùng máy in đã chọn cho bill và vé; đổi máy in sẽ
đổi máy điều khiển két. Trong phần **Két tiền**, chọn chân 2 (mặc định) hoặc 5
và nhấn **Thử mở két / Mở thủ công**.
Chọn **Loại lệnh mở két → TSPL** cho 365B ở chế độ in tem. TSPL dùng chân 2,
gửi `\r\nCASHDRAWER 0,25,250\r\n` (xung ON 50 ms, OFF 500 ms), là lệnh đã
tạo tiếng kích trong lần thử trực tiếp với két ICD-410. Người dùng đã xác nhận
bản beta.3 hoạt động. Khóa cần ở vị trí cho phép mở bằng điện.
ESC/POS vẫn được giữ nguyên và là mặc định cho cấu hình cũ; mỗi lần mở chỉ
gửi loại lệnh đã chọn, không tự thử cả hai loại.
Thông báo gửi lệnh thành công chỉ xác nhận Windows nhận lệnh; cần quan sát
két thực tế để xác nhận tương thích dây, điện áp, chân kích và vị trí khóa.

Bật **Tự mở két khi thanh toán tiền mặt thành công** sau khi thử thành công.
Cấu hình lưu riêng trên thiết bị, mặc định tắt. JPOS dùng Windows spooler
với dữ liệu RAW và lệnh ESC/POS `1B 70 m 19 FA`: chân 2 (`m=0`) hoặc 5
(`m=1`), xung ON 50 ms, OFF 500 ms. Không chuyển lệnh sang máy in dự phòng.

Áp dụng cho đơn bán hàng và bán gói thành viên đã xác nhận tiền mặt thành công,
kể cả khi hoàn tất lại đơn gói hiện tại. Chuyển khoản, in lại bill, in vé,
in kiểm tra lề và đơn thanh toán lỗi không tự gửi lệnh mở két.

Mỗi mã đơn chỉ có một lần thử tự mở. JPOS lưu dấu lần thử trong thư mục
`cash-drawer-attempts` thuộc thư mục dữ liệu local của ứng dụng trước khi gửi
lệnh. Dấu này giữ lại qua lần khởi động ứng dụng. Nếu máy in lỗi hoặc kết quả
không rõ, không tự gửi lại; nhân viên có quyền có thể mở thủ công sau khi kiểm tra.
Lỗi mở két chỉ hiện cảnh báo, không thay đổi đơn đã thanh toán.

Đổi cấu hình, thử và mở thủ công yêu cầu quyền `pos.cash_drawer.open` tại
điểm bán hiện tại, hoặc quyền `*` toàn cục/tại điểm bán. Quản trị viên cần cấp
quyền này qua hệ thống quản lý vai trò đang dùng; JPOS không tự cấp quyền và
không sửa collection vai trò dùng chung. Tự mở sau thanh toán không yêu cầu
quyền mở thủ công. Lệnh native kiểm tra quyền trong phiên POS được lưu khi mở
thủ công và chỉ nhận từ cửa sổ thu ngân chính.

## Kiểm tra tại cửa hàng

1. Thử mở với BT-T080 và XP-80C, xác nhận đúng két; thử chân còn lại nếu cần.
2. Bật tự mở và thanh toán một đơn tiền mặt: két mở một lần.
3. In lại bill, in vé và thanh toán chuyển khoản: két không tự mở.
4. Thanh toán gói thành viên bằng tiền mặt, gồm thử lại cùng đơn sau lỗi API:
   chỉ gửi một lần khi đơn đã xác nhận thành công.
5. Ngắt kết nối máy in điều khiển két: đơn tiền mặt vẫn thành công, cảnh báo
   thiết bị xuất hiện và không chuyển sang máy in khác.
6. Tài khoản không có quyền không đổi cấu hình hoặc mở thủ công được.
7. Khởi động lại JPOS và xử lý lại cùng mã đơn: không tự mở thêm lần nữa.
