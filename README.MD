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

## Chi tiết khoản thu và phiếu thu

BE tính tổng từ các dòng phí, kiểm tra số tiền không âm, tối đa 2 chữ số thập
phân và giảm giá không vượt tổng. Áp dụng cho tạo thủ công, theo lớp và ghi danh
tự động; không sửa lại số tiền trên khoản thu cũ được dùng lại.

`GET /invoices/:id` trả các dòng phí, số dư, lịch sử giao dịch và số phiếu thu.
`GET /invoices/:id/receipts/:receiptId` trả phiếu cùng giao dịch liên kết và tên
trung tâm. Admin xem trong trung tâm, Sale theo học viên phụ trách, học viên chỉ
xem của mình; giáo viên không xem tài chính. Phiếu cũ thiếu giao dịch hợp lệ không
được in bằng cách lấy tổng hóa đơn thay thế. Người thu/lập phiếu lấy từ JWT.

`POST /invoices/:id/cancel` chỉ cho Admin, nhận `notes` là lý do bắt buộc tối đa
1000 ký tự. Khóa cùng bản ghi như thu tiền; chặn khoản đã có giao dịch, phiếu thu
hoặc trạng thái đã thanh toán/hoàn tiền. Giữ bản ghi, nối thời điểm/người hủy/lý
do vào ghi chú. Khoản hủy ngừng tính công nợ. Không đổi schema hoặc thêm thư viện.

## Điểm danh buổi học

Hai API ghi điểm danh dùng chung kiểm tra quyền và thời gian: chỉ Admin hoặc
giáo viên phụ trách buổi học được ghi; buổi/lớp đã hủy và buổi chưa bắt đầu không
được ghi, kể cả khi đã mở khóa. Giáo viên bị khóa sau 48 giờ từ giờ bắt đầu theo
giờ Việt Nam; chỉ giáo viên phụ trách được yêu cầu Admin mở lại. Mở khóa không
thay đổi người phụ trách. Không có bản ghi nghĩa là chưa điểm danh, không tự tính
có mặt. FE cho chọn từng người hoặc đánh dấu có mặt cho các học viên chưa chọn;
kết quả chỉ được ghi khi bấm Lưu. Trạng thái buổi học và điểm danh hiển thị riêng;
buổi hủy không tính vào số buổi đã học. Không thay đổi cấu trúc DB.

## Nghỉ lớp và ghi danh lại

Admin cho nghỉ lớp bằng trạng thái ghi danh `dropped`, không xóa bản ghi hoặc đổi
trạng thái hồ sơ học viên. Sĩ số chỉ tính `active` ở danh sách lớp, chi tiết lớp,
lịch cá nhân và màn hình xếp lớp. Hồ sơ `completed` giữ nguyên; không cho nghỉ hoặc
ghi danh lại cùng lớp. Trạng thái và sĩ số không cần bảng/cột mới.

Ghi danh lại bản ghi `dropped` dùng bản ghi cũ, giữ ngày ghi danh và dữ liệu học
tập; không tự tạo, hủy hay hoàn học phí. Admin kiểm tra tại phần học phí nếu cần
điều chỉnh tài chính. Với ghi danh mới có khoản thu cũ của cùng học viên/lớp từ
luồng trước đây, tự dùng lại khoản thu còn hiệu lực. Tạo hóa đơn thủ công vẫn chặn
trùng như trước. Thao tác nghỉ/ghi danh giữ khóa lớp và học viên trong transaction.

Kiểm tra lịch trước khi ghi danh và lúc lưu dùng chung phép đối chiếu các buổi còn
lại theo ngày/giờ Việt Nam, gồm cả hôm nay, bỏ qua buổi/lớp đã hủy hoặc kết thúc.
Chưa tải được kết quả hoặc chưa có giờ/lịch đối chiếu thì giao diện không ghi là
trống lịch. Admin vẫn có lựa chọn cho phép trùng lịch đã có sẵn, bằng giá trị boolean.

## Đồng bộ lịch khi sửa lớp hoặc phân công

Sửa ngày/giờ lớp đồng bộ các buổi `scheduled` chưa bắt đầu theo giờ Việt Nam và
chưa có điểm danh. Giữ ID/nội dung khi sắp lại buổi; buổi không còn trong lịch mới
được đánh dấu hủy. Ngày/giờ và người phụ trách/phòng đã xác định của buổi đã học,
đã điểm danh hoặc đã hủy được giữ lại. Lưu lại lịch không đổi không sinh trùng buổi.

Phân công chỉ cập nhật các buổi còn được sửa. `null` nghĩa là bỏ phân công;
không gửi trường nghĩa là giữ nguyên. Lịch và bộ lọc dùng giáo viên/phòng thực tế
trên từng buổi; lịch dạy cá nhân không lấy mặc định mới của lớp để thay cho lịch sử.
API phòng/giảng viên rảnh nhận `class_id` để đối chiếu các buổi sắp tới thực tế
trong phạm vi được xem; không yêu cầu gửi lại lịch mẫu của lớp.

