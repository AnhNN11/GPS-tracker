import { createHash, randomBytes } from "node:crypto";
import { collections, transaction } from "./db";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function issueClientToken(
  userId: string,
  deviceId: string,
  deviceLabel: string,
) {
  const token = randomBytes(32).toString("hex"),
    expiresAt = new Date(Date.now() + 12 * 3600000);
  await transaction(async (c, session) => {
    if (!(await c.users.findOne({ id: userId, enabled: 1 }, { session })))
      throw new Error("UNAUTHORIZED");
    await c.clientTokens.deleteMany({ user_id: userId, deviceId }, { session });
    await c.clientTokens.insertOne(
      {
        tokenHash: digest(token),
        user_id: userId,
        deviceId,
        deviceLabel,
        expiresAt,
      },
      { session },
    );
  });
  return { token, expiresAt: expiresAt.getTime() };
}
export async function requireClient(authorization: string | null) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization ?? "");
  if (!match) throw new Error("UNAUTHORIZED");
  const c = await collections(),
    identity = await c.clientTokens.findOne({
      tokenHash: digest(match[1]),
      expiresAt: { $gt: new Date() },
    });
  const user = identity
    ? await c.users.findOne({ id: identity.user_id, enabled: 1 })
    : null;
  if (!user || !identity) throw new Error("UNAUTHORIZED");
  return { user, identity };
}
