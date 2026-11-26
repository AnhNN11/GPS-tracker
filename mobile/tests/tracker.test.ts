import { test } from "node:test";
import assert from "node:assert/strict";
import { Tracker, type Fix, type Update } from "../src/tracker";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("Native fixes keep sensor time, upload at most once per minute, and stop sending after explicit stop", async () => {
  let now = 1000000,
    callback: (fix?: Fix) => void = () => {};
  const uploads: any[] = [],
    removed: string[] = [],
    updates: Update[] = [];
  const tracker = new Tracker(
    {
      add: async (cb) => {
        callback = cb;
        return "watch";
      },
      remove: async (id) => {
        removed.push(id);
      },
    },
    async (route, body) => {
      if (route === "location") {
        uploads.push(body);
        return { reading: body, status: "inside", receivedAt: now };
      }
      return { ok: true };
    },
    (value) => updates.push(value),
    () => now,
  );
  await tracker.start();
  callback({ latitude: 14, longitude: 108, accuracy: 10, time: now - 1000 });
  await tick();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].capturedAt, 999000);
  now += 1000;
  callback({ latitude: 14, longitude: 108, accuracy: 10, time: now });
  await tick();
  assert.equal(uploads.length, 1);
  now += 60000;
  callback({ latitude: 14, longitude: 108, accuracy: 10, time: now });
  await tick();
  assert.equal(uploads.length, 2);
  await tracker.stop();
  now += 60000;
  callback({ latitude: 14, longitude: 108, accuracy: 10, time: now });
  await tick();
  assert.equal(uploads.length, 2);
  assert.deepEqual(removed, ["watch"]);
  assert.equal(updates.at(-1)?.active, false);
});
test("Stopping while the permission prompt is pending removes the late watcher", async () => {
  let resolveWatch: (id: string) => void = () => {};
  const removed: string[] = [];
  const tracker = new Tracker(
    {
      add: () =>
        new Promise((resolve) => {
          resolveWatch = resolve;
        }),
      remove: async (id) => {
        removed.push(id);
      },
    },
    async () => ({}),
    () => {},
  );
  const starting = tracker.start();
  await tick();
  await tracker.stop();
  resolveWatch("late");
  await starting;
  assert.deepEqual(removed, ["late"]);
});
test("An expired bearer token stops the native watcher instead of retrying in the background", async () => {
  let callback: (fix?: Fix) => void = () => {};
  const removed: string[] = [],
    updates: Update[] = [];
  const tracker = new Tracker(
    {
      add: async (cb) => {
        callback = cb;
        return "watch";
      },
      remove: async (id) => {
        removed.push(id);
      },
    },
    async (route) => {
      if (route === "location")
        throw Object.assign(new Error("Expired"), { status: 401 });
      return {};
    },
    (value) => updates.push(value),
    () => 1000000,
  );
  await tracker.start();
  callback({ latitude: 14, longitude: 108, accuracy: 5, time: 1000000 });
  await tick();
  assert.deepEqual(removed, ["watch"]);
  assert.equal(updates.at(-1)?.active, false);
  assert.match(updates.at(-1)?.message ?? "", /hết hạn/);
});
