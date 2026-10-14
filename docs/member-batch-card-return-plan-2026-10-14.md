# Gỡ liên kết thẻ hàng loạt tại /members/batch — nghiên cứu và kế hoạch

Ngày 14/10/2026. Phạm vi hiện tại: nghiên cứu/lập kế hoạch, chưa sửa code,
chưa gọi API trả thẻ và chưa thay đổi HK hoặc Firestore.

Cập nhật triển khai: người dùng đã duyệt và chỉ định thẻ của số 0938571951 để
thử gỡ/gắn lại. Đã thực hiện và khôi phục liên kết. OpenAPI trả lỗi lấy thông
tin thiết bị; dùng cashier return/confirm đã kiểm chứng từ module jingjian.
Kết quả, thay đổi metadata thẻ và các giới hạn ghi trong
`member-batch-card-return-results-2026-10-14.md`. Mô tả phạm vi ở trên là lịch sử
thời điểm lập kế hoạch, không phải trạng thái cuối.

## Mục tiêu

Nhân viên đặt lần lượt thẻ lên đầu đọc, JPOS đưa vào danh sách. Khi đủ danh sách,
nhân viên chọn **Gỡ liên kết thành viên với thẻ**. Chỉ gỡ các thẻ được chọn khỏi
thành viên; giữ tài khoản/UID, thông tin cá nhân, thẻ khác và tài sản thành viên.
Thẻ đã được HK xác nhận rảnh có thể dùng lại qua luồng cấp thẻ hiện có.
Không hoàn cọc, không tạo đơn hoàn tiền, không bật cron/quét danh bạ.

## Nguồn và kết quả nghiên cứu

1. `海外-鲸舰-OpenApi_EN.md`, mục **Membership refund** khoảng dòng 1641–1714:
   `POST /openapi/action`, action **member_return_card**, version **10.11.8**.
   Payload ví dụ có `employeeName`, `bizCode`, `memberCode`, `isReturnDeposit`.
   Mục generate-sign khoảng dòng 14890–14918 xác nhận cùng bốn field.
2. Bảng tham số của mục này bị chép nhầm: ghi member_switch_status/uid/enable
   thay vì return_card. Response thành công/thất bại đều "No data". Vì vậy không
   suy ra schema response, tính idempotent hay bảo toàn số dư chỉ từ bảng đó.
3. App cài ở `C:/Users/machh/AppData/Local/Programs/jingjian/resources/app.asar`
   có version **11.6.1**, route `member-return-card`, component MemberReturnCard.
   Đây là shell tải các module riêng.
4. Module thực tế cache trên máy:
   `C:/Users/machh/AppData/Local/Programs/client-window-files/packages/member-return-card_11.10.1/member-return-card.umd.cjs`.
   Đã đọc trực tiếp mã module; cũng có bản 11.4.12/11.6.12/11.8.5 trong cache.
   Chưa xác nhận manifest phiên đăng nhập hiện tại đang chọn bản nào.

### Hành vi "批量退卡" của jingjian

- Hai chế độ: trả thẻ một thành viên và trả thẻ hàng loạt.
- Mỗi lần reader trả `memberCode`, gọi GET
  `/member/cashier/MemberCard/return/info?memberCode=...` để lấy thông tin cọc.
- Chống trùng theo memberCode, thêm vào danh sách, đánh số thứ tự; cho xóa dòng.
  Sau mỗi thẻ gọi clear trên ô đọc thẻ để nhận thẻ tiếp theo.
- Bấm xác nhận gửi POST `/member/cashier/MemberCard/return/batchconfirm`:

```json
{
  "item": [{ "memberCode": "MA_THE" }],
  "isReturnDeposit": false
}
```

- Header `JJ-BizCode` lấy từ jingjian.bizCode; khi thành công refresh bizCode,
  thông báo và đóng cửa sổ. Module chỉ kiểm tra success tổng, không chứng minh
  backend thực hiện nguyên tử cả lô hoặc có kết quả riêng từng thẻ.
- Quyền gốc: `Member-Return-Card`. Module mặc định hoàn cọc=true; JPOS phải
  đặt rõ false theo phạm vi gỡ liên kết, không sao chép mặc định này.

