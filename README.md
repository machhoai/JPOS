# JPOS

JPOS là ứng dụng bán hàng tại quầy chạy trên Windows bằng Tauri. Giao diện dùng Next.js và được xuất thành tệp tĩnh để đóng gói cùng ứng dụng; các tác vụ máy chủ nằm trong Firebase Cloud Functions. Ứng dụng kết nối Firebase, JPULSE và các dịch vụ tích hợp theo cấu hình của từng môi trường.

## Cấu trúc repository

| Đường dẫn | Nội dung |
| --- | --- |
| `src/` | Giao diện Next.js, trạng thái ứng dụng và luồng bán hàng |
| `src-tauri/` | Ứng dụng desktop Rust/Tauri, in ấn, thiết bị và updater |
| `functions/` | Firebase Cloud Functions, có dependency và lockfile riêng |
| `test/`, `functions/test/` | Kiểm thử frontend và Cloud Functions |
| `docs/` | Hướng dẫn sử dụng, tích hợp voucher, updater và thiết bị |
| `.github/workflows/release-tauri.yml` | Build/ký installer Windows và phát hành bản cập nhật ứng dụng |

Xem [hướng dẫn sử dụng](docs/Huong_dan_su_dung_JPOS.docx), [hợp đồng voucher](docs/voucher-api.md), [tích hợp đầu đọc thẻ](docs/card-reader-d3.md) và [quy trình cập nhật](docs/UPDATER.md) theo phần việc tương ứng.

## Yêu cầu phát triển

- Node.js **22** và pnpm **9.15.4** cho ứng dụng; Cloud Functions cũng khai báo Node.js 22.
- Để chạy bản desktop trên Windows: Rust toolchain, công cụ build C++ cho Windows và các tài nguyên thiết bị được kiểm tra bởi script trong `scripts/`.
- Firebase CLI nếu chạy emulator hoặc triển khai Cloud Functions.
- Quyền truy cập môi trường **test** Firebase/JPULSE và tài khoản thử nghiệm do người quản trị cấp riêng. Repository không bao gồm dữ liệu hoặc bí mật production.

## Cài đặt và chạy cục bộ

Từ thư mục gốc:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
npm --prefix functions ci
```

Sao chép `.env.example.local` thành `.env.local` ở gốc và `functions/.env.example` thành `functions/.env.local`, sau đó điền **giá trị test** được cấp. File ở gốc chỉ chứa cấu hình frontend `NEXT_PUBLIC_*`; khóa HK API, JoyWorld và PayOS thuộc cấu hình máy chủ của Functions. Các file `.env.local` và `functions/.env` được Git bỏ qua. Không sao chép bí mật production vào máy phát triển hoặc commit chúng.

```bash
pnpm dev        # Giao diện trong trình duyệt tại http://localhost:3000
pnpm tauri:dev  # Ứng dụng desktop; tự chạy Next.js dev server
```

Để thử Cloud Functions cục bộ, dùng Firebase Emulator theo `firebase.json` và cấu hình test phù hợp. Một số luồng cần quyền Firebase, máy in, đầu đọc thẻ hoặc dịch vụ ngoài nên không thể xác minh chỉ bằng giao diện trình duyệt.

## Kiểm tra và build

```bash
pnpm test
pnpm lint
pnpm build
npm --prefix functions run build
npm --prefix functions test
```

`pnpm build` tạo static export trong `out/`. `pnpm tauri:build` tạo installer Windows và chạy bước chuẩn bị sidecar/driver theo `src-tauri/tauri.conf.json`; cần công cụ Windows và tài nguyên thiết bị thích hợp. Triển khai Cloud Functions bằng lệnh `npm --prefix functions run deploy` **chỉ khi đã thống nhất môi trường, quyền và kế hoạch triển khai**.

## Phân biệt hai loại Release

- **Release ứng dụng:** tag dạng `jpos-v*` kích hoạt workflow [Release JPOS Desktop](.github/workflows/release-tauri.yml), ký installer, tạo `latest.json` và mirror installer sang Firebase Storage. Ứng dụng đang cài dùng URL `releases/latest/download/latest.json` để kiểm tra cập nhật. Chỉ tạo tag này theo [quy trình cập nhật](docs/UPDATER.md).
- **Release bàn giao source:** tag dạng `handover-*` là snapshot mã nguồn và tài liệu, không chứa installer và không kích hoạt workflow desktop. Release loại này được đánh dấu **prerelease** để không thay thế Release ứng dụng mới nhất tại URL updater.

Không dùng tag `jpos-v*` để bàn giao source nếu không chủ ý phát hành một bản cài đặt mới cho cửa hàng.

## Phạm vi bàn giao

Git tag/Release xác định đúng phiên bản mã nguồn đã bàn giao. Người tiếp nhận cần được cấp riêng quyền Firebase/GCP, GitHub, registry, khóa ký Tauri, cấu hình tích hợp, dữ liệu test và quyền vận hành tương ứng. Release không bao gồm `.env.local`, private key, dữ liệu production hoặc thay đổi chưa commit trên máy phát triển.

Khi nghiệm thu, đội tiếp nhận cần clone đúng tag, cài dependency, chạy các kiểm tra đã thống nhất, dựng bản desktop trên môi trường test và ghi lại lỗi/tồn đọng cùng đầu mối hỗ trợ. Quyền sở hữu và quyền sử dụng mã nguồn được xác định trong hợp đồng bàn giao giữa hai bên.
