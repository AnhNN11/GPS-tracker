import { test } from "node:test";
import assert from "node:assert/strict";
import { browserDeviceId } from "../src/lib/device-context";
import { withRequestTimeout } from "../src/lib/request-timeout";

test("Device identity remains valid when Safari lacks crypto.randomUUID", () => {
  const id = browserDeviceId({ getRandomValues: crypto.getRandomValues.bind(crypto) });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test("Requests abort without relying on AbortSignal.timeout and preserve successful results", async () => {
  const native = AbortSignal.timeout;
  try {
    Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
    assert.equal(await withRequestTimeout(async () => "saved", 100), "saved");
    await assert.rejects(withRequestTimeout((signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }), 5), /timeout/);
  } finally {
    Object.defineProperty(AbortSignal, "timeout", { value: native, configurable: true, writable: true });
  }
});
