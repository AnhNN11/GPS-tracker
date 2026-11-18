export async function enableBrowserPush() {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    throw new Error(
      "Thiết bị chưa hỗ trợ thông báo. Trên iPhone, thêm website vào Màn hình chính rồi mở lại từ biểu tượng.",
    );
  if (!window.isSecureContext) throw new Error("Thông báo cần kết nối HTTPS.");
  // Request while the click gesture is still active, before any network awaits.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Chưa được cấp quyền thông báo.");
  await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error("Chưa khởi động được thông báo. Vui lòng thử lại.")),
        15000,
      ),
    ),
  ]);
  const response = await fetch("/api/push/config", { cache: "no-store" });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error);
  const value = config.publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(value + "=".repeat((4 - (value.length % 4)) % 4));
  const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key.buffer,
    }));
  const saved = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saved.ok)
    throw new Error((await saved.json()).error || "Không lưu được thiết bị.");
}
export async function disableBrowserPush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    const response = await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Không tắt được thông báo.");
  } finally {
    await subscription.unsubscribe();
  }
}
