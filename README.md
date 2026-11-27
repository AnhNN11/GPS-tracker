# Campus Guard

Next.js + Ant Design + MongoDB Atlas, deploy trên **Vercel Hobby**. Trường mặc định: Phân hiệu 1 Trường Thiếu sinh quân miền Trung, **534 Phạm Văn Đồng, phường Thống Nhất, tỉnh Gia Lai**, trên cơ sở trụ sở cũ Bộ Chỉ huy Quân sự tỉnh Gia Lai. Đã cài sẵn vùng tạm bán kính 200 m quanh ghim địa chỉ Google Maps (14.0182432, 107.991825). Google Maps đánh dấu ghim chưa chính xác; vùng tạm không phải hàng rào đã khảo sát. Admin có thể thay bằng đa giác thực tế.

## Production trên Vercel — không cần chạy CLI trên máy cá nhân

1. Cấu hình Environment Variables: `MONGODB_URI`, `MONGODB_DB=campus_guard`, `APP_ORIGIN=https://gpstracker-one.vercel.app`. URI và Origin là biến của môi trường Production; redeploy sau khi thay đổi.
2. Mở **/setup**, nhập mã thiết lập riêng và tự chọn tên, email, mật khẩu quản trị. Có thể dùng liên kết cấp riêng dạng `/setup#setup=...`; phần fragment không gửi lên server trong URL. Sau khi nhập mã, trang xóa fragment khỏi thanh địa chỉ.
3. Mã thiết lập được lưu dưới dạng hash, hết hạn sau 24 giờ và chỉ dùng được một lần. Chủ sở hữu cũng có thể dùng biến bí mật `ADMIN_SETUP_TOKEN` (tối thiểu 32 ký tự ngẫu nhiên) trên Vercel. Không có đăng ký admin công khai, tài khoản hay mật khẩu mặc định. Sau khi khởi tạo thành công, việc khởi tạo bị khóa bằng transaction, kể cả khi có hai yêu cầu đồng thời.
4. Admin đăng nhập để mở Dashboard quân số và cấp tài khoản người dùng. Vùng tính tạm được dùng ngay, kể cả chưa lưu cấu hình khuôn viên; cấu hình đa giác đã lưu luôn được ưu tiên.
5. Admin mở **Lịch sử & phân tích**, chọn ngày và người dùng để xem các lượt ngoài khuôn viên, mẫu GPS, hành trình hoặc xuất CSV. Không có bước bật thông báo.
6. Người dùng mở Vị trí của tôi, đồng ý chia sẻ và cấp quyền vị trí.

File `.env.local` được Git bỏ qua. Không đưa URI, mã thiết lập, cookie, khóa VAPID riêng hoặc mật khẩu vào mã client hay biến `NEXT_PUBLIC_*`. Các phần cấu hình push cũ không được dùng để gửi thông báo trong luồng ghi nhận hiện tại.

## Giám sát tự động trên gói miễn phí

Workflow **.github/workflows/gps-monitor.yml** gọi **GET /api/cron** theo lịch mục tiêu 5 phút/lần, khi push lên main hoặc chạy thủ công từ GitHub Actions. Không cần Vercel Pro, không có tiến trình `setInterval` phải chạy trong Vercel, không phải lưu khóa giám sát trong repo.

Mỗi lần chạy workflow yêu cầu một GitHub OIDC token ngắn hạn. API xác minh chữ ký bằng JWKS chính thức, issuer, audience, repository, nhánh main, tên workflow, ID bất biến của repository/owner và loại sự kiện. Token từ fork, pull request hoặc workflow khác bị từ chối. Mặc định chỉ tin repo `AnhNN11/GPS-tracker`; nếu fork, chủ sở hữu phải cập nhật workflow và các biến `MONITOR_GITHUB_REPOSITORY`, `MONITOR_GITHUB_REPOSITORY_ID`, `MONITOR_GITHUB_OWNER_ID`.

