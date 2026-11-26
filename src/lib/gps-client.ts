import type { Reading } from "./geo";
type Provider = Pick<Geolocation, "getCurrentPosition">;

function request(
  provider: Provider,
  highAccuracy: boolean,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    // Browser timeouts can exclude permission dialogs. Bound our own UI wait too.
    const timer = setTimeout(() => reject({ code: 3 }), 15000);
    provider.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve(position);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
      { enableHighAccuracy: highAccuracy, maximumAge: 0, timeout: 10000 },
    );
  });
}
export function gpsErrorMessage(error: unknown) {
  const code = (error as { code?: number })?.code;
  if (code === 1)
    return "Chưa được cấp quyền vị trí. Bật Dịch vụ vị trí của điện thoại và quyền vị trí cho website trong trình duyệt.";
  if (code === 2)
    return "Thiết bị chưa tìm được vị trí. Bật GPS, kiểm tra mạng và thử ở nơi thoáng hơn.";
  if (code === 3)
    return "Chưa lấy được GPS trong thời gian chờ. Kiểm tra quyền vị trí rồi bấm Cập nhật GPS ngay để thử lại.";
  return error instanceof Error
    ? error.message
    : "Không cập nhật được vị trí. Hãy thử lại.";
}
export async function captureLocation(provider: Provider): Promise<Reading> {
  let position: GeolocationPosition;
  try {
    position = await request(provider, true);
  } catch (error) {
    if ((error as { code?: number }).code === 1) throw error;
    position = await request(provider, false);
  }
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    capturedAt: Math.round(position.timestamp),
  };
}
