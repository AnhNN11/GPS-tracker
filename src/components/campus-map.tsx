"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  divIcon,
  type Marker as LeafletMarker,
  type Map as LeafletMap,
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
import { mapPresence } from "@/lib/map-presence";
import "leaflet/dist/leaflet.css";
const mapTime = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "Chưa có thời điểm nhận";
function PersonDetails({
  person,
  now,
  staleMinutes,
}: {
  person: Person;
  now: number;
  staleMinutes: number;
}) {
  const presence = mapPresence(person, now, staleMinutes);
  return (
    <div className="map-person-details">
      <strong>{person.name}</strong>
      <span>{person.email}</span>
      <b style={{ color: presence.color }}>{presence.label}</b>
      <span>GPS ghi: {mapTime(person.reading!.capturedAt)}</span>
      <span>Máy chủ nhận: {mapTime(person.lastReceivedAt)}</span>
      <span>Sai số: ±{Math.round(person.reading!.accuracy)} m</span>
      <span>
        Tọa độ: {person.reading!.lat.toFixed(6)},{" "}
        {person.reading!.lng.toFixed(6)}
      </span>
    </div>
  );
}
function regionPoints(polygon: Point[], circle?: CircleRegion) {
  return circle ? circlePolygon(circle) : polygon;
}
function fitPeopleBounds(
  map: LeafletMap,
  people: Person[],
  polygon: Point[],
  circle?: CircleRegion,
) {
  const points = people
    .filter((p) => p.reading)
    .map((p) => [p.reading!.lat, p.reading!.lng] as [number, number]);
  if (!points.length) return;
  points.push(
    ...regionPoints(polygon, circle).map(
      (p) => [p.lat, p.lng] as [number, number],
    ),
  );
  map.fitBounds(points, { padding: [40, 40], maxZoom: 17, animate: false });
}
function Controls({
  drawing,
  onPoint,
  focus,
  circle,
  polygon,
  fitRegion,
  editing,
  fitRevision,
  onCenterPick,
  people,
  fitPeople,
}: {
  drawing: boolean;
  onPoint?: (p: Point) => void;
  focus: Point | null;
  circle?: CircleRegion;
  polygon: Point[];
  fitRegion: boolean;
  editing: boolean;
  fitRevision: number;
  onCenterPick?: (p: Point) => void;
  people: Person[];
  fitPeople: boolean;
}) {
  const map = useMap();
  const wasEditing = useRef(false),
    hadRegion = useRef(false),
    lastFit = useRef(fitRevision);
  const current = useRef({
    circle,
    polygon,
    fitRegion,
    editing,
    people,
    fitPeople,
    focus,
  });
  current.current = {
    circle,
    polygon,
    fitRegion,
    editing,
    people,
    fitPeople,
    focus,
  };
  const peopleKey = people
    .filter((p) => p.reading)
    .map((p) => p.id)
    .sort()
    .join(",");
  const boundaryKey = JSON.stringify(regionPoints(polygon, circle));
  useMapEvents({
    click(e) {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (onCenterPick)
        onCenterPick({
          lat: Math.max(-85, Math.min(85, point.lat)),
          lng: ((point.lng + 540) % 360) - 180,
        });
      else if (drawing) onPoint?.(point);
    },
  });
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], 17);
  }, [focus?.lat, focus?.lng, map]);
  useEffect(() => {
    if (!fitPeople || focus) return;
    const value = current.current;
    fitPeopleBounds(map, value.people, value.polygon, value.circle);
  }, [fitPeople, peopleKey, fitRevision, focus, map]);
  useEffect(() => {
    const points = regionPoints(
      current.current.polygon,
      current.current.circle,
    );
    const shouldFit =
      !editing ||
      !wasEditing.current ||
      (!hadRegion.current && !drawing) ||
      lastFit.current !== fitRevision;
    wasEditing.current = editing;
    hadRegion.current = points.length >= 3;
    lastFit.current = fitRevision;
    if (fitRegion && points.length >= 3 && shouldFit) {
      map.invalidateSize({ pan: false });
      map.fitBounds(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [30, 30], maxZoom: 18, animate: false },
      );
    }
  }, [fitRegion, editing, drawing, fitRevision, boundaryKey, map]);
  useEffect(() => {
    const resize = () => {
      map.invalidateSize({ pan: false });
      const value = current.current;
      const points = regionPoints(value.polygon, value.circle);
      if (value.fitRegion && !value.editing && points.length >= 3)
        map.fitBounds(
          points.map((p) => [p.lat, p.lng] as [number, number]),
          { padding: [30, 30], maxZoom: 18, animate: false },
        );
      else if (value.fitPeople && !value.focus)
        fitPeopleBounds(map, value.people, value.polygon, value.circle);
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(map.getContainer());
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [map]);
  return null;
}
function PersonMarker({
  person,
  now,
  staleMinutes,
}: {
  person: Person;
  now: number;
  staleMinutes: number;
}) {
  const presence = mapPresence(person, now, staleMinutes);
  const marker = useRef<LeafletMarker | null>(null);
  const label = `${person.name}: ${presence.label}`;
  const icon = useMemo(
    () =>
      divIcon({
        className: "map-person-marker",
        html: `<span class="map-person-dot" style="background:${presence.color}" aria-hidden="true"></span>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -14],
        tooltipAnchor: [0, -18],
      }),
    [presence.color],
  );
  useEffect(() => {
    const target = marker.current;
    const element = target?.getElement();
    if (!element || !target) return;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", label);
    element.tabIndex = 0;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        target.closeTooltip();
        target.openPopup();
      } else if (event.key === "Escape") target.closePopup();
    };
    const focus = () => {
      target.openTooltip();
    };
    const blur = () => {
      target.closeTooltip();
    };
    element.addEventListener("keydown", keydown);
    element.addEventListener("focus", focus);
    element.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("keydown", keydown);
      element.removeEventListener("focus", focus);
      element.removeEventListener("blur", blur);
    };
  }, [label, icon]);
  const reading = person.reading!;
  return (
    <>
      <Circle
        center={[reading.lat, reading.lng]}
        radius={reading.accuracy}
        interactive={false}
        pathOptions={{ color: presence.color, fillOpacity: 0.1, weight: 1 }}
      />
      <Marker
        ref={marker}
        position={[reading.lat, reading.lng]}
        icon={icon}
        title={label}
        alt={label}
      >
        <Tooltip direction="top" className="person-map-tooltip">
          <PersonDetails
            person={person}
            now={now}
            staleMinutes={staleMinutes}
          />
        </Tooltip>
        <Popup>
          <PersonDetails
            person={person}
            now={now}
            staleMinutes={staleMinutes}
          />
        </Popup>
      </Marker>
    </>
  );
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
        html: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M8 8l-4 4 4 4m8-8 4 4-4 4"/></svg>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [],
  );
  const centerIcon = useMemo(
    () =>
      divIcon({
        className: "circle-edit-marker circle-center-handle",
        html: '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
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
  onCenterPick,
  fitPeople = false,
  now = Date.now(),
  staleMinutes = 5,
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
  onCenterPick?: (p: Point) => void;
  fitPeople?: boolean;
  now?: number;
  staleMinutes?: number;
}) {
  const center = focus ??
    people.find((person) => person.reading)?.reading ??
    circle?.center ??
    polygon[0] ?? { lat: 14.0182432, lng: 107.991825 };
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={polygon.length ? 17 : 14}
      className={drawing || onCenterPick ? "map drawing" : "map"}
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
        editing={drawing || !!onCircleChange}
        polygon={polygon}
        fitRevision={fitRevision}
        onCenterPick={onCenterPick}
        people={people}
        fitPeople={fitPeople}
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
        .filter((person) => person.reading)
        .map((person) => (
          <PersonMarker
            key={person.id}
            person={person}
            now={now}
            staleMinutes={staleMinutes}
          />
        ))}
    </MapContainer>
  );
}
