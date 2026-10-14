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
- [x] Deploy chọn lọc backend thành viên và rules hợp nhất từ bduck-system.
- [x] Push tag jpos-v2.0.2 để build bộ cài có chữ ký trên GitHub Actions.
- [x] Kiểm tra release, latest.json, chữ ký và URL mirror bộ cài.

## Kết quả phát hành

Phát hành ngày 14/10/2026 lúc 17:05 (Asia/Saigon), source `3151cd3`,
tag `jpos-v2.0.2`. GitHub Actions run `38546476985` hoàn tất thành công.
[Bản phát hành](https://github.com/machhoai/JPOS/releases/tag/jpos-v2.0.2)
đã public, không phải draft/prerelease.

Đã deploy getPosAuthSession, onMemberProfileChange, retryMemberProfileChanges,
onMemberImportCacheChanged, onMemberRegistrationCreated,
recoverMemberRegistration, onMemberCardReturnJob, processMemberCardReturnJob.
Rules/indexes deploy từ repository bduck-system; không xóa index ngoài source.
Query gợi ý Firestore, worker ACTIVE và queue RUNNING đã kiểm tra; không có
schedule synchronizeHKMemberDirectory.

Đã tải `JPOS_2.0.2_x64-setup.exe` (44,870,993 bytes), kiểm tra chữ ký bằng
production public key. Bytes mirror Firebase Storage khớp bộ cài GitHub.
Endpoint updater đang cấu hình trả version 2.0.2 và đủ ba dòng mô tả ở trên.
SHA-256: `808f48c70983100305290bd2c2a0d5e61e16eb7e5fd968d5ebd838d45143550f`.
Kết quả kiểm tra lưu tại `.firebase/releases/2.0.2/verification.json` (ignored).
Không chạy installer lên máy POS trong lượt phát hành; máy nhận bản mới qua
chức năng cập nhật ứng dụng hiện có.

Gia hạn chưa được thử mutation trên dữ liệu khách thật; release không tự gửi
lệnh gia hạn. Đầu đọc thật cần kiểm chứng tại POS. Chi tiết các luồng được lưu
trong báo cáo triển khai từng chức năng.
