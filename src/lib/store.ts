import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { publicUser, type UserRow } from "./auth";
import {
  advanceOutside,
  classify,
  defaultPolicy,
  type Point,
  type Policy,
  type Reading,
  type Candidate,
} from "./geo";
export type Campus = {
  name: string;
  address: string;
  polygon: Point[];
  policy: Policy;
};
export const initialCampus: Campus = {
  name: "Phân hiệu 1 Trường Thiếu sinh quân miền Trung",
  address: "Phường Thống Nhất, Pleiku, Gia Lai",
  polygon: [],
  policy: defaultPolicy,
};
export function campus(): Campus {
  const row = db.prepare("SELECT value FROM settings WHERE id=1").get() as
    { value: string } | undefined;
  return row ? JSON.parse(row.value) : initialCampus;
}
export function saveCampus(value: Campus) {
  transaction(() => {
    db.prepare(
      "INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    ).run(JSON.stringify(value));
    db.prepare("UPDATE users SET status='unknown',candidate=NULL").run();
    db.prepare(
      "UPDATE alerts SET resolved_at=? WHERE resolved_at IS NULL AND type=?",
    ).run(Date.now(), "outside");
  });
}
function openAlert(userId: string, type: string, time = Date.now()) {
  db.prepare(
    "INSERT OR IGNORE INTO alerts(id,user_id,type,created_at) VALUES(?,?,?,?)",
  ).run(randomUUID(), userId, type, time);
}
function resolveAlert(userId: string, type: string) {
  db.prepare(
    "UPDATE alerts SET resolved_at=? WHERE user_id=? AND type=? AND resolved_at IS NULL",
  ).run(Date.now(), userId, type);
}
export function acceptReading(
  userId: string,
  reading: Reading,
  now = Date.now(),
) {
  return transaction(() => {
    const user = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(userId) as UserRow;
    if (!user.tracking) throw new Error("Bạn cần bật chia sẻ vị trí trước.");
    const previous = user.reading
      ? (JSON.parse(user.reading) as Reading)
      : null;
    if (
      reading.capturedAt < now - 90000 ||
      reading.capturedAt > now + 10000 ||
      (previous && reading.capturedAt <= previous.capturedAt)
    )
      throw new Error(
        "Mẫu vị trí đã cũ hoặc trùng thời điểm. Hãy lấy vị trí mới.",
      );
    const config = campus(),
      status = classify(reading, config.polygon, config.policy);
    let candidate: Candidate | null = null,
      displayed: string = status;
    if (status === "outside") {
      const next = advanceOutside(
        user.candidate ? JSON.parse(user.candidate) : null,
        reading.capturedAt,
        config.policy,
      );
      candidate = next.candidate;
      displayed = next.confirmed ? "outside" : "pending";
      if (next.confirmed) openAlert(user.id, "outside", now);
    }
    if (status === "inside") resolveAlert(user.id, "outside");
    resolveAlert(user.id, "stale");
    db.prepare(
      "UPDATE users SET reading=?,status=?,candidate=? WHERE id=?",
    ).run(
      JSON.stringify(reading),
      displayed,
      candidate ? JSON.stringify(candidate) : null,
      user.id,
    );
    return displayed;
  });
}
export function setTracking(userId: string, enabled: boolean) {
  transaction(() => {
    db.prepare(
      "UPDATE users SET tracking=?,tracking_started=?,reading=NULL,candidate=NULL,status='unknown' WHERE id=?",
    ).run(enabled ? 1 : 0, enabled ? Date.now() : null, userId);
    if (!enabled) {
      resolveAlert(userId, "stale");
      resolveAlert(userId, "outside");
    }
  });
}
export function sweep(now = Date.now()) {
  transaction(() => {
    const policy = campus().policy;
    const users = db
      .prepare("SELECT * FROM users WHERE tracking=1 AND enabled=1")
      .all() as UserRow[];
    for (const user of users) {
      const reading = user.reading
        ? (JSON.parse(user.reading) as Reading)
        : null;
      if (
        now - (reading?.capturedAt ?? user.tracking_started ?? now) >
        policy.staleMinutes * 60000
      ) {
        openAlert(user.id, "stale", now);
        db.prepare(
          "UPDATE users SET status='stale',candidate=NULL WHERE id=?",
        ).run(user.id);
      }
    }
  });
}
export function dashboard(user: UserRow) {
  sweep();
  const admin = user.role === "admin";
  const users = (
    admin
      ? db.prepare("SELECT * FROM users ORDER BY created_at DESC").all()
      : db.prepare("SELECT * FROM users WHERE id=?").all(user.id)
  ) as UserRow[];
  const query =
    "SELECT alerts.*,users.name AS user_name FROM alerts JOIN users ON users.id=alerts.user_id";
  const alerts = admin
    ? db.prepare(query + " ORDER BY created_at DESC LIMIT 200").all()
    : db
        .prepare(query + " WHERE user_id=? ORDER BY created_at DESC LIMIT 100")
        .all(user.id);
  return {
    campus: campus(),
    users: users.map(publicUser),
    alerts,
    me: publicUser(users.find((u) => u.id === user.id) ?? user),
    serverTime: Date.now(),
  };
}