GitHub Actions có thể chạy trễ, bỏ lượt và tắt lịch sau thời gian dài repo không có hoạt động. Vì vậy ngưỡng mất cập nhật 5 phút **không đồng nghĩa** cảnh báo chắc chắn xuất hiện trong đúng 5 phút; thường phải cộng thời gian chờ lượt kiểm tra. Trang Sự kiện hiển thị nhịp kiểm tra gần nhất và ghi chú khi lâu không có nhịp; không gửi thông báo ra thiết bị.

API cũng hỗ trợ `Authorization: Bearer <CRON_SECRET>` nếu chủ sở hữu cấu hình một secret ngẫu nhiên dài ít nhất 32 ký tự cho scheduler khác. Secret không nằm trong URL và không được đưa vào source. Mỗi lượt kiểm tra có giới hạn batch/thời gian để phù hợp Vercel Function; các lượt sau xử lý tiếp phần còn lại. Đọc dashboard vẫn có bước kiểm tra bù ngắn.

## Lưu lịch sử để phân tích sau

Trang mặc định của admin là **Dashboard quân số**; người dùng mở thẳng **Vị trí của tôi**. Tổng quân số chỉ gồm tài khoản học viên đang hoạt động, không gồm admin hoặc tài khoản đã khóa. GPS cũ/mất cập nhật không được tính là đang ở trường. Dashboard tự làm mới mỗi 15 giây; lịch sử tự tải lại khi có mẫu GPS mới. Không gửi Web Push và không bật popup cảnh báo trong bản này. Việc ghi nhận không yêu cầu admin mở dashboard.

- Trang đang hoạt động lấy GPS mục tiêu mỗi **60 giây** và gửi về server. Mọi mẫu hợp lệ được ghi vào `location_samples`, kể cả mẫu trong vùng, ngoài vùng, chưa rõ hoặc chưa có ranh giới. Một mẫu ngoài đơn lẻ vẫn được lưu, ngay cả khi chưa đủ chuỗi xác nhận một lượt vượt vùng.
- `excursions` ghi lượt ngoài vùng đã xác nhận: mẫu ngoài đầu tiên, lúc đủ mẫu xác nhận, mẫu ngoài cuối, mẫu quay lại (nếu có) và nguyên nhân kết thúc.
- Mỗi mẫu và lượt gắn với phiên theo dõi, cùng phiên bản ranh giới trong `boundary_versions`. Sửa khuôn viên không làm đổi kết quả hoặc đường ranh của lịch sử cũ.
- Dừng chia sẻ/khóa tài khoản không xóa lịch sử. Mất dữ liệu quá 130 giây, dừng chia sẻ hoặc thay đổi ranh giới kết thúc lượt theo lý do tương ứng, **không** giả định người dùng đã quay lại trường.
- Chỉ mẫu xác nhận ở trong vùng mới ghi thời điểm quay lại. Khoảng quan sát ngoài là khoảng giữa mẫu ngoài đầu và cuối; không phải thời gian chính xác người đó đứng ngoài hàng rào. Đường nối trên bản đồ chỉ nối các mẫu đã nhận, không chứng minh đường đi thực tế.
- Lọc tối đa 31 ngày, theo giờ Việt Nam (UTC+7); sự kiện đang mở hoặc có khoảng quan sát giao với ngày chọn vẫn được hiển thị. Xem mẫu riêng, lượt riêng, hành trình và đường ranh tại thời điểm cũ.
- CSV UTF-8 có BOM, tối đa 10.000 dòng mỗi lần xuất. Nếu nhiều hơn cần thu hẹp ngày/người dùng; server không cắt bớt dữ liệu một cách âm thầm. Các trường văn bản được chống công thức bảng tính.
- Admin xem toàn bộ; người dùng chỉ đọc/xuất dữ liệu của mình. API lịch sử và CSV đều yêu cầu đăng nhập, phân quyền và có `Cache-Control: no-store`.

