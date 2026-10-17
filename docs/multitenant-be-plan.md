# Kế hoạch sửa BE cho kiến trúc Multi-Tenant

> Tài liệu bàn giao từ session "DB/Supabase" sang session "BE". Đọc hết mục 1–2 trước khi sửa code.
> Cập nhật lần cuối: 2026-10-17. Nhánh BE: `develop` @ `d96dce7` + migration/schema multi-tenant chưa commit.

## Trạng thái triển khai BE (cập nhật 2026-10-17)

| WP | Trạng thái |
|---|---|
| WP1 tenant từ subdomain, WP2 JWT | Xong (`tenant.middleware.ts`, `auth.middleware.ts`) |
| WP3 ngữ cảnh Prisma, `withTenantTx` | Xong (`database/db.ts`, `tenant-context.ts`) |
| WP4, WP5 unique theo tenant, login/register | Xong; invoice/receipt dùng 8 chữ số `crypto.randomInt` |
| WP6 API nền tảng | Xong (`/api/platform/*`, `scripts/seed-platform-admin.ts`) |
| WP7 Storage | Xong: đường dẫn `tenant-N/class-M/…`, bucket private + signed URL, allowlist MIME. **Cần đặt bucket `class-materials` ở chế độ private trên Supabase khi cutover** |
| WP8 job nền | Chưa (chưa có cron; route admin kích hoạt đã nằm trong ngữ cảnh tenant) |
| WP9 | Funnel gom phía DB xong; dashboard, keyset pagination chưa |
| WP10 | CORS theo `BASE_DOMAIN`, rate limit theo tenant+IP xong; `helmet` chưa |
| Kiểm thử | `npm test` (61 test, cần Docker `smartedu-pg-test`), gồm test hành vi cho class+lịch, ghi danh, hóa đơn+thanh toán, điểm danh, chuyển lead |

## 0. Quy tắc làm việc

- **KHÔNG chạy `prisma migrate deploy` / `db push` / bất kỳ lệnh ghi nào vào Supabase.** Việc áp dụng migration lên Supabase thuộc session DB, sau khi người dùng xác nhận.
- Mọi thử nghiệm dùng Postgres local (Docker, mục 2.3). Export `DATABASE_URL`/`DIRECT_URL` trong shell (biến shell thắng `.env`) và kiểm tra dòng `Datasource ... localhost:55432` trước khi chạy lệnh Prisma.
- `src/generated/prisma` hiện là client cũ (gitignored). Sau khi pull schema mới phải `npx prisma generate`, nhưng **client mới không chạy được với DB Supabase hiện tại** (thiếu cột `tenant_id`). Chỉ generate khi đã trỏ vào DB local.
- Trước khi sửa, đọc: `prisma/schema.prisma`, `prisma/migrations/20261017110000_multitenant_core/migration.sql`, `prisma/migrations/20261017120000_rls_tenant_isolation/migration.sql`.

## 1. Bối cảnh đã chốt

| Quyết định | Nội dung |
|---|---|
| Mô hình | Shared database, shared schema, cột `tenant_id` trên 26 bảng nghiệp vụ, RLS ở DB làm lớp bảo vệ thứ hai. |
| Xác định tenant | **Subdomain** (`trungtama.smartedu.vn`). Chỉ tin `tenant_id` trong JWT, đối chiếu với tenant suy ra từ `Host`. **Bỏ header `X-Tenant-ID`** trong spec cũ. |
| Email | Unique **theo tenant**: `users(tenant_id,email)`, `students`, `teachers`. Một người ở 2 trung tâm = 2 tài khoản. |
| Super Admin | Bảng riêng `platform_admins` (không thuộc tenant). Không thêm `super_admin` vào enum `UserRole`. |
| Tenant mặc định | `tenants.id = 1`, tên "Default Center", subdomain `demo`, chứa toàn bộ dữ liệu cũ. |
| Xóa tenant | Không `DELETE`. Dùng `tenants.status = 'closed'` (FK là `RESTRICT`). |

## 2. Hợp đồng với DB (BE phải tuân thủ)

### 2.1 Role và biến môi trường

