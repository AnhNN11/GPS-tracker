import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
const temporary = mkdtempSync(join(tmpdir(), "campus-test-"));
process.env.DATABASE_PATH = join(temporary, "test.sqlite");
const { db } = await import("../src/lib/db");
const { createUser, hashPassword, verifyPassword } =
  await import("../src/lib/auth");
const { saveCampus, initialCampus, acceptReading, setTracking, sweep } =
  await import("../src/lib/store");
const polygon = [
  { lat: 14, lng: 108 },
  { lat: 14, lng: 108.002 },
  { lat: 14.002, lng: 108.002 },
  { lat: 14.002, lng: 108 },
];
after(() => {
  db.close();
  assert.equal(dirname(temporary), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith("campus-test-"));
  rmSync(temporary, { recursive: true, force: true });
});
test("Passwords are salted and verified without storing plaintext", () => {
  const a = hashPassword("example-strong-password");
  assert.notEqual(a, hashPassword("example-strong-password"));
  assert.ok(verifyPassword("example-strong-password", a));
  assert.ok(!verifyPassword("wrong", a));
});
test("Real persisted workflow: confirmation, reports, stale deduplication, recovery", () => {
  saveCampus({ ...initialCampus, polygon });
  const id = createUser(
    "Test member",
    "test@example.invalid",
    "a-secure-password",
  );
  setTracking(id, true);
  const now = Date.now();
  const send = (lat: number, lng: number, delta: number, accuracy = 5) =>
    acceptReading(
      id,
      { lat, lng, accuracy, capturedAt: now + delta },
      now + delta,
    );
  assert.equal(send(14.001, 108.004, 0), "pending");
  assert.equal(send(14.001, 108.004, 30000), "outside");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE type='outside'").get()
      ?.n,
    1,
  );
  send(14.001, 108.004, 60000);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE type='outside'").get()
      ?.n,
    1,
  );
  assert.throws(() => send(14.001, 108.004, 60000));
  assert.throws(() =>
    acceptReading(
      id,
      { lat: 14, lng: 108, accuracy: 5, capturedAt: now - 100000 },
      now,
    ),
  );
  send(14, 108.001, 90000);
  assert.equal(
    db.prepare("SELECT status FROM users WHERE id=?").get(id)?.status,
    "uncertain",
  );
  assert.equal(send(14.001, 108.004, 110000), "pending");
  assert.equal(send(14.001, 108.001, 140000), "inside");
  assert.ok(
    db.prepare("SELECT resolved_at FROM alerts WHERE type='outside'").get()
      ?.resolved_at,
  );
  sweep(now + 500000);
  sweep(now + 510000);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE type='stale' AND resolved_at IS NULL",
      )
      .get()?.n,
    1,
  );
  assert.equal(send(14.001, 108.001, 520000), "inside");
  assert.ok(
    db.prepare("SELECT resolved_at FROM alerts WHERE type='stale'").get()
      ?.resolved_at,
  );
  setTracking(id, false);
  assert.throws(() => send(14.001, 108.001, 540000));
});
