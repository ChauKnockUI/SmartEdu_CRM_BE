npx prisma generate
npx prisma studio --port 5556

#cài thư viện supabase bucket
npm install @supabase/supabase-js

npm install multer
npm i -D @types/multer

## Gửi email cho Lead

Trang chi tiết Lead có nút **Soạn email**. BE gửi văn bản thuần qua Resend API;
chỉ Admin hoặc Sale đang phụ trách Lead được gửi. Không có thư viện hoặc migration mới.

1. Tạo API key gửi email trong Resend và xác minh tên miền gửi:
   https://resend.com/docs/dashboard/domains/introduction
2. Đặt các biến sau trong `.env` **của BE**, rồi khởi động lại BE:

```env
RESEND_API_KEY=your-resend-api-key
LEAD_EMAIL_FROM="Tên trung tâm <tuvan@your-verified-domain.vn>"
LEAD_EMAIL_REPLY_TO=tuvan@your-verified-domain.vn
```

`LEAD_EMAIL_REPLY_TO` có thể để trống. Cấu hình này dùng chung cho các tenant chạy
trên cùng BE; chưa có màn hình quản lý hộp thư riêng cho từng trung tâm.
Không đặt khóa API trong FE hoặc commit `.env`.

`GET /api/leads/email-config` chỉ trả trạng thái sẵn sàng và địa chỉ gửi.
`POST /api/leads/:id/emails` nhận `to`, `subject`, `text`, `request_id` (UUID cho một bản soạn).
Người nhận phải khớp email hiện tại của Lead. Khi lỗi mạng, gửi lại cùng nội dung và
`request_id`: Resend chống gửi trùng trong 24 giờ; lịch sử đã lưu cũng được kiểm tra
để tránh gửi/lưu lại. Không có bảo đảm chống trùng lâu dài nếu dịch vụ đã nhận email
nhưng DB lỗi và bản gửi được thử lại sau thời hạn đó.

Lịch sử chỉ được ghi sau khi dịch vụ chấp nhận email, với phản hồi khách là
“Chưa có phản hồi”. “Dịch vụ đã tiếp nhận” chưa xác nhận phát thành công hoặc khách
đã đọc. Nếu lưu lịch sử lỗi sau khi gửi, API trả `history_saved: false` và giao diện
cảnh báo kiểm tra dịch vụ trước khi gửi lại. Chưa có webhook theo dõi giao nhận,
đồng bộ thư trả lời, tệp đính kèm hoặc gửi hàng loạt.

Kiểm tra thủ công sau cấu hình: gửi một email đến địa chỉ thử nghiệm của bạn,
đối chiếu hộp thư và trang Emails của Resend, rồi kiểm tra lịch sử Lead.

## Danh sách và xuất CSV học viên

`GET /api/students` lọc theo `search`, `status`, `class_id`, `has_debt`, có phân trang.
`GET /api/students/filter-options` trả tên các lớp trong phạm vi được xem.
`GET /api/students/export` xuất UTF-8 CSV cho toàn bộ kết quả cùng bộ lọc, bỏ qua phân trang.

Admin xem học viên của trung tâm; Sale xem học viên gắn với Lead đang được phân công;
giáo viên xem học viên đang ghi danh trong lớp phụ trách. CSV dùng cùng điều kiện
phân quyền với danh sách; giáo viên không có dữ liệu công nợ hoặc bộ lọc tài chính.
Tên/số lớp trong danh sách và CSV cũng được giới hạn theo phạm vi của người xem.
Xuất file là thao tác đọc; quyền tạo/sửa hồ sơ và cấp lại mật khẩu vẫn chỉ dành cho Admin.

## Hồ sơ cá nhân học viên

`GET /students/me` dành cho role `student`, lấy hồ sơ theo tài khoản trong JWT,
không nhận ID tài khoản từ query. Tài khoản chưa liên kết hồ sơ trả 404 với thông
báo liên hệ trung tâm. Học viên chỉ xem hồ sơ, lịch sử lớp, lịch học hiện tại và học
phí của chính mình; không xem Lead, đánh giá nội bộ, danh sách học viên hoặc thao
tác thu tiền. API xem theo ID và học phí vẫn kiểm tra phạm vi tài khoản.

FE dùng lại trang hồ sơ tại `/lms/my-profile`, tải hồ sơ, học phí và cảnh báo (với
nhân viên có quyền) độc lập, có lỗi và thử lại riêng. Lỗi học phí không chặn hồ sơ
và không hiển thị thành không có công nợ. Dashboard học viên dùng chung phép tính
học phí với trang hồ sơ. Không thêm bảng, cột, migration hoặc thư viện.

## Trạng thái lớp học theo ngày

Lớp `upcoming` tự chuyển sang `ongoing` từ ngày bắt đầu, và sang `completed`
**sau** ngày kết thúc, theo lịch `Asia/Ho_Chi_Minh`. Ngày lưu trong DB là `DATE`;
lớp vẫn đang học trong toàn bộ ngày kết thúc. `cancelled` và `completed` được giữ
nguyên; lớp chưa có ngày bắt đầu hoặc có khoảng ngày sai không tự chuyển trạng thái.
Lớp có ngày bắt đầu nhưng chưa có ngày kết thúc sẽ tiếp tục `ongoing`.

BE đồng bộ một lần mỗi ngày Việt Nam cho mỗi tenant trước các API nghiệp vụ và
trước lượt quét nền hiện có. Các yêu cầu đồng thời dùng chung lượt đồng bộ; lỗi sẽ
được thử lại ở yêu cầu sau. Tạo/sửa lớp tính trạng thái ngay, còn ghi danh và chuyển
Lead kiểm tra lại ngày của lớp trong transaction. Không cần cron, thư viện hoặc
migration mới. Không tự sửa điểm danh hoặc đánh dấu buổi học đã hoàn thành.

## Dropout Early Warning

Flow:

```text
Attendance / Assignment / Invoice / TestResult
-> Backend aggregates dropout features per student and class
-> AI service POST /predict-dropout
-> Backend updates students.dropout_risk, dropout_risk_level, dropout_risk_reasons
-> Backend appends ai_predictions with prediction_type = dropout_risk
```

Required AI env:

```env
AI_DROPOUT_RISK_URL=http://127.0.0.1:8000/predict-dropout
```

Manual scoring endpoint:

```http
POST /students/:id/dropout-risk/score?class_id=123
```