Lịch sử chỉ bắt đầu từ khi triển khai bản này; không thể khôi phục các mẫu mà phiên bản cũ chưa từng lưu. Chưa tự động xóa lịch sử theo TTL. Không có ghi GPS khi trang đã đóng, không có tải bù offline; phân tích sau vẫn cần thiết bị thu và gửi được mẫu trong lúc sử dụng. Vùng mặc định có tâm và bán kính 200 m quanh ghim địa chỉ. Chế độ tròn tính trực tiếp khoảng cách Haversine trên mô hình Trái Đất hình cầu, đơn vị mét; 64 điểm chỉ phục vụ giới hạn bản đồ/tương thích, không dùng để phân loại hình tròn. Nguồn ghim: https://www.google.com/maps/search/?api=1&query=534%20Ph%E1%BA%A1m%20V%C4%83n%20%C4%90%E1%BB%93ng%2C%20Pleiku%2C%20Gia%20Lai (tra ngày 26/11/2026). Bán kính 200 m là cấu hình tạm để thử thuật toán, không phải kích thước hay hàng rào thực tế của trường. Giao diện và bản lịch sử giữ ghi chú về vùng tạm này.

## Phản hồi cập nhật GPS

Chi tiết lượt đi (`GET /api/history/events/:id`) chỉ lấy mẫu cùng thiết bị với lượt đó; dữ liệu legacy không có mã thiết bị được giữ riêng. Phản hồi bổ sung `segments` (các nhóm chỉ số trong `points`) và `breaks` (chỉ số hai đầu cùng lý do ngắt). Cả hai bản đồ hành trình dùng chung thuật toán chia đoạn, không nối qua thời gian gián đoạn, sai số lớn hay bước nhảy bất thường.

Dashboard chỉ chạy một yêu cầu trạng thái tại một thời điểm: tick 15 giây không loại bỏ phản hồi đang chờ. Sau ghi GPS/lưu cấu hình, phản hồi cũ được bỏ qua và gộp một lượt tải mới; đổi phiên đăng nhập ngăn dữ liệu của tài khoản cũ quay lại giao diện. Trên điện thoại, nút bật/cập nhật GPS nằm trước các hướng dẫn mở rộng; các ô nhập dùng chữ 16 px và vùng bấm chính từ 44 px. Điểm GPS có vùng bấm 44 px, hỗ trợ Enter/Space mở thông tin và Escape đóng.

Đăng nhập không tự bật chia sẻ; giao diện nhắc rõ khi chưa bật. Khi đã bật, trang thử gửi GPS ngay và khoảng mỗi 60 giây; dashboard lấy trạng thái mỗi 15 giây và ngay khi quay lại trang/có mạng. Bản đồ tổng quan tự căn các điểm khi có người gửi mẫu đầu tiên, có nút **Xem tất cả vị trí**. Rê chuột hoặc chạm điểm để xem tên, email, trạng thái, tọa độ, sai số, giờ GPS ghi và giờ máy chủ nhận. Điểm cũ/mất cập nhật/dừng chia sẻ vẫn hiện là vị trí cuối với màu tương ứng, không coi là vị trí hiện tại.

Trang Vị trí của tôi hiển thị riêng đang lấy GPS, đang gửi, đã lưu trên máy chủ hoặc lỗi. API trả lại mẫu và thời điểm nhận; giao diện cập nhật ngay từ phản hồi này, hiển thị giây và tự đưa bản đồ đến điểm mới. Nút **Cập nhật GPS ngay** lấy mẫu mới mà không phải chờ 60 giây. Nếu GPS chính xác cao thất bại, thử lại chế độ thường; sai số thực tế vẫn được lưu và mẫu quá kém vẫn được phân loại chưa rõ. Từ chối quyền không tự động thử vượt quyền. Khi quay lại trang hoặc có mạng trở lại, thử gửi mẫu mới. Không thay thời điểm GPS bằng giờ máy chủ hay giả lập vị trí thiết bị.

## Chỉnh bán kính

