import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPresence } from "../src/lib/map-presence";
import type { Person } from "../src/lib/types";

const person: Person = {
  id: "member", name: "Member", email: "member@example.invalid",
  role: "member", enabled: true, tracking: true, trackingStarted: 1,
  reading: { lat: 14, lng: 108, accuracy: 10, capturedAt: 1000000 },
  status: "inside",
};
test("Old, stopped and locked GPS never looks like a current inside location", () => {
  assert.match(mapPresence(person, 1300001, 5).label, /Mất cập nhật/);
  assert.match(mapPresence({ ...person, tracking: false }, 1000000, 5).label, /Đã dừng chia sẻ/);
  assert.match(mapPresence({ ...person, enabled: false }, 1000000, 5).label, /Tài khoản đã khóa/);
  assert.notEqual(mapPresence({ ...person, tracking: false }, 1000000, 5).color,
    mapPresence(person, 1000000, 5).color);
});
test("Fresh GPS preserves uncertain and pending states instead of confirming outside early", () => {
  assert.equal(mapPresence(person, 1000010, 5).label, "Trong khuôn viên");
  assert.equal(mapPresence({ ...person, status: "uncertain" }, 1000010, 5).label, "GPS chưa rõ");
  assert.match(mapPresence({ ...person, status: "pending" }, 1000010, 5).label, /chờ xác nhận/);
});
