import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { collections, transaction } from "./db";
import { publicUser, type UserRow } from "./auth";
import {
  ensureBoundary,
  closeExcursion,
  recordHistory,
  boundaryId,
} from "./history-store";
import { advanceOutside, classify, type Reading, type Candidate } from "./geo";
import type { Campus, AlertRow } from "./models";
import { schoolPreset } from "./campus-preset";
import type { DeviceContext } from "./device-context";
export type { Campus } from "./models";
type Collections = Awaited<ReturnType<typeof collections>>;
export const initialCampus: Campus = schoolPreset;
export async function campus(
  c?: Collections,
  session?: ClientSession,
): Promise<Campus> {
  const store = c ?? (await collections());
  const saved = (await store.settings.findOne({ key: "campus" }, { session }))
    ?.value;
  return saved?.polygon.length ? saved : initialCampus;
}
export async function saveCampus(value: Campus) {
  await transaction(async (c, session) => {
    const existing = await c.settings.findOne({ key: "campus" }, { session });
    if (existing && boundaryId(existing.value) === boundaryId(value)) return;
    await ensureBoundary(c, session, value);
    await c.excursions.updateMany(
      { active: true },
      {
        $set: {
          active: false,
          endReason: "boundary_changed",
          closedAt: Date.now(),
        },
      },
      { session },
    );
    await c.settings.updateOne(
      { key: "campus" },
      { $set: { value } },
      { upsert: true, session },
    );
    await c.users.updateMany(
      {},
      { $set: { status: "unknown", candidate: null } },
      { session },
    );
    await c.alerts.updateMany(
      { active: true, type: "outside" },
      { $set: { resolved_at: Date.now(), active: false } },
      { session },
    );
  });
}
async function openAlert(
  c: Collections,
  session: ClientSession,
  userId: string,
  type: AlertRow["type"],
  time = Date.now(),
) {
  await c.alerts.updateOne(
    { user_id: userId, type, active: true },
    {
      $setOnInsert: {
        id: randomUUID(),
        user_id: userId,
        type,
        active: true,
        created_at: time,
        resolved_at: null,
        acknowledged_at: null,
        report: null,
        reported_at: null,
      },
    },
    { upsert: true, session },
  );
}
async function resolveAlert(
  c: Collections,
  session: ClientSession,
  userId: string,
  type: AlertRow["type"],
) {
  await c.alerts.updateMany(
    { user_id: userId, type, active: true },
    { $set: { resolved_at: Date.now(), active: false } },
    { session },
  );
}
export async function acceptReading(
  userId: string,
  reading: Reading,
  now = Date.now(),
  device?: DeviceContext,
) {
  return transaction(async (c, session) => {
    const user = await c.users.findOne({ id: userId, enabled: 1 }, { session });
    if (!user?.tracking) throw new Error("Bạn cần bật chia sẻ vị trí trước.");
    if (
      reading.capturedAt < now - 90000 ||
      reading.capturedAt > now + 10000 ||
      (user.reading && reading.capturedAt <= user.reading.capturedAt)
    )
      throw new Error(
        "Mẫu vị trí đã cũ hoặc trùng thời điểm. Hãy lấy vị trí mới.",
      );
    const config = await campus(c, session),
      status = classify(reading, config.polygon, config.policy, config.circle);
    let candidate: Candidate | null = null,
      displayed: string = status;
    if (status === "outside") {
      const next = advanceOutside(
        user.candidate?.campusVersion === boundaryId(config) &&
          user.candidate?.deviceId === device?.deviceId
          ? user.candidate
          : null,
        reading.capturedAt,
        config.policy,
      );
      candidate = {
        ...next.candidate,
        campusVersion: boundaryId(config),
        ...(device ? { deviceId: device.deviceId } : {}),
        firstReading:
          next.candidate.count > 1
            ? (user.candidate?.firstReading ?? reading)
            : reading,
      };
      displayed = next.confirmed ? "outside" : "pending";
      if (next.confirmed) await openAlert(c, session, user.id, "outside", now);
    }
    if (status === "inside") await resolveAlert(c, session, user.id, "outside");
    await resolveAlert(c, session, user.id, "stale");
    const trackingSession = user.tracking_session ?? randomUUID();
    await recordHistory(c, session, {
      userId: user.id,
      trackingSession,
      campus: config,
      reading,
      classification: status,
      status: displayed,
      candidate,
      previous: user.reading,
      receivedAt: now,
      device,
    });
    await c.users.updateOne(
      { id: user.id },
      {
        $set: {
          reading,
          reading_received_at: now,
          status: displayed,
          candidate,
          tracking_session: trackingSession,
        },
      },
      { session },
    );
    return displayed;
  });
}
export async function setTracking(userId: string, enabled: boolean) {
  await transaction(async (c, session) => {
    const user = await c.users.findOne({ id: userId }, { session });
    if (!user) return;
    if (!!user.tracking === enabled) return;
    await c.users.updateOne(
      { id: userId },
      {
        $set: {
          tracking: enabled ? 1 : 0,
          tracking_started: enabled ? Date.now() : null,
          tracking_session: enabled ? randomUUID() : null,
          candidate: null,
          status: "unknown",
        },
      },
      { session },
    );
    if (!enabled) {
      await closeExcursion(c, session, userId, "sharing_stopped");
      await resolveAlert(c, session, userId, "stale");
      await resolveAlert(c, session, userId, "outside");
    }
  });
}
export async function disableUser(userId: string, enabled: boolean) {
  await transaction(async (c, session) => {
    await c.users.updateOne(
      { id: userId },
      {
        $set: {
          enabled: enabled ? 1 : 0,
          ...(!enabled
            ? {
                tracking: 0,
                tracking_started: null,
                reading: null,
                candidate: null,
                status: "unknown",
              }
            : {}),
        },
      },
      { session },
    );
    if (!enabled) {
      await closeExcursion(c, session, userId, "account_disabled");
      await c.sessions.deleteMany({ user_id: userId }, { session });
      await resolveAlert(c, session, userId, "stale");
      await resolveAlert(c, session, userId, "outside");
    }
  });
}
export async function sweep(now = Date.now(), budgetMs = 30000, limit = 200) {
  const c = await collections(),
    cutoff = now - (await campus(c)).policy.staleMinutes * 60000;
  const ids = await c.users
    .find(
      {
        tracking: 1,
        enabled: 1,
        status: { $ne: "stale" },
        $or: [
          { "reading.capturedAt": { $lt: cutoff } },
          { reading: null, tracking_started: { $lt: cutoff } },
        ],
      },
      { projection: { id: 1 } },
    )
    .limit(limit)
    .toArray();
  let flagged = 0,
    processed = 0;
  const deadline = Date.now() + budgetMs;
  for (const { id } of ids) {
    if (Date.now() > deadline)
      return { checked: processed, flagged, remaining: true };
    const changed = await transaction(async (store, session) => {
      const user = await store.users.findOne(
        { id, tracking: 1, enabled: 1, status: { $ne: "stale" } },
        { session },
      );
      if (!user) return false;
      const policy = (await campus(store, session)).policy;
      if (
        now -
          Math.max(
            user.reading?.capturedAt ?? 0,
            user.tracking_started ?? now,
          ) >
        policy.staleMinutes * 60000
      ) {
        await openAlert(store, session, id, "stale", now);
        await closeExcursion(store, session, id, "data_gap", now);
        await store.users.updateOne(
          { id },
          { $set: { status: "stale", candidate: null } },
          { session },
        );
        return true;
      }
      return false;
    });
    processed++;
    if (changed) flagged++;
  }
  return { checked: ids.length, flagged, remaining: ids.length === limit };
}
export async function dashboard(user: UserRow) {
  await sweep(Date.now(), 3000, 20);
  const c = await collections(),
    admin = user.role === "admin";
  const users = await c.users
    .find(admin ? {} : { id: user.id })
    .sort({ created_at: -1 })
    .toArray();
  const alerts = await c.alerts
    .find(admin ? {} : { user_id: user.id }, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .limit(admin ? 200 : 100)
    .toArray();
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    campus: await campus(c),
    users: users.map(publicUser),
    alerts: alerts.map((a) => ({
      ...a,
      user_name: names.get(a.user_id) ?? "Người dùng",
    })),
    me: publicUser(users.find((u) => u.id === user.id) ?? user),
    monitor:
      user.role === "admin"
        ? {
            lastRunAt:
              (await c.runtime.findOne({ key: "monitor" }))?.lastRunAt ?? null,
          }
        : undefined,
    serverTime: Date.now(),
  };
}
