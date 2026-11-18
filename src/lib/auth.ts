import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  password: string;
  enabled: number;
  tracking: number;
  tracking_started: number | null;
  reading: string | null;
  status: string;
  candidate: string | null;
  created_at: number;
};
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function createUser(
  name: string,
  email: string,
  password: string,
  role = "member",
) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    name,
    email.toLowerCase(),
    hashPassword(password),
    role,
    Date.now(),
  );
  return id;
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function sessionUser() {
  const token = (await cookies()).get("campus_session")?.value;
  if (!token) return null;
  return db
    .prepare(
      "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND enabled=1",
    )
    .get(digest(token), Date.now()) as UserRow | undefined;
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
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(token),
    id,
    expires,
  );
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
    db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
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
    reading: u.reading ? JSON.parse(u.reading) : null,
  };
}
export function loginAllowed(email: string) {
  const row = db
    .prepare("SELECT * FROM login_limits WHERE key=?")
    .get(email) as { attempts: number; resets: number } | undefined;
  return !row || row.resets < Date.now() || row.attempts < 5;
}
export function failedLogin(email: string) {
  db.prepare(
    "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resets<? THEN 1 ELSE attempts+1 END,resets=CASE WHEN resets<? THEN excluded.resets ELSE resets END",
  ).run(email, Date.now() + 15 * 60000, Date.now(), Date.now());
}