Khi thay đổi tâm, bán kính, đa giác hoặc thông tin cấu hình, giao diện đánh dấu **Chưa lưu**. Chuyển mục/đăng xuất yêu cầu chọn **Tiếp tục chỉnh sửa** hoặc **Bỏ thay đổi**; nút Hủy là thao tác bỏ nháp rõ ràng. Có cảnh báo rời trang qua `beforeunload` khi trình duyệt cho phép. **Xem toàn vùng** hỗ trợ cả đa giác và hình tròn; không tự căn lại trong lúc đang vẽ/kéo.

Vùng quản lý đặt được ở nơi bất kỳ; tọa độ trường chỉ là cấu hình ban đầu. Trong chế độ chỉnh hình tròn, di chuyển/thu nhỏ bản đồ đến nơi cần đặt, bấm **Đặt tâm trên bản đồ** rồi chạm một điểm. Tâm chuyển đến điểm đó và giữ nguyên bán kính; có thể kéo ✚ hoặc nhập tọa độ để chỉnh tiếp. Bấm **Lưu bán kính** để lưu. **Hủy chọn tâm** chỉ tắt chế độ chọn, không đổi vùng đã lưu. Liên kết Google Maps trong thông báo cũng dùng tâm hiện tại.

Admin vào **Khuôn viên trường → Kéo chỉnh bán kính** (hoặc Chỉnh sửa ranh giới), chọn **Tâm và bán kính**. Kéo nút **↔** trên viền xanh để phóng to/thu nhỏ trực tiếp bằng chuột hoặc ngón tay; kéo nút **✚** để dời tâm. Ô bán kính và tọa độ đồng bộ với thao tác kéo. Nút **Xem toàn vùng** căn lại bản đồ; bản đồ không tự zoom trong lúc chỉnh để điểm kéo không nhảy. Nút **Lưu bán kính** dưới bản đồ áp dụng thay đổi; nháp không tự ghi lên máy chủ. Có thể dùng phím mũi tên khi nút ↔ được focus để chỉnh mỗi bước 10 m. Nhập bán kính từ **50 đến 3.000 m**, hoặc thay tọa độ tâm. Vùng xanh xem trước đổi kích thước; thay đổi chỉ áp dụng sau **Lưu khuôn viên**. Chọn **Vẽ đa giác theo hàng rào** nếu cần khớp hình dạng trường; chuyển sang đa giác không còn áp dụng bán kính.

API PUT `/api/campus` nhận `circle: { center: { lat, lng }, radiusMeters }` hoặc `polygon`. Server kiểm tra quyền admin, giới hạn bán kính/tọa độ và tự tạo điểm bao bản đồ cho hình tròn; không tin đa giác gửi kèm để phân loại hình tròn. API đọc trả cùng tâm/bán kính đã lưu. Đổi bán kính tạo phiên bản ranh giới mới và ngắt chuỗi xác nhận cũ; lịch sử giữ nguyên bán kính lúc ghi nhận. Lưu lại cấu hình y hệt không kết thúc các lượt đang mở. Cấu hình cũ chỉ có đa giác vẫn được hỗ trợ.

## Ranh giới và sai số

- Vẽ đa giác theo hàng rào; hỗ trợ đa giác lõm, từ 3–100 đỉnh, không tự cắt, diện tích tối thiểu 100 m² và kích thước trong 10 km.
- Sai số GPS tối đa mặc định 50 m, vùng đệm 10 m. Chỉ tính ngoài nếu điểm ở ngoài và khoảng cách đến ranh giới lớn hơn sai số + vùng đệm.
- Cần ít nhất 2 mẫu ngoài liên tiếp kéo dài tối thiểu 30 giây, hai mẫu cách nhau không quá 130 giây. Mẫu trong/không rõ ngắt chuỗi xác nhận.
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

