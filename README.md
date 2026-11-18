# Campus Guard

Next.js App Router + Ant Design + Leaflet + SQLite. Tên trường mặc định: **Phân hiệu 1 Trường Thiếu sinh quân miền Trung, phường Thống Nhất, Pleiku, Gia Lai**. Không gán tọa độ hay ranh giới trường chưa được xác minh. Bản đồ khởi tạo ở khu vực Pleiku; admin tìm khuôn viên và vẽ theo hàng rào thực tế.

## Chạy trên máy chủ

Yêu cầu Node.js >=22.13 (khuyến nghị Node 24 LTS), ổ đĩa ghi được. Từ thư mục này:

```powershell
npm install
npm run admin
npm run dev
```

Lệnh `admin` hỏi email, tên và mật khẩu (ít nhất 12 ký tự, không hiển thị). Không có tài khoản hay mật khẩu mặc định. Mở http://localhost:3000, đăng nhập bằng tài khoản vừa tạo. Trong cửa sổ terminal thứ hai chạy:

```powershell
npm run monitor
```

**Monitor phải chạy liên tục**, kể cả khi không ai mở trình duyệt. Nó kiểm tra quá hạn mỗi 30 giây và ghi cảnh báo vào SQLite. API dashboard cũng kiểm tra bù khi được đọc. Cảnh báo hiện trên trang admin; nút Bật thông báo sử dụng Notification API khi trang vẫn mở. **Chưa triển khai Web Push / SMS / email khi admin đóng trang.**

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
# Một tiến trình riêng, cùng DATABASE_PATH:
npm run monitor
```

Dùng VPS/container Node với ổ đĩa bền vững; reverse proxy HTTPS. Điện thoại phải vào URL HTTPS để cấp quyền vị trí. Production cookie có cờ Secure, HttpOnly, SameSite=Strict. Đặt hai tiến trình app và monitor dưới trình quản lý tiến trình để tự khởi động lại. Có thể dùng một app process và một monitor process chung một DB SQLite (WAL, busy timeout). Không đặt SQLite trên network filesystem, không chạy nhiều container với DB cục bộ riêng. Không dùng Next.js static export hoặc hosting không có persistent filesystem. Sao lưu SQLite bằng SQLite backup API hoặc dừng cả hai tiến trình trước khi sao chép file DB.

`DATABASE_PATH` mặc định là `./data/campus.sqlite`; có thể đặt biến môi trường thành đường dẫn tuyệt đối, **cùng giá trị cho cả app, admin CLI và monitor**. `.env.example` có mô tả; script CLI đọc biến môi trường của tiến trình, không tự nạp `.env.local`.

Web không bảo đảm định vị nền Android/iOS. Cần ứng dụng native/hybrid có module định vị nền và quyền phù hợp để triển khai yêu cầu khóa màn hình/chuyển ứng dụng. Backend và thuật toán hiện tại có thể tái sử dụng, nhưng chưa có ứng dụng native trong dự án này. Chưa triển khai lịch ca bắt buộc theo dõi, cấp phép ra ngoài, khôi phục mật khẩu, audit log hay xác minh GPS chống giả mạo.

Bản đồ dùng tile OpenStreetMap (cần mạng và tuân thủ chính sách nhà cung cấp). Chưa có ảnh vệ tinh. Không gửi tọa độ người dùng tới dịch vụ geocoding; tile request vẫn tiết lộ vùng bản đồ đang xem cho nhà cung cấp tile.

## Kiểm tra

`npm test`: kiểm tra đa giác lõm, hình tự cắt, sai số sát ranh giới, chuỗi xác nhận; kiểm tra DB thật cho mất cập nhật, khử cảnh báo trùng, khôi phục vị trí và mật khẩu. `npm run test:api` (sau build) tự chạy server tạm, kiểm tra cookie, phân quyền, tạo tài khoản, CSRF, lưu ranh giới và gửi vị trí; không dùng hoặc sửa DB thật.
