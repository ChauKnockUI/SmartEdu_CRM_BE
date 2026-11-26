npx prisma generate
npx prisma studio --port 5556

#cài thư viện supabase bucket
npm install @supabase/supabase-js

npm install multer
npm i -D @types/multer

## Gửi email cho Lead

Trang chi tiết Lead có nút **Soạn email**. BE gửi văn bản thuần qua Gmail SMTP
bằng Nodemailer; chỉ Admin hoặc Sale đang phụ trách Lead được gửi. Mỗi trung tâm
lưu Gmail và Mật khẩu ứng dụng riêng, không lấy địa chỉ người gửi từ yêu cầu của Sale.

Triển khai lần đầu:

1. Áp dụng migration `20261125120000_tenant_email_settings`, rồi tạo Prisma Client:
   `npm run db:migrate:deploy` và `npm run db:generate`.
2. Tạo khóa mã hóa máy chủ bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Lưu kết quả vào `.env` của BE dưới tên `EMAIL_SETTINGS_ENCRYPTION_KEY`, khởi động lại BE.
   Giữ khóa ổn định và sao lưu riêng; không commit `.env`. Khi đổi khóa này phải nhập lại
   Mật khẩu ứng dụng của các trung tâm hoặc thực hiện quy trình mã hóa lại trước đó.
3. Admin trung tâm mở **Cài đặt trung tâm → Email chăm sóc**, nhập tên hiển thị,
   Gmail gửi và Mật khẩu ứng dụng 16 ký tự do Google cấp sau khi bật Xác minh 2 bước.
   Chọn **Kiểm tra và lưu**. Lần chỉnh sửa sau có thể để trống mật khẩu để giữ giá trị cũ.
   Khoảng trắng trong mật khẩu sao chép được tự loại bỏ. Không dùng mật khẩu đăng nhập Google.
   Nếu bảng cấu hình đã được tạo ở bước trước thì chuyển sang Gmail không cần migration mới.

`GET/PUT /api/settings/email` chỉ cho Admin, có RLS theo tenant; PUT từ chối trường
ngoài hợp đồng và cấu hình cũ đã bị người khác cập nhật. PUT nhận `sender_name`,
`sender_email`, `app_password` (có thể bỏ qua nếu đã lưu), `updated_at`.
Kiểm tra dùng `transport.verify()` tới `smtp.gmail.com:587` với STARTTLS bắt buộc, xác thực bằng
chính Gmail gửi; không gửi email thử. Thành công xác nhận đăng nhập SMTP, không thay
thế kết quả gửi thực tế hoặc xác nhận tài khoản còn hạn mức. Máy chủ/cổng được cố định ở BE.

Nếu phần mềm bảo vệ mạng của máy chủ kiểm tra SMTP TLS, cấu hình `GMAIL_SMTP_CA_FILE`
trong `.env` trỏ tới PEM của CA đã được tin cậy trên máy. Ví dụ máy dev hiện tại dùng
`certs/local-mail-ca.pem` xuất từ Avast Web/Mail Shield Root trong Windows Trusted Root.
File cục bộ được gitignore; máy chủ khác có thể để trống biến này khi dùng chuỗi CA công khai.
Không thêm chứng chỉ có tên **Untrusted Root**, không tắt xác minh TLS. Lỗi chứng chỉ
được báo riêng với lỗi đăng nhập; cần khởi động lại BE khi sửa `.env`.

Mật khẩu được mã hóa AES-256-GCM với dữ liệu xác thực gắn tenant; API chỉ trả
`has_password`, không trả mật khẩu gốc hoặc ciphertext. Thiếu khóa mã hóa máy chủ
sẽ chặn lưu/gửi, không làm dừng toàn bộ ứng dụng. Tái sử dụng cột `api_key_encrypted`
để không sửa schema; ciphertext mới có tiền tố `gmail-v1`. Cấu hình Brevo cũ không
được dùng làm mật khẩu Gmail; Admin cần nhập và kiểm tra Mật khẩu ứng dụng lần đầu.

