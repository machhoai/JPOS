# Firestore schema — thành viên POS

## Quyền sở hữu và namespace

- Collection: `pos_members`
- Chủ sở hữu schema: POS
- Document ID: `remoteUid` do OpenAPI trả về
- Phiên bản schema hiện tại: `1`
- Truy cập: backend-only qua Cloud Functions Admin SDK

Frontend không đọc hoặc ghi trực tiếp collection này. Tra cứu thành viên bằng
điện thoại hoặc mã thẻ luôn gọi OpenAPI; dữ liệu local chỉ bổ sung ngày sinh,
email và metadata đồng bộ.

## Fields

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `schemaVersion` | `1` | Phiên bản schema bắt buộc |
| `remoteUid` | `string` | Phải trùng document ID |
| `mid` | `string \| null` | Member ID từ OpenAPI nếu có |
| `memberCode` | `string \| null` | Chỉ lưu khi OpenAPI đã xác nhận |
| `phone` | `string` | Số điện thoại đã chuẩn hóa |
| `fullName` | `string` | Họ tên thành viên |
| `gender` | `MALE \| FEMALE \| OTHER \| UNKNOWN` | Giá trị chuẩn hóa |
| `birthDate` | `string \| null` | `YYYY-MM-DD` |
| `email` | `string \| null` | Email chữ thường |
| `shopId` | `number` | Cửa hàng OpenAPI |
| `warehouseId` | `string` | Điểm bán mà nhân viên được phân quyền |
| `createdBy` | `string` | Firebase UID người tạo |
| `updatedBy` | `string` | Firebase UID người cập nhật cuối |
| `createdAt` | `string` | ISO-8601, được bảo toàn khi cập nhật |
| `updatedAt` | `string` | ISO-8601 |
| `lastRemoteSyncAt` | `string` | Lần OpenAPI xác nhận thành công gần nhất |

## Indexes

Repository hiện chỉ đọc theo document ID nên không cần composite index. Các
field PII không được dùng để query local đã tắt single-field index trong
`firestore.indexes.json`: `remoteUid`, `mid`, `memberCode`, `phone`, `fullName`,
`birthDate`, `email`, `createdBy`, `updatedBy`.

`shopId`, `warehouseId`, `updatedAt` và `schemaVersion` giữ index mặc định để có
thể phục vụ tác vụ quản trị/reconciliation có phân vùng trong tương lai mà không
lập chỉ mục trực tiếp trên PII.

## Security Rules

`pos_members` có `allow read, write: if false`. Cloud Functions Admin SDK không
bị Security Rules chặn và là đường truy cập duy nhất.

POS và `bduck-system` dùng chung Firebase project. Không deploy riêng
`firestore.rules` hoặc `firestore.indexes.json` từ repository POS. Trước khi
deploy, phải merge block `pos_members` và các field override vào rules/indexes
chính thức của database dùng chung rồi review toàn bộ diff.


## Mở rộng chỉnh sửa local-first — 13/10/2026

Schema v1 giữ tương thích, bổ sung metadata tùy chọn: `nickName`,
`profileRevision`, `remoteConfirmedRevision`, `remoteSnapshot`, `syncStatus`,
`syncLease`. Baseline được bổ sung khi tra cứu đã xác minh UID/cửa hàng; không
migration phá hủy hồ sơ cũ. Sau khi seed, lookup ưu tiên hồ sơ POS đang pending,
HK vẫn là nguồn số dư/thẻ/hạng.

Collection `pos_member_profile_changes` do POS sở hữu, document ID là operationId;
subcollection `attempts` chứa nhật ký lần đồng bộ. Collection
`pos_member_profile_locks` do POS sở hữu giữ lease theo hash MID/UID. Cả hai
backend-only, không cho frontend đọc/ghi trực tiếp. Hồ sơ và history được tạo
trong cùng transaction; không tăng `lastRemoteSyncAt` khi chỉ lưu local.

Phone vẫn tắt single-field index; lookup mới dùng composite index
`warehouseId + shopId + phone`. History và worker dùng các composite index
được thêm trong source indexes của POS và hợp nhất với `bduck-system`.
Các map trước/sau và snapshot/lease không cần single-field indexing.

Xem [báo cáo triển khai](member-profile-edit-implementation-results-2026-10-13.md)
cho schema thao tác, quyền và trình tự phát hành. Không deploy riêng ruleset POS.

## Danh bạ nhập từ HK — 14/10/2026

`hkSnapshot` giữ toàn bộ record `member_list`, gồm cả field chưa có trong schema
POS. `hkImportHash` là SHA-256 chuẩn hóa key và thứ tự danh sách thẻ;
`hkImportedAt` chỉ đổi khi snapshot cần ghi. `hkImportCompleteness` là
`member_list`; `hkImportMissingFields` hiện chứa `email` vì API list không trả
field này. Email được lấy qua lookup UID, không xóa email đã có.

Hồ sơ mới có `hkImportUnassigned: true`; nếu nhiều warehouse dùng chung shop HK,
`warehouseId` tạm là `hk-shop-20692`. Chỉ lookup đã xác minh HK/Auth/device mới
gán warehouse thực và tạo baseline chỉnh sửa đầy đủ. Hồ sơ có tên HK rỗng được
hiển thị nhãn thay thế để tương thích repository cũ; giá trị HK thực trong
snapshot vẫn rỗng, và editor xác minh lại, yêu cầu tên hợp lệ trước khi lưu.

