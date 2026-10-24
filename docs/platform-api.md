# API Super Admin (`/api/platform/*`)

Dùng cho giao diện quản trị của chủ nền tảng (host riêng, ví dụ `admin.smartedu.vn`). Không phụ thuộc tenant, chạy bằng role DB `app_admin`.

- Xác thực: `Authorization: Bearer <token>` lấy từ `POST /auth/login`. Token có `scope=platform`, hết hạn sau **8 giờ**. Token của người dùng trung tâm bị từ chối (401).
- Mọi response: `{ status: 'success', data }` hoặc `{ success: false, message }` khi lỗi. Mã lỗi: 400 dữ liệu sai, 401 chưa đăng nhập, 404 không tìm thấy, 409 xung đột trạng thái/trùng, 429 quá giới hạn.
- Thao tác ghi được ghi nhật ký JSON ra stdout (`type: "platform_audit"`), không chứa mật khẩu.

## Công khai
| Method | Path | Mô tả |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ token, admin }` (10 lần / 15 phút / IP) |
| GET | `/tenants/check-subdomain?subdomain=abc` | `{ available, reason? }` |

## Tài khoản của tôi
| Method | Path | Body | Ghi chú |
|---|---|---|---|
| GET | `/auth/me` | | |
| POST | `/auth/change-password` | `{ current_password, new_password }` | mật khẩu mới ≥ 12 ký tự |

## Dashboard
`GET /stats` →
```
tenants:   { total, byStatus{trial,active,suspended,closed}, newThisWeek, trialExpired }
revenue:   { mrr, thisMonth }           // mrr quy đổi theo tháng từ các kỳ đang chạy
expiringSoon: { windowDays: 7, subscriptions[], trials[] }
planDistribution: [{ plan_id, code, name, count }]
totalUsers
```

## Trung tâm
| Method | Path | Body / Query |
|---|---|---|
| GET | `/tenants` | `page, limit(≤100), search, status` |
| POST | `/tenants` | `{ name, subdomain, plan_id?, contact_email?, contact_phone?, admin:{email,password≥8,full_name} }` → tạo tenant `trial` 14 ngày + admin đầu tiên + kỳ đăng ký 0đ |
| GET | `/tenants/:id` | chi tiết + `usage{users,students,teachers,leads,classes,limits}` + `currentSubscription` |
| PUT | `/tenants/:id` | `{ name?, contact_email?, contact_phone? }` |
| PUT | `/tenants/:id/status` | `{ status: trial\|active\|suspended\|closed }` — hiệu lực ngay (hủy cache). `closed` không mở lại được (409) |

## Gói và gia hạn của trung tâm
| Method | Path | Body | Hành vi |
|---|---|---|---|
| GET | `/tenants/:id/subscriptions` | | lịch sử kỳ đăng ký |
| POST | `/tenants/:id/subscription` | `{ plan_id, months(1-36, mặc định 1) }` | đổi/nâng gói: hủy kỳ đang chạy, mở kỳ mới (`amount = giá tháng × months`); trial → active. Gói ngừng bán → 400 |
| POST | `/tenants/:id/extend` | `{ days(1-365) }` | cộng thêm ngày cho kỳ đang chạy; trung tâm trial thì cộng vào `trial_ends_at`. Active mà chưa có kỳ → 409 |

## Hỗ trợ người dùng của trung tâm
| Method | Path | Body |
|---|---|---|
| GET | `/tenants/:id/users` | `?role=admin` (tối đa 200) |
| PUT | `/tenants/:id/users/:userId` | `{ is_active }` |
| POST | `/tenants/:id/users/:userId/reset-password` | `{ password? }` (≥ 12 ký tự). Bỏ trống thì hệ thống sinh mật khẩu và **chỉ trả về một lần** trong `data.password` |

## Gói dịch vụ
`GET /plans`, `POST /plans`, `PUT /plans/:id` — `{ code, name, price_monthly, max_students?, max_users?, features?, is_active? }`. Ngừng bán gói bằng `is_active:false` (không xóa).

## Quản trị viên nền tảng
`GET /admins`, `POST /admins {email,password≥12,full_name}`, `PUT /admins/:id {full_name?, is_active?}`. Không tự vô hiệu hóa chính mình (400). Quản trị viên bị vô hiệu hóa mất quyền ngay ở request kế tiếp.

## Chưa có (cần DB session)
- Bảng `platform_audit_logs` để tra cứu nhật ký trong giao diện (hiện chỉ ghi stdout).
- Tự động chuyển trạng thái khi kỳ đăng ký có phí hết hạn (hiện chỉ trung tâm `trial` hết hạn bị chặn 402).
