# Campus Guard

Next.js App Router + Ant Design + Leaflet + MongoDB Atlas. Tên trường mặc định: **Phân hiệu 1 Trường Thiếu sinh quân miền Trung, phường Thống Nhất, Pleiku, Gia Lai**. Không gán tọa độ hay ranh giới trường chưa được xác minh. Bản đồ khởi tạo ở khu vực Pleiku; admin tìm khuôn viên và vẽ theo hàng rào thực tế.

## Chạy trên máy chủ

Yêu cầu Node.js >=22.13 (khuyến nghị Node 24 LTS), MongoDB replica set/Atlas và quyền truy cập mạng tới database. Sao chép `.env.example` thành `.env.local`, điền `MONGODB_URI`, `MONGODB_DB` và `APP_ORIGIN`. Không đưa chuỗi kết nối vào mã client, biến `NEXT_PUBLIC_*`, Git hoặc log. File `.env.local` đã được Git bỏ qua. Từ thư mục này:

```powershell
npm install
npm run db:check
npm run admin
npm run dev
```

Lệnh `admin` hỏi email, tên và mật khẩu (ít nhất 12 ký tự, không hiển thị). Không có tài khoản hay mật khẩu mặc định. Mở http://localhost:3000, đăng nhập bằng tài khoản vừa tạo. Trong cửa sổ terminal thứ hai chạy:

```powershell
npm run monitor
```

**Monitor phải chạy liên tục**, kể cả khi không ai mở trình duyệt. Nó kiểm tra quá hạn mỗi 30 giây và ghi cảnh báo vào MongoDB. API dashboard cũng kiểm tra bù khi được đọc. Cảnh báo hiện trên trang admin; nút Bật thông báo sử dụng Notification API khi trang vẫn mở. **Chưa triển khai Web Push / SMS / email khi admin đóng trang.**

## Luồng sử dụng

1. Admin vào Khuôn viên trường → Thiết lập → di chuyển/phóng to bản đồ → nhấp các góc theo hàng rào → Lưu. Hình vẽ phải đơn, không tự cắt, ít nhất 3 đỉnh và diện tích 100 m². Không sử dụng ranh giới minh họa để kết luận vi phạm.
2. Admin tạo tài khoản người dùng tại Tài khoản. Chỉ admin được tạo tài khoản, xem người khác, sửa ranh giới, khóa/mở tài khoản, ghi nhận cảnh báo.
3. Người dùng đăng nhập → Vị trí của tôi → đồng ý chia sẻ → cấp quyền vị trí. Mục tiêu lấy mẫu mỗi 20 giây khi trang hoạt động. Vị trí được tính và lưu trên máy chủ. Người dùng chỉ xem vị trí/cảnh báo của mình và gửi báo cáo cho admin.
4. Người dùng có thể dừng chia sẻ. Phiên này kết thúc giám sát, các cảnh báo đang hoạt động kết thúc; lịch sử vẫn còn. Không coi việc dừng chia sẻ là chứng cứ đã ra khỏi trường. Admin thấy trạng thái Chưa chia sẻ.

## Cách đo

- Dùng phép kiểm tra điểm trong đa giác (hỗ trợ khuôn viên lõm) và khoảng cách ngắn nhất tới các cạnh. Phép chiếu cục bộ theo mét, dành cho khuôn viên nhỏ (giới hạn 10 km từ đỉnh đầu).
- Chỉ xác nhận ngoài khi điểm nằm ngoài, sai số <=50 m, khoảng cách tới ranh giới > sai số GPS + vùng đệm 10 m. Điểm gần hàng rào và điểm GPS kém được ghi Chưa rõ.
- Ít nhất 2 mẫu ngoài liên tiếp, kéo dài tối thiểu 30 giây; khoảng cách giữa hai mẫu không quá 90 giây. Mẫu trong/không rõ hoặc khoảng nghỉ quá lâu ngắt chuỗi xác nhận. Cảnh báo ngoài vùng kết thúc khi có mẫu xác nhận trong vùng hoặc admin thay đổi ranh giới.
- Không có vị trí mới quá 5 phút trong phiên chia sẻ → cảnh báo Mất cập nhật. Dùng thời điểm thu GPS, từ chối mẫu trùng, quá cũ (>90 giây) hoặc quá xa tương lai (>10 giây). Ngưỡng có thể chỉnh trong giao diện.
- Mỗi người chỉ có một cảnh báo đang hoạt động cho mỗi loại. Ghi nhận của admin và báo cáo của người dùng không xóa cảnh báo.
- `accuracy` là ước lượng từ thiết bị, không phải cam kết sai số tuyệt đối. Cần đo thực tế ở cổng/hàng rào; không dùng GPS điện thoại để bảo đảm chính xác từng mét hoặc chứng minh hành vi. Tọa độ do thiết bị gửi có thể bị giả mạo.

