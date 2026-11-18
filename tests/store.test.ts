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
  await saveCampus({ ...initialCampus, polygon });
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
