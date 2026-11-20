# JPOS voucher contract

Ngày cập nhật: 11/09/2026. Nguồn voucher: J-PULSE.

## Quy tắc nghiệp vụ

- Hỗ trợ `FREE_TICKET`, `FREE_ITEM`, `DISCOUNT_PERCENT`.
- Mọi chiến dịch phải có mapping sản phẩm riêng cho từng `warehouseId` và được bật trước khi JPOS nhận mã.
- Voucher phần trăm giảm trên toàn bộ đơn hàng. Mỗi đơn dùng tối đa một voucher phần trăm.
- Voucher vé/quà trừ đủ giá của sản phẩm và số lượng đã mapping; một đơn có thể dùng nhiều mã.
- Khi kết hợp, quyền lợi vé/quà được trừ trước, phần trăm được tính trên phần tiền còn lại. Tiền được làm tròn về số nguyên VND.
- JPOS chỉ resolve/commit khi có mạng. Frontend không được tự xác nhận mã bằng cache.

## API quản trị J-PULSE

Các API dưới đây dùng JWT/RBAC hiện tại của `be-wms`.

### `GET /api/pos/stores/:warehouseId/voucher-settings`

Quyền: `pos.settings.read` tại cửa hàng. Trả về `campaigns`, catalog `products` và các `settings` hiện có của cửa hàng.

### `PUT /api/pos/stores/:warehouseId/voucher-settings/:campaignId`

Quyền: `pos.settings.manage` tại cửa hàng. Body:

```json
{
  "enabled": true,
  "product_id": "TICKET-01",
  "quantity": 1,
  "expected_version": 0,
  "action_time": "2026-09-11T09:00:00+07:00"
}
```

Backend kiểm tra campaign và sản phẩm, dùng optimistic concurrency, rồi ghi setting và `audit_logs` trong cùng transaction.

## Callable dùng bởi JPOS

JPOS gọi Cloud Function `getPosAuthSession`; request luôn đi qua Firebase Auth và device authentication.

### Resolve mã

```json
{
  "action": "resolveVoucher",
  "payload": {
    "code": "JP-ABC123",
    "warehouseId": "STORE-01"
  }
}
```

Kết quả:

```json
{
  "code": "JP-ABC123",
  "campaignId": "campaign-01",
  "campaignName": "Tặng vé tháng 9",
  "rewardType": "FREE_TICKET",
  "rewardValue": 0,
  "product": {
    "goodsId": "TICKET-01",
    "goodsName": "Vé vui chơi",
    "price": 200000,
    "quantity": 1,
    "ticketsPerUnit": 1
  }
}
```

Resolve chỉ kiểm tra và trả mapping, chưa đánh dấu voucher `USED`.

### Tạo/hoàn tất đơn

Hai action hiện có `prepareOrder` và `checkoutOrder`, cùng request tạo PayOS, nhận thêm:

```json
{
  "voucherCodes": ["JP-ABC123", "JP-GIFT456"]
}
```

Server luôn tải lại sản phẩm và giá. Khi thanh toán tiền mặt, việc ghi `pos_orders`, đổi code J-PULSE sang `USED`, cập nhật counter campaign, tạo `pos_voucher_redemptions` và audit nằm trong cùng Firestore transaction. Khi tạo PayOS/QR cố định, voucher được giữ 15 phút; hủy hoặc hết hạn sẽ chuyển reservation sang `CANCELLED`.

Đơn lưu thêm `subtotalAmount`, `discountAmount`, `totalAmount`, `voucherCodes` và snapshot `vouchers`. `totalAmount` là số tiền cuối cùng cần thu.

## Đồng bộ Hong Kong

Voucher JPOS giảm số tiền thu và số tiền trên hóa đơn Việt Nam. Đơn gửi HK dùng `actualPayment` do `order_create` của HK trả về. Khi đơn chưa có khoản tiền HK hợp lệ đã lưu, gửi `PayAmount = null` để HK dùng số tiền mặc định của chính đơn HK theo hợp đồng OpenAPI.

## Firestore ownership

- `marketing_voucher_campaigns`, `marketing_voucher_codes`: J-PULSE sở hữu schema.
- `pos_voucher_campaign_settings`: cấu hình theo khóa `{warehouseId}__{campaignId}`; J-PULSE quản trị qua API.
- `pos_voucher_redemptions`: JPOS sở hữu; document ID là mã voucher chuẩn hóa.
- Client không được ghi trực tiếp hai collection `pos_`; mọi mutation đi qua backend để giữ transaction và audit.

## Mã lỗi chính

- `invalid-argument`: mã hoặc payload sai định dạng, danh sách mã trùng.
- `not-found`: không có mã voucher.
- `failed-precondition`: campaign hết hạn/tạm dừng, cửa hàng chưa bật, mapping hoặc sản phẩm không còn hợp lệ, thiếu số lượng sản phẩm, hoặc có voucher phần trăm thứ hai.
- `already-exists`: mã đã hoàn tất hoặc đang được giữ bởi giao dịch khác.
