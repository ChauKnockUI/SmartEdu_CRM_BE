# Kế hoạch điều chỉnh FE và AI cho BE multi-tenant

> Dựa trên audit ngày 2026-10-17 (FE: `SmartEdu_CRM_FE`, AI: `SmartEdu_CRM_AI`). BE ở nhánh `feat/multi-tenant`.

## 1. Tóm tắt thay đổi hợp đồng API

Đường dẫn các endpoint nghiệp vụ **không đổi** (`/api/leads`, `/api/classes`, ...). Thay đổi nằm ở cách xác định tenant, token và một số response.

| # | Thay đổi | Ảnh hưởng |
|---|---|---|
| 1 | Tenant lấy từ **Host** của request (`trungtam.smartedu.vn`), không nhận từ header/body | FE phải gọi API qua cùng subdomain (đường dẫn tương đối `/api`) |
| 2 | JWT có `tenantId` và `scope`; token cũ trả 401, token sai tenant trả 403 | Mọi người dùng phải đăng nhập lại một lần sau cutover |
| 3 | Mã lỗi mới: 404 (không có trung tâm), 403 (trung tâm bị khóa), 402 (hết hạn dùng thử) | FE cần màn hình riêng cho từng trường hợp |
| 4 | Email unique theo tenant: đăng nhập/đăng ký chỉ trong phạm vi trung tâm đang truy cập | Không cần đổi form, nhưng thông điệp lỗi 409 đổi |
| 5 | Tài liệu lớp: `file_url` trong danh sách là **URL ký hết hạn sau 1 giờ** (có thể `null` nếu file lỗi). Upload/update trả về đường dẫn storage, không phải URL tải | FE không được lưu `file_url`, phải gọi lại danh sách khi cần mở; chỉ `admin`/`teacher` được upload/sửa/xóa; chỉ nhận pdf, office, ảnh, zip, mp3, mp4 |
| 6 | Số hóa đơn/phiếu thu: `INV-YYYYMMDD-NNNNNNNN`, `REC-YYYYMMDD-NNNNNNNN` (8 chữ số) | Chỉ ảnh hưởng nếu FE parse/hiển thị theo độ dài cũ |
| 7 | Lỗi trùng/ tham chiếu sai trả 409, không tìm thấy trả 404 qua `errorHandler`; 429 kèm `Retry-After` | FE hiển thị thông điệp theo mã |
| 8 | API nền tảng mới `/api/platform/*` (Super Admin), JWT `scope=platform`, không phụ thuộc tenant | Cần giao diện Super Admin mới |

Response `/auth/login` và `/auth/me` **chưa** trả thông tin tenant. Cần bổ sung ở BE (xem 3.1) để FE hiển thị tên trung tâm.

## 2. AI service (`SmartEdu_CRM_AI`)

Kết luận: **không phải sửa code**. `api_server.py` không đọc/ghi DB, chỉ nhận đặc trưng và trả dự đoán (`/predict-lead`, `/predict-lead-v2`, `/explain-lead-v2`, `/predict-dropout`). BE là nơi gọi và ghi `ai_predictions`, `lead_ai_scores` kèm `tenant_id` (đã qua RLS). BE gọi AI theo `AI_LEAD_SCORING_URL` và `AI_DROPOUT_RISK_URL`, giữ nguyên.

Việc nên làm (hạ tầng, không đổi logic):
- Giữ AI trong mạng nội bộ, **không công khai ra Internet** (endpoint hiện không có xác thực). Nếu buộc phải công khai: thêm header bí mật dùng chung `X-AI-Key`, kiểm tra ở FastAPI và gửi từ `leadScoring.api.ts`, `dropoutRisk.api.ts`.
- Không gửi PII (tên, email, SĐT) trong payload; hiện payload chỉ gồm đặc trưng số/danh mục, giữ như vậy.
- Tùy chọn: BE gửi `X-Tenant-ID` chỉ để log phía AI (không dùng cho quyết định).
- Mô hình dùng chung cho mọi tenant. Mô hình riêng theo tenant là hạng mục tương lai, không thuộc đợt này.

Ước tính: 0,5 ngày (chỉ khi chọn thêm khóa API nội bộ).

## 3. Frontend (`SmartEdu_CRM_FE`)

Hiện trạng chính: 16 file dùng `baseURL` từ `apiConfig.ts`, 15 file đọc `localStorage.getItem('token')`, không có xử lý 401/403 toàn cục, `getApiConfig` mặc định `http://localhost:3000/api`, `.env.example` chứa cả biến DB (không thuộc FE), `VITE_API_KEY` được gắn vào header `Authorization` (xung đột với token đăng nhập).

### 3.1 Việc cần làm ở BE trước (nhỏ, để FE dùng)
- `login`, `me` trả thêm `tenant: { id, name, subdomain, status }`.
- (Tùy chọn) `GET /api/tenant/info` công khai theo Host để trang đăng nhập hiển thị tên/logo trung tâm trước khi đăng nhập.

### 3.2 Hạng mục FE

