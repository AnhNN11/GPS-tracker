import * as webpush from "web-push";
import { randomUUID, createHash } from "node:crypto";
import { collections } from "./db";
export function trustedPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "fcm.googleapis.com" ||
        u.hostname === "web.push.apple.com" ||
        u.hostname === "updates.push.services.mozilla.com" ||
        u.hostname.endsWith(".push.services.mozilla.com") ||
        u.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
async function keys() {
  const c = await collections();
  let record = await c.runtime.findOne({ key: "push_keys" });
  if (!record?.publicKey || !record.privateKey) {
    const generated = webpush.generateVAPIDKeys();
    await c.runtime.updateOne(
      { key: "push_keys" },
      { $setOnInsert: { ...generated } },
      { upsert: true },
    );
    record = await c.runtime.findOne({ key: "push_keys" });
  }
  if (!record?.publicKey || !record.privateKey)
    throw new Error("Push chưa sẵn sàng.");
  return { publicKey: record.publicKey, privateKey: record.privateKey };
}
export async function pushPublicKey() {
  return (await keys()).publicKey;
}
export async function savePushDevice(
  userId: string,
  value: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  if (!trustedPushEndpoint(value.endpoint))
    throw new Error("Dịch vụ thông báo chưa được hỗ trợ.");
  const c = await collections();
  await c.pushDevices.updateOne(
    { endpoint: value.endpoint },
    {
      $set: { user_id: userId, keys: value.keys },
      $setOnInsert: {
        id: createHash("sha256").update(value.endpoint).digest("hex"),
        endpoint: value.endpoint,
        createdAt: Date.now(),
      },
    },
    { upsert: true },
  );
}
// Deliver encrypted notifications only to current admins who explicitly subscribed.
export async function deliverPendingPush(
  limit = 3,
  send: typeof webpush.sendNotification = webpush.sendNotification,
) {
  const c = await collections();
  const admins = await c.users
    .find({ role: "admin", enabled: 1 }, { projection: { id: 1, email: 1 } })
    .toArray();
  if (!admins.length) return { sent: 0 };
  const devices = await c.pushDevices
    .find({ user_id: { $in: admins.map((a) => a.id) } })
    .limit(100)
    .toArray();
  if (!devices.length) return { sent: 0 };
  const vapid = await keys();
  let sent = 0;
  const deadline = Date.now() + 15000;
  for (let i = 0; i < limit && Date.now() < deadline; i++) {
    const claim = randomUUID(),
      now = Date.now();
    const alert = await c.alerts.findOneAndUpdate(
      {
        active: true,
        acknowledged_at: null,
        pushSentAt: { $exists: false },
        $or: [
          { pushClaimUntil: { $exists: false } },
          { pushClaimUntil: { $lt: now } },
        ],
      },
      { $set: { pushClaim: claim, pushClaimUntil: now + 60000 } },
      { sort: { created_at: 1 }, returnDocument: "after" },
    );
    if (!alert) break;
    const user = await c.users.findOne(
      { id: alert.user_id },
      { projection: { name: 1 } },
    );
    const delivered = new Set(alert.pushDeliveredTo ?? []);
    for (const device of devices) {
      if (Date.now() > deadline) break;
      if (delivered.has(device.id)) continue;
      if (!trustedPushEndpoint(device.endpoint)) continue;
      try {
        await send(
          { endpoint: device.endpoint, keys: device.keys },
          JSON.stringify({
            title:
              alert.type === "outside"
                ? "Cảnh báo ngoài khuôn viên"
                : "Mất cập nhật vị trí",
            body:
              (user?.name ?? "Người dùng") + " · Kiểm tra trong Campus Guard",
            tag: alert.id,
            url: "/",
          }),
          {
            TTL: 300,
            timeout: 4000,
            vapidDetails: {
              subject:
                "mailto:" +
                (admins.find((a) => a.id === device.user_id)?.email ??
                  admins[0].email),
              ...vapid,
            },
          },
        );
        delivered.add(device.id);
        await c.alerts.updateOne(
          { id: alert.id, pushClaim: claim },
          { $addToSet: { pushDeliveredTo: device.id } },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await c.pushDevices.deleteOne({ id: device.id });
          delivered.add(device.id);
        }
      }
    }
    if (devices.every((device) => delivered.has(device.id)))
      await c.alerts.updateOne(
        { id: alert.id, pushClaim: claim },
        { $set: { pushSentAt: Date.now() } },
      );
    // A failed send keeps its short lease and is retried by the next monitor.
  }
  return { sent };
}
