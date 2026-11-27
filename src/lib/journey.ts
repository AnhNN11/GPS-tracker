import { collections } from "./db";
import { analyseJourney } from "./journey-analysis";
import { historyFilters, type HistoryQuery } from "./history";
import type { UserRow } from "./models";

export { analyseJourney } from "./journey-analysis";

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
