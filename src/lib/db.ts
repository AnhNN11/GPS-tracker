import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
// Runtime data lives on a persistent volume; never bundle the database in a build.
const file = resolve(
  /* turbopackIgnore: true */ process.env.DATABASE_PATH || "data/campus.sqlite",
);
mkdirSync(dirname(file), { recursive: true });
const globalDb = globalThis as unknown as { campusDb?: DatabaseSync };
export const db = (globalDb.campusDb ??= new DatabaseSync(file));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
 role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, tracking INTEGER NOT NULL DEFAULT 0,
 tracking_started INTEGER, reading TEXT, status TEXT NOT NULL DEFAULT 'unknown', candidate TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
 created_at INTEGER NOT NULL, resolved_at INTEGER, acknowledged_at INTEGER, report TEXT, reported_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_alert ON alerts(user_id,type) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets INTEGER NOT NULL);
`);
export function transaction<T>(action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
