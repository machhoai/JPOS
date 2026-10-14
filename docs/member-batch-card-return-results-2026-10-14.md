# Gỡ liên kết thẻ hàng loạt — kết quả triển khai 14/10/2026

Đã thêm chế độ **Gỡ liên kết thẻ** tại `/members/batch`. Nhân viên đọc lần lượt
thẻ, xem danh sách đã xác minh, bỏ dòng không cần rồi xác nhận lô. Thẻ giữ trên
reader không tạo dòng/truy vấn trùng. Có tiến độ, dừng tại điểm an toàn, tiếp tục
phần chưa xong, xuất CSV và phục hồi job sau mở lại màn hình.

## API thực tế và thử nghiệm đã được chỉ định

Người dùng cho phép thử thẻ liên kết số **0938571951**, rồi gắn lại. Fixture xác
nhận **01PAYJOYW002820**, UID `f591a267-e79c-4f87-afc9-856213e5e056`, loại
thành viên thông thường=1 và cọc trả=0. Đã lưu baseline trước thao tác.

OpenAPI `member_return_card` trả success=false, msg **Lỗi lấy thông tin thiết
bị** với cấu hình app hiện tại; kiểm tra sau request thẻ vẫn gắn.
Vì vậy luồng triển khai dùng endpoint mà module jingjian dùng thực tế:

```text
POST /member/cashier/MemberCard/return/confirm
JJ-BizCode: operationId cố định
body: memberCode, memberId đã xác minh, isReturnDeposit=false
```

Response gỡ thật: success=true, code=0, data=null. Đã kiểm chứng thẻ biến mất
khỏi danh sách thẻ của UID cũ và endpoint take/check chấp nhận thẻ để cấp lại.
Sau đó đã gắn lại đúng mã/chip cho UID cũ bằng luồng cashier cấp thẻ hiện có.
Luồng mua thẻ miễn phí chỉ được dùng khi HK không còn lượt nhận thẻ sẵn;
helper hiện có kiểm tra giá/cọc bằng 0 trước tạo đơn, không tạo khoản thu mới.

Kết quả cuối:

- **Liên kết mã thẻ/chip/UID đã khôi phục.**
- Phone, realName, nickName, sex, birthday, email và các mảng số dư trả bởi
  member_getmember_uid không khác baseline.
- Thời gian tạo liên kết thẻ và ghi chú nhận thẻ **thay đổi**, vì HK tạo quan
  hệ cấp thẻ mới khi gắn lại. Không tuyên bố các metadata đó trở về ngày cũ.
- Đã làm mới riêng snapshot thẻ của member này trong Firestore và hash shard
  tương ứng: 2 document reads, 2 writes; primary memberCode giữ nguyên.
  Không quét danh bạ, không ghi đè core profile local.
- Thiết bị đọc thẻ vật lý không có tại đây; kiểm chứng API gỡ/cấp lại là thật,
  còn vòng đọc liên tục và xác minh hai lần được thử với reader giả lập.

## Bảo vệ trong backend

Auth/device/shop/warehouse và quyền **pos.members.return_card** được kiểm tra
ở callable. Worker kiểm tra lại quyền hiện hành. Preview dùng chủ thẻ/loại
tài khoản từ HK, khớp chip đọc và shop; yêu cầu UID/MID/ID quan hệ thẻ hợp lệ.
Chặn khách vãng lai, thẻ máy/thẻ công cộng, loại không rõ, thành viên disabled.
Không chỉ dựa vào tên hạng để suy ra loại thành viên.

Preview trả token HMAC có hạn 2 giờ, ràng buộc actor/scope/chip/chủ thẻ. Tạo lô
kiểm tra token và lưu ngay, không gọi lại HK tuần tự cho cả 100 thẻ. Worker vẫn
đối chiếu HK tươi ngay trước mutation. Mã lô và requestHash bảo vệ retry khi
mất response; danh sách sau submit được freeze. Lô tối đa 100 thẻ.

Khóa physical card và UID dùng chung với confirmMemberCardIssue. Nếu API cấp
thẻ bị lỗi/mơ hồ, lease ngắn giữ lại tối đa 3 phút; gỡ không chen vào giữa lần
gắn đó. Khóa gỡ thẻ đang UNKNOWN/LOCAL_PENDING được giữ để không gắn lại trước
khi đối chiếu. Kiểm tra UID/MID/chip và ID quan hệ thẻ giúp phát hiện gắn lại
ngay cả khi thẻ trở về cùng UID. Không gửi gỡ lại khi outcome trước chưa rõ.
API chỉ nhận memberCode, không có compare-and-set owner trên HK; khóa JPOS
không kiểm soát thao tác đồng thời từ công cụ bên ngoài.

