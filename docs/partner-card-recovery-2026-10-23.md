# Khôi phục thẻ đối tác tại quầy — 23/10/2026

## Giao diện

Trang Thành viên **không có nút khôi phục riêng**. Dùng luồng **Đọc thẻ** hiện
có để phát hiện thẻ đối tác rồi mở modal. Nhân viên cần quyền
`pos.members.restore_card` (hoặc wildcard hiện có) để xác nhận:

1. Đọc thẻ vật lý, đối chiếu mã thẻ và chip bằng một document đích trong danh
   sách 600 thẻ. Thẻ thường không mở modal và tiếp tục tra cứu bình thường.
   Thẻ đủ điều kiện tự mở modal; thiếu quyền chỉ xem thông tin, không xác nhận.
2. Hiển thị thành viên, số điện thoại, trạng thái và lịch sử đã lưu: tạo thành
   viên, ghi nhận thẻ trên POS, vô hiệu hóa, gỡ liên kết, xác nhận khôi phục.
3. Nút **Xác nhận khôi phục thẻ** đọc lại đúng thẻ với dynamic serial nếu có,
   rồi gửi xác nhận đã ký. Sai mã/chip hoặc thẻ ngoài danh sách bị chặn.
4. Backend xử lý nền; modal đọc một document mỗi 3 giây khi còn hoạt động,
   không chồng polling, dừng khi hoàn tất/rời màn hình/đổi điểm bán.
5. Thành công chỉ có nút **Mở hồ sơ thành viên**. Không có Đọc tiếp hay Xác
   nhận lại. Mở hồ sơ bằng UID thành viên gốc và luồng tra cứu hiện có.

## Dữ liệu, quyền và bảo mật

`pos_partner_card_recoveries` là collection POS backend-only, mỗi mã thẻ có
document ID SHA256(shopId:memberCode). Không có API liệt kê toàn bộ danh sách.
Record giữ UID/MID/chip/chủ cũ, điểm tạo, lịch sử và checkpoint khôi phục.
Nguồn seed là các bản sao và nhật ký gỡ thẻ đã kiểm chứng trong `.firebase/`.
Đã tạo đủ 600 record AVAILABLE: **0 reads, 600 writes**, không kích hoạt tài
khoản hoặc gắn lại bất kỳ thẻ nào. Script create-only không ghi đè record cũ.

Permission registry của bduck-system đã khai báo quyền mới; không tự cấp quyền
cho nhân viên thật. Người có wildcard hiện hành dùng được ngay. Để phân quyền
riêng từ giao diện quản trị, cần phát hành registry trong ứng dụng quản trị.

Rules và index source được bổ sung ở POS và repository chủ quản bduck-system.
Không deploy riêng rules POS. Collection mới đang được bảo vệ bởi default-deny
hiện có; kiểm tra REST không đăng nhập trả HTTP 403. Các khai báo tắt index cho
history/requests được chuẩn bị trong source, chưa phát hành thay toàn bộ indexes.

## Xử lý backend

`getPosAuthSession`: detect, preview, confirm, fetch trạng thái. Preview HMAC có hạn
10 phút, ràng buộc actor/điểm bán/shop/chip/mã thẻ/UID. Confirm kiểm tra quyền
thiết bị/nhân viên, tạo checkpoint QUEUED và khóa thẻ/UID dùng chung với luồng
cấp/gỡ thẻ hiện có. Job tiếp tục khi đóng màn hình.

`onPartnerCardRecovery` chạy bằng Firestore event, có lease và retry vận chuyển.
Worker kiểm tra lại quyền, chủ gốc, loại thành viên thông thường và thẻ khác.
Thẻ đã có chủ mới hoặc tài khoản có thẻ khác bị chặn trước khi bật lại.

Luồng: kiểm tra thẻ rảnh và cấu hình nhận thẻ → bật đúng UID → gắn đúng thẻ →
đọc lại liên kết/trạng thái/số dư → cập nhật Firestore và manifest hash cùng
transaction → hoàn tất và giải phóng khóa. Không tạo thành viên mới, không nạp
điểm hay sửa điểm tạo/core profile. Giữ số dư hiện tại; phát hiện số dư thay
đổi giữa hai lần đối chiếu thì yêu cầu quản lý kiểm tra, không tự bù/trừ.