Kiểm thử dùng replica set MongoDB tạm, không ghi dữ liệu thử vào Atlas thật; lần đầu có thể tải MongoDB binary chính thức. Kiểm tra API bao gồm tạo admin trên web, mã dùng một lần, khóa thiết lập, CSRF, phân quyền, cookie, GPS, cảnh báo, API cron và lịch sử, phiên bản ranh giới, phân quyền xuất CSV và múi giờ. Các test thư viện push cũ dùng transport giả lập, không gửi thông báo thật.

`npm run admin` và `npm run monitor` chỉ là tiện ích tùy chọn cho phát triển/VPS. Luồng Vercel sử dụng /setup và GitHub Actions, không yêu cầu người dùng chạy hai lệnh đó.

Bản đồ dùng tile OpenStreetMap và cần mạng; chưa có ảnh vệ tinh. Chưa có khôi phục mật khẩu, audit log, cấp phép ra ngoài hay chống giả GPS.


## Công cụ phân tích hành trình trên web

Vào **Lịch sử & phân tích**, chọn một tài khoản và khoảng ngày, bấm **Phân tích hành trình**. Có bộ lọc thiết bị, bản đồ đường đi, các mốc thời gian, bảng tọa độ và nút xem từng điểm. Màu xanh lá là trong vùng, đỏ ngoài vùng, vàng/nâu là chưa rõ; màu luôn kèm nhãn chữ. Quân số tổng dùng xanh dương.

Mẫu mới có mã trình duyệt/ứng dụng ngẫu nhiên cùng nhãn hệ điều hành/trình duyệt. Không dùng IMEI hay fingerprint phần cứng. Mẫu cũ không có mã được ghi rõ là chưa phân biệt thiết bị; không khôi phục hoặc suy đoán mã thiết bị cho quá khứ. CSV có thêm mã/tên thiết bị. Đổi thiết bị ngắt chuỗi xác nhận và không tính mẫu từ máy khác là bằng chứng đã quay lại.

Đường nối không đi qua đoạn mất dữ liệu >130 giây, đổi phiên/ranh giới, sai số vượt ngưỡng của phiên bản ranh giới, hoặc bước nhảy >60 m/s. Không nối hai thiết bị khác nhau. Độ dài nối mẫu là ước tính, không phải quãng đường đi thực tế; không suy ra địa chỉ đã ghé hoặc vị trí trong khoảng không có GPS. Tool giới hạn 10.000 mẫu/50 phiên bản ranh giới mỗi lần và yêu cầu thu hẹp ngày nếu vượt giới hạn, không âm thầm cắt lịch sử. Member chỉ phân tích dữ liệu của mình; admin cần chọn một tài khoản.

## Giới hạn của client web/PWA

Bản hiện tại chỉ dùng web/PWA. Service Worker không có API GPS để ghi vị trí liên tục ở nền. Khi khóa màn hình hoặc chuyển ứng dụng, Android/iOS có thể ngừng/suspend trang. Thêm vào màn hình chính không bảo đảm GPS nền.

Trong Vị trí của tôi có tùy chọn **Giữ màn hình sáng khi đang chia sẻ** bằng Screen Wake Lock nếu trình duyệt hỗ trợ. Khóa chỉ hoạt động khi trang đang hiển thị; hệ điều hành có thể từ chối/thu hồi. Khi trở lại trang, lấy mẫu GPS mới và thử giữ màn hình sáng lại nếu tùy chọn còn bật. Mất dữ liệu được thể hiện là chưa rõ/mất cập nhật, không suy đoán vị trí nền.

Ưu tiên Safari trên iPhone: trang có hướng dẫn cấp quyền, gửi mẫu lại khi `pageshow`/quay lại trang và cập nhật dashboard ngay khi trở lại. Luồng đăng nhập/GPS và tải lịch sử không phụ thuộc `AbortSignal.timeout`; mã thiết bị có phương án Web Crypto khi thiếu `randomUUID`; bản đồ có phương án resize khi thiếu `ResizeObserver`. Các phương án này không mở khóa GPS nền hoặc vượt quyền người dùng. Chạm điểm mở thông tin trên màn hình cảm ứng; rê chuột mở thông tin trên máy tính.
