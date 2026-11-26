"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  divIcon,
  type Marker as LeafletMarker,
  type LeafletEvent,
} from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  Circle,
  CircleMarker,
  Popup,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  circlePolygon,
  pointAtDistance,
  geodesicDistance,
  type Point,
  type CircleRegion,
} from "@/lib/geo";
import type { Person } from "@/lib/types";
import "leaflet/dist/leaflet.css";
const colors: Record<string, string> = {
  inside: "#087443",
  outside: "#c32626",
  stale: "#985500",
  pending: "#985500",
  uncertain: "#64748b",
};
function Controls({
  drawing,
  onPoint,
  focus,
  circle,
  fitRegion,
  editingCircle,
  fitRevision,
}: {
  drawing: boolean;
  onPoint?: (p: Point) => void;
  focus: Point | null;
  circle?: CircleRegion;
  fitRegion: boolean;
  editingCircle: boolean;
  fitRevision: number;
}) {
  const map = useMap();
  const wasEditing = useRef(false),
    lastFit = useRef(fitRevision);
  const region = useRef({ circle, fitRegion });
  region.current = { circle, fitRegion };
  useMapEvents({
    click(e) {
      if (drawing) onPoint?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], 17);
  }, [focus?.lat, focus?.lng, map]);
  useEffect(() => {
    const shouldFit =
      !editingCircle || !wasEditing.current || lastFit.current !== fitRevision;
    wasEditing.current = editingCircle;
    lastFit.current = fitRevision;
    if (fitRegion && circle && shouldFit)
      map.fitBounds(
        circlePolygon(circle).map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [25, 25], maxZoom: 18 },
      );
  }, [
    fitRegion,
    editingCircle,
    fitRevision,
    circle?.center.lat,
    circle?.center.lng,
    circle?.radiusMeters,
    map,
  ]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      const current = region.current;
      if (current.fitRegion && current.circle)
        map.fitBounds(
          circlePolygon(current.circle).map(
            (p) => [p.lat, p.lng] as [number, number],
          ),
          { padding: [25, 25], maxZoom: 18, animate: false },
        );
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
function CircleEditor({
  circle,
  onChange,
}: {
  circle: CircleRegion;
  onChange: (value: CircleRegion) => void;
}) {
  const [bearing, setBearing] = useState(90);
  const current = useRef(circle),
    callback = useRef(onChange),
    radiusMarker = useRef<LeafletMarker | null>(null);
  current.current = circle;
  callback.current = onChange;
  const radiusIcon = useMemo(
    () =>
      divIcon({
        className: "circle-edit-marker circle-radius-handle",
        html: '<span aria-hidden="true">↔</span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [],
  );
  const centerIcon = useMemo(
    () =>
      divIcon({
        className: "circle-edit-marker circle-center-handle",
        html: '<span aria-hidden="true">✚</span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [],
  );
  const radiusEvents = useMemo(() => {
    const resize = (event: LeafletEvent) => {
      const position = (event.target as LeafletMarker).getLatLng(),
        center = current.current.center;
      const a = (center.lat * Math.PI) / 180,
        b = (position.lat * Math.PI) / 180,
        delta = ((position.lng - center.lng) * Math.PI) / 180;
      setBearing(
        (Math.atan2(
          Math.sin(delta) * Math.cos(b),
          Math.cos(a) * Math.sin(b) -
            Math.sin(a) * Math.cos(b) * Math.cos(delta),
        ) *
          180) /
          Math.PI,
      );
      const radiusMeters = Math.max(
        50,
        Math.min(3000, Math.round(geodesicDistance(center, position))),
      );
      callback.current({ ...current.current, radiusMeters });
    };
    return { drag: resize, dragend: resize };
  }, []);
  const centerEvents = useMemo(
    () => ({
      drag: (event: LeafletEvent) => {
        const point = (event.target as LeafletMarker).getLatLng();
        callback.current({
          ...current.current,
          center: {
            lat: Math.max(-85, Math.min(85, point.lat)),
            lng: ((point.lng + 540) % 360) - 180,
          },
        });
      },
    }),
    [],
  );
  useEffect(() => {
    const element = radiusMarker.current?.getElement();
    const keydown = (event: KeyboardEvent) => {
      const change = ["ArrowRight", "ArrowUp", "+", "="].includes(event.key)
        ? 10
        : ["ArrowLeft", "ArrowDown", "-"].includes(event.key)
          ? -10
          : 0;
      if (!change) return;
      event.preventDefault();
      event.stopPropagation();
      callback.current({
        ...current.current,
        radiusMeters: Math.max(
          50,
          Math.min(3000, Math.round(current.current.radiusMeters + change)),
        ),
      });
    };
    element?.addEventListener("keydown", keydown);
    return () => element?.removeEventListener("keydown", keydown);
  }, []);
  const edge = pointAtDistance(circle.center, bearing, circle.radiusMeters);
  return (
    <>
      <Polyline
        positions={[
          [circle.center.lat, circle.center.lng],
          [edge.lat, edge.lng],
        ]}
        pathOptions={{ color: "#087443", weight: 2, dashArray: "5 5" }}
      />
      <Marker
        position={[circle.center.lat, circle.center.lng]}
        draggable
        icon={centerIcon}
        eventHandlers={centerEvents}
        title="Kéo tâm để di chuyển vùng"
        alt="Kéo tâm để di chuyển vùng"
      >
        <Tooltip direction="bottom" offset={[0, 18]}>
          Kéo để di chuyển tâm
        </Tooltip>
      </Marker>
      <Marker
        ref={radiusMarker}
        position={[edge.lat, edge.lng]}
        draggable
        icon={radiusIcon}
        eventHandlers={radiusEvents}
        title="Kéo viền để thay đổi bán kính"
        alt="Kéo viền để thay đổi bán kính"
      >
        <Tooltip permanent direction="top" offset={[0, -22]}>
          {Math.round(circle.radiusMeters)} m · Kéo ↔ để đổi bán kính
        </Tooltip>
      </Marker>
    </>
  );
}
export default function CampusMap({
  polygon,
  people = [],
  drawing = false,
  onPoint,
  focus = null,
  circle,
  fitRegion = false,
  onCircleChange,
  fitRevision = 0,
}: {
  polygon: Point[];
  people?: Person[];
  drawing?: boolean;
  onPoint?: (p: Point) => void;
  focus?: Point | null;
  circle?: CircleRegion;
  fitRegion?: boolean;
  onCircleChange?: (circle: CircleRegion) => void;
  fitRevision?: number;
}) {
  const center = focus ??
    people.find((person) => person.reading)?.reading ??
    circle?.center ??
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
      <Controls
        drawing={drawing}
        onPoint={onPoint}
        focus={focus}
        circle={circle}
        fitRegion={fitRegion}
        editingCircle={!!onCircleChange}
        fitRevision={fitRevision}
      />
      {circle ? (
        <>
          <Circle
            center={[circle.center.lat, circle.center.lng]}
            radius={circle.radiusMeters}
            pathOptions={{ color: "#178771", weight: 2, fillOpacity: 0.1 }}
          />
          {onCircleChange ? (
            <CircleEditor circle={circle} onChange={onCircleChange} />
          ) : (
            <CircleMarker
              center={[circle.center.lat, circle.center.lng]}
              radius={4}
              pathOptions={{ color: "#178771", fillOpacity: 1 }}
            >
              <Popup>Tâm vùng · bán kính {circle.radiusMeters} m</Popup>
            </CircleMarker>
          )}
        </>
      ) : polygon.length >= 3 ? (
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