`GET /api/leads/email-config` chỉ trả trạng thái cấu hình và người gửi đã lưu.
`POST /api/leads/:id/emails` nhận `to`, `subject`, `text`, `request_id` (UUID cho một bản soạn).
Người nhận phải khớp email hiện tại của Lead. Lịch sử đã lưu là kiểm tra bền vững
cho cùng mã yêu cầu. Trong một tiến trình BE, các lần gọi cùng mã/nội dung dùng chung
kết quả SMTP trong 30 phút, giới hạn 1.000 mã, gồm cả lỗi chưa rõ kết quả.
`Message-ID` xác định từ mã yêu cầu giúp đối chiếu thư, không phải bảo đảm chống trùng
của Gmail. Không bảo đảm chống trùng giữa nhiều tiến trình hoặc sau khi khởi động lại
nếu Gmail đã nhận nhưng chưa lưu được lịch sử. Không tự retry SMTP khi chưa rõ kết quả.
API trả `delivery_unknown=true` nếu lỗi có thể xảy ra sau DATA; FE cũng xử lý mất phản
hồi HTTP như kết quả chưa xác định. Nút gửi bị khóa tới khi người dùng xác nhận đã
kiểm tra mục **Đã gửi** trong Gmail; lần gửi chủ động sau đó dùng mã yêu cầu mới.

Lịch sử chỉ được ghi sau khi dịch vụ chấp nhận email, với phản hồi khách là
“Chưa có phản hồi”. “Dịch vụ đã tiếp nhận” chưa xác nhận phát thành công hoặc khách
đã đọc. Nếu lưu lịch sử lỗi sau khi gửi, API trả `history_saved: false` và giao diện
cảnh báo kiểm tra dịch vụ trước khi gửi lại. Chưa có webhook theo dõi giao nhận,
đồng bộ thư trả lời, tệp đính kèm hoặc gửi hàng loạt.

Kiểm tra thủ công sau cấu hình: gửi một email đến địa chỉ thử nghiệm của bạn,
đối chiếu hộp thư nhận, mục **Đã gửi** của Gmail trung tâm và lịch sử Lead.

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

## Công việc trên Dashboard

`GET /dashboard/work?view=summary` lấy bộ đếm các nhóm; chỉ tải danh sách của
một nhóm khi mở chi tiết bằng `view=list&category=...`. Vai trò/phạm vi lấy từ
token. Nhóm không thuộc vai trò trả 403; lỗi tải không giả số 0. Kiểu phân trang
`category=...&page=1&limit=5` vẫn được giữ cho các lời gọi cũ.

Dashboard Admin gom công việc vào khối Cảnh báo cạnh biểu đồ Nguồn Lead, cùng
cảnh báo hiện có; chỉ hiện nhóm có việc. Xem chi tiết mở Drawer, 3 dòng/trang.
Danh sách được tải một lần mỗi nhóm và giữ tạm trong Dashboard; đổi trang hoặc
mở lại cùng nhóm không gọi API. Tải lại/quay về trang/quay lại cửa sổ cập nhật dữ
liệu; cache bị thay khi đổi tài khoản, token hoặc tải lại, không lưu localStorage.

- Admin: Lead chưa phân công/cần chăm sóc, hồ sơ học viên chưa có lớp đang học
  hoặc sắp mở, lớp thiếu giáo viên/phòng, buổi thiếu điểm danh, chờ học bù, học phí.
- Sale: Lead và học viên từ Lead mình phụ trách, công nợ theo quyền hiện tại;
  học viên chưa có lớp chỉ mở xem hồ sơ để phối hợp với Admin.
- Giáo viên: thiếu điểm danh/chờ học bù theo giáo viên thực tế của từng buổi.
- Học viên: xem học phí và buổi chờ học bù của lớp đang ghi danh, không có thao tác
  thu tiền, phân công hay chỉnh lịch.

Điểm danh dùng chung điều kiện với nhắc quá hạn; học bù đọc lịch sử trong `memo`;
công nợ dùng `invoiceService.getDebts`, tách nhóm quá hạn và chưa quá hạn.
Hồ sơ/lớp hiển thị ngày tạo, không coi đó là số ngày chờ xếp lớp/phân công.
Dashboard tải công việc độc lập với tổng quan, cập nhật khi mở lại trang, quay
lại cửa sổ hoặc bấm Tải lại. Không thêm bảng, migration, cron hay thư viện.

Lịch Dashboard giáo viên/học viên dùng ngày Việt Nam, loại buổi/lớp đã hủy;
buổi tiếp theo phải có giờ bắt đầu trong tương lai. Mốc lịch là 7 ngày từ hôm nay.

## Tiến độ học tập trên Dashboard học viên

`overview.lists.classProgress` trả riêng từng lớp đang ghi danh/đã hoàn tất,
không lấy lớp đã nghỉ hoặc đã hủy. Tổng buổi ưu tiên lịch thực tế, giữ buổi nghỉ
chờ học bù trong kế hoạch và loại lịch hủy không còn sử dụng. Khi chưa có lịch,
chỉ hiển thị số buổi dự kiến của khóa học nếu có, không tạo phần trăm giả.
Buổi đã tổ chức phải kết thúc theo giờ Việt Nam và có điểm danh hoặc trạng thái
`completed`; buổi quá giờ chưa xác nhận được đếm riêng. Có mặt/đi muộn, vắng và
vắng có phép được tách theo điểm danh của chính học viên. Tiến độ tổ chức lớp
không thay đổi trạng thái ghi danh hay tự kết luận học viên hoàn thành khóa học.

