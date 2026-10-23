# Phát hành JPOS 2.0.3

Ngày phát hành: 23/10/2026, Asia/Saigon.

- Source: `93173c96df4dfb2f4ebca79bfb0f37f8d5f2a80a`, tag `jpos-v2.0.3`, đã push lên main.
- Release: https://github.com/machhoai/JPOS/releases/tag/jpos-v2.0.3
- GitHub Actions: https://github.com/machhoai/JPOS/actions/runs/39921659953 — thành công.
- Tự nhận diện thẻ đối tác khi đọc thẻ, mở modal lịch sử và xác nhận khôi phục; không có nút riêng.
- Hiển thị thành viên đang tắt và dùng chung danh bạ thành viên giữa cửa hàng.
- Cho phép gỡ liên kết thẻ thành viên đang tắt.

## Backend và kiểm tra

Đã deploy thành công 4 Function tại asia-southeast1, project jw-system-f2104:
getPosAuthSession, onPartnerCardRecovery, onMemberCardReturnJob,
processMemberCardReturnJob. Không bật thêm cron nhập danh bạ.

224/224 kiểm thử Functions và 71/71 kiểm thử frontend đạt. Browser QA luồng
đọc thẻ/khôi phục đạt. CI kiểm tra production, static build, build Windows,
ký updater và mirror bộ cài đều thành công.

Bộ cài JPOS_2.0.3_x64-setup.exe: 44.872.081 bytes.
SHA-256: `649ff27740aee9a45118c96c5d8c9eba89000c53690b567896e319711d2df973`.
Đã xác thực chữ ký updater với production public key. Bytes mirror Firebase
Storage khớp bộ cài GitHub; endpoint updater cấu hình trong ứng dụng trả 2.0.3,
đúng chữ ký và release notes. Kết quả: `.firebase/releases/2.0.3/verification.json`
(ignored). Không chạy cài đặt trên máy quầy hoặc khôi phục thẻ thật trong lượt này.

## Dữ liệu dùng chung và phạm vi commit

JPULSE đã commit/push `d185aba2`: permission pos.members.restore_card, rules deny
và index exemptions cho pos_partner_card_recoveries. Lượt này chỉ deploy
Functions; rules/indexes là cấu hình source, chưa deploy lại. Default deny hiện
hành vẫn bảo vệ collection, Function truy cập qua Admin SDK. Việc phân quyền
cho nhân viên tiếp tục theo RBAC, không tự cấp thêm quyền.

Các thay đổi có sẵn ngoài phạm vi và các script/dữ liệu thử nghiệm cũ được giữ
nguyên trong working tree, không đưa vào commit phát hành.