| ID | Việc | File chính | Công |
|---|---|---|---|
| FE-1 | **Gọi API qua cùng origin**: `VITE_API_BASE_URL=/api`; dev dùng proxy Vite `/api -> http://localhost:3000`; truy cập dev qua `demo.localhost:5173`. Production: nginx proxy `/api` tới BE. Bỏ mặc định `localhost:3000` | `apiConfig.ts`, `vite.config.ts`, `nginx.conf`, `.env.example` | 0,5 ngày |
| FE-2 | **Gom `fetch` rải rác về một client**: 15 file tự đọc token → dùng một `apiClient` chèn `Authorization`, đọc `message` lỗi, xử lý 401/402/403/404 tập trung. Bỏ `VITE_API_KEY` khỏi header | `services/api/*.ts`, `SchedulingPage.tsx` | 1,5 ngày |
| FE-3 | **Xử lý phiên**: 401 → xóa token và về `/login`; 403 "token không thuộc trung tâm" → đăng xuất; lưu `tenant` trong `AuthContext`; mọi người dùng đăng nhập lại sau cutover | `AuthContext.tsx`, `loginPage.tsx` | 0,5 ngày |
| FE-4 | **Màn hình trạng thái trung tâm**: 404 "không tìm thấy trung tâm", 403 "đang bị khóa", 402 "hết hạn dùng thử" (chuyển tới liên hệ/nâng cấp) | trang mới + interceptor | 0,5 ngày |
| FE-5 | **Tài liệu lớp**: mở bằng `file_url` mới lấy từ API, xử lý `null`; sau upload/sửa gọi lại danh sách; ẩn nút upload/sửa/xóa với học viên; kiểm tra loại file phía client theo allowlist; hiển thị lỗi 400 "Định dạng file không được hỗ trợ" | `ClassDetailPage.tsx`, `material.service.ts` | 0,5 ngày |
| FE-6 | **Đăng ký**: bản hiện tại là đăng ký người dùng trong 1 trung tâm; giữ nguyên, hiển thị tên trung tâm; role `sale/teacher` chờ admin kích hoạt (đã có), xử lý 409 trùng email trong trung tâm | `registerPage.tsx` | 0,25 ngày |
| FE-7 | **Super Admin** (ứng dụng/route riêng tại `platform.smartedu.vn`): đăng nhập, danh sách trung tâm (lọc, tìm kiếm), tạo trung tâm (kiểm tra subdomain trực tiếp bằng `check-subdomain`), khóa/mở trung tâm, thống kê MRR, quản lý gói | module `features/platform/*`, router riêng, `platform.service.ts` | 3 ngày |
| FE-8 | **Trang đăng ký trung tâm tự phục vụ** (nếu cần, phụ thuộc quyết định xác minh email). Giai đoạn đầu có thể thay bằng form liên hệ + Super Admin tạo tay | trang công khai | 1 ngày (tùy chọn) |
| FE-9 | **Dọn dẹp**: bỏ biến DB khỏi `.env.example`, bỏ `dist/` khỏi git nếu đang theo dõi, cập nhật `RBAC-GUIDE.md`, `DB_INTEGRATION_GUIDE.md` | tài liệu | 0,25 ngày |
| FE-10 | **Kiểm thử**: thêm Vitest + Testing Library cho `apiClient` (mã lỗi, token) và luồng đăng nhập; chạy thủ công kịch bản 2 trung tâm (2 tab `a.localhost`, `b.localhost`) | test mới | 1 ngày |

Tổng FE: khoảng **8–9 ngày** (bỏ FE-8 còn 7–8 ngày; FE-7 có thể tách đợt sau, đợt đầu tạo trung tâm bằng script/Postman).

### 3.3 Hạ tầng và cấu hình liên quan
- DNS wildcard `*.smartedu.vn` và chứng chỉ TLS wildcard; `platform.smartedu.vn` trỏ cùng cụm.
- Reverse proxy chuyển `Host` nguyên vẹn (hoặc `X-Forwarded-Host`) tới BE; BE chỉ tin header này khi nằm sau proxy tin cậy.
- Biến môi trường BE khi cutover: `ADMIN_DATABASE_URL`, `BASE_DOMAIN`, `DATABASE_URL` (role `app_user`), `SUPABASE_SERVICE_ROLE_KEY`; bucket `class-materials` đặt private.
- localStorage tách theo origin nên token của hai trung tâm không lẫn nhau; đây là hành vi mong muốn.

## 4. Thứ tự đề xuất

1. BE: bổ sung `tenant` vào `login`/`me` (và `tenant/info` nếu cần). 0,5 ngày.
2. FE-1, FE-2, FE-3, FE-4 (nền tảng, chặn cutover). 3 ngày.
3. FE-5, FE-6, FE-9. 1 ngày.
4. Kiểm thử FE-10 với BE chạy Postgres local, 2 tenant.
5. Cutover đồng bộ (DB, BE, FE) theo mục 5 của `multitenant-be-plan.md`.
6. FE-7 (Super Admin) và FE-8 (đăng ký trung tâm) có thể ra sau cutover nếu tạm dùng script.
7. AI: giữ nguyên; thêm khóa nội bộ nếu AI không nằm trong mạng riêng.

## 5. Rủi ro

- Quên một chỗ gọi `fetch` trực tiếp (đã thấy `SchedulingPage.tsx`) sẽ chạy sai khi đổi sang `/api`; FE-2 cần grep toàn bộ `fetch(`/`axios` sau khi refactor.
- Cutover làm mọi phiên đăng nhập cũ mất hiệu lực; cần thông báo trước.
- Nếu FE và API không cùng subdomain (ví dụ `api.smartedu.vn`) thì mô hình nhận diện tenant bằng Host không chạy; cần thống nhất lại trước khi code FE-1.
- Hạ tầng AI công khai không xác thực là rủi ro chi phí/lạm dụng, độc lập với multi-tenant.

## 6. Câu hỏi cần chốt
1. FE và API có chạy cùng subdomain (khuyến nghị) không?
2. Super Admin làm ngay hay sau cutover?
3. Có cần trang đăng ký trung tâm công khai trong đợt này không?
4. AI có nằm trong mạng nội bộ không?
