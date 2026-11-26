import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Tracker, type Receipt } from "./tracker";
import "./style.css";
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  "BackgroundGeolocation",
);
const origin = "https://gpstracker-one.vercel.app";
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let token: string | null = null;
let deviceId = localStorage.getItem("native_device_id");
if (!deviceId || !/^[0-9a-f-]{36}$/i.test(deviceId)) {
  deviceId = crypto.randomUUID();
  localStorage.setItem("native_device_id", deviceId);
}
const platform = Capacitor.getPlatform(),
  native = Capacitor.isNativePlatform();
const error = (message = "") => {
  element("error").textContent = message;
  element("error").classList.toggle("hidden", !message);
};
async function api(route: string, data?: unknown): Promise<any> {
  const response = await CapacitorHttp.request({
    url: origin + "/api/client/" + route,
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    data,
    connectTimeout: 15000,
    readTimeout: 25000,
    responseType: "json",
  });
  const body =
    typeof response.data === "string"
      ? JSON.parse(response.data)
      : response.data;
  if (response.status < 200 || response.status >= 300)
    throw Object.assign(new Error(body.error ?? "Yêu cầu thất bại."), {
      status: response.status,
    });
  return body;
}
const time = (value: number) =>
  new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const tracker = new Tracker(
  {
    add: (callback) =>
      BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: "Campus Guard đang chia sẻ GPS",
          backgroundMessage:
            "Bạn đã bật chia sẻ vị trí. Mở Campus Guard để dừng.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 0,
        },
        (location, issue) =>
          callback(location ?? undefined, issue ?? undefined),
      ),
    remove: (id) => BackgroundGeolocation.removeWatcher({ id }),
  },
  api,
  (state) => {
    element("tracking-status").textContent = state.message;
    element("tracking-status").classList.toggle("error", !!state.error);
    element<HTMLButtonElement>("start-button").disabled = state.active;
    element<HTMLButtonElement>("stop-button").disabled = !state.active;
    if (state.receipt) showReceipt(state.receipt);
  },
);
function showReceipt(receipt: Receipt) {
  element("latest-point").textContent =
    `GPS ${time(receipt.reading.capturedAt)} · ${receipt.reading.lat.toFixed(6)}, ${receipt.reading.lng.toFixed(6)} · ±${Math.round(receipt.reading.accuracy)} m. Máy chủ nhận ${time(receipt.receivedAt)}. Trạng thái: ${receipt.status}.`;
}
element("native-warning").classList.toggle("hidden", native);
element<HTMLButtonElement>("login-button").disabled = !native;
element("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!native) return;
  const button = element<HTMLButtonElement>("login-button");
  button.disabled = true;
  error();
  try {
    const result = await api("login", {
      email: element<HTMLInputElement>("email").value.trim(),
      password: element<HTMLInputElement>("password").value,
      deviceId,
      deviceLabel: `${platform === "ios" ? "iOS" : "Android"} · Campus Guard`,
    });
    token = result.token;
    element<HTMLInputElement>("password").value = "";
    element("account-name").textContent = result.user.name;
    element("device-name").textContent =
      `${platform} · mã trình duyệt ứng dụng ${deviceId!.slice(0, 8)}`;
    element("session-expiry").textContent =
      "Phiên hết hạn: " + time(result.expiresAt);
    element("login-panel").classList.add("hidden");
    element("tracking-panel").classList.remove("hidden");
  } catch (issue) {
    error((issue as Error).message);
  } finally {
    button.disabled = false;
  }
});
element("start-button").addEventListener("click", async () => {
  error();
  if (!element<HTMLInputElement>("consent").checked) {
    error("Cần đồng ý chia sẻ vị trí trước khi bật.");
    return;
  }
  const button = element<HTMLButtonElement>("start-button");
  button.disabled = true;
  try {
    if (platform === "android") {
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display !== "granted")
        throw new Error(
          "Cần cho phép thông báo để Android hiện trạng thái đang dùng GPS.",
        );
    }
    await tracker.start();
  } catch (issue) {
    error((issue as Error).message);
  } finally {
    if (element<HTMLButtonElement>("stop-button").disabled)
      button.disabled = false;
  }
});
element("stop-button").addEventListener("click", () => {
  void tracker
    .stop()
    .catch((issue) => error("Chưa hoàn tất dừng chia sẻ: " + issue.message));
});
element("settings-button").addEventListener("click", () => {
  void BackgroundGeolocation.openSettings().catch((issue) =>
    error(issue.message),
  );
});
element("logout-button").addEventListener("click", async () => {
  error();
  await tracker.stop().catch(() => {});
  try {
    await api("logout", {});
  } catch (issue) {
    error(
      "Đã dừng GPS và xóa phiên trên thiết bị; chưa xác nhận thu hồi trên máy chủ: " +
        (issue as Error).message,
    );
  }
  token = null;
  element("tracking-panel").classList.add("hidden");
  element("login-panel").classList.remove("hidden");
  element<HTMLInputElement>("consent").checked = false;
});