**Phát hiện quan trọng:** module ghi rõ thẻ khách vãng lai khi gỡ liên kết có
thể xóa số dư tài khoản. Không hoàn cọc không loại bỏ tác động này.
Tài liệu member_list mô tả memberLevelType: 1 thành viên, 2 khách vãng lai,
3 thẻ sửa máy, 4 thẻ công cộng. Đề xuất bản đầu chỉ chấp nhận **type=1** đã
được xác minh từ HK; chặn type 2/3/4, unknown và các trường hợp chưa xác định
được loại tài khoản. Không dùng tên/hạng hiển thị để đoán loại.

`/member/returncard` ở dòng khoảng 13422 là **message push** thông báo trả thẻ,
không phải endpoint để yêu cầu gỡ. Không gọi nhầm endpoint này.
Không dùng member_switch_status/member_card_switch_status để thay thế: đổi
trạng thái tài khoản/thẻ không chứng minh thẻ đã rảnh để cấp lại.

## Tận dụng phần đang có

- Route/page: `src/app/members/batch/page.tsx`.
- `useMemberBatchProcessor` đang chạy tuần tự: đọc/xác thực thẻ → đăng ký
  thành viên → gắn thẻ → nạp điểm. Có điểm dừng an toàn, retry và checkpoint.
- `useMemberBatchStore` dùng Zustand persist giữ lô khi đóng/mở ứng dụng.
- `readMemberCard`, `cancelMemberCardRead` và đầu đọc Decard hiện có trả
  memberCode, cardUuid, serialNumber; tái sử dụng cho thu danh sách.
- **Không dùng prepareMemberCardForIssue nguyên xi**: hàm đó kiểm tra thẻ chưa
  gắn, trong khi chế độ mới cần nhận thẻ đang gắn. Chỉ tái sử dụng thao tác đọc,
  kiểm tra hai lần khớp chip/mã khi cần và cơ chế chờ thẻ khác.
- Backend đã có get member by card, get cards by UID, cashier getdetails và
  kiểm tra thẻ sẵn sàng cấp. Các API HK phải tiếp tục nằm trong `functions/`.
- Local hiện có `pos_members.memberCode` và
  `pos_members.hkSnapshot.memberCardList`, không chỉ một field duy nhất.
- `MemberBatchWorkspace.tsx` hiện dài **496 dòng**. Khi sửa phải tách thành
  các component dưới 200 dòng theo project rules, giữ nguyên luồng tạo lô.

## Thiết kế luồng

### 1. Hai chế độ trong /members/batch

Giữ tab **Tạo thành viên/cấp thẻ hàng loạt**, thêm tab **Gỡ liên kết thẻ**.
Không đổi chế độ/điểm bán khi đang đọc hoặc đang xử lý; dừng tại điểm an toàn.
Tab mới không yêu cầu file Excel, thông tin đăng ký hoặc điểm nạp.

Hiển thị nút Bắt đầu đọc/Dừng đọc, số thẻ, danh sách mã thẻ, thành viên hiện
liên kết, trạng thái, lý do lỗi và thao tác bỏ dòng. CTA cuối:
**Gỡ liên kết thành viên với thẻ**. Dialog xác nhận số thẻ và phạm vi thao tác;
không hoàn tiền/cọc, không xóa thành viên. Chỉ dòng hợp lệ được xác nhận.

### 2. Thu danh sách liên tục

Đọc một thẻ → xác minh dữ liệu đọc → chống trùng → backend preview HK xác định
đúng owner/shop/chip/loại tài khoản → thêm dòng → chờ thẻ mới.
Giữ thẻ trên reader không sinh nhiều dòng hoặc gọi HK liên tục. Cùng mã thẻ
nhưng khác UUID, hoặc cùng UUID nhưng khác mã, báo cần kiểm tra, không tự ghi đè.
Thẻ lỗi/không thuộc shop/loại bị chặn hiển thị lý do; vẫn có thể đọc thẻ tiếp.

Thẻ không còn owner chưa được coi là rảnh chỉ vì API lookup báo không thấy.
Cần kiểm tra trạng thái cấp lại: rảnh thật → ALREADY_FREE, không gửi yêu cầu
gỡ; lỗi kết nối/thiếu bằng chứng → NEEDS_REVIEW. Không nhận riêng serial đọc
được như bằng chứng đã xác minh memberCode/chip.

