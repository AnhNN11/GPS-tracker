import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestDatabase } from "../scripts/test-database";
const fixture = await startTestDatabase();
const { collections, closeDatabase } = await import("../src/lib/db");
const { createUser } = await import("../src/lib/auth");
const { initialCampus, saveCampus, setTracking, acceptReading } =
  await import("../src/lib/store");
const {
  readHistory,
  excursionDetail,
  parseHistoryQuery,
  vietnamDate,
  csvCell,
  historyCsv,
} = await import("../src/lib/history");
const c = await collections();
const polygon = [
  { lat: 14, lng: 108 },
  { lat: 14, lng: 108.002 },
  { lat: 14.002, lng: 108.002 },
  { lat: 14.002, lng: 108 },
];
const day = (n: number) => new Date(n + 7 * 3600000).toISOString().slice(0, 10);
after(async () => {
  await closeDatabase();
  await fixture.stop();
});
test("Concurrent first GPS uploads share one immutable default-boundary snapshot", async () => {
  const ids = await Promise.all(
    ["a", "b"].map((name) =>
      createUser("Concurrent " + name, name + "@concurrent.invalid", "a-secure-password"),
    ),
  );
  for (const id of ids) await setTracking(id, true);
  const now = Date.now();
  await Promise.all(
    ids.map((id) =>
      acceptReading(id, { lat: 14, lng: 108, accuracy: 5, capturedAt: now }, now),
    ),
  );
  assert.equal(await c.samples.countDocuments({ user_id: { $in: ids } }), 2);
  assert.equal(await c.boundaryVersions.countDocuments({}), 1);
  for (const id of ids) await setTracking(id, false);
});
test("Every GPS sample survives stopping and includes the original boundary version", async () => {
  await saveCampus({ ...initialCampus, polygon });
  const id = await createUser(
    "History member",
    "history@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now(),
    send = (lat: number, lng: number, delta: number, accuracy = 5) =>
      acceptReading(
        id,
        { lat, lng, accuracy, capturedAt: now + delta },
        now + delta,
      );
  await send(14.001, 108.001, 0);
  await send(14.001, 108.004, 60000);
  await send(14.001, 108.004, 120000);
  await send(14.001, 108.004, 180000, 100);
  await send(14.001, 108.001, 240000);
  assert.equal(await c.samples.countDocuments({ user_id: id }), 5);
  const event = await c.excursions.findOne({ user_id: id });
  assert.ok(event);
  assert.equal(event.startedAt, now + 60000);
  assert.equal(event.confirmedAt, now + 120000);
  assert.equal(event.lastOutsideAt, now + 120000);
  assert.equal(event.returnedAt, now + 240000);
  assert.equal(event.endReason, "returned");
  assert.equal(event.firstOutside.capturedAt, now + 60000);
  await assert.rejects(send(14.001, 108.001, 240000));
  assert.equal(await c.samples.countDocuments({ user_id: id }), 5);
  const version = event.campusVersion;
  await setTracking(id, false);
  assert.equal(await c.samples.countDocuments({ user_id: id }), 5);
  assert.ok((await c.users.findOne({ id }))?.reading);
  await saveCampus({
    ...initialCampus,
    polygon: polygon.map((p) => ({ ...p, lng: p.lng + 0.01 })),
  });
  assert.equal(
    (await c.excursions.findOne({ id: event.id }))?.campusVersion,
    version,
  );
  assert.deepEqual(
    (await c.boundaryVersions.findOne({ id: version }))?.campus.polygon,
    polygon,
  );
  const user = await c.users.findOne({ id });
  assert.ok(user);
  const detail = await excursionDetail(user, event.id);
  assert.deepEqual(detail.boundary?.polygon, polygon);
  assert.ok(detail.points.length >= 3);
  const q = parseHistoryQuery(
    new URLSearchParams({
      from: day(now - 86400000),
      to: day(now + 86400000),
      view: "samples",
    }),
  );
  const history = await readHistory(user, q);
  assert.equal(history.total, 5);
  assert.equal(history.summary.outsideSamples, 2);
  assert.equal(history.summary.uncertainSamples, 1);
  await assert.rejects(readHistory(user, { ...q, userId: "someone-else" }));
  await assert.rejects(
    excursionDetail({ ...user, id: "someone-else" }, event.id),
  );
});
test("A single outside sample is saved even before an excursion is confirmed", async () => {
  await saveCampus({ ...initialCampus, polygon });
  const id = await createUser(
    "Single sample",
    "single@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now();
  assert.equal(
    await acceptReading(
      id,
      { lat: 14.001, lng: 108.004, accuracy: 5, capturedAt: now },
      now,
    ),
    "pending",
  );
  assert.equal(
    await c.samples.countDocuments({ user_id: id, classification: "outside" }),
    1,
  );
  assert.equal(await c.excursions.countDocuments({ user_id: id }), 0);
});
test("Missing data and stopping sharing never fabricate a return to campus", async () => {
  await saveCampus({ ...initialCampus, polygon });
  const id = await createUser(
    "Gap member",
    "gap@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now();
  const send = (delta: number) =>
    acceptReading(
      id,
      { lat: 14.001, lng: 108.004, accuracy: 5, capturedAt: now + delta },
      now + delta,
    );
  await send(0);
  await send(60000);
  await send(300000);
  const closed = await c.excursions.findOne({ user_id: id });
  assert.equal(closed?.endReason, "data_gap");
  assert.equal(closed?.returnedAt, null);
  await send(360000);
  await setTracking(id, false);
  const stopped = await c.excursions.findOne({
    user_id: id,
    startedAt: now + 300000,
  });
  assert.equal(stopped?.endReason, "sharing_stopped");
  assert.equal(stopped?.returnedAt, null);
  assert.equal(await c.samples.countDocuments({ user_id: id }), 4);
});
test("Date filtering follows UTC+7 and CSV cells prevent formulas", () => {
  assert.equal(vietnamDate("2026-11-26"), Date.parse("2026-11-25T17:00:00Z"));
  assert.throws(() => vietnamDate("2026-02-30"));
  assert.throws(() =>
    parseHistoryQuery(
      new URLSearchParams({ from: "2026-01-01", to: "2026-03-01" }),
    ),
  );
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell(-12), "-12");
  const csv = historyCsv("samples", [
    {
      user_name: "=1+1",
      capturedAt: Date.parse("2026-11-25T17:00:00Z"),
      lat: 14,
      lng: 108,
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("2026-11-26T00:00:00.000+07:00"));
  assert.ok(csv.includes("'=1+1"));
});