## Lịch từng buổi trong hồ sơ học viên

Tab Lịch học dùng `GET /students/:id/schedules`, có lọc lớp/khoảng ngày và phân
trang 10 buổi. Mặc định tháng hiện tại theo ngày Việt Nam, tối đa 1 năm mỗi lần
lọc. Quyền xem hồ sơ và phạm vi lớp/buổi được kiểm tra ở BE; chỉ lấy các lớp đang
ghi danh và điểm danh của đúng học viên được chọn. Giáo viên/phòng lấy từ từng
buổi, giữ nhãn nghỉ chờ học bù và lịch học bù như các trang lịch khác. Không dùng
lịch thứ/giờ mẫu của lớp thay cho lịch từng buổi. Lỗi tải hiển thị riêng và có thử lại.

Dashboard giáo viên/học viên mở tab Tài liệu của đúng lớp. Tài liệu hiện có luồng
upload Supabase Storage (bucket mặc định `class-materials`, giới hạn 20 MB),
DB lưu metadata/đường dẫn; link tải được ký mới khi người dùng bấm tải về.

## Tài liệu chung của lớp và theo buổi

Giữ bảng `class_materials`, thêm `schedule_id` tùy chọn: `null` là tài liệu chung,
có ID là tài liệu của buổi đó. Tài liệu cũ giữ nguyên và được coi là tài liệu chung.
Khóa ngoại gồm tenant, lớp, buổi để không gắn nhầm tài liệu sang lớp/trung tâm khác.
Không thêm kho tài liệu dùng chung cho khóa học.

File nằm trong Supabase Storage, bucket mặc định `class-materials` phải để private.
DB lưu đường dẫn ổn định trong `file_url`, không lưu signed URL. Giữ cấu hình
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` ở BE;
không đưa service role key sang FE. Mỗi file tối đa 20 MB, kiểm tra MIME và đuôi file.

- `GET /classes/:classId/materials`: metadata, buổi học và quyền thao tác.
- `GET /schedules/:scheduleId/materials`: tài liệu buổi đang xem cùng tài liệu chung.
- `POST /classes/:classId/materials`: multipart `title`, `file`, `schedule_id` tùy chọn.
- `PUT /materials/:id`: multipart sửa tên/phạm vi, có thể thay file. Bỏ `schedule_id`
  giữ phạm vi cũ; gửi chuỗi rỗng chuyển về tài liệu chung.
- `GET /materials/:id/download`: kiểm tra quyền rồi ký link 5 phút, có tên file tải về;
  phản hồi `Cache-Control: no-store`. Danh sách không trả đường dẫn storage.
- `DELETE /materials/:id`: xóa bản ghi rồi dọn file. Sửa/thay file chỉ dọn file cũ sau
  khi lưu DB thành công; lỗi dọn file ghi log `[Material] File cleanup failed`.

Admin quản lý trong trung tâm; giáo viên chính quản lý tài liệu cả lớp. Giáo viên
được phân công riêng buổi chỉ quản lý tài liệu buổi đó, xem được tài liệu chung.
Học viên đang học/đã hoàn tất lớp chỉ xem và tải; đã nghỉ lớp không còn quyền.
Sale không truy cập tài liệu. Quyền tài liệu độc lập với khóa thời gian điểm danh.

Danh sách tài liệu gần đây trên dashboard giảng viên dùng cùng phạm vi quyền:
lớp chính, buổi được phân công riêng và tài liệu chung của lớp có buổi được phân
công. Chỉ trả metadata lớp/buổi và liên kết mở phù hợp; không trả đường dẫn file
hoặc signed URL trong tổng quan. Tên file multipart tiếng Việt được chuẩn hóa;
ZIP chấp nhận thêm MIME `application/x-zip-compressed` của Windows.

`SUPABASE_SERVICE_ROLE_KEY` nhận secret key `sb_secret_...` hoặc JWT có role
`service_role`; không dùng publishable/anon key. Lỗi Storage ghi log đã lọc khóa
với tiền tố `[Material] Storage request failed`, phân biệt lỗi quyền, bucket,
dung lượng, MIME và chứng chỉ HTTPS. Không bật public bucket để sửa lỗi quyền.
Nếu Windows truy cập HTTPS được nhưng Node báo `UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
dùng Node 22.19+ và đặt `$env:NODE_USE_SYSTEM_CA="1"` trước khi chạy BE, hoặc cấu
hình `NODE_EXTRA_CA_CERTS` trỏ tới CA PEM đáng tin cậy trước khi khởi động Node.
Không tắt xác minh TLS. Thiết lập CA không thay thế việc cấu hình đúng server key.

