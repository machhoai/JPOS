# Danh bạ thành viên dùng chung — 23/10/2026

## Nguyên nhân và quy ước

Số `270826500` tồn tại trong `pos_members` nhưng có điểm tạo là AEON Mall Tân
Phú. Phiên POS ở Landmark 81 không tìm được vì query gợi ý và kiểm tra lookup
đã dùng điểm tạo như phạm vi sở hữu. Theo quy ước được người dùng xác nhận,
thành viên được tìm và đọc ở mọi cửa hàng; điểm tạo chỉ là nguồn gốc hồ sơ.

## Thay đổi

- Gợi ý điện thoại đọc danh bạ chung theo HK shop và prefix, không lọc điểm tạo.
- Lookup theo UID đã chọn và theo số điện thoại chính xác chấp nhận hồ sơ tạo
  tại điểm khác. Giữ xác minh số điện thoại, UID và HK shop.
- Seed hồ sơ khi lookup không đổi warehouseId của hồ sơ đã có điểm tạo.
- Đọc lịch sử chỉnh sửa từ cửa hàng khác vẫn yêu cầu quyền history/edit hiện có.
- Người dùng phải có quyền tại điểm đang sử dụng. Intent đăng ký đang phục hồi
  vẫn gắn với workflow tại điểm bán; không mở rộng quyền sửa/gỡ thẻ/thanh toán.
- Không chuyển hàng loạt 600 hồ sơ sang Landmark và không sửa dữ liệu kho dùng chung.
- Không thêm truy vấn Firestore khi gõ; vẫn limit 10, debounce và cache hiện có.

## Kiểm chứng

`npm --prefix functions test`: 208/208 đạt, gồm gợi ý khác điểm tạo, lookup theo
selected UID và exact phone, thành viên disabled, bảo toàn điểm tạo trong seed
hồ sơ legacy và đã khởi tạo, đọc lịch sử khác điểm, chặn HK shop khác và tài
khoản chưa có quyền tại điểm sử dụng.

Đã triển khai `getPosAuthSession` tại `asia-southeast1` trên `jw-system-f2104`.
Kiểm chứng trực tiếp trên phiên POS localhost đang chọn Landmark 81: tìm
`270826500` thấy gợi ý **Khách hàng 500 — Trạng thái: Đang tắt**, chọn và mở
được đầy đủ hồ sơ, UID `3438c3ce-8fce-43cf-aa7a-723537afe2e7`, 5 điểm và chưa
cấp thẻ. Không chuyển điểm tạo sang Landmark. Ảnh xác nhận tại
`.firebase/member-phone-search-qa/shared-member-270826500.png` (ignored).
