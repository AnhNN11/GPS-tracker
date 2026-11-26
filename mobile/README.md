# Campus Guard — client Android/iOS

Client cài trên điện thoại dùng GPS native; website Vercel vẫn là nơi quản trị và phân tích. Không có tiến trình GPS nền nào được giả lập bằng tab web/PWA.

## Sử dụng

1. Android: cài APK kiểm thử từ artifact **campus-guard-android-debug** của workflow **Mobile client build**. Đây là bản debug để thử nội bộ, không phải bản phát hành Google Play.
2. iOS: cần máy Mac/Xcode và tài khoản Apple để ký/cài lên iPhone (hoặc phân phối TestFlight bằng tài khoản Developer). Artifact iOS của CI chỉ dùng cho **Simulator**, không cài được trên iPhone thật.
3. Đăng nhập bằng tài khoản đã được admin cấp. Đọc và bật ô đồng ý, bấm **Bật định vị nền**, cấp quyền vị trí. Android phải cho phép thông báo dịch vụ vị trí; iOS cấp quyền vị trí phù hợp và cho phép cập nhật nền.
4. Khóa màn hình/chuyển ứng dụng để thử; trên web xem mẫu GPS mới, tên thiết bị và hành trình. Mục tiêu gửi mỗi 60 giây khi hệ điều hành cung cấp vị trí. Có nút dừng và đăng xuất.

Android dùng foreground service và thông báo thường trực. iOS khai báo chế độ nền `location`. Không bảo đảm chạy sau khi buộc dừng ứng dụng, khởi động lại máy hoặc khi OS/hãng máy giới hạn pin. Không tự khởi động lại hay che giấu việc chia sẻ. Thiết bị cần Internet; không tải bù mẫu offline cũ. Bản này không tự đăng nhập hay tự bật GPS sau khi ứng dụng bị kết thúc.

Token ngẫu nhiên chỉ ở RAM, thời hạn 12 giờ; không lưu mật khẩu/token xuống localStorage hay file. Server chỉ giữ hash token, buộc thiết bị gửi bằng danh tính đã đăng nhập, hỗ trợ thu hồi khi đăng xuất/khóa tài khoản. Client không có quyền tạo tài khoản hoặc đọc dữ liệu của người khác, kể cả đăng nhập bằng tài khoản admin. Mã thiết bị ngẫu nhiên được lưu để phân tích; không phải IMEI, không chứng minh danh tính phần cứng. Đổi/xóa dữ liệu ứng dụng có thể tạo mã mới. Trạng thái bật/tắt chia sẻ hiện dùng chung cho tài khoản; nên dùng một tài khoản cho một người trên một thiết bị.

## Build

Yêu cầu Node 22.13+, Android Studio/SDK 36 và JDK 21 cho Android. Xcode/macOS cho iOS.

```text
npm ci
npm test
npm run sync
npm run android
```

Android: `android/gradlew -p android assembleDebug` (Windows dùng `android/gradlew.bat`).

iOS lần đầu trên macOS:

```text
npm run build
npx cap add ios --packagemanager SPM
node scripts/configure-ios.mjs
npx cap sync ios
npm run ios
```

Trong Xcode chọn Team ký và iPhone đích. Không lưu certificate/provisioning profile vào repository. Workflow CI build APK và iOS Simulator không cần bí mật ký phát hành.

Giao diện đóng gói cục bộ; API cố định là `https://gpstracker-one.vercel.app/api/client/`. `CapacitorHttp` gửi qua HTTP native, tránh throttle HTTP của Android WebView trong nền. `android.useLegacyBridge=true` theo hướng dẫn plugin. Android service không được export sang ứng dụng khác; app tắt sao lưu.

Nguồn kỹ thuật: [plugin Background Geolocation](https://github.com/capacitor-community/background-geolocation), [CapacitorHttp](https://capacitorjs.com/docs/apis/http), [Apple background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background).

Kiểm thử đơn vị kiểm tra giữ thời điểm GPS, giới hạn nhịp gửi, dừng trong lúc chờ quyền và hết hạn token. Build CI không thay thế thử nền trên thiết bị thật, quyền OS, tiết kiệm pin và mạng di động.
