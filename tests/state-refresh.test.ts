import { test } from "node:test";
import assert from "node:assert/strict";
import { createStateRefresh } from "../src/lib/state-refresh";

function fixture() {
  const pending: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  const values: string[] = [],
    errors: unknown[] = [];
  const refresh = createStateRefresh({
    load: () =>
      new Promise<string>((resolve, reject) =>
        pending.push({ resolve, reject }),
      ),
    apply: (value) => values.push(value),
    onError: (error) => errors.push(error),
  });
  return { refresh, pending, values, errors };
}
test("Slow successful requests survive repeated 15-second polling ticks", async () => {
  const { refresh, pending, values } = fixture();
  const first = refresh.request();
  for (let tick = 0; tick < 4; tick++) assert.equal(refresh.request(), first);
  assert.equal(pending.length, 1);
  pending[0].resolve("slow response");
  await first;
  assert.deepEqual(values, ["slow response"]);
  const second = refresh.request();
  pending[1].resolve("next response");
  await second;
  assert.equal(values.length, 2);
});
test("GPS receipts and writes coalesce one follow-up read without applying the old state", async () => {
  const { refresh, pending, values } = fixture();
  const task = refresh.request();
  assert.equal(refresh.request(true), task);
  refresh.request(true);
  pending[0].resolve("before GPS was saved");
  await Promise.resolve();
  assert.equal(pending.length, 2);
  assert.deepEqual(values, []);
  pending[1].resolve("GPS saved");
  await task;
  assert.deepEqual(values, ["GPS saved"]);
});
test("Changing session ignores old responses and old authentication errors", async () => {
  const { refresh, pending, values, errors } = fixture();
  const task = refresh.request();
  refresh.invalidate();
  refresh.request(true);
  pending[0].reject(new Error("Old session expired"));
  await Promise.resolve();
  pending[1].resolve("new account");
  await task;
  assert.deepEqual(errors, []);
  assert.deepEqual(values, ["new account"]);
  const late = refresh.request();
  refresh.invalidate();
  pending[2].resolve("signed-out account");
  await late;
  assert.deepEqual(values, ["new account"]);
});
test("A failed read releases the queue for a retry", async () => {
  const { refresh, pending, values, errors } = fixture();
  const first = refresh.request();
  pending[0].reject(new Error("offline"));
  await first;
  assert.equal(errors.length, 1);
  const retry = refresh.request();
  pending[1].resolve("online");
  await retry;
  assert.deepEqual(values, ["online"]);
});
test("A forced refresh at request completion is not lost", async () => {
  const { refresh, pending, values } = fixture();
  const first = refresh.request();
  pending[0].resolve("initial");
  await Promise.resolve();
  const followUp = refresh.request(true);
  await Promise.resolve();
  assert.equal(pending.length, 2);
  pending[1].resolve("after write");
  await Promise.all([first, followUp]);
  assert.deepEqual(values, ["initial", "after write"]);
});
