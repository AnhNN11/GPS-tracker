import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestDatabase } from "../scripts/test-database";
const fixture = await startTestDatabase();
const { createUser } = await import("../src/lib/auth");
const { issueClientToken, requireClient } =
  await import("../src/lib/client-auth");
const { collections, closeDatabase } = await import("../src/lib/db");
const { disableUser } = await import("../src/lib/store");
after(async () => {
  await closeDatabase();
  await fixture.stop();
});
test("Native tokens are hashed, tied to one device, rotated on login and revoked on account locking", async () => {
  const id = await createUser(
      "Native",
      "native@example.invalid",
      "a-secure-password",
    ),
    device = "11111111-1111-4111-8111-111111111111";
  const first = await issueClientToken(id, device, "Android");
  const c = await collections(),
    stored = await c.clientTokens.findOne({ user_id: id });
  assert.ok(stored);
  assert.notEqual(stored.tokenHash, first.token);
  assert.ok(!JSON.stringify(stored).includes(first.token));
  assert.equal(
    (await requireClient("Bearer " + first.token)).identity.deviceId,
    device,
  );
  const second = await issueClientToken(id, device, "Android");
  await assert.rejects(requireClient("Bearer " + first.token));
  assert.equal((await requireClient("Bearer " + second.token)).user.id, id);
  await c.clientTokens.updateOne(
    { user_id: id },
    { $set: { expiresAt: new Date(0) } },
  );
  await assert.rejects(requireClient("Bearer " + second.token));
  const third = await issueClientToken(id, device, "Android");
  await disableUser(id, false);
  await assert.rejects(requireClient("Bearer " + third.token));
  assert.equal(await c.clientTokens.countDocuments({ user_id: id }), 0);
});
