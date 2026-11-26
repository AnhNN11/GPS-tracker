"use client";
import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  Circle,
  CircleMarker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { Point } from "@/lib/geo";
import type { Person } from "@/lib/types";
import "leaflet/dist/leaflet.css";
const colors: Record<string, string> = {
  inside: "#16836b",
  outside: "#e2574c",
  stale: "#d28d18",
  pending: "#d28d18",
  uncertain: "#64748b",
};
function Controls({
  drawing,
  onPoint,
  focus,
}: {
  drawing: boolean;
  onPoint?: (p: Point) => void;
  focus: Point | null;
}) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (drawing) onPoint?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], 17);
  }, [focus?.lat, focus?.lng, map]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
export default function CampusMap({
  polygon,
  people = [],
  drawing = false,
  onPoint,
  focus = null,
}: {
  polygon: Point[];
  people?: Person[];
  drawing?: boolean;
  onPoint?: (p: Point) => void;
  focus?: Point | null;
}) {
  const center = focus ??
    people.find((person) => person.reading)?.reading ??
    polygon[0] ?? { lat: 14.0182432, lng: 107.991825 };
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={polygon.length ? 17 : 14}
      className={drawing ? "map drawing" : "map"}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Controls drawing={drawing} onPoint={onPoint} focus={focus} />
      {polygon.length >= 3 ? (
        <Polygon
          positions={polygon.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: "#178771",
            weight: 2,
            fillOpacity: 0.1,
            dashArray: drawing ? "7 7" : undefined,
          }}
        />
      ) : (
        <Polyline
          positions={polygon.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: "#178771" }}
        />
      )}
      {drawing &&
        polygon.map((p, i) => (
          <CircleMarker
            key={i}
            center={[p.lat, p.lng]}
            radius={5}
            pathOptions={{
              color: "#fff",
              fillColor: "#178771",
              fillOpacity: 1,
            }}
          >
            <Popup>Đỉnh {i + 1}</Popup>
          </CircleMarker>
        ))}
      {people
        .filter((p) => p.reading)
        .map((p) => (
          <Circle
            key={p.id}
            center={[p.reading!.lat, p.reading!.lng]}
            radius={p.reading!.accuracy}
            pathOptions={{
              color: colors[p.status] ?? "#64748b",
              fillOpacity: 0.1,
              weight: 1,
            }}
          >
            <CircleMarker
              center={[p.reading!.lat, p.reading!.lng]}
              radius={7}
              pathOptions={{
                color: "#fff",
                weight: 2,
                fillColor: colors[p.status] ?? "#64748b",
                fillOpacity: 1,
              }}
            >
              <Popup>
                <strong>{p.name}</strong>
                <br />
                Sai số GPS: ±{Math.round(p.reading!.accuracy)} m<br />
                {new Date(p.reading!.capturedAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </Popup>
            </CircleMarker>
          </Circle>
        ))}
    </MapContainer>
  );
}