### 3. Chốt lô và xử lý tuần tự

Lưu job/items bền vững trên Firestore trước khi gọi mutation HK. Mỗi item có
operationId/bizCode cố định, mã thẻ/UUID, UID/MID/quan hệ thẻ đã preview, scope,
actor/device và checkpoint. Freeze danh sách khi bắt đầu; thẻ đọc thêm phải
nằm trong lô tiếp theo, không tự nhập vào lô đang chạy.

Ưu tiên **member_return_card từng thẻ** với isReturnDeposit=false, vì API này
có trong tài liệu và cho phép theo dõi từng kết quả. Endpoint batchconfirm của
jingjian được ghi nhận để đối chiếu, chưa chọn làm mặc định khi chưa biết
partial-success/atomicity. Không gửi cả lô rồi đoán mọi thẻ đều thành công.

Worker chạy theo từng job bằng sự kiện/Cloud Tasks có retry giới hạn, không
cron. Tuần tự trong lô giúp giảm xung đột và dễ đối chiếu. UI nhận jobId nhanh,
hiển thị tiến độ; backend tiếp tục khi nhân viên rời màn hình. Dừng/hủy lô chỉ
dừng các item chưa thực hiện, không tự gắn lại những thẻ đã gỡ.

### 4. Kiểm tra ngay trước mutation

Backend xác minh lại Auth/device/quyền, shop, chủ thẻ hiện hành, chip/quan hệ
thẻ, memberLevelType và trạng thái tài khoản. Nếu owner hoặc chip đổi so với
preview thì dừng dòng; không gỡ thẻ của owner mới.
employeeName lấy từ dữ liệu nhân viên tin cậy trên backend, không tin input UI.
Khóa theo physical card và UID, dùng chung với luồng cấp/gắn thẻ JPOS để ngăn
gắn lại trong lúc đang gỡ/đối chiếu. Phối hợp với lease chỉnh sửa member hiện có.

Giới hạn hợp đồng: member_return_card chỉ có memberCode, không có điều kiện
UID/card-version expected trong ví dụ. Khóa JPOS không kiểm soát công cụ bên
ngoài cùng sửa HK. Không hứa bảo đảm tuyệt đối khi có tác nhân ngoài JPOS đổi
owner đúng giữa kiểm tra và request; mọi kết quả mơ hồ phải đối chiếu, không
gửi lại mù quáng. Giữ cùng bizCode khi retry, nhưng chưa coi đó là idempotency
đã được HK xác nhận.

### 5. Xác nhận HK rồi cập nhật local

Sau response thành công, đọc lại danh sách thẻ của UID cũ và kiểm tra trạng thái
cấp lại. Thành viên phải vẫn tồn tại; không được còn quan hệ với thẻ đã gỡ.
Thẻ đã gắn sang người khác thì đánh dấu CARD_REASSIGNED, không gọi gỡ tiếp.

Chỉ sau xác nhận mới transaction cập nhật member local và trạng thái item:

- Nếu memberCode chính bằng mã vừa gỡ, cập nhật bằng một thẻ còn lại đã được
  xác minh hoặc null khi không còn. Nếu primary đang là thẻ khác, giữ nguyên.
- Loại đúng entry thẻ khỏi hkSnapshot.memberCardList, không xóa toàn bộ mảng,
  không sửa tên/phone/email/số dư, profileRevision hay history chỉnh sửa.
- Không tự tính các tổng HK từ độ dài mảng thẻ hoặc dựng snapshot "đầy đủ" giả.
  Đánh dấu cache snapshot cần đối chiếu và vô hiệu hóa manifest hash của UID
  bằng cơ chế importer hiện có/transaction phù hợp. Không dùng hash stale như
  bằng chứng đã đối chiếu toàn bộ nguồn; cũng không bật quét danh bạ để sửa cache.
- Backend đọc current document trong transaction; không dùng set thay toàn bộ
  hồ sơ hoặc dữ liệu preview cũ ghi đè thẻ mới/profile vừa chỉnh sửa.
