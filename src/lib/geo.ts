export type Point = { lat: number; lng: number };
export type CircleRegion = { center: Point; radiusMeters: number };
export type Reading = Point & { accuracy: number; capturedAt: number };
export type Policy = {
  buffer: number;
  maxAccuracy: number;
  confirmSeconds: number;
  staleMinutes: number;
};
export const defaultPolicy: Policy = {
  buffer: 10,
  maxAccuracy: 50,
  confirmSeconds: 30,
  staleMinutes: 5,
};
const earth = 6371008.8;
export function geodesicDistance(a: Point, b: Point) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians,
    dLng = (b.lng - a.lng) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function pointAtDistance(
  center: Point,
  bearing: number,
  meters: number,
): Point {
  const lat = (center.lat * Math.PI) / 180,
    lng = (center.lng * Math.PI) / 180;
  const angle = meters / earth,
    direction = (bearing * Math.PI) / 180;
  const nextLat = Math.asin(
    Math.sin(lat) * Math.cos(angle) +
      Math.cos(lat) * Math.sin(angle) * Math.cos(direction),
  );
  const nextLng =
    lng +
    Math.atan2(
      Math.sin(direction) * Math.sin(angle) * Math.cos(lat),
      Math.cos(angle) - Math.sin(lat) * Math.sin(nextLat),
    );
  return {
    lat: (nextLat * 180) / Math.PI,
    lng: (((nextLng * 180) / Math.PI + 540) % 360) - 180,
  };
}
export function validCircle(value: unknown): value is CircleRegion {
  const circle = value as CircleRegion | null;
  return (
    !!circle &&
    Number.isFinite(circle.radiusMeters) &&
    circle.radiusMeters >= 50 &&
    circle.radiusMeters <= 3000 &&
    !!circle.center &&
    Number.isFinite(circle.center.lat) &&
    Math.abs(circle.center.lat) <= 85 &&
    Number.isFinite(circle.center.lng) &&
    Math.abs(circle.center.lng) <= 180
  );
}
export function circlePolygon(circle: CircleRegion): Point[] {
  return Array.from({ length: 64 }, (_, index) =>
    pointAtDistance(circle.center, (index * 360) / 64, circle.radiusMeters),
  );
}
function project(p: Point, origin: Point) {
  return {
    x:
      (((p.lng - origin.lng) * Math.PI) / 180) *
      earth *
      Math.cos((origin.lat * Math.PI) / 180),
    y: (((p.lat - origin.lat) * Math.PI) / 180) * earth,
  };
}
export function distance(a: Point, b: Point) {
  const p = project(a, b);
  return Math.hypot(p.x, p.y);
}
export function inside(p: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng
    )
      result = !result;
  }
  return result;
}
export function edgeDistance(
  p: Point,
  polygon: Point[],
  circle?: CircleRegion,
) {
  if (circle)
    return Math.abs(geodesicDistance(p, circle.center) - circle.radiusMeters);
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = project(polygon[i], p),
      b = project(polygon[(i + 1) % polygon.length], p);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)),
    );
    nearest = Math.min(nearest, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return nearest;
}
export function validPolygon(points: Point[]) {
  if (
    points.length < 3 ||
    points.length > 100 ||
    points.some(
      (p) =>
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lng) ||
        Math.abs(p.lat) > 85 ||
        Math.abs(p.lng) > 180,
    )
  )
    return false;
  if (points.some((p) => distance(p, points[0]) > 10000)) return false;
  const projected = points.map((p) => project(p, points[0]));
  const orient = (a: (typeof projected)[number], b: typeof a, c: typeof a) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = projected[i],
      b = projected[(i + 1) % points.length];
    if (distance(points[i], points[(i + 1) % points.length]) < 1) return false;
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = projected[j],
        d = projected[(j + 1) % points.length];
      const s1 = orient(a, b, c),
        s2 = orient(a, b, d),
        s3 = orient(c, d, a),
        s4 = orient(c, d, b);
      // Reject intersections, including collinear or touching non-adjacent edges.
      if (
        s1 * s2 <= 0 &&
        s3 * s4 <= 0 &&
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      )
        return false;
    }
  }
  return Math.abs(area) / 2 >= 100;
}
export function classify(
  reading: Reading,
  polygon: Point[],
  policy: Policy,
  circle?: CircleRegion,
): "inside" | "outside" | "uncertain" | "unconfigured" {
  if (!circle && polygon.length < 3) return "unconfigured";
  if (
    reading.accuracy > policy.maxAccuracy ||
    edgeDistance(reading, polygon, circle) <=
      reading.accuracy + policy.buffer + 1e-6
  )
    return "uncertain";
  return (
    circle
      ? geodesicDistance(reading, circle.center) <= circle.radiusMeters
      : inside(reading, polygon)
  )
    ? "inside"
    : "outside";
}
export type Candidate = {
  deviceId?: string;
  campusVersion?: string;
  since: number;
  last: number;
  count: number;
  firstReading?: Reading;
};
export function advanceOutside(
  previous: Candidate | null,
  time: number,
  policy: Policy,
) {
  const candidate =
    previous && time > previous.last && time - previous.last <= 130000
      ? { ...previous, last: time, count: previous.count + 1 }
      : { since: time, last: time, count: 1 };
  return {
    candidate,
    confirmed:
      candidate.count >= 2 &&
      time - candidate.since >= policy.confirmSeconds * 1000,
  };
}
