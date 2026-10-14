# Gia hạn giá trị lưu trữ — 14/10/2026

## API tìm thấy

`海外-鲸舰-OpenApi_EN.md` không có API chuyên biệt cho **储值延期**.
Các trường `memberDelayValue`, `memberDelayMode`, `isResetMemberExpiry` trong
định nghĩa gói liên quan đến hạn thành viên, không xác định thao tác khôi phục
từng khoản giá trị hết hạn.

Đã đọc `C:\Users\machh\AppData\Local\Programs\jingjian\resources\app.asar`:
ứng dụng Electron phiên bản 11.6.1 tải các module nghiệp vụ bên ngoài.
Đối chiếu trực tiếp module đang lưu trong:

`C:\Users\machh\AppData\Local\Programs\client-window-files\packages\accountOf_11.8.1\accountOf.umd.cjs`

Bản dễ đọc ở `.agent/jingjian-analysis/accountOf-11.8.1.pretty.cjs`,
phần lấy khoản giá trị khoảng dòng 65149 và phần gửi gia hạn dòng 65306.

- Đọc khoản giá trị: `GET /member/cashier/memberstore/getenabledstores`,
  query `memberId`, `memberAcctId`, `category`.
- Xu giới hạn thời gian: `GET /member/cashier/memberstore/timecoinbatch`,
  query `memberId`, `memberAcctId`, `page`, `limit`.
- Gia hạn: `POST /member/cashier/memberstore/delay`.
- Body: `memberAcctId`, `delayId` (ID khoản giá trị), `delayDate` (`yyyy-mm-dd`),
  `remark`, `memberCode` khi có. Header `JJ-BizCode` giữ nguyên khi thử lại.
- Quyền gốc: `Auth_Store_Delay`. Ứng dụng gốc chỉ bổ sung payload ủy quyền khi
  tài khoản đang đăng nhập chưa có quyền; backend POS dùng tài khoản tích hợp
  được cấu hình và để HK kiểm tra quyền trên tài khoản đó.

API quầy sử dụng loại tài khoản **101/102/104/105/106/107**, khác OpenAPI
**1/2/4/5/6/7**. `uid` của OpenAPI tương ứng `memberAcctId`;
`mid` tương ứng `memberId`. Giao diện dùng các loại thực có trong
`getdetails.memberStoreInfo`, loại bỏ vé/gói vé/coupon vì có API riêng.

Khoản hết hạn lấy giá trị từ `limitAmount`, khoản còn hạn lấy `amount`.
Xu giới hạn thời gian lấy `enableAmount` khi API trả trường này. Module Jingjian
cũ có ghi chú về 3 tháng; module mới cho chọn khoảng ngày để tìm dữ liệu cũ hơn.
Khoản không giới hạn, hết giá trị
hoặc thuộc cửa hàng khác không được chọn để gia hạn.

## Triển khai

Cập nhật bộ lọc khoảng ngày theo module
`client-window-files/packages/member-info_11.10.1/member-info.umd.cjs`,
component `MemberStoreRenewal`: đọc
`GET /member/cashier/memberstore/getdelaystores`, query `memberAcctId`,
`category`, `startTime` (`yyyy-mm-dd 00:00:00`), `endTime`
(`yyyy-mm-dd 23:59:59`), `page`, `limit`. Bộ lọc là **ngày hết hạn**, đã kiểm
chứng API thật: ngày nhận 11/08/2026 không trả khoản mẫu, ngày hết hạn
31/12/2099 trả đúng khoản đó. Không giới hạn khoảng ngày tìm kiếm trong 90 ngày.
Xóa bộ lọc tìm từ 01/01/2000 đến 31/12/2100. Giao diện đã bỏ câu cảnh báo 3 tháng.
HK hiện trả array đầy đủ, không có `totals`, và bỏ qua `page`; backend phân
trang array theo 50 khoản/trang. Nếu phiên bản HK trả `totals`, dùng phân trang
của server. Trước khi gia hạn khoản cũ, xác minh lại qua `getdelaystores` theo
ngày hết hạn gốc; khi đối chiếu yêu cầu mất phản hồi, tìm theo hạn mới để vẫn
xác nhận được kết quả sau khi khoản rời khỏi khoảng lọc ban đầu.

