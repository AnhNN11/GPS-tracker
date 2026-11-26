import { defaultPolicy, circlePolygon } from "./geo";
import type { Campus } from "./models";

// Address pin inspected on Google Maps, 2026-11-26. The pin is approximate;
// the 200 m radius is a starter configuration, not a surveyed school boundary.
export const schoolCenter = { lat: 14.0182432, lng: 107.991825 };
export const schoolRadiusMeters = 200;
export const schoolMapUrl =
  "https://www.google.com/maps/search/?api=1&query=14.0182432,107.991825";
const circle = { center: schoolCenter, radiusMeters: schoolRadiusMeters };
export const schoolPreset: Campus = {
  name: "Phân hiệu 1 Trường Thiếu sinh quân miền Trung",
  address: "534 Phạm Văn Đồng, phường Thống Nhất, tỉnh Gia Lai",
  // Polygon is for map bounds/backwards compatibility; classification uses radius.
  polygon: circlePolygon(circle),
  circle,
  policy: defaultPolicy,
  boundaryNote:
    "Vùng tạm 200 m quanh ghim địa chỉ Google Maps; chưa xác minh hàng rào trường.",
};
