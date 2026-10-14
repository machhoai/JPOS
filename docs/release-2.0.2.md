# Phát hành JPOS 2.0.2

## Phạm vi và mô tả hiển thị trong Cài đặt

- Cập nhật tìm kiếm bằng số điện thoại: Hiển thị danh sách khi tìm kiếm.
- Bổ sung chức năng gia hạn cho gói thẻ thành viên.
- Bổ sung chức năng hủy thẻ (gỡ liên kết thẻ khỏi thành viên để sử dụng lại).

Bản phát hành gồm các thay đổi thành viên đã triển khai: chỉnh sửa hồ sơ,
phục hồi đăng ký, danh bạ Firestore và các chức năng trên. Các thay đổi định
dạng ngày hiện có được đưa vào cùng shared DateInput/formatDate để giữ build
nhất quán. Không đưa script thử thanh toán, dữ liệu khách hay credential vào
bộ cài. Không bật lại cron nhập danh bạ.

## Kế hoạch và kiểm tra

- [x] Kiểm tra phiên bản hiện hành, workflow ký updater và phạm vi source.
- [x] Tăng package/Cargo lên 2.0.2 và cập nhật releaseBody.
- [x] Chạy 198 tests backend, 71 tests frontend, lint thành viên và static build.
- [ ] Deploy chọn lọc backend thành viên và rules hợp nhất từ bduck-system.
- [ ] Push tag jpos-v2.0.2 để build bộ cài có chữ ký trên GitHub Actions.
- [ ] Kiểm tra release, latest.json, chữ ký và URL mirror bộ cài.

Gia hạn chưa được thử mutation trên dữ liệu khách thật; release không tự gửi
lệnh gia hạn. Đầu đọc thật cần kiểm chứng tại POS. Chi tiết các luồng được lưu
trong báo cáo triển khai từng chức năng.
