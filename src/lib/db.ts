import nextEnv from "@next/env";
import { MongoClient, type ClientSession } from "mongodb";
import type { UserRow, AlertRow, Campus } from "./models";
nextEnv.loadEnvConfig(process.cwd());
type SessionRow = {
  token: string;
  user_id: string;
  expires: number;
  expiresAt: Date;
};
type LimitRow = {
  key: string;
  attempts: number;
  resets: number;
  expiresAt: Date;
};
const cache = globalThis as unknown as { campusMongo?: Promise<MongoClient> };
async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("DB_UNAVAILABLE");
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || "campus_guard");
    await Promise.all([
      db.collection("users").createIndex({ id: 1 }, { unique: true }),
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("sessions").createIndex({ token: 1 }, { unique: true }),
      db
        .collection("sessions")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("settings").createIndex({ key: 1 }, { unique: true }),
      db.collection("alerts").createIndex({ id: 1 }, { unique: true }),
      db
        .collection("alerts")
        .createIndex(
          { user_id: 1, type: 1 },
          { unique: true, partialFilterExpression: { active: true } },
        ),
      db.collection("alerts").createIndex({ user_id: 1, created_at: -1 }),
      db.collection("login_limits").createIndex({ key: 1 }, { unique: true }),
      db
        .collection("login_limits")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    return client;
  } catch {
    await client.close();
    throw new Error("DB_UNAVAILABLE");
  }
}
export async function getClient() {
  cache.campusMongo ??= connect().catch((e) => {
    cache.campusMongo = undefined;
    throw e;
  });
  return cache.campusMongo;
}
export async function collections() {
  const db = (await getClient()).db(process.env.MONGODB_DB || "campus_guard");
  return {
    users: db.collection<UserRow>("users"),
    sessions: db.collection<SessionRow>("sessions"),
    settings: db.collection<{ key: string; value: Campus }>("settings"),
    alerts: db.collection<AlertRow>("alerts"),
    limits: db.collection<LimitRow>("login_limits"),
  };
}
export async function transaction<T>(
  action: (
    c: Awaited<ReturnType<typeof collections>>,
    session: ClientSession,
  ) => Promise<T>,
): Promise<T> {
  const c = await collections(),
    session = (await getClient()).startSession();
  try {
    return (await session.withTransaction(() => action(c, session)))!;
  } finally {
    await session.endSession();
  }
}
export async function closeDatabase() {
  if (cache.campusMongo) {
    await (await cache.campusMongo).close();
    cache.campusMongo = undefined;
  }
}