Middleware multipart giữ ngữ cảnh request bằng `AsyncResource.bind` ở callback
Multer, áp dụng cho tải mới và cập nhật tài liệu. Tránh mất tenant khi stream
kết thúc; tenant vẫn lấy từ middleware xác thực hiện có, không lấy từ form upload.

Migration chuẩn bị tại `prisma/migrations/20261122120000_materials_by_session/migration.sql`.
Chưa tự áp dụng vào DB. Khi triển khai, kiểm tra đúng môi trường và các migration
đang chờ, sao lưu theo quy trình hiện có, sau đó chạy `npm run db:migrate:deploy`
và `npm run db:generate`, khởi động lại BE rồi triển khai FE tương ứng. Dừng tiến
trình BE trước khi generate nếu Windows đang khóa file Prisma engine.

## Thống kê điểm danh thống nhất

Dashboard giáo viên/học viên thống kê toàn bộ lịch sử điểm danh của các buổi
đã kết thúc theo ngày/giờ Việt Nam, loại buổi và lớp đã hủy. Giáo viên tính theo
người phụ trách thực tế của từng buổi; học viên chỉ tính bản ghi của chính mình,
gồm cả lịch sử lớp đã nghỉ. Tiến độ từng lớp vẫn dùng các lớp đang ghi danh/đã
hoàn tất, có ghi rõ phạm vi riêng. Buổi cũ thiếu giờ kết thúc chỉ tính sau ngày học.

Tỷ lệ tham gia = (Có mặt + Muộn) / số bản ghi đã điểm danh, làm tròn 1 chữ số
thập phân. Vắng không phép và vắng có phép tách riêng; cả hai thuộc mẫu số.
Chưa điểm danh không tự thành vắng, không thuộc mẫu số; chưa có dữ liệu trả
`rate: null` và hiển thị Chưa có dữ liệu, khác với tỷ lệ 0% có điểm danh thực tế.
Dashboard không suy đoán số chưa điểm danh từ sĩ số hiện tại của các lớp cũ.

Trang buổi học dùng cùng công thức, tính riêng buổi đang xem và ghi rõ khi là
bản nháp chưa lưu. Buổi nghỉ/hủy không áp dụng thống kê. API danh sách vắng và
giao diện cùng gồm vắng không phép, vắng có phép và muộn, giữ phạm vi xem cũ.
Không thêm bảng, migration hoặc sửa các bản ghi điểm danh để tính thống kê.

## Hạng mục làm sau: cơ hội tư vấn học tiếp

Theo yêu cầu người dùng, tạm hoãn phần này; chưa triển khai hoặc migration DB.
Học viên gần kết thúc lớp vẫn giữ hồ sơ học viên và Lead gốc đã đăng ký.
Thiết kế dự kiến: một học viên có nhiều cơ hội học tiếp, mỗi cơ hội có khóa mục
tiêu, Sale phụ trách, trạng thái và lịch sử tư vấn riêng. Chốt thành công sẽ ghi
danh hồ sơ học viên hiện có vào lớp mới; không tạo lại học viên hoặc đưa Lead gốc
về trạng thái Mới. Có thể đặt tab Học viên học tiếp cạnh tab Khách mới trong khu
vực Lead & Tư vấn, tái sử dụng giao diện hiện có.

Cần thiết kế quan hệ và migration riêng trước khi làm: giữ nguồn Lead gốc,
tách chống trùng hồ sơ khỏi chống trùng cơ hội đang mở, rà lại phân quyền Sale
và báo cáo. Không chỉ bỏ unique ở Student.lead_id hoặc bỏ chặn email/điện thoại.
Ngưỡng tiến độ chỉ gợi ý cần tư vấn, không tự quyết định học viên đủ trình độ lên
cấp. Các tích hợp email/SMS/tổng đài cũng tiếp tục để sau theo phạm vi đã thống nhất.

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

## Tra cứu học viên khi ghi danh

`GET /api/students` hỗ trợ thêm `exclude_class_id` (ID lớp nguyên dương). Bộ lọc
loại học viên có ghi danh khác `dropped` trong lớp đó trước khi phân trang và đếm
tổng, vẫn kết hợp phạm vi tài khoản/trung tâm hiện có. FE tra cứu hồ sơ `active`,
20 người mỗi trang. Chi tiết lớp trả thêm `student.status` để xác định nút ghi
danh lại, không cần tải toàn bộ danh sách học viên. Không thay đổi schema DB.