Sau HK, kiểm tra thẻ không còn ở UID cũ và được HK chấp nhận cấp lại. Chỉ sau
đó transaction mới cập nhật local cùng trạng thái item. Primary bằng mã bị gỡ
thì đổi sang thẻ còn lại đã xác minh hoặc null; primary khác giữ nguyên.
Chỉ loại đúng thẻ trong hkSnapshot.memberCardList, giữ profile/số dư/thẻ khác.
Hash snapshot cũ không được dựng lại như đã đồng bộ toàn nguồn: thay đổi cache
thẻ làm hash không khớp; guardian importer hiện có vô hiệu hóa manifest của
UID để lần đồng bộ thủ công sau đối chiếu lại. Không mở cron để sửa cache.

HK xong/local lỗi → LOCAL_PENDING; retry chỉ xác nhận và hoàn tất local.
SENDING/UNKNOWN → đọc đối chiếu, không tự gửi lại. Nếu chủ/link đổi hoặc thẻ
vẫn gắn sau kết quả mơ hồ, NEEDS_REVIEW. Sai quyền hoặc khóa bận được dừng có
giới hạn, tránh tự enqueue vô hạn. Retry do nhân viên yêu cầu kiểm tra quyền
lại; item chưa từng gửi hoặc bị HK từ chối rõ ràng mới được gửi lại sau kiểm
tra tươi. Item đã hoàn tất không chạy lại.

## Lưu trữ, queue và chi phí đọc

`pos_member_card_return_jobs` backend-only chứa tối đa 100 item trong một
document, operationId/checkpoint/lỗi/lease/requestHash. Subcollection attempts
giữ kết quả từng lần. `pos_member_card_locks` backend-only chứa khóa.
Rules/indexes hợp nhất từ repository chủ quản bduck-system; không force xóa
remote index ngoài source. Items/requestHash/lease tắt single-field indexes.
Quyền mới được khai báo trong registry, không tự sửa role của nhân viên thật.

`onMemberCardReturnJob` enqueue khi job chuyển QUEUED; worker
`processMemberCardReturnJob` chạy tối đa 3 thẻ/lượt hoặc ngân sách thời gian,
sau đó tiếp tục theo sự kiện. Hai worker tối đa, retry vận chuyển 6 lần,
backoff 30–300 giây. Business retry mỗi item tối đa 6 lần, có backoff tương ứng;
Firestore event retry giúp không mất enqueue, khác với retry xử lý item.
Không có lịch định kỳ. Worker tiếp tục khi đóng màn hình; UI polling 4 giây
chỉ khi còn lô hoạt động, một document mỗi lần, không cho request poll chồng.
Khi rời màn hình hoặc lô hoàn tất/pause/review, polling dừng.

Đã cấp quyền cloudtasks.enqueuer trên đúng queue cho runtime service account;
actAs trên chính account đã có từ cơ chế phục hồi đăng ký. Đã kiểm chứng thật
Firestore event → enqueue → dispatch → hoàn tất task bằng fixture có lease
bảo vệ và xóa trước dispatch; không thao tác thẻ khách trong bài queue test.
Các fixture/task thử nghiệm đã dọn. Secret cashier cloud khớp cấu hình dùng
trong thử nghiệm thật; chỉ so sánh trong bộ nhớ, không xuất credential.

## Giao diện và xác minh

Workspace cũ 496 dòng đã tách thành controller, presentation, panels và table.
Các file UI mới đều dưới 200 dòng; giữ luồng Excel → tạo member → gắn thẻ →
nạp điểm, recovery và xuất kết quả. UI tiếng Việt, Tailwind, gooey-toast;
ngày hiển thị qua formatDateTime theo dd/mm/yyyy HH:mm.

- **194/194 Functions tests** đạt, gồm **22 test** mới cho worker/policy/API:
  token sửa/sai scope, lỗi lưu job trước HK, giữ core/other cards, retry mất
  response, local failure, đổi owner/link, pause, shared lock, giới hạn retry
  và mất quyền không tạo loop vô hạn; guest/unknown/wrong-shop bị chặn.
- **71/71 frontend tests** đạt; lint các file frontend sửa và static build đạt.
- Browser QA dùng component/hook/store thật với service/reader giả: quét liên
  tục, giữ thẻ không preview lại, guest bị chặn, freeze danh sách, kết quả
  partial/local pending và reload cùng job đạt; không có browser error.
- Đã xem ảnh danh sách/tiến độ; hình và kết quả QA ở
  `.firebase/card-return-ui-qa/` (ignored).

Backend phát hành chọn lọc getPosAuthSession, onMemberCardReturnJob và
processMemberCardReturnJob vùng asia-southeast1. Không bật lại đồng bộ danh bạ
02:00/audit thứ Hai hoặc phát hành scheduled worker mới. Frontend đã build;
chưa phát hành installer Tauri/tự cập nhật các máy POS trong lượt này.

Nhân viên cần được quản trị viên cấp quyền pos.members.return_card nếu chưa
có quyền wildcard. Cần thử vòng đọc với đầu Decard thực tại POS để xác nhận
phần cứng; không tuyên bố đã kiểm chứng đầu đọc vật lý khi không có thiết bị.

```powershell
node scripts/member-card-return-ui-qa.cjs
```

Baseline thẻ thử/response/checks trong `.firebase/card-return-contract/`,
bị Git ignore. Không commit credential hoặc snapshot dữ liệu khách.