## Triển khai thực tế

```powershell
npm run test
npm run build
npm run start
# Một tiến trình riêng, cùng MONGODB_URI/MONGODB_DB:
npm run monitor
```

Dùng VPS/container Node và reverse proxy HTTPS. Điện thoại phải vào URL HTTPS để cấp quyền vị trí. Production cookie có cờ Secure, HttpOnly, SameSite=Strict. Đặt cả app và monitor dưới trình quản lý tiến trình để tự khởi động lại. Cả app, admin CLI và monitor đều tự nạp `.env.local` và dùng cùng `MONGODB_URI`/`MONGODB_DB`.

`MONGODB_DB` mặc định là `campus_guard`. Kết nối dùng pool, index email duy nhất, index chống trùng cảnh báo đang hoạt động và TTL index cho phiên đăng nhập/giới hạn thử sai. Cập nhật vị trí và cảnh báo dùng multi-document transaction nên **cần MongoDB replica set hoặc Atlas**, không dùng MongoDB standalone. Không cần persistent filesystem cho database ở máy chạy Next.js. Các file SQLite cũ trong `data/` được giữ nguyên, không bị xóa và không còn được ứng dụng sử dụng.

`APP_ORIGIN` phải bằng origin thực tế của website, ví dụ `https://gps.example.edu.vn` (không có đường dẫn hoặc dấu `/` cuối). Khi thử trong LAN, có thể khai báo danh sách origin tin cậy cách nhau bởi dấu phẩy; HTTP qua IP LAN vẫn không đủ điều kiện dùng GPS. Không lấy `Host`/`X-Forwarded-Host` bất kỳ làm allowlist. Cấu hình này sửa lỗi đăng nhập 403 khi Next lắng nghe trên `0.0.0.0`.

`npm run db:check` kiểm tra kết nối bằng ping, không tạo tài khoản hay dữ liệu mẫu. Nếu thất bại, kiểm tra Atlas Network Access, DNS và quyền database user; không cần mở truy cập cho toàn bộ Internet. Thông tin kết nối phải nằm trong môi trường của máy chủ khi deploy. Các lỗi kết nối trả thông báo chung, không đưa URI hoặc chi tiết driver xuống trình duyệt.

Web không bảo đảm định vị nền Android/iOS. Cần ứng dụng native/hybrid có module định vị nền và quyền phù hợp để triển khai yêu cầu khóa màn hình/chuyển ứng dụng. Backend và thuật toán hiện tại có thể tái sử dụng, nhưng chưa có ứng dụng native trong dự án này. Chưa triển khai lịch ca bắt buộc theo dõi, cấp phép ra ngoài, khôi phục mật khẩu, audit log hay xác minh GPS chống giả mạo.

Bản đồ dùng tile OpenStreetMap (cần mạng và tuân thủ chính sách nhà cung cấp). Chưa có ảnh vệ tinh. Không gửi tọa độ người dùng tới dịch vụ geocoding; tile request vẫn tiết lộ vùng bản đồ đang xem cho nhà cung cấp tile.

## Kiểm tra

`npm test`: kiểm tra hình học, Origin, mật khẩu và workflow MongoDB bằng replica set tạm (`mongodb-memory-server`), bao gồm chống trùng cảnh báo, transaction và phục hồi vị trí. Lần đầu có thể tải MongoDB binary từ máy chủ phân phối chính thức. **Các kiểm thử ghi dữ liệu vào MongoDB tạm, không dùng Atlas được cấu hình trong `.env.local`.** `npm run test:api` (sau build) tự chạy server tạm với `--hostname 0.0.0.0` để kiểm tra cookie, phân quyền, khóa tài khoản, CSRF, ranh giới, GPS và báo cáo.
