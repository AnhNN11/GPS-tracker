"use client";
import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import type { LocationSample, Campus } from "@/lib/models";
import "leaflet/dist/leaflet.css";
function Fit({
  points,
  boundary,
}: {
  points: LocationSample[];
  boundary: Campus | null;
}) {
  const map = useMap();
  useEffect(() => {
    const coordinates = [
      ...points.map((p) => [p.lat, p.lng] as [number, number]),
      ...(boundary?.polygon ?? []).map(
        (p) => [p.lat, p.lng] as [number, number],
      ),
    ];
    if (coordinates.length)
      map.fitBounds(coordinates, { padding: [30, 30], maxZoom: 18 });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, points, boundary]);
  return null;
}
export default function HistoryMap({
  points,
  boundary,
}: {
  points: LocationSample[];
  boundary: Campus | null;
}) {
  const first = points[0] ?? boundary?.polygon[0] ?? { lat: 13.9833, lng: 108 };
  const stride = Math.max(1, Math.ceil(points.length / 200));
  return (
    <MapContainer center={[first.lat, first.lng]} zoom={16} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit points={points} boundary={boundary} />
      {boundary && boundary.polygon.length >= 3 && (
        <Polygon
          positions={boundary.polygon.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: "#178771", weight: 2, fillOpacity: 0.08 }}
        />
      )}
      <Polyline
        positions={points.map((p) => [p.lat, p.lng])}
        pathOptions={{ color: "#516c83", weight: 3, opacity: 0.7 }}
      />
      {points
        .filter((_, i) => i % stride === 0 || i === points.length - 1)
        .map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={4}
            pathOptions={{
              color:
                p.classification === "outside"
                  ? "#d95546"
                  : p.classification === "inside"
                    ? "#167d68"
                    : "#b48a32",
              fillOpacity: 1,
              weight: 1,
            }}
          >
            <Popup>
              {new Date(p.capturedAt).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
              <br />
              {p.classification === "outside"
                ? "Mẫu ở ngoài"
                : p.classification === "inside"
                  ? "Mẫu ở trong"
                  : "Chưa rõ"}{" "}
              · Sai số ±{Math.round(p.accuracy)} m
            </Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}
