import type { Filter } from "mongodb";
import { collections } from "./db";
import type { UserRow, LocationSample, Excursion } from "./models";
export type HistoryQuery = {
  from: string;
  to: string;
  userId?: string;
  view: "events" | "samples";
  classification?: string;
  page: number;
  pageSize: number;
};
export const dayInVietnam = (time = Date.now()) =>
  new Date(time + 7 * 3600000).toISOString().slice(0, 10);
export function vietnamDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Ngày không hợp lệ.");
  const time = Date.parse(value + "T00:00:00+07:00");
  if (!Number.isFinite(time) || dayInVietnam(time) !== value)
    throw new Error("Ngày không hợp lệ.");
  return time;
}
export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
  const from = params.get("from") || dayInVietnam(Date.now() - 6 * 86400000),
    to = params.get("to") || dayInVietnam();
  const start = vietnamDate(from),
    end = vietnamDate(to) + 86400000;
  if (end <= start || end - start > 31 * 86400000)
    throw new Error("Chọn khoảng thời gian tối đa 31 ngày.");
  const view = params.get("view") || "events",
    classification = params.get("classification") || undefined;
  if (view !== "events" && view !== "samples")
    throw new Error("Loại lịch sử không hợp lệ.");
  if (
    classification &&
    !["inside", "outside", "uncertain", "unconfigured"].includes(classification)
  )
    throw new Error("Bộ lọc vị trí không hợp lệ.");
  const page = Number(params.get("page") || 1),
    pageSize = Number(params.get("pageSize") || 50);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new Error("Phân trang không hợp lệ.");
  return {
    from,
    to,
    view,
    classification,
    userId: params.get("userId") || undefined,
    page,
    pageSize,
  };
}
function scope(user: UserRow, requested?: string) {
  if (user.role !== "admin" && requested && requested !== user.id)
    throw new Error("FORBIDDEN");
  return user.role === "admin" ? requested : user.id;
}
export function historyFilters(user: UserRow, q: HistoryQuery) {
  const userId = scope(user, q.userId),
    from = vietnamDate(q.from),
    to = vietnamDate(q.to) + 86400000;
  const samples: Filter<LocationSample> = {
    ...(userId ? { user_id: userId } : {}),
    capturedAt: { $gte: from, $lt: to },
  };
  const events: Filter<Excursion> = {
    ...(userId ? { user_id: userId } : {}),
    startedAt: { $lt: to },
    $or: [
      { active: true },
      { returnedAt: { $gte: from } },
      { lastOutsideAt: { $gte: from } },
    ],
  };
  return { samples, events };
}
export async function readHistory(
  user: UserRow,
  q: HistoryQuery,
  exportAll = false,
) {
  const c = await collections(),
    filters = historyFilters(user, q);
  const sampleFilter = {
    ...filters.samples,
    ...(q.classification
      ? { classification: q.classification as LocationSample["classification"] }
      : {}),
  };
  const total =
    q.view === "samples"
      ? await c.samples.countDocuments(sampleFilter)
      : await c.excursions.countDocuments(filters.events);
  if (exportAll && total > 10000)
    throw new Error(
      "Có hơn 10.000 dòng. Hãy chọn khoảng ngày hoặc người dùng cụ thể hơn để xuất CSV.",
    );
  const skip = exportAll ? 0 : (q.page - 1) * q.pageSize,
    limit = exportAll ? 10000 : q.pageSize;
  const rows =
    q.view === "samples"
      ? await c.samples
          .find(sampleFilter, { projection: { _id: 0 } })
          .sort({ capturedAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray()
      : await c.excursions
          .find(filters.events, { projection: { _id: 0 } })
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
  const ids = [...new Set(rows.map((r) => r.user_id))],
    names = new Map(
      (
        await c.users
          .find({ id: { $in: ids } }, { projection: { id: 1, name: 1 } })
          .toArray()
      ).map((u) => [u.id, u.name]),
    );
  const counts = await c.samples
    .aggregate<{
      total: number;
      outside: number;
      uncertain: number;
      users: string[];
    }>([
      { $match: filters.samples },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          outside: {
            $sum: { $cond: [{ $eq: ["$classification", "outside"] }, 1, 0] },
          },
          uncertain: {
            $sum: { $cond: [{ $eq: ["$classification", "uncertain"] }, 1, 0] },
          },
          users: { $addToSet: "$user_id" },
        },
      },
    ])
    .toArray();
  const count = counts[0];
  return {
    rows: rows.map((row) => ({
      ...row,
      user_name: names.get(row.user_id) ?? "Người dùng",
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    summary: {
      samples: count?.total ?? 0,
      outsideSamples: count?.outside ?? 0,
      uncertainSamples: count?.uncertain ?? 0,
      people: count?.users.length ?? 0,
      events: await c.excursions.countDocuments(filters.events),
    },
    from: q.from,
    to: q.to,
  };
}
export async function excursionDetail(user: UserRow, id: string) {
  const c = await collections(),
    event = await c.excursions.findOne(
      { id, ...(user.role === "admin" ? {} : { user_id: user.id }) },
      { projection: { _id: 0 } },
    );
  if (!event) throw new Error("Không tìm thấy lượt ghi nhận.");
  const end = event.returnedAt ?? event.lastOutsideAt;
  const points = await c.samples
    .find(
      {
        user_id: event.user_id,
        trackingSession: event.trackingSession,
        campusVersion: event.campusVersion,
        capturedAt: { $gte: event.startedAt - 60000, $lte: end + 60000 },
      },
      { projection: { _id: 0 } },
    )
    .sort({ capturedAt: 1 })
    .limit(2001)
    .toArray();
  const boundary = await c.boundaryVersions.findOne(
    { id: event.campusVersion },
    { projection: { _id: 0 } },
  );
  const person = await c.users.findOne(
    { id: event.user_id },
    { projection: { name: 1 } },
  );
  return {
    event: { ...event, user_name: person?.name ?? "Người dùng" },
    points: points.slice(0, 2000),
    truncated: points.length > 2000,
    boundary: boundary?.campus ?? null,
  };
}
export function csvCell(value: unknown) {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : '""';
  let text = String(value);
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function localTime(value: unknown) {
  return typeof value === "number"
    ? new Date(value + 7 * 3600000).toISOString().replace("Z", "+07:00")
    : "";
}
export function historyCsv(
  view: HistoryQuery["view"],
  rows: Record<string, unknown>[],
) {
  const headings =
    view === "samples"
      ? [
          "Người dùng",
          "Mã người dùng",
          "Mã thiết bị",
          "Tên thiết bị",
          "Thời điểm GPS (UTC+7)",
          "Thời điểm nhận (UTC+7)",
          "Vĩ độ",
          "Kinh độ",
          "Sai số (m)",
          "Phân loại mẫu",
          "Trạng thái xác nhận",
          "Khoảng cách ranh giới (m)",
          "Phiên theo dõi",
          "Phiên bản ranh giới",
        ]
      : [
          "Người dùng",
          "Mã lượt",
          "Mã thiết bị",
          "Mẫu ngoài đầu tiên (UTC+7)",
          "Xác nhận ngoài (UTC+7)",
          "Mẫu ngoài cuối (UTC+7)",
          "Mẫu quay lại (UTC+7)",
          "Kết thúc ghi nhận (UTC+7)",
          "Lý do kết thúc",
          "Khoảng quan sát ngoài (giây)",
          "Phiên bản ranh giới",
        ];
  const lines = [headings.map(csvCell).join(",")];
  for (const r of rows) {
    const values =
      view === "samples"
        ? [
            r.user_name,
            r.user_id,
            r.deviceId,
            r.deviceLabel,
            localTime(r.capturedAt),
            localTime(r.receivedAt),
            r.lat,
            r.lng,
            r.accuracy,
            r.classification,
            r.status,
            r.edgeDistanceMeters,
            r.trackingSession,
            r.campusVersion,
          ]
        : [
            r.user_name,
            r.id,
            r.deviceId,
            localTime(r.startedAt),
            localTime(r.confirmedAt),
            localTime(r.lastOutsideAt),
            localTime(r.returnedAt),
            localTime(r.closedAt),
            r.endReason ?? "open",
            Math.max(0, (Number(r.lastOutsideAt) - Number(r.startedAt)) / 1000),
            r.campusVersion,
          ];
    lines.push(values.map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}
