import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedPushEndpoint } from "../src/lib/push";
test("Push endpoint validation rejects SSRF destinations", () => {
  for (const url of [
    "https://fcm.googleapis.com/fcm/send/test",
    "https://web.push.apple.com/test",
    "https://updates.push.services.mozilla.com/wpush/v2/test",
  ])
    assert.equal(trustedPushEndpoint(url), true);
  for (const url of [
    "http://fcm.googleapis.com/test",
    "https://127.0.0.1/api",
    "https://fcm.googleapis.com.evil.example/test",
    "https://user:password@fcm.googleapis.com/test",
    "https://fcm.googleapis.com:8080/test",
    "https://169.254.169.254/metadata",
  ])
    assert.equal(trustedPushEndpoint(url), false);
});
