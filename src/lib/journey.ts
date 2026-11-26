import { collections } from "./db";
import { geodesicDistance } from "./geo";
import { historyFilters, type HistoryQuery } from "./history";
import type { UserRow, LocationSample, BoundaryVersion } from "./models";

export function analyseJourney(
  points: LocationSample[],
  boundaries: BoundaryVersion[] = [],
) {
  const limits = new Map(
    boundaries.map((b) => [b.id, b.campus.policy.maxAccuracy]),
  );
  const groups = new Map<string, number[]>();
  points.forEach((point, index) => {
    const key = point.deviceId ?? "legacy";
    const group = groups.get(key) ?? [];
    group.push(index);
    groups.set(key, group);
  });
  const segments: number[][] = [],
    breaks: { from: number; to: number; reason: string }[] = [];
  let meters = 0,
    observedSeconds = 0,
    outsideSeconds = 0;
  for (const indexes of groups.values()) {
    let segment: number[] = [];
    for (const index of indexes) {
      const previous = segment.at(-1),
        point = points[index];
      let reason = "";
      if (previous !== undefined) {
        const before = points[previous],
          dt = (point.capturedAt - before.capturedAt) / 1000;
        const distance = geodesicDistance(before, point);
        if (
          before.trackingSession !== point.trackingSession ||
          before.campusVersion !== point.campusVersion
        )
          reason = "Đổi phiên hoặc ranh giới";
        else if (dt <= 0 || dt > 130) reason = "Gián đoạn thời gian";
        else if (
          before.accuracy > (limits.get(before.campusVersion) ?? 50) ||
          point.accuracy > (limits.get(point.campusVersion) ?? 50)
        )
          reason = "GPS có sai số lớn";
        else if (distance / dt > 60) reason = "Bước nhảy GPS bất thường";
        if (reason) {
          segments.push(segment);
          segment = [];
          breaks.push({ from: previous, to: index, reason });
        } else {
          meters += distance;
          observedSeconds += dt;
          if (
            before.classification === "outside" &&
            point.classification === "outside"
          )
            outsideSeconds += dt;
        }
      }
      segment.push(index);
    }
    if (segment.length) segments.push(segment);
  }
  segments.sort((a, b) => points[a[0]].capturedAt - points[b[0]].capturedAt);
  return {
    segments,
    breaks,
    summary: {
      samples: points.length,
      outsideSamples: points.filter((p) => p.classification === "outside")
        .length,
      uncertainSamples: points.filter((p) => p.classification === "uncertain")
        .length,
      lineDistanceMeters: Math.round(meters),
      observedSeconds: Math.round(observedSeconds),
      outsideObservedSeconds: Math.round(outsideSeconds),
      firstAt: points[0]?.capturedAt ?? null,
      lastAt: points.at(-1)?.capturedAt ?? null,
    },
  };
}
export async function readJourney(
  user: UserRow,
  query: HistoryQuery,
  deviceId?: string,
) {
  if (user.role === "admin" && !query.userId)
    throw new Error("Chọn một tài khoản để phân tích hành trình.");
  const filters = historyFilters(user, query);
  if (
    deviceId &&
    deviceId !== "legacy" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      deviceId,
    )
  )
    throw new Error("Mã thiết bị không hợp lệ.");
  const c = await collections();
  const all = await c.samples
    .find(filters.samples, { projection: { _id: 0 } })
    .sort({ capturedAt: 1 })
    .limit(10001)
    .toArray();
  if (all.length > 10000)
    throw new Error(
      "Hành trình có hơn 10.000 mẫu. Hãy thu hẹp khoảng ngày để phân tích đầy đủ.",
    );
  const devices = [
    ...new Map(
      all.map((point) => [
        point.deviceId ?? "legacy",
        {
          id: point.deviceId ?? "legacy",
          label: point.deviceLabel ?? "Chưa phân biệt thiết bị (dữ liệu cũ)",
        },
      ]),
    ).values(),
  ];
  const points = deviceId
    ? all.filter((point) => (point.deviceId ?? "legacy") === deviceId)
    : all;
  const versions = [...new Set(points.map((point) => point.campusVersion))];
  if (versions.length > 50)
    throw new Error(
      "Có quá nhiều phiên bản ranh giới. Hãy thu hẹp khoảng ngày.",
    );
  const boundaries = await c.boundaryVersions
    .find({ id: { $in: versions } }, { projection: { _id: 0 } })
    .toArray();
  return {
    points,
    boundaries,
    devices,
    ...analyseJourney(points, boundaries),
    legacySamples: points.filter((p) => !p.deviceId).length,
    from: query.from,
    to: query.to,
  };
}
export type JourneyResult = Awaited<ReturnType<typeof readJourney>>;
