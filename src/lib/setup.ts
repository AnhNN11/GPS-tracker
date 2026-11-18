import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { collections, transaction } from "./db";
import { hashPassword } from "./auth";
import type { UserRow } from "./models";
const digest = (value: string) => createHash("sha256").update(value).digest();
function matches(value: string, expected: string) {
  const a = digest(value),
    b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function setupStatus() {
  const c = await collections();
  const required =
    !(await c.users.findOne({ role: "admin" })) &&
    !(await c.runtime.findOne({ key: "admin_bootstrap", completed: true }));
  const invite = await c.runtime.findOne({ key: "admin_setup" });
  const tokenReady =
    !!(
      process.env.ADMIN_SETUP_TOKEN &&
      process.env.ADMIN_SETUP_TOKEN.length >= 32
    ) ||
    !!(
      invite?.tokenHash &&
      !invite.consumedAt &&
      (invite.expiresAt ?? 0) > Date.now()
    );
  return { required, tokenReady: required && tokenReady };
}
// Called only from a trusted provisioning environment, never from a public route.
export async function issueSetupToken() {
  const token = randomBytes(32).toString("hex");
  await transaction(async (c, session) => {
    if (
      (await c.users.findOne({ role: "admin" }, { session })) ||
      (await c.runtime.findOne(
        { key: "admin_bootstrap", completed: true },
        { session },
      ))
    )
      throw new Error("Thiết lập quản trị đã hoàn tất.");
    await c.runtime.updateOne(
      { key: "admin_setup" },
      {
        $set: {
          tokenHash: digest(token).toString("hex"),
          expiresAt: Date.now() + 24 * 3600000,
        },
        $unset: { consumedAt: "" },
      },
      { upsert: true, session },
    );
  });
  return token;
}
export async function createInitialAdmin(input: {
  name: string;
  email: string;
  password: string;
  code: string;
}) {
  const user: UserRow = {
    id: randomUUID(),
    name: input.name,
    email: input.email,
    password: hashPassword(input.password),
    role: "admin",
    enabled: 1,
    tracking: 0,
    tracking_started: null,
    reading: null,
    candidate: null,
    status: "unknown",
    created_at: Date.now(),
  };
  return transaction(async (c, session) => {
    // All contenders write the same lock document; retries must recheck completion.
    await c.runtime.updateOne(
      { key: "admin_bootstrap" },
      { $set: { touchedAt: Date.now() } },
      { upsert: true, session },
    );
    if (
      (await c.runtime.findOne(
        { key: "admin_bootstrap", completed: true },
        { session },
      )) ||
      (await c.users.findOne({ role: "admin" }, { session }))
    )
      throw new Error("Thiết lập quản trị đã hoàn tất.");
    const invite = await c.runtime.findOne({ key: "admin_setup" }, { session });
    const env = process.env.ADMIN_SETUP_TOKEN;
    const envMatch =
      !!env &&
      env.length >= 32 &&
      matches(input.code, digest(env).toString("hex"));
    const inviteMatch =
      !!invite?.tokenHash &&
      !invite.consumedAt &&
      (invite.expiresAt ?? 0) > Date.now() &&
      matches(input.code, invite.tokenHash);
    if (!envMatch && !inviteMatch)
      throw new Error("Mã thiết lập không đúng hoặc đã hết hạn.");
    await c.users.insertOne(user, { session });
    await c.runtime.updateOne(
      { key: "admin_bootstrap" },
      { $set: { completed: true } },
      { session },
    );
    await c.runtime.updateOne(
      { key: "admin_setup" },
      { $set: { consumedAt: Date.now() }, $unset: { tokenHash: "" } },
      { session },
    );
    return user;
  });
}
