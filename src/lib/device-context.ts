export type DeviceContext = { deviceId: string; deviceLabel: string };
let temporaryId: string | undefined;
export function deviceContext(): DeviceContext {
  temporaryId ??= crypto.randomUUID();
  let deviceId = temporaryId;
  try {
    const saved = localStorage.getItem("campus_device_id");
    if (
      saved &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        saved,
      )
    )
      deviceId = saved;
    else localStorage.setItem("campus_device_id", deviceId);
  } catch {
    /* Blocked storage keeps an ID only for this page session. */
  }
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac/i.test(ua)
          ? "macOS"
          : "Thiết bị khác";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome|CriOS/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : "Trình duyệt";
  return { deviceId, deviceLabel: `${os} · ${browser}` };
}
