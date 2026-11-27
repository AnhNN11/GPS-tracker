export type DeviceContext = { deviceId: string; deviceLabel: string };
let temporaryId: string | undefined;
export function browserDeviceId(
  provider: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>,
) {
  if (typeof provider.randomUUID === "function") return provider.randomUUID();
  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10)]
    .map((part) => part.join("")).join("-");
}
export function deviceContext(): DeviceContext {
  temporaryId ??= browserDeviceId(crypto);
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