| Role | Dùng cho | Đặc điểm |
|---|---|---|
| `app_user` | Mọi request của tenant | Không `BYPASSRLS`. `statement_timeout=15s`, `idle_in_transaction_session_timeout=30s`. Chỉ `SELECT` trên `tenants`, `tenant_subscriptions`, `subscription_plans`. Không có quyền với `platform_admins`, `_prisma_migrations`. |
| `app_admin` | Super-admin API, job liên tenant, onboarding tenant | `BYPASSRLS`. Không có quyền với `_prisma_migrations`. |
| `postgres` | Chỉ migration (`DIRECT_URL`) | Không dùng cho runtime. |

Biến môi trường mới cần thêm vào `src/config/env.ts` và `.env.example`:

- `DATABASE_URL` → đổi sang `app_user` (qua pooler, cổng 6543, `pgbouncer=true&connection_limit=N`).
- `ADMIN_DATABASE_URL` → `app_admin` (client Prisma thứ hai, chỉ dùng cho `/api/platform/*` và onboarding).
- `DIRECT_URL` → giữ `postgres`, chỉ cho `prisma migrate`.
- `BASE_DOMAIN` (ví dụ `smartedu.vn`; dev: `localhost`).
- Mật khẩu `app_user`/`app_admin` **chưa đặt trong migration**; session DB sẽ đặt bằng `ALTER ROLE ... PASSWORD`.

### 2.2 Cách truyền tenant vào DB

Trong **mỗi transaction** của mỗi request, câu đầu tiên phải là:

```sql
SELECT set_config('app.tenant_id', '<tenant id>', true);
```

Đảm bảo của DB (đã kiểm chứng trên local, kể cả qua Prisma 5.22):

- Chưa đặt `app.tenant_id` → `app_user` thấy **0 dòng** (không lỗi). INSERT thất bại vì `tenant_id` NOT NULL.
- `tenant_id` có `DEFAULT` lấy từ `app.tenant_id`, nên INSERT **không cần truyền `tenant_id`**. Truyền sai tenant → lỗi RLS (`new row violates row-level security policy`). Chuyển dòng sang tenant khác bằng UPDATE cũng bị chặn.
- `set_config(..., true)` chỉ có hiệu lực trong transaction. Với pooler (PgBouncer transaction mode) **không dùng** `SET` cấp session.
- Nếu một request không bọc transaction thì RLS vô dụng (đọc ra rỗng). Đây là điểm dễ sai nhất.

Quy ước Prisma: vì `tenant_id` có `@default(dbgenerated(...))` nên trong `UncheckedCreateInput` nó là tùy chọn. `data: { name: 'x' }` chạy được; `data: { room: { connect } }` kiểu "checked" yêu cầu `tenant` → ưu tiên dạng scalar FK (`class_id: 3`).

Tham chiếu chéo tenant (cập nhật 2026-10-17): FK thường chỉ kiểm tra id tồn tại và RLS chỉ kiểm tra `tenant_id` của dòng mới, nên trước đây `leads.course_id` trỏ sang khóa học của tenant khác vẫn lọt. Đã vá ở DB bằng migration `20261017130000_cross_tenant_reference_guards`: 19 quan hệ bắt buộc dùng FK ghép `(tenant_id, id)`, 23 FK đơn cột còn lại (21 tùy chọn + `notifications.user_id`, `class_materials.uploaded_by`) có trigger `BEFORE INSERT/UPDATE`. Vi phạm trả SQLSTATE `23503` (Prisma: `P2003`), cần map sang `400`/`409`. `ON DELETE SET NULL` giữ nguyên. Test `it.fails` về lead/course chéo tenant giờ phải đổi thành `it` (chạy lại trên `smartedu_test` local, đã có migration này). Trigger chỉ chạy khi giá trị cột FK khác NULL; thêm ~10–15 µs/dòng khi ghi.

Tenant bị lọc ở hai tầng: extension Prisma (thêm `where tenant_id`) **và** RLS. Extension giúp planner dùng index; RLS là lưới an toàn. Không bỏ cái nào.

### 2.3 Môi trường test local

