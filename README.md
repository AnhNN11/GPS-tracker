# Campus Guard

Next.js + Ant Design + MongoDB Atlas, deploy trên **Vercel Hobby**. Trường mặc định: Phân hiệu 1 Trường Thiếu sinh quân miền Trung, phường Thống Nhất, Pleiku, Gia Lai. Admin xác nhận ranh giới thực tế bằng cách vẽ đa giác trên bản đồ.

## Production trên Vercel — không cần chạy CLI trên máy cá nhân

1. Cấu hình Environment Variables: `MONGODB_URI`, `MONGODB_DB=campus_guard`, `APP_ORIGIN=https://gpstracker-one.vercel.app`. URI và Origin là biến của môi trường Production; redeploy sau khi thay đổi.
2. Mở **/setup**, nhập mã thiết lập riêng và tự chọn tên, email, mật khẩu quản trị. Có thể dùng liên kết cấp riêng dạng `/setup#setup=...`; phần fragment không gửi lên server trong URL. Sau khi nhập mã, trang xóa fragment khỏi thanh địa chỉ.
3. Mã thiết lập được lưu dưới dạng hash, hết hạn sau 24 giờ và chỉ dùng được một lần. Chủ sở hữu cũng có thể dùng biến bí mật `ADMIN_SETUP_TOKEN` (tối thiểu 32 ký tự ngẫu nhiên) trên Vercel. Không có đăng ký admin công khai, tài khoản hay mật khẩu mặc định. Sau khi khởi tạo thành công, việc khởi tạo bị khóa bằng transaction, kể cả khi có hai yêu cầu đồng thời.
4. Admin đăng nhập, vẽ và lưu ranh giới khuôn viên rồi cấp tài khoản người dùng.
5. Admin mở Cảnh báo → **Nhận thông báo trên thiết bị**. Trên iPhone, thêm website vào Màn hình chính và mở từ biểu tượng trước khi bật thông báo.
6. Người dùng mở Vị trí của tôi, đồng ý chia sẻ và cấp quyền vị trí.

File `.env.local` được Git bỏ qua. Không đưa URI, mã thiết lập, cookie, khóa VAPID riêng hoặc mật khẩu vào mã client hay biến `NEXT_PUBLIC_*`. Các khóa Web Push được tạo và lưu riêng ở MongoDB phía server; API chỉ trả public key cho admin đã xác thực.

## Giám sát tự động trên gói miễn phí

Workflow **.github/workflows/gps-monitor.yml** gọi **GET /api/cron** theo lịch mục tiêu 5 phút/lần, khi push lên main hoặc chạy thủ công từ GitHub Actions. Không cần Vercel Pro, không có tiến trình `setInterval` phải chạy trong Vercel, không phải lưu khóa giám sát trong repo.

Mỗi lần chạy workflow yêu cầu một GitHub OIDC token ngắn hạn. API xác minh chữ ký bằng JWKS chính thức, issuer, audience, repository, nhánh main, tên workflow và loại sự kiện. Token từ fork, pull request hoặc workflow khác bị từ chối. Mặc định chỉ tin repo `AnhNN11/GPS-tracker`; nếu fork, chủ sở hữu phải cập nhật workflow và biến `MONITOR_GITHUB_REPOSITORY`.

GitHub Actions có thể chạy trễ, bỏ lượt và tắt lịch sau thời gian dài repo không có hoạt động. Vì vậy ngưỡng mất cập nhật 5 phút **không đồng nghĩa** cảnh báo chắc chắn xuất hiện trong đúng 5 phút; thường phải cộng thời gian chờ lượt kiểm tra. Trang Cảnh báo hiển thị nhịp kiểm tra gần nhất và cảnh báo khi lâu không có nhịp.

API cũng hỗ trợ `Authorization: Bearer <CRON_SECRET>` nếu chủ sở hữu cấu hình một secret ngẫu nhiên dài ít nhất 32 ký tự cho scheduler khác. Secret không nằm trong URL và không được đưa vào source. Mỗi lượt kiểm tra có giới hạn batch/thời gian để phù hợp Vercel Function; các lượt sau xử lý tiếp phần còn lại. Đọc dashboard vẫn có bước kiểm tra bù ngắn.

