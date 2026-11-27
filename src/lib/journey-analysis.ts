import { geodesicDistance } from "./geo";
import type { LocationSample, BoundaryVersion } from "./models";

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