```
Container : smartedu-pg-test (postgres:17-alpine), cổng 55432
DB        : smartedu_test  (đã áp dụng đủ migration, schema khớp schema.prisma)
            smartedu_perf  (+371k lead, 60 tenant mô phỏng, dùng đo hiệu năng)
postgres  : postgresql://postgres:local_test_pw@localhost:55432/smartedu_test
app_user  : postgresql://app_user:x@localhost:55432/smartedu_test
app_admin : chưa có mật khẩu → ALTER ROLE app_admin PASSWORD 'x'; (chỉ local)
```

Nếu container mất: khôi phục từ `D:\DA\DACN\DACN3\backups\smartedu_pre_rls_*.sql` vào `postgres:17-alpine`, rồi `npx prisma migrate deploy` (với biến trỏ localhost). Muốn reset sạch dữ liệu test: tạo DB mới từ backup.

Dữ liệu mẫu trong `smartedu_test`: tenant 1 có 23 user, 29 lead, 9 học viên, 15 hóa đơn, 11 thông báo. Tạo thêm tenant 2 để test cách ly.

## 3. Công việc cho BE (theo thứ tự)

### WP1. Nhận diện tenant từ subdomain

- Tạo `src/middlewares/tenant.middleware.ts`: lấy `Host` (tôn trọng `X-Forwarded-Host` khi có proxy tin cậy), tách subdomain theo `BASE_DOMAIN`, tra `tenants` (dùng client `app_admin` hoặc một hàm tra riêng vì `app_user` chỉ đọc được tenant của chính nó khi đã có GUC → **cần client riêng để resolve**).
- Cache kết quả (Map có TTL ~60s, hoặc Redis), hủy cache khi khóa tenant. Không truy vấn DB mỗi request.
- Từ chối nếu: không có tenant (`404`), `status` là `suspended`/`closed` (`403`), hết `trial_ends_at` mà chưa có gói (`402`/`403`).
- Gắn `req.tenant = { id, subdomain, status }`.
- Dev local: hỗ trợ `demo.localhost:3000` hoặc biến `DEV_DEFAULT_TENANT_SUBDOMAIN`. Không chấp nhận tenant từ header/body ở production.
- Quy tắc subdomain trùng với DB: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, cấm `www admin api app auth login mail static assets status support platform super-admin` (có `CHECK` ở DB, BE nên validate trước để báo lỗi dễ hiểu).

### WP2. JWT và authenticate

- `src/utils/jwt.util.ts`: thêm `tenantId: number` và `scope: 'tenant' | 'platform'` vào `JwtPayload`.
- `src/middlewares/auth.middleware.ts`: sau `verifyToken`, kiểm tra `decoded.scope === 'tenant'` và `decoded.tenantId === req.tenant.id`, sai → `403`. Token cũ (không có `tenantId`) → `401` bắt đăng nhập lại.
- Thứ tự middleware: `tenant → authenticate → authorize → (bọc ngữ cảnh DB) → controller`.
- Xóa mọi chỗ đọc `X-Tenant-ID` nếu có.

### WP3. Ngữ cảnh tenant cho Prisma (phần cốt lõi)

Hiện 19 file import `prisma` từ `src/database/db.ts`. Mục tiêu: **giữ nguyên import**, đổi thứ được export.

- Dùng `AsyncLocalStorage` (`src/database/tenant-context.ts`) lưu `{ tenantId }`; middleware (sau `authenticate`) gọi `als.run(...)` bao quanh `next()`.
- `db.ts`: tạo `base = new PrismaClient({ datasourceUrl: DATABASE_URL })` và export `prisma = base.$extends(...)`:
  - `query.$allModels.$allOperations`: nếu có context → chạy
    `base.$transaction([base.$executeRaw\`SELECT set_config('app.tenant_id', ${String(tenantId)}, true)\`, query(args)])` và trả phần tử thứ hai. Đây là mẫu RLS chuẩn của Prisma, tốn ~3,3 ms/op local (so ~1,4 ms không RLS).
  - Nếu **không có context** → ném lỗi rõ ràng (không để lọt truy vấn không tenant). Ngoại lệ: các đường chạy có chủ đích (health check, resolve tenant) dùng client riêng.
  - Tự thêm `tenant_id` vào `where` (find*/update*/delete*/count/aggregate/groupBy) và `data` (create/createMany/upsert.create) để planner dùng index. `findUnique`/`findUniqueOrThrow` thêm `tenant_id` vào `where` được (Prisma 5.22). Cẩn thận `upsert`, `createMany`, `include`/`select` lồng.