## Thông báo trên điện thoại

Dùng Web Push chuẩn qua Service Worker, không gọi `new Notification()` trên trang. Push được mã hóa, chỉ gửi tới thiết bị của admin hiện còn quyền truy cập và đã bật thông báo. Khi admin đăng xuất, thiết bị đó được hủy đăng ký nhận push. Service Worker không cache dữ liệu riêng và không lấy GPS nền.

Cảnh báo mới được thử gửi ngay sau khi server nhận mẫu vị trí, và các thông báo đang chờ được xử lý lại qua lịch monitor. Mỗi thiết bị có trạng thái gửi riêng để lần thử lại không gửi trùng cho thiết bị đã thành công; endpoint hết hạn được xóa. Việc gửi thành công tới dịch vụ push không bảo đảm thiết bị sẽ hiển thị ngay vì còn phụ thuộc mạng, hệ điều hành và quyền người dùng.

FCM/Firebase có thể bổ sung sau khi kết nối project. Bản này dùng Web Push trực tiếp, không yêu cầu Firebase project hoặc service-account key để chạy. Chưa chuyển tài khoản và dữ liệu từ MongoDB sang Firebase.

## Ranh giới và sai số

- Vẽ đa giác theo hàng rào; hỗ trợ đa giác lõm, từ 3–100 đỉnh, không tự cắt, diện tích tối thiểu 100 m² và kích thước trong 10 km.
- Sai số GPS tối đa mặc định 50 m, vùng đệm 10 m. Chỉ tính ngoài nếu điểm ở ngoài và khoảng cách đến ranh giới lớn hơn sai số + vùng đệm.
- Cần ít nhất 2 mẫu ngoài liên tiếp kéo dài tối thiểu 30 giây, hai mẫu cách nhau không quá 90 giây. Mẫu trong/không rõ ngắt chuỗi xác nhận.
- Quá 5 phút không có mẫu mới trong phiên chia sẻ tạo cảnh báo mất cập nhật. Từ chối mẫu trùng, cũ quá 90 giây hoặc xa tương lai quá 10 giây.
- Ghi nhận của admin và báo cáo người dùng không xóa cảnh báo. Người dùng có thể dừng chia sẻ; trạng thái dừng không chứng minh đã ra ngoài. Chưa có lịch ca bắt buộc theo dõi.
- GPS chỉ là ước lượng và có thể bị giả mạo. Không dùng để bảo đảm chính xác từng mét ở hàng rào.
- Web có thể dừng lấy GPS khi khóa màn hình hoặc chuyển ứng dụng. Firebase/PWA cũng không thay thế module định vị nền native.

## Phát triển và kiểm thử

Yêu cầu Node >=22.13 và MongoDB replica set/Atlas. App, script và monitor cùng đọc `.env.local`. Không cần ổ đĩa database cục bộ trên Vercel. Các file SQLite cũ không còn được sử dụng và không bị xóa.

```powershell
npm install
npm run db:check
npm run dev
npm test
npm run build
npm run test:api
```

Kiểm thử dùng replica set MongoDB tạm, không ghi dữ liệu thử vào Atlas thật; lần đầu có thể tải MongoDB binary chính thức. Kiểm tra API bao gồm tạo admin trên web, mã dùng một lần, khóa thiết lập, CSRF, phân quyền, cookie, GPS, cảnh báo, API cron và dữ liệu Web Push. Test gửi push dùng transport giả lập, không gửi thông báo thật.

`npm run admin` và `npm run monitor` chỉ là tiện ích tùy chọn cho phát triển/VPS. Luồng Vercel sử dụng /setup và GitHub Actions, không yêu cầu người dùng chạy hai lệnh đó.

Bản đồ dùng tile OpenStreetMap và cần mạng; chưa có ảnh vệ tinh. Chưa có khôi phục mật khẩu, audit log, cấp phép ra ngoài hay chống giả GPS.
