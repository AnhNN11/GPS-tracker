import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { cookies } from "next/headers";
import { collections, transaction } from "./db";
import type { UserRow } from "./models";
export type { UserRow } from "./models";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const expected = Buffer.from(key, "hex"),
    actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function createUser(
  name: string,
  email: string,
  password: string,
  role: UserRow["role"] = "member",
) {
  const id = randomUUID(),
    c = await collections();
  await c.users.insertOne({
    id,
    name,
    email: email.trim().toLowerCase(),
    password: hashPassword(password),
    role,
    enabled: 1,
    tracking: 0,
    tracking_started: null,
    reading: null,
    status: "unknown",
    candidate: null,
    created_at: Date.now(),
  });
  return id;
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function sessionUser() {
  const token = (await cookies()).get("campus_session")?.value;
  if (!token) return null;
  const c = await collections(),
    session = await c.sessions.findOne({
      token: digest(token),
      expires: { $gt: Date.now() },
    });
  return session
    ? await c.users.findOne({ id: session.user_id, enabled: 1 })
    : null;
}
export async function requireUser(admin = false) {
  const user = await sessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (admin && user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}
export async function startSession(id: string) {
  const token = randomBytes(32).toString("hex"),
    expires = Date.now() + 12 * 3600000;
  await transaction(async (c, session) => {
    const user = await c.users.findOne({ id, enabled: 1 }, { session });
    if (!user) throw new Error("UNAUTHORIZED");
    await c.sessions.insertOne(
      {
        token: digest(token),
        user_id: id,
        expires,
        expiresAt: new Date(expires),
      },
      { session },
    );
  });
  (await cookies()).set("campus_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(expires),
  });
}
export async function endSession() {
  const jar = await cookies(),
    token = jar.get("campus_session")?.value;
  if (token)
    await (await collections()).sessions.deleteOne({ token: digest(token) });
  jar.delete("campus_session");
}
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    enabled: !!u.enabled,
    tracking: !!u.tracking,
    status: u.status,
    trackingStarted: u.tracking_started,
    reading: u.reading,
    lastReceivedAt: u.reading_received_at ?? null,
  };
}
export async function loginAllowed(email: string) {
  const row = await (await collections()).limits.findOne({ key: email });
  return !row || row.resets < Date.now() || row.attempts < 5;
}
export async function failedLogin(email: string) {
  const now = Date.now();
  await (
    await collections()
  ).limits.updateOne(
    { key: email },
    [
      {
        $set: {
          key: email,
          attempts: {
            $cond: [{ $gt: ["$resets", now] }, { $add: ["$attempts", 1] }, 1],
          },
          resets: {
            $cond: [{ $gt: ["$resets", now] }, "$resets", now + 900000],
          },
          expiresAt: new Date(now + 900000),
        },
      },
    ],
    { upsert: true },
  );
}