- **Interactive transaction (`prisma.$transaction(async tx => ...)`)** — 9 file dùng (`auth.controller`, `lead.controller`, `class.repository`, `lead.repository`, `student.repository`, `teacher.repository`, `attendance.service`, `invoice.service`, `schedule.service`). `tx` bên trong **không** qua cơ chế trên, nên cần một helper:
  ```ts
  export const withTenantTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    base.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${String(currentTenantId())}, true)`;
      return fn(tx);
    });
  ```
  rồi thay `prisma.$transaction(async tx => ...)` bằng `withTenantTx(async tx => ...)`. Thêm `tenant_id` thủ công trong `where` khi dùng `tx` nếu cần index. Đặt `maxWait`/`timeout` hợp lý (mặc định 2s/5s).
- **Connection pool:** mỗi op chiếm 1 connection suốt thời gian giữ transaction. Với `connection_limit=5`, pool cạn nhanh. Đánh giá lại giá trị sau khi đo (gợi ý bắt đầu 10–15 cho 1 instance). Các `Promise.all` song song (ví dụ `dashboard.service.ts`) vẫn chạy song song vì mỗi op là transaction riêng, nhưng mỗi op tốn 3 round-trip → **deploy BE cùng region với Supabase (ap-northeast-2)**, nếu không độ trễ mỗi request tăng ~3 × RTT.
- Không dùng CTE gộp `set_config` vào câu truy vấn để tiết kiệm round-trip (thứ tự thực thi với policy không được đảm bảo).
- Chấp nhận kèm theo: điều kiện `= enum` (vd `status = 'overdue'`) không được dùng làm điều kiện index khi có RLS (`enum_eq` không leakproof). Không ảnh hưởng tenant vài nghìn dòng; nếu tenant rất lớn thì tính đến chuyển cột lọc nhiều sang `text + CHECK` (báo session DB).

### WP4. Sửa 6 lỗi biên dịch (tra theo unique cũ)

Sau `prisma generate`, `tsc` báo đúng 6 chỗ (đều do unique `email`/`name` giờ là cặp với `tenant_id`):

| File | Cách sửa |
|---|---|
| `src/controllers/auth.controller.ts:25` (register) | `findUnique({ where: { tenant_id_email: { tenant_id: req.tenant.id, email } } })` |
| `src/controllers/auth.controller.ts:135` (login) | như trên; tenant lấy từ `req.tenant` (Host), **không** từ body |
| `src/repositories/student.repository.ts:70` | `findByEmail` → composite `tenant_id_email` (hoặc `findFirst`) |
| `src/repositories/teacher.repository.ts:70` | `findUserByEmail` → composite |
| `src/repositories/teacher.repository.ts:77` | `findTeacherByEmail` → composite (bảng `teachers`) |
| `src/repositories/room.repository.ts:26` | `findByName` → `tenant_id_name` |

Khi tạo mới, bắt `P2002` và trả `409` với thông điệp theo từng ràng buộc (email, tên phòng, `invoice_no`, `receipt_no`).

### WP5. Đăng nhập/đăng ký theo tenant

- `login`: tenant từ `req.tenant`; tìm `(tenant_id, email)`; JWT chứa `tenantId`, `scope:'tenant'`. Thông điệp lỗi giữ chung để không lộ email tồn tại.
- `register` tự phục vụ hiện cho `role` do client gửi (`student` tự kích hoạt, role khác `is_active=false`) — rà lại: chỉ admin của tenant mới tạo user role cao; không để client chọn `tenant_id`.
- `invoice_no`/`receipt_no` sinh ngẫu nhiên 5 chữ số theo ngày (`invoice.service.ts:15`): xác suất trùng thực tế với một tenant lớn; ràng buộc đã là unique theo tenant, nên thêm retry khi `P2002`.

### WP6. API nền tảng (Super Admin / onboarding)

- Router riêng `/api/platform/*`, xác thực bằng `platform_admins` + JWT `scope:'platform'`, dùng client `app_admin` (`ADMIN_DATABASE_URL`). Tách hẳn khỏi luồng tenant.
- Endpoint: `GET/POST /tenants`, `PUT /tenants/:id/status`, `GET /stats` (MRR từ `tenant_subscriptions`), CRUD `subscription_plans`, `GET /tenants/check-subdomain` (công khai, rate limit).
- Tạo tenant: một transaction duy nhất (client `app_admin`): `tenants` → tài khoản admin đầu tiên (`users`, `tenant_id` truyền tường minh) → `tenant_subscriptions` (trial 14 ngày).
- Khóa tenant → hủy cache WP1.
- Đăng nhập super admin: bảng `platform_admins`, bcrypt như `users`; seed một tài khoản qua script (không hard-code).

### WP7. Supabase Storage

`src/services/material.service.ts` đang lưu `class-${classId}/${safeFileName}` trong bucket public dùng chung.

- Đổi đường dẫn thành `tenant-${tenantId}/class-${classId}/...`; bỏ qua/di chuyển file cũ (`class-*` thuộc tenant 1; `getStoragePathFromUrl` phải đọc được cả hai dạng cho đến khi di chuyển xong).
- Khuyến nghị bucket riêng tư + signed URL ngắn hạn (hiện `getPublicUrl` ai biết URL cũng tải được). Cần thống nhất với FE.
- `src/config/supabase.ts` có dự phòng `SERVICE_ROLE_KEY || ANON_KEY`: bỏ dự phòng, thiếu key thì báo lỗi.

### WP8. Tác vụ liên tenant / nền

- `notification.service.ts`: `remindAllOverdue` (quét lịch quá hạn) và `deleteOld` hiện chỉ gọi từ route do admin kích hoạt → trong ngữ cảnh tenant nên chỉ tác động tenant đó (đúng). Nếu chuyển thành cron: lặp từng tenant và chạy trong `als.run` cho từng tenant (hoặc dùng client `app_admin`).
- AI: `ai_predictions` và `lead_ai_scores` được ghi bởi BE (`src/services/ai/*.repository.ts`), AI service Python không ghi DB → chỉ cần gửi `tenant_id` trong payload/header cho mục đích log. Xác nhận lại với repo `SmartEdu_CRM_AI` trước khi kết luận.
- Seed: `prisma/seed.ts`, `prisma/seed-finance.ts` phải chạy bằng `app_admin`/`postgres` với `tenant_id` tường minh (mặc định tenant 1) hoặc `set_config` trước.

### WP9. Hiệu năng cần xử lý cùng đợt

- `lead.repository.ts::getFunnelData` tải **toàn bộ lead** của tenant (không `LIMIT`, kèm 3 join). Đo: 94 ms phía DB cho 200k lead, nhưng chi phí chính là đưa 200k dòng vào Node. Đổi sang `groupBy`/đếm phía DB (`count` theo `status`, `lead_source`).
- Dashboard (`dashboard.service.ts`): nhiều truy vấn song song, mỗi truy vấn thành transaction 3 câu (WP3). Gộp bớt thành vài câu `groupBy`/`$queryRaw` có đặt `set_config` trong cùng transaction nếu cần.
- Phân trang `skip/take` (OFFSET) trên danh sách lớn: chuyển keyset `(createdAt, id)` khi bảng lớn (offset 150k ≈ 43 ms).
- Tìm kiếm `contains` + `insensitive` quét tuần tự trong phạm vi tenant (100 ms với tenant 200k lead). Chấp nhận được hiện tại; nếu cần, báo session DB thêm `pg_trgm`.
- Giữ mọi truy vấn dưới 15 giây (`statement_timeout` của `app_user`); xuất báo cáo lớn phải phân trang/stream.

### WP10. Cấu hình, CORS, bảo mật

- CORS hiện `origin: env.FRONTEND_URL` (một origin). Cần cho phép `*.BASE_DOMAIN` (kiểm tra bằng hàm, không dùng `*`).
- Rate limit (`rateLimit.middleware.ts`) theo `(tenantId, IP)`.
- Thêm `tenant`/`tenantId` vào `requestLogger`. Không log mật khẩu/JWT.
- Cookie/localStorage tách theo subdomain là hành vi mong muốn; FE phải gọi API qua cùng subdomain hoặc `api.BASE_DOMAIN` kèm `Origin` hợp lệ (nếu API ở subdomain chung `api.`, **không** suy tenant từ Host của API → cần cách khác, ví dụ tenant trong JWT sau đăng nhập và tenant ở body/header của riêng bước login; thống nhất với FE trước khi code WP1).

## 4. Kiểm thử bắt buộc (DoD)

Chạy với Postgres local, 2 tenant trở lên:

1. **Truy cập chéo bằng id** (IDOR) trên mọi resource: lead, student, class, invoice, payment, schedule, attendance, test, assignment, material, notification → `404`/`403`.
2. **Giả mạo tenant:** token tenant A + Host tenant B → `403`; thêm `tenant_id` vào body/query → bị bỏ qua hoặc `400`.
3. **Ghi chéo:** tạo bản ghi tham chiếu id của tenant khác (ví dụ ghi danh học viên tenant B vào lớp tenant A) → lỗi FK/RLS.
4. **Quên bọc ngữ cảnh:** gọi `prisma` ngoài `als.run` → ném lỗi, không trả dữ liệu.
5. **Cách ly ở tầng DB, không qua extension:** kết nối trực tiếp bằng `app_user` (không `set_config`) → 0 dòng; có `set_config` tenant 2 → không thấy dữ liệu tenant 1.
6. **Trùng ràng buộc theo tenant:** cùng email/tên phòng/số hóa đơn ở 2 tenant được phép; trùng trong 1 tenant → `409`.
7. **Tenant bị khóa:** mọi API trả `403`; token cũ không dùng được.
8. **Thông báo/AI:** `notifications`, `ai_predictions`, `lead_ai_scores` mang đúng `tenant_id`.
9. **Hiệu năng:** `EXPLAIN` các truy vấn chính trên `smartedu_perf` cho tenant lớn và nhỏ.

Gợi ý đo: script Node dùng Prisma client như mẫu đã thử (200 lần `$transaction{set_config, findMany}` ≈ 3,7 ms/lần local).

## 5. Thứ tự đề xuất và điểm phụ thuộc DB

1. WP4 + WP5 (nhỏ, biên dịch sạch trên schema mới).
2. WP3 (khung ngữ cảnh) → viết test mục 4.4–4.5 ngay.
3. WP1 + WP2 (tenant + JWT) → test 4.2, 4.7.
4. WP6 (API nền tảng + onboarding).
5. WP7, WP8, WP9, WP10.

**Cutover lên Supabase phải đồng bộ**, vì BE cũ không chạy được trên schema mới (`tenant_id NOT NULL`, RLS) và BE mới không chạy được trên schema cũ. Trình tự do session DB điều phối: backup → áp dụng 4 migration (đã thử local) → đặt mật khẩu `app_user`/`app_admin` → đổi biến môi trường → triển khai BE mới → smoke test mục 4. Rollback = khôi phục backup (dữ liệu nhỏ, downtime ngắn). BE cần sẵn sàng ở trạng thái "đã test pass trên local" trước khi session DB bắt đầu cutover.

## 6. Việc session DB sẽ làm (BE không cần lo)

- Áp dụng migration lên Supabase, backup/rollback, đặt mật khẩu role, kiểm tra RLS trên Supabase.
- Xử lý lệch lịch sử migration (`20260522141143_add_schedule_content` có trên DB nhưng thiếu file local; `notifications` và cột khóa điểm danh được tạo bằng `db push`, chưa có migration).
- Thêm index/extension (`pg_trgm`...) và theo dõi `pg_stat_statements` khi BE đã chạy tenant thật.
- Quyết định liên quan pooler Supabase với role tùy chỉnh (`app_user.<project-ref>`).

## 7. Câu hỏi còn mở (cần người dùng quyết)

1. **API đặt ở đâu?** Mỗi tenant gọi API qua chính subdomain của mình (`trungtama.smartedu.vn/api`) hay tập trung (`api.smartedu.vn`)? Quyết định cách WP1 suy ra tenant.
2. Bucket tài liệu: giữ public hay chuyển private + signed URL?
3. Đăng ký tenant tự phục vụ (FE-03) có cần xác minh email trước khi kích hoạt không?
4. Các tài khoản `student`/`teacher` có đăng nhập qua cùng cổng subdomain của trung tâm không (giả định: có)?