- Nếu member chưa có local, xác minh HK rồi lưu tối thiểu đúng schema qua luồng
  seed hiện có; không tạo nhầm thành viên mới trên HK hoặc đổi ownership tùy ý.

HK đã gỡ nhưng Firestore lỗi → HK_CONFIRMED/LOCAL_PENDING. Retry chỉ hoàn tất
local, không gỡ HK lần nữa. Timeout sau mutation → UNKNOWN; kiểm tra owner,
thẻ cũ và availability trước khi quyết định. Không thông báo "thẻ dùng lại
được" khi chỉ nhận success mà chưa đối chiếu.

## Trạng thái và nhật ký

Item: READY → CHECKING → SENDING → HK_CONFIRMED → COMPLETED.
Nhánh phụ: ALREADY_FREE, INVALID, UNKNOWN, LOCAL_PENDING, CARD_REASSIGNED,
NEEDS_REVIEW, SKIPPED. Job tổng hợp hoàn tất một phần; kết quả/error theo từng
thẻ, retry chỉ dòng chưa hoàn tất, xuất CSV kết quả. Ngày giờ hiển thị
dd/mm/yyyy HH:mm theo AGENTS; ISO chỉ cho lưu trữ/API.

Đề xuất collection backend-only `pos_member_card_return_jobs`, items/attempts
là subcollections; khóa `pos_member_card_locks` phối hợp cấp/gỡ.
Đã tìm các tên này trong source/rules/indexes POS và bduck-system, chưa thấy
xung đột. Khai báo constants/schema/rules/indexes trước code. Quyền POS mới
`pos.members.return_card` đăng ký ở registry bduck-system, không tự cấp quyền
cho tài khoản thật. Trang cấp thẻ hiện có không bị đổi quyền ngoài phạm vi cần.

## Task list và thứ tự triển khai

- [x] Đọc tài liệu OpenAPI và code module thẻ trả lại hàng loạt trên máy.
- [x] Đối chiếu reader/batch hiện có, schema local, nguy cơ thẻ khách vãng lai.
- [x] Viết kế hoạch; chưa triển khai mutation.
- [x] Chốt hợp đồng bằng thử nghiệm kiểm soát trên thẻ thử được chỉ định: member
  type=1, không hoàn cọc, số dư/tài khoản không đổi, thẻ rảnh và cấp lại được.
  Không dùng thẻ khách thật để thử. Ghi schema response/thông báo lỗi thực tế.
- [x] Tách workspace cũ về các file UI <=200 dòng; thêm chế độ/thu danh sách.
- [x] Backend preview/permission/policy, operation/bizCode và locks dùng chung
  với gắn thẻ; job bền vững và worker giới hạn retry.
- [x] Cleanup local chính xác, snapshot invalidation và phục hồi LOCAL_PENDING.
- [x] UI tiến độ/dừng an toàn/retry phần còn lại/CSV, Zustand persist và scope.
- [x] Rules/indexes/permission registry hợp nhất bduck-system, không deploy
  rules POS riêng; kiểm thử và phát hành đúng Function cần.
- [x] Báo cáo kết quả đối chiếu, giới hạn còn lại; lịch danh bạ vẫn tắt.

## Kiểm thử bắt buộc

Reader giữ thẻ/quét trùng/thay thẻ giữa hai lần đọc; hủy reader/unmount;
thẻ đã rảnh, wrong-shop, guest/special/unknown type, member disabled;
hai thẻ cùng UID và một member có nhiều thẻ; primary khác thẻ đang gỡ;
Firestore lỗi trước mutation không gọi HK; lỗi sau HK chỉ sửa local;
timeout/delivery trùng không gỡ owner mới; thao tác cấp thẻ đồng thời bị khóa;
đóng/mở JPOS tiếp tục job; pause/dừng có checkpoint; partial-success hiển thị
đúng từng dòng; UID/thông tin/số dư/thẻ khác giữ nguyên; thẻ gỡ cấp lại được.

Khi triển khai áp dụng frontend-expert/brand-guidelines, Tailwind/gooey-toast
theo project rules. Skill brainstorm không có trong catalog/repository; kế hoạch
dựa trên yêu cầu cụ thể và bằng chứng đã đọc, không giả lập đã dùng skill này.
