import { defaultPolicy } from "./geo";
import type { Campus } from "./models";

// Address pin inspected on Google Maps, 2026-11-26. The pin is approximate;
// the 200 m radius is a starter configuration, not a surveyed school boundary.
export const schoolCenter = { lat: 14.0182432, lng: 107.991825 };
export const schoolRadiusMeters = 200;
export const schoolMapUrl =
  "https://www.google.com/maps/search/?api=1&query=14.0182432,107.991825";
export const schoolPreset: Campus = {
  name: "Phân hiệu 1 Trường Thiếu sinh quân miền Trung",
  address: "534 Phạm Văn Đồng, phường Thống Nhất, tỉnh Gia Lai",
  // 64 sides keep the circle approximation error below 0.25 m at this radius.
  polygon: Array.from({ length: 64 }, (_, index) => {
    const angle = (index * 2 * Math.PI) / 64;
    return {
      lat:
        schoolCenter.lat +
        (((schoolRadiusMeters * Math.cos(angle)) / 6371008.8) * 180) / Math.PI,
      lng:
        schoolCenter.lng +
        (((schoolRadiusMeters * Math.sin(angle)) /
          (6371008.8 * Math.cos((schoolCenter.lat * Math.PI) / 180))) *
          180) /
          Math.PI,
    };
  }),
  policy: defaultPolicy,
  boundaryNote:
    "Vùng tạm 200 m quanh ghim địa chỉ Google Maps; chưa xác minh hàng rào trường.",
};