Khi hết lượt nhận thẻ, dùng nhánh cấp lại qua đơn 0 đồng hiện có, chỉ khi giá/
cọc thật bằng 0; không tự miễn giảm thẻ có giá. Mỗi POST HK có checkpoint SENDING
và response DONE, hash payload và bizCode cố định. Nếu mất response, đọc đối
chiếu trước; không gửi lại POST chưa rõ kết quả. HK đã gắn/local lỗi thì lần
kiểm tra tiếp chỉ hoàn tất local. Khóa được giữ khi cần đối chiếu để ngăn thao
tác cấp/gỡ chen vào. Không tự tắt lại tài khoản sau một kết quả gắn chưa rõ.
NEEDS_REVIEW cần nhân viên đọc lại thẻ để đối chiếu; trường hợp POST vẫn mơ hồ
phải được quản lý xử lý, không lặp lại mù quáng.

Khóa chỉ phối hợp các luồng JPOS; không kiểm soát công cụ ngoài JPOS cùng sửa HK.

## Kiểm chứng và phát hành

- Functions: **224/224 tests** đạt, gồm sai chip/ngoài danh sách, quyền/token,
  actor/điểm bán khác, chủ mới, thẻ khác/khách vãng lai, khôi phục và bảo toàn
  điểm tạo, retry sau local failure/response lost, POST mơ hồ và cấp lại 0 đồng.
- Frontend: **71/71 tests**, lint và static build đạt.
- Browser QA dùng dịch vụ phát hiện và component/hook thật, reader/API giả:
  không có nút riêng, thẻ thường tra cứu bình thường, thẻ đối tác tự mở modal,
  lịch sử dd/mm/yyyy,
  đọc lại sai thẻ bị chặn, mất phản hồi được đối chiếu và màn thành công đúng
  một nút mở hồ sơ; không browser error.
- Đã kiểm tra read-only HK take/info và take/deposit cho một thẻ trong lô:
  surplusQty=0 và giá/cọc=0, phù hợp nhánh đã triển khai.
- Đã triển khai getPosAuthSession và onPartnerCardRecovery vùng asia-southeast1
  trên jw-system-f2104. Fixture sự kiện thật với actor/UID giả không có quyền
  chuyển đúng NEEDS_REVIEW, không có remote mutation, sau đó đã xóa fixture.
- Sau điều chỉnh, modal chỉ được mở từ kết quả đọc thẻ đủ điều kiện; entry
  button cũ đã được bỏ. Không cần phát hành worker lần nữa cho thay đổi detect.
- Không khôi phục thử thẻ khách thật. Chưa kiểm tra phần cứng đầu đọc tại quầy;
  frontend mới cần bản JPOS có build này, chưa phát hành installer/tự cập nhật.

Ảnh và kết quả: `.firebase/partner-card-recovery-ui-qa/`.
Nhật ký seed/kiểm tra trigger: `.firebase/partner-card-recovery/` (đều ignored).

Cập nhật phát hành 23/10/2026: JPOS 2.0.3 đã phát hành và xác thực bộ cài,
chữ ký, manifest updater; xem [kết quả phát hành](release-2.0.3.md).

## Điều chỉnh nhận diện ngày 26/10/2026

Sau khi khớp mã thẻ/chip trong ledger, detector tra cứu chủ thẻ hiện tại qua
HK cashier `getmember/list` với `isReadCard: true`. Nếu đã có thành viên đang
liên kết thẻ, trả `recovery: null` để JPOS tiếp tục tra cứu hồ sơ hiện tại.
Điều kiện này áp dụng trước kiểm tra quyền phục hồi và mọi trạng thái ledger,
kể cả COMPLETED; lịch sử trong danh sách 600 thẻ không quyết định chủ hiện tại.
Chỉ kết quả không có chủ thẻ mới tiếp tục luồng modal phục hồi cũ. Lỗi mạng,
response thiếu dữ liệu hoặc lỗi HK khác không được coi là thẻ còn trống.

Không thêm lượt đọc/ghi Firestore vào detector: vẫn một lần đọc ledger theo mã
thẻ, thêm một truy vấn HK chỉ khi mã thẻ/chip khớp danh sách. Worker xác nhận và
đối chiếu lại liên kết trước mutation vẫn giữ nguyên. 228/228 tests Functions
đạt, gồm chủ mới ở mọi trạng thái ledger, không có quyền phục hồi, thẻ đã khôi
phục, thẻ trống và lỗi tra cứu. Thay đổi backend áp dụng với JPOS 2.0.3 hiện có.
