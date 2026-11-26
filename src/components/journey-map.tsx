"use client";
import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Polyline,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import type { JourneyResult } from "@/lib/journey";
import "leaflet/dist/leaflet.css";
const color = {
  inside: "#087443",
  outside: "#c32626",
  uncertain: "#a35b00",
  unconfigured: "#526174",
};
function Frame({
  data,
  selected,
}: {
  data: JourneyResult;
  selected: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    const coordinates = [
      ...data.points,
      ...data.boundaries.flatMap((b) => b.campus.polygon),
    ].map((p) => [p.lat, p.lng] as [number, number]);
    if (coordinates.length)
      map.fitBounds(coordinates, { padding: [30, 30], maxZoom: 18 });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [data, map]);
  useEffect(() => {
    if (selected !== null && data.points[selected]) {
      const p = data.points[selected];
      map.flyTo([p.lat, p.lng], 17);
    }
  }, [selected, data, map]);
  return null;
}
export default function JourneyMap({
  data,
  selected,
}: {
  data: JourneyResult;
  selected: number | null;
}) {
  const center = data.points[0] ?? { lat: 14.0182432, lng: 107.991825 };
  const stride = Math.max(1, Math.ceil(data.points.length / 200));
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={15}
      className="map journey-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Frame data={data} selected={selected} />
      {data.boundaries.map(({ id, campus }) =>
        campus.circle ? (
          <Circle
            key={id}
            center={[campus.circle.center.lat, campus.circle.center.lng]}
            radius={campus.circle.radiusMeters}
            pathOptions={{
              color: "#087443",
              weight: 2,
              fillOpacity: 0.04,
              dashArray: "6 4",
            }}
          >
            <Popup>{campus.boundaryNote ?? campus.address}</Popup>
          </Circle>
        ) : (
          <Polygon
            key={id}
            positions={campus.polygon.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#087443", weight: 2, fillOpacity: 0.04 }}
          />
        ),
      )}
      {data.segments
        .filter((indexes) => indexes.length >= 2)
        .map((indexes, i) => (
          <Polyline
            key={i}
            positions={indexes.map((index) => [
              data.points[index].lat,
              data.points[index].lng,
            ])}
            pathOptions={{ color: "#1557b0", weight: 4, opacity: 0.85 }}
          />
        ))}
      {data.points
        .map((p, index) => ({ p, index }))
        .filter(
          ({ index }) =>
            index % stride === 0 || index === data.points.length - 1,
        )
        .map(({ p, index }) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={index === 0 || index === data.points.length - 1 ? 8 : 4}
            pathOptions={{
              color: "#fff",
              weight: 1,
              fillColor: color[p.classification],
              fillOpacity: 1,
            }}
          >
            <Popup>
              Mẫu {index + 1} ·{" "}
              {new Date(p.capturedAt).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
              <br />
              {p.deviceLabel ?? "Dữ liệu chưa có mã thiết bị"}
              <br />
              {p.lat.toFixed(6)}, {p.lng.toFixed(6)} · ±{Math.round(p.accuracy)}{" "}
              m
            </Popup>
          </CircleMarker>
        ))}
      {selected !== null && data.points[selected] && (
        <CircleMarker
          center={[data.points[selected].lat, data.points[selected].lng]}
          radius={11}
          pathOptions={{
            color: "#111827",
            weight: 3,
            fillColor: "#facc15",
            fillOpacity: 1,
          }}
        />
      )}
    </MapContainer>
  );
}
