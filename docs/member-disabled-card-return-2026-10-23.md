# Gỡ thẻ của thành viên đang tắt — 23/10/2026

Đã xác minh trực tiếp Jingjian cho phép gỡ thẻ khỏi thành viên đang tắt bằng
`POST /member/cashier/MemberCard/return/confirm`, với `isReturnDeposit=false`.
Không cần bật lại thành viên.

## Thẻ thử và dữ liệu Firestore

- Thành viên: `270826001`, UID `67514eb5-cc53-4214-8735-001162235883`.
- Thẻ đã gỡ: `01PAYJOYW002986`.
- Sau thao tác, thành viên vẫn tắt, không còn thẻ; hồ sơ và số dư trả bởi
  cashier getdetails không thay đổi. API take/check chấp nhận cấp lại thẻ.
- Đã đồng bộ riêng hồ sơ này vào Firestore: `memberCode=null`, snapshot mới
  có danh sách thẻ trống và `isEnabled=false`. Core profile local giữ nguyên.
- Cập nhật hash của snapshot và entry manifest tương ứng trong cùng commit,
  có precondition updateTime để tránh ghi đè cập nhật đồng thời.
- Tổng cộng 2 document reads và 2 writes: hồ sơ và một import shard.
- Bản sao trước sửa và kết quả commit nằm trong file ignored
  `.firebase/disabled-card-return-270826001/firestore-sync.json`.

## Thay đổi JPOS

Bỏ điều kiện `details.isEnabled !== true` trong `fetchCardReturnOwner`, được
dùng chung bởi preview và worker. Gỡ thẻ không thay đổi trạng thái thành viên.
Giữ nguyên kiểm tra owner, chip, quan hệ thẻ, shop, loại thành viên, quyền và khóa.
Thẻ khách vãng lai, máy và công cộng vẫn bị chặn.

Kiểm chứng: `npm --prefix functions test` — 199/199 đạt, gồm regression cho
thành viên tắt và xác nhận không gọi thao tác bật tài khoản. Không gỡ thêm thẻ
khách thật trong quá trình kiểm tra thay đổi mã nguồn.

Phần chặn thành viên disabled trong báo cáo 14/10/2026 được thay thế bởi kết
quả kiểm chứng và hành vi mới ghi tại đây.
