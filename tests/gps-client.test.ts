import { test } from "node:test";
import assert from "node:assert/strict";
import { captureLocation, gpsErrorMessage } from "../src/lib/gps-client";
import { schoolPreset, schoolCenter } from "../src/lib/campus-preset";
import { classify, validPolygon } from "../src/lib/geo";
import { rosterCounts } from "../src/lib/roster";
import type { Person } from "../src/lib/types";

test("GPS falls back after a high-accuracy failure and preserves sensor time and accuracy", async () => {
  const modes: boolean[] = [];
  const reading = await captureLocation({
    getCurrentPosition(success, failure, options) {
      modes.push(!!options?.enableHighAccuracy);
      if (options?.enableHighAccuracy)
        failure!({ code: 3 } as GeolocationPositionError);
      else
        success({
          coords: { latitude: 14, longitude: 108, accuracy: 120 },
          timestamp: 1000.4,
        } as GeolocationPosition);
    },
  });
  assert.deepEqual(modes, [true, false]);
  assert.deepEqual(reading, {
    lat: 14,
    lng: 108,
    accuracy: 120,
    capturedAt: 1000,
  });
});
test("Denied GPS permission is surfaced without attempting a fallback", async () => {
  let attempts = 0;
  await assert.rejects(
    captureLocation({
      getCurrentPosition(_success, failure) {
        attempts++;
        failure!({ code: 1 } as GeolocationPositionError);
      },
    }),
    (error: unknown) => gpsErrorMessage(error).includes("quyền vị trí"),
  );
  assert.equal(attempts, 1);
});
test("The approximate school preset can classify GPS immediately without an empty boundary", () => {
  assert.ok(validPolygon(schoolPreset.polygon));
  assert.equal(
    classify(
      { ...schoolCenter, capturedAt: 0, accuracy: 10 },
      schoolPreset.polygon,
      schoolPreset.policy,
    ),
    "inside",
  );
  assert.equal(
    classify(
      {
        lat: schoolCenter.lat + 0.01,
        lng: schoolCenter.lng,
        capturedAt: 0,
        accuracy: 10,
      },
      schoolPreset.polygon,
      schoolPreset.policy,
    ),
    "outside",
  );
  assert.equal(
    classify(
      { ...schoolPreset.polygon[0], capturedAt: 0, accuracy: 10 },
      schoolPreset.polygon,
      schoolPreset.policy,
    ),
    "uncertain",
  );
  assert.ok(schoolPreset.boundaryNote?.includes("chưa xác minh"));
});
test("Roster excludes administrators and locked accounts; old GPS does not imply presence", () => {
  const base: Person = {
    id: "member",
    name: "Member",
    email: "member@example.invalid",
    role: "member",
    enabled: true,
    tracking: true,
    trackingStarted: 0,
    status: "inside",
    reading: { ...schoolCenter, accuracy: 5, capturedAt: 600000 },
  };
  const counts = rosterCounts(
    [
      base,
      { ...base, id: "old", reading: { ...base.reading!, capturedAt: 0 } },
      { ...base, id: "admin", role: "admin" },
      { ...base, id: "disabled", enabled: false },
      { ...base, id: "outside", status: "outside" },
    ],
    600000,
    5,
  );
  assert.deepEqual(counts, {
    total: 3,
    inside: 1,
    outside: 1,
    unknown: 1,
    fresh: 2,
  });
});
