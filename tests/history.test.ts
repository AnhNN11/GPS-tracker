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
      createUser(
        "Concurrent " + name,
        name + "@concurrent.invalid",
        "a-secure-password",
      ),
    ),
  );
  for (const id of ids) await setTracking(id, true);
  const now = Date.now();
  await Promise.all(
    ids.map((id) =>
      acceptReading(
        id,
        { lat: 14, lng: 108, accuracy: 5, capturedAt: now },
        now,
      ),
    ),
  );
  assert.equal(await c.samples.countDocuments({ user_id: { $in: ids } }), 2);
  assert.equal(await c.boundaryVersions.countDocuments({}), 1);
  for (const id of ids) await setTracking(id, false);
});
test("Every GPS sample survives stopping and includes the original boundary version", async () => {
  await saveCampus({ ...initialCampus, circle: undefined, polygon });
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
    circle: undefined,
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
  await saveCampus({ ...initialCampus, circle: undefined, polygon });
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
  await saveCampus({ ...initialCampus, circle: undefined, polygon });
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
test("Changing radius preserves old circle history and resets confirmation; saving unchanged settings preserves open events", async () => {
  const { circlePolygon, pointAtDistance } = await import("../src/lib/geo");
  const { schoolCenter } = await import("../src/lib/campus-preset");
  const circle = { center: schoolCenter, radiusMeters: 500 };
  const original = { ...initialCampus, circle, polygon: circlePolygon(circle) };
  await saveCampus(original);
  const id = await createUser(
    "Circle member",
    "circle@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now(),
    point = pointAtDistance(schoolCenter, 90, 700);
  assert.equal(
    await acceptReading(id, { ...point, accuracy: 10, capturedAt: now }, now),
    "pending",
  );
  assert.equal(
    await acceptReading(
      id,
      { ...point, accuracy: 10, capturedAt: now + 60000 },
      now + 60000,
    ),
    "outside",
  );
  const event = await c.excursions.findOne({ user_id: id, active: true });
  assert.ok(event);
  await saveCampus(original);
  assert.equal((await c.excursions.findOne({ id: event.id }))?.active, true);
  const larger = { ...circle, radiusMeters: 1000 };
  await saveCampus({
    ...original,
    circle: larger,
    polygon: circlePolygon(larger),
  });
  const closed = await c.excursions.findOne({ id: event.id });
  assert.equal(closed?.endReason, "boundary_changed");
  assert.equal(closed?.returnedAt, null);
  assert.equal(
    (await c.boundaryVersions.findOne({ id: event.campusVersion }))?.campus
      .circle?.radiusMeters,
    500,
  );
  assert.equal((await c.users.findOne({ id }))?.candidate, null);
  assert.equal(
    await acceptReading(
      id,
      { ...point, accuracy: 10, capturedAt: now + 120000 },
      now + 120000,
    ),
    "inside",
  );
  assert.equal(
    await c.samples.countDocuments({ user_id: id, classification: "outside" }),
    2,
  );
  const user = await c.users.findOne({ id });
  assert.ok(user);
  assert.equal(
    (await excursionDetail(user, event.id)).boundary?.circle?.radiusMeters,
    500,
  );
  await setTracking(id, false);
});

test("A configuration version change cannot extend an event or reuse confirmation from the old radius", async () => {
  const { circlePolygon, pointAtDistance } = await import("../src/lib/geo");
  const { schoolCenter } = await import("../src/lib/campus-preset");
  const circle = { center: schoolCenter, radiusMeters: 500 };
  await saveCampus({
    ...initialCampus,
    circle,
    polygon: circlePolygon(circle),
  });
  const id = await createUser(
    "Version member",
    "version@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const now = Date.now(),
    point = pointAtDistance(schoolCenter, 90, 700);
  await acceptReading(id, { ...point, accuracy: 10, capturedAt: now }, now);
  assert.equal(
    await acceptReading(
      id,
      { ...point, accuracy: 10, capturedAt: now + 60000 },
      now + 60000,
    ),
    "outside",
  );
  const previousEvent = await c.excursions.findOne({
    user_id: id,
    active: true,
  });
  assert.ok(previousEvent);
  const nextCircle = { ...circle, radiusMeters: 300 };
  // Simulate a deployment/config migration that did not use the settings UI.
  await c.settings.updateOne(
    { key: "campus" },
    {
      $set: {
        value: {
          ...initialCampus,
          circle: nextCircle,
          polygon: circlePolygon(nextCircle),
        },
      },
    },
  );
  assert.equal(
    await acceptReading(
      id,
      { ...point, accuracy: 10, capturedAt: now + 120000 },
      now + 120000,
    ),
    "pending",
  );
  assert.equal(
    (await c.excursions.findOne({ id: previousEvent.id }))?.endReason,
    "boundary_changed",
  );
  assert.equal(
    await c.excursions.countDocuments({ user_id: id, active: true }),
    0,
  );
  assert.equal((await c.users.findOne({ id }))?.candidate?.count, 1);
  await setTracking(id, false);
});

test("Device-specific journeys are scoped to their owner and switching device never fabricates a return", async () => {
  const { readJourney } = await import("../src/lib/journey");
  const { schoolCenter } = await import("../src/lib/campus-preset");
  const { pointAtDistance } = await import("../src/lib/geo");
  await saveCampus(initialCampus);
  const id = await createUser(
    "Device member",
    "device@example.invalid",
    "a-secure-password",
  );
  await setTracking(id, true);
  const a = {
      deviceId: "11111111-1111-4111-8111-111111111111",
      deviceLabel: "Android A",
    },
    b = {
      deviceId: "22222222-2222-4222-8222-222222222222",
      deviceLabel: "iOS B",
    };
  const now = Date.now(),
    outside = pointAtDistance(schoolCenter, 90, 500);
  await acceptReading(id, { ...outside, accuracy: 5, capturedAt: now }, now, a);
  await acceptReading(
    id,
    { ...outside, accuracy: 5, capturedAt: now + 60000 },
    now + 60000,
    a,
  );
  await acceptReading(
    id,
    { ...schoolCenter, accuracy: 5, capturedAt: now + 120000 },
    now + 120000,
    b,
  );
  const event = await c.excursions.findOne({ user_id: id });
  assert.equal(event?.deviceId, a.deviceId);
  assert.equal(event?.endReason, "device_changed");
  assert.equal(event?.returnedAt, null);
  const user = await c.users.findOne({ id });
  assert.ok(user);
  const q = parseHistoryQuery(
    new URLSearchParams({ from: day(now), to: day(now + 120000), userId: id }),
  );
  const all = await readJourney(user, q);
  assert.equal(all.points.length, 3);
  assert.equal(all.devices.length, 2);
  assert.deepEqual(all.segments, [[0, 1], [2]]);
  assert.equal((await readJourney(user, q, a.deviceId)).points.length, 2);
  await assert.rejects(readJourney(user, { ...q, userId: "other" }));
  await assert.rejects(
    readJourney({ ...user, role: "admin" }, { ...q, userId: undefined }),
  );
  await setTracking(id, false);
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
