import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestDatabase } from "../scripts/test-database";
const fixture = await startTestDatabase();
const { collections, closeDatabase } = await import("../src/lib/db");
const { createUser, hashPassword, verifyPassword, loginAllowed, failedLogin } =
  await import("../src/lib/auth");
const { saveCampus, initialCampus, acceptReading, setTracking, sweep } =
  await import("../src/lib/store");
const c = await collections();
const polygon = [
  { lat: 14, lng: 108 },
  { lat: 14, lng: 108.002 },
  { lat: 14.002, lng: 108.002 },
  { lat: 14.002, lng: 108 },
];
after(async () => {
  await closeDatabase();
  await fixture.stop();
});
test("Concurrent monitors create only one active alert per user", async () => {
  const id = await createUser(
    "Concurrent",
    "concurrent@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now() + 600000;
  await Promise.all([sweep(now), sweep(now)]);
  assert.equal(
    await c.alerts.countDocuments({ user_id: id, type: "stale", active: true }),
    1,
  );
  await setTracking(id, false);
});
test("Passwords are salted and verified without storing plaintext", () => {
  const a = hashPassword("example-strong-password");
  assert.notEqual(a, hashPassword("example-strong-password"));
  assert.ok(verifyPassword("example-strong-password", a));
  assert.ok(!verifyPassword("wrong", a));
});
test("MongoDB transactions preserve confirmation, stale deduplication and recovery", async () => {
  await saveCampus({ ...initialCampus, circle: undefined, polygon });
  const id = await createUser(
    "Test member",
    "test@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now();
  const send = (lat: number, lng: number, delta: number, accuracy = 5) =>
    acceptReading(
      id,
      { lat, lng, accuracy, capturedAt: now + delta },
      now + delta,
    );
  assert.equal(await send(14.001, 108.004, 0), "pending");
  assert.equal(await send(14.001, 108.004, 30000), "outside");
  assert.equal(await c.alerts.countDocuments({ type: "outside" }), 1);
  await send(14.001, 108.004, 60000);
  assert.equal(await c.alerts.countDocuments({ type: "outside" }), 1);
  await assert.rejects(send(14.001, 108.004, 60000));
  await assert.rejects(
    acceptReading(
      id,
      { lat: 14, lng: 108, accuracy: 5, capturedAt: now - 100000 },
      now,
    ),
  );
  await send(14, 108.001, 90000);
  assert.equal((await c.users.findOne({ id }))?.status, "uncertain");
  assert.equal(await send(14.001, 108.004, 110000), "pending");
  assert.equal(await send(14.001, 108.001, 140000), "inside");
  assert.ok((await c.alerts.findOne({ type: "outside" }))?.resolved_at);
  await sweep(now + 500000);
  await sweep(now + 510000);
  assert.equal(
    await c.alerts.countDocuments({ type: "stale", active: true }),
    1,
  );
  assert.equal(await send(14.001, 108.001, 520000), "inside");
  assert.ok((await c.alerts.findOne({ type: "stale" }))?.resolved_at);
  await setTracking(id, false);
  await assert.rejects(send(14.001, 108.001, 540000));
});
test("Unique emails, login limits and TTL indexes are persisted in MongoDB", async () => {
  await assert.rejects(
    createUser("Duplicate", "test@example.invalid", "a-secure-password"),
  );
  for (let i = 0; i < 5; i++) await failedLogin("bad@example.invalid");
  assert.equal(await loginAllowed("bad@example.invalid"), false);
  await c.limits.updateOne(
    { key: "bad@example.invalid" },
    { $set: { resets: Date.now() - 1 } },
  );
  assert.equal(await loginAllowed("bad@example.invalid"), true);
  await failedLogin("bad@example.invalid");
  assert.equal(
    (await c.limits.findOne({ key: "bad@example.invalid" }))?.attempts,
    1,
  );
  assert.ok(
    (await c.sessions.listIndexes().toArray()).some(
      (i) => i.expireAfterSeconds === 0,
    ),
  );
  const id = await createUser(
    "Rollback",
    "rollback@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const before = await c.users.findOne({ id });
  await assert.rejects(
    acceptReading(id, {
      lat: 14,
      lng: 108,
      accuracy: 5,
      capturedAt: Date.now() - 100000,
    }),
  );
  assert.deepEqual((await c.users.findOne({ id }))?.reading, before?.reading);
});
test("First-admin setup requires an unexpired one-time token and resists concurrent claims", async () => {
  const { issueSetupToken, setupStatus, createInitialAdmin } =
    await import("../src/lib/setup");
  const code = await issueSetupToken();
  const input = {
    name: "Owner",
    email: "owner@example.invalid",
    password: "a-strong-owner-password",
    code,
  };
  assert.equal((await setupStatus()).required, true);
  await assert.rejects(
    createInitialAdmin({ ...input, code: "wrong".repeat(10) }),
  );
  assert.equal(await c.users.countDocuments({ role: "admin" }), 0);
  await c.runtime.updateOne(
    { key: "admin_setup" },
    { $set: { expiresAt: Date.now() - 1 } },
  );
  await assert.rejects(createInitialAdmin(input));
  input.code = await issueSetupToken();
  const attempts = await Promise.allSettled([
    createInitialAdmin(input),
    createInitialAdmin({ ...input, email: "other-owner@example.invalid" }),
  ]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.equal(await c.users.countDocuments({ role: "admin" }), 1);
  assert.equal((await setupStatus()).required, false);
  assert.equal(
    (await c.runtime.findOne({ key: "admin_setup" }))?.tokenHash,
    undefined,
  );
  await assert.rejects(issueSetupToken());
  await assert.rejects(createInitialAdmin(input));
  // Completion remains locked even if an operator accidentally removes the admin.
  await c.users.deleteMany({ role: "admin" });
  assert.equal((await setupStatus()).required, false);
});
test("Push delivery retries only failed devices and removes expired subscriptions", async () => {
  const { savePushDevice, deliverPendingPush } =
    await import("../src/lib/push");
  const admin = await createUser(
    "Push Admin",
    "push-admin@example.invalid",
    "a-secure-password",
    "admin",
  );
  const member = await createUser(
    "Push Member",
    "push-member@example.invalid",
    "a-secure-password",
  );
  for (const device of ["good", "retry", "expired"])
    await savePushDevice(admin, {
      endpoint: "https://fcm.googleapis.com/fcm/send/" + device,
      keys: { p256dh: "x".repeat(87), auth: "x".repeat(22) },
    });
  await setTracking(member, true);
  await c.users.updateOne(
    { id: member },
    { $set: { tracking_started: Date.now() - 10 * 60000 } },
  );
  await sweep();
  const calls: string[] = [];
  const first = async (subscription: { endpoint: string }) => {
    calls.push(subscription.endpoint);
    if (subscription.endpoint.endsWith("retry")) throw { statusCode: 500 };
    if (subscription.endpoint.endsWith("expired")) throw { statusCode: 410 };
    return { statusCode: 201, body: "", headers: {} };
  };
  const result = await deliverPendingPush(10, first);
  assert.ok(result.sent >= 1);
  assert.equal(
    await c.pushDevices.countDocuments({ endpoint: { $regex: "expired$" } }),
    0,
  );
  const alert = await c.alerts.findOne({
    user_id: member,
    type: "stale",
    active: true,
  });
  assert.ok(alert);
  assert.equal(alert.pushSentAt, undefined);
  assert.ok(alert.pushDeliveredTo?.length);
  // Limit the second attempt to this alert; other test alerts are not relevant.
  await c.alerts.updateMany(
    { user_id: { $ne: member } },
    { $set: { pushSentAt: Date.now() } },
  );
  await c.alerts.updateOne({ id: alert.id }, { $set: { pushClaimUntil: 0 } });
  const retried: string[] = [];
  await deliverPendingPush(1, async (s) => {
    retried.push(s.endpoint);
    return { statusCode: 201, body: "", headers: {} };
  });
  assert.deepEqual(retried, ["https://fcm.googleapis.com/fcm/send/retry"]);
  assert.ok((await c.alerts.findOne({ id: alert.id }))?.pushSentAt);
});
