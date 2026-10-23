# Hiển thị thành viên đang tắt khi tìm theo số điện thoại — 23/10/2026

Gợi ý điện thoại tiếp tục bao gồm cả thành viên đang bật và đang tắt trong
phạm vi shop/warehouse được phép. Projection đọc thêm `hkSnapshot.isEnabled`
ngay trong truy vấn hiện có; không thêm query Firestore hay gọi HK khi gõ.
Thành viên tắt có dòng đỏ **Trạng thái: Đang tắt** và vẫn chọn được để tra cứu.

OpenAPI `member_getmember_uid` và `member_getmember_phone` đã được kiểm tra
trực tiếp với số `270826001`: cả hai trả hồ sơ nhưng không trả enabled status.
Vì vậy sau khi xác minh thành viên trong lookup, backend dùng cashier
`GET /member/cashier/member/getdetails` để lấy trạng thái hiện tại. Không gọi
thao tác bật/tắt. Gợi ý dùng snapshot local, hồ sơ chi tiết dùng status HK mới.
Nếu không lấy được status thì vẫn trả hồ sơ đã xác minh với trạng thái
**Chưa xác định**, không suy đoán đang bật. Status thuộc shop khác bị từ chối.

## Xác minh

- Backend: 204/204 tests đạt, gồm gợi ý disabled không tăng số query, chọn
  UID disabled để mở hồ sơ, status bật/tắt/không xác định và shop mismatch.
- Frontend: 71/71 tests đạt; lint các file frontend thay đổi đạt.
- `npm run build` thành công.
- Browser QA với component/hook thật và dữ liệu giả lập: debounce, không lookup
  khi gõ, chọn thành viên disabled, trạng thái đỏ trong hồ sơ, chưa có thẻ,
  retry, response cũ, đổi scope và tra cứu mã thẻ đều đạt; không browser error.
- Helper status gọi trực tiếp HK cho `270826001` trả `isEnabled=false`.
- Ảnh QA: `.firebase/member-phone-search-qa/disabled-member-profile.png`.

Thay đổi frontend cần bản build JPOS mới trên máy sử dụng; không phát hành
installer hoặc tự cập nhật máy POS trong lượt này.