Thành viên → tra cứu đúng khách → **Gia hạn** → chọn loại và khoản giá trị →
chọn hạn mới, nhập lý do → xem xác nhận → xác nhận gia hạn.
Ngày hiển thị `dd/mm/yyyy`, dùng `DateInput` chung; gửi ngày ISO cho HK.
Giữ quy ước múi giờ Asia/Saigon (+07:00) của cửa hàng.

Callable `getPosAuthSession` thêm `getMemberRenewalBatches` và
`renewMemberStoredValue`. Kiểm tra Auth, device, warehouse, shop cấu hình,
profile đã xác minh và quyền `pos.members.compensate` (quyền điều chỉnh giá trị
thành viên hiện có). HK kiểm tra thêm quyền trên tài khoản tích hợp.
Token tích hợp manager đã được xác minh có quyền đọc các API này; không cần
đăng nhập workplace vật lý. Credentials không được gửi xuống frontend.

Mỗi thao tác có mã UUID, fingerprint bất biến và khóa theo khoản giá trị.
Thành công được replay từ nhật ký; phản hồi từ chối rõ ràng cho phép thử lại.
Timeout/response không hợp lệ giữ trạng thái UNKNOWN, không tự gửi lại mutation.
Đối chiếu hạn tuyệt đối trên HK khi kiểm tra lại; nếu chưa xác nhận được thì giữ
khóa để tránh gia hạn trùng. Khóa giữ hạn đã xác nhận để chặn yêu cầu đọc dữ liệu
cũ ghi đè một hạn mới hơn. Yêu cầu chưa rõ kết quả được phục hồi khi mở lại tab
từ nhật ký backend của cùng nhân viên/thiết bị/loại giá trị.

## Kiểm chứng và giới hạn

- TypeScript frontend và build Functions, ESLint các file giao diện đã sửa.
- 35 test backend qua: 12 test gia hạn/tìm kiếm và 23 test policy/cấp thẻ liên quan.
- Browser QA dùng component thật và response giả: chọn khoản phù hợp, chỉ hiện
  loại có thực, từ chối ngày sai, bước xác nhận, khóa khi đang gửi, phục hồi sau
  mất phản hồi và mở lại tab, giữ nguyên request khi thử lại, tải lại số dư.
  Kiểm tra bộ lọc ngày cũ, query ngày ISO, chuyển trang, xóa bộ lọc về trang 1,
  câu thông báo 3 tháng đã được loại bỏ. Kiểm tra kích thước desktop/mobile,
  không tràn ngang, không lỗi runtime và
  không có request ra dịch vụ bên ngoài. Script: `scripts/member-renewal-ui-qa.cjs`.
- Build cuối gặp biến `previews` chưa khai báo kiểu ở chức năng gỡ thẻ đang có
  trong workspace; bổ sung kiểu owner theo `CardReturnJob`, không đổi hành vi.
- Đọc thật `getdetails`: UID/MID khớp; danh sách `getenabledstores` là array,
  có `id`, `shopId`, `limitTime`, `amount`, `limitAmount` đúng dự kiến.
- Đọc thật loại 101/102/106/109: mapper hoạt động; tài khoản mẫu có Tiền/Lượt
  không giới hạn, các loại còn lại không có khoản để gia hạn.
- Cửa hàng không cấu hình 116/117; giao diện chỉ hiển thị loại tài khoản có thực.
- Đăng nhập cashier workplace bằng tài khoản cấu hình bị từ chối; token manager
  của cùng tài khoản đọc được endpoint quầy. Không thay đổi luồng đăng nhập của
  các chức năng khác.
- Chưa gửi lệnh gia hạn lên dữ liệu thật, nên chưa xác minh quyền ghi
  `Auth_Store_Delay` và hành vi phục hồi sau gia hạn của backend HK thật.
- Chưa deploy Functions/frontend/rules. Không deploy riêng `firestore.rules`
  POS; phải hợp nhất với repository chủ quản `bduck-system` trước khi phát hành.