Kiểm tra trùng phòng/giảng viên và học viên trước khi đổi lịch, có tên lớp và
ngày/giờ trong thông báo lỗi. Tạo lớp và đổi lịch dùng cùng khóa theo trung tâm;
kiểm tra và ghi nằm trong một transaction. Ghi điểm danh đọc lại buổi học dưới
khóa để tránh đổi lịch đồng thời với lưu điểm danh. Không thêm schema hay thư viện.

## Khóa học và ngày kết thúc lớp

Danh sách khóa học hỗ trợ tìm kiếm, phân trang và `is_active=true|false|all`;
mặc định chỉ lấy khóa đang mở cho các ô chọn hiện có. Admin có thể tạm dừng/mở
lại bằng trường `is_active`, vẫn giữ lớp và lịch sử. Sửa số buổi hoặc học phí
khóa học không tự sửa lịch lớp cũ hay khoản phải thu đã lập.

Chi tiết khóa học dùng cùng phạm vi lớp như danh sách lớp. Sĩ số tính các ghi
danh `active`; thống kê học viên đếm các ID khác nhau trong phạm vi tài khoản,
không cộng trùng người học nhiều lớp. Giáo viên/Sale/học viên chỉ thấy lớp được phép.

Khi tạo lớp, nếu khóa học có `total_sessions`, chọn ngày bắt đầu, các thứ học và
giờ học. Số buổi/tuần bằng số thứ đã chọn, không nhập thêm. FE hiện ngày kết thúc là buổi cuối; BE tính lại và sinh
đúng số buổi. Ngày bắt đầu không trùng thứ học thì buổi đầu là thứ học kế tiếp.
Mỗi thứ tương ứng một buổi/tuần; chưa tự trừ ngày nghỉ lễ. Khóa cũ chưa có số buổi
vẫn cho nhập ngày kết thúc thủ công. Kiểm tra khóa đang mở/số buổi lần nữa trong
transaction để tránh lưu lịch cũ khi khóa vừa được sửa. Không đổi schema/thư viện.

## Báo nghỉ và xếp lịch học bù

Trong chi tiết buổi học, Admin hoặc giáo viên thực tế phụ trách có thể báo nghỉ
buổi chưa bắt đầu/chưa điểm danh, nhập lý do. Buổi chuyển `cancelled`, hiện
"Nghỉ · Chờ học bù" và ngừng nhắc điểm danh. Xếp học bù dùng lại chính ID đó,
chuyển về `scheduled`, giữ nội dung học và số buổi của lớp. API:
`POST /schedules/:id/cancel` nhận `reason`; `POST /schedules/:id/makeup` nhận
`date` (YYYY-MM-DD), `start_time`, `end_time` (HH:mm), `reason`.

Kiểm tra lại quyền và điểm danh sau khi khóa lớp/buổi. Học bù phải ở tương lai,
không trùng buổi cùng lớp, giáo viên, phòng hoặc học viên đang ghi danh. Dùng
cùng khóa lịch và khóa học viên như tạo/đổi lịch/ghi danh. Giáo viên giữ phòng
hiện tại; Admin có thể gửi `room_id` khác. Ngày kết thúc chỉ được kéo dài khi cần;
buổi bù đang chờ ở lớp vừa kết thúc có thể đưa lớp trở lại trạng thái học.

Lịch sử ngày/giờ và lý do được ghi trong `Schedule.memo` đã có, giữ memo cũ và
không trộn với `notes` là nội dung dạy học. Các màn hình lịch/chi tiết dùng chung
nhãn, có bộ lọc "Chờ xếp học bù". Sửa lịch chung giữ buổi bù riêng và không sinh
thêm buổi thường từ khoảng ngày được kéo dài. Không thêm bảng/cột/migration.

## Thông báo lịch và nhắc điểm danh

Báo nghỉ/xếp học bù tạo thông báo nội bộ trong cùng transaction với đổi lịch.
Người nhận là Admin đang hoạt động, giáo viên thực tế và tài khoản học viên đang
ghi danh; loại người vừa thao tác và không gửi cho Sale/người ngoài lớp. Liên kết
trỏ tới cùng ID buổi học. Không gửi email/SMS hoặc gọi dịch vụ ngoài.

Nhắc điểm danh ghép DATE/TIME theo +07: không nhắc trước giờ bắt đầu, phân biệt
đang học và đã kết thúc, bỏ buổi/lớp đã hủy, đã có điểm danh hoặc chưa có học viên.
Khóa buổi và đọc lại trước khi gửi; chống trùng 24 giờ theo buổi/người nhận/ngày
giờ/giáo viên/lần đổi lịch. Quét quá hạn chỉ lấy buổi đã kết thúc theo giờ Việt Nam,
đi qua các buổi đã nhắc và giới hạn 100 thông báo mới mỗi lượt, trả `remaining`.

Thông báo cũ được đánh dấu đọc và bỏ liên kết xử lý khi nghỉ/đổi lịch/đã điểm danh
hoặc không còn quyền xem. Giữ nội dung gốc trong DB. API danh sách kiểm tra lại
quyền của người xem; yêu cầu mở điểm danh để sửa kết quả cũ vẫn hợp lệ cho tới khi
được mở/giải quyết. Chống gửi lặp yêu cầu mở tới cùng Admin trong 24 giờ; mở khóa
xóa trạng thái cần xử lý của yêu cầu cũ. Không đổi schema hoặc thêm thư viện.

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