`pos_member_import_state` chứa control/lease theo shop và 16 document shard
UID/hash. `pos_member_import_runs` lưu báo cáo job, số đọc/ghi và trạng thái;
cả hai backend-only. Không trộn nhật ký nhập với lịch sử chỉnh sửa nhân viên.
Snapshot/hash/timestamp nhập và map hash shard tắt single-field indexes.
Rules/indexes đã hợp nhất và triển khai từ repository chủ quản bduck-system.

Job chỉ cập nhật snapshot của hồ sơ đã tồn tại; tên, điện thoại, email, warehouse,
revision và lease chỉnh sửa vẫn được bảo toàn. Dữ liệu mới từ HK trong snapshot
không tự ghi đè bản chỉnh sửa POS đang chờ đồng bộ.

## Phục hồi đăng ký và gợi ý số điện thoại — 14/10/2026

`pos_member_registration_requests` do POS sở hữu, backend-only, ID SHA-256 của
shop/phone. Payload gốc bất biến, mã thao tác, actor/device, shop/warehouse,
trạng thái PREPARED/HK_IN_FLIGHT/HK_CONFIRMED/COMPLETED/NEEDS_REVIEW,
UID/MID khi biết, lease, số lần thử và lỗi gần nhất. Subcollection `attempts`
giữ diễn tiến mỗi lần xử lý. Quyền truy cập qua callable kiểm tra Auth/device
và warehouse, không mở quyền client trực tiếp.

Intent tồn tại trước khi gọi HK. Hồ sơ mới và state COMPLETED ghi cùng một
transaction. Bản ghi member đã tồn tại được bảo toàn. Không ghi đè input intent
khi nhân viên sửa draft rồi thử lại. Prefix tìm trong `pos_members` và các intent
chưa hoàn tất; chỉ trả tối đa 10 gợi ý tên/phone/UID/trạng thái. Hồ sơ điểm bán
khác bị loại; hồ sơ HK chưa gán warehouse vẫn được tìm trong shop phù hợp.

Composite indexes mới: members shopId+phone (chặn đăng ký trùng),
shopId+warehouseId+phone, shopId+hkImportUnassigned+phone;
requests shopId+warehouseId+state+phone. Single-field phone vẫn tắt;
các map payload/fingerprint/lease và PII intent không tạo single-field index.
Index/rules được hợp nhất với repository bduck-system trước khi phát hành.

## Gia hạn giá trị lưu trữ — 14/10/2026

Thêm subcollections do POS sở hữu dưới `pos_members/{uid}`:
`stored_value_renewals/{operationId}` lưu scope shop/warehouse, loại tài khoản
quầy, ID khoản giá trị, hạn cũ/mới, lượng còn lại, lý do, nhân viên/thiết bị,
fingerprint, thời điểm và trạng thái PROCESSING/SUCCEEDED/FAILED/UNKNOWN.
`stored_value_renewal_locks/{delayId}` khóa từng khoản giá trị, giữ thao tác
hiện tại và hạn đã xác nhận để chặn ghi đè từ một yêu cầu đọc dữ liệu cũ.
Không tạo collection top-level mới. Client không được đọc/ghi trực tiếp;
callable kiểm tra quyền `pos.members.compensate` và scope thiết bị/điểm bán.
Query phục hồi dùng single-field index `status` của subcollection,
không yêu cầu composite index mới. Rules phải hợp nhất với bduck-system trước
khi triển khai; không deploy rules riêng từ POS.

## Gỡ liên kết thẻ hàng loạt — 14/10/2026

`pos_member_card_return_jobs/{jobId}` do POS sở hữu, backend-only, chứa
actor/device/shop/warehouse, requestHash, lease, trạng thái và tối đa 100 item.
Mỗi item giữ chủ thẻ đã xác minh, ID quan hệ thẻ, operationId, mutationSent,
checkpoint HK/local, số lần thử và lỗi. Subcollection `attempts` lưu diễn tiến.
Callable kiểm tra quyền `pos.members.return_card`; client không đọc/ghi trực tiếp.
Items/requestHash/lease tắt single-field indexes; lấy tiến độ theo document ID
không cần composite index mới.

`pos_member_card_locks` chứa khóa theo shop/mã thẻ và UID, dùng chung giữa
gỡ thẻ và cấp thẻ. Khóa gỡ có kết quả chưa rõ được giữ để chặn cấp lại trước
khi đối chiếu; khóa cấp thẻ có lease tối đa 3 phút khi request lỗi.

Sau khi xác minh HK đã gỡ, transaction cập nhật `pos_members/{uid}` cùng
checkpoint job và giải phóng khóa. Chỉ thay primary `memberCode` nếu bằng mã
bị gỡ, loại đúng thẻ khỏi `hkSnapshot.memberCardList`, thêm `cardLinksUpdatedAt`.
Core profile, số dư và thẻ khác được giữ. Không giả lập hash toàn snapshot mới;
guardian importer hiện có vô hiệu hóa manifest UID khi cache thẻ thay đổi.
Không thêm cron. Rules/indexes đã hợp nhất và phát hành từ bduck-system.

Xem [kết quả triển khai](member-batch-card-return-results-2026-10-14.md).
