import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseJourney } from "../src/lib/journey";
import type { LocationSample } from "../src/lib/models";
const sample = (
  id: number,
  seconds: number,
  extra: Partial<LocationSample> = {},
): LocationSample => ({
  id: String(id),
  user_id: "user",
  lat: 14,
  lng: 108 + seconds * 0.000001,
  accuracy: 5,
  capturedAt: seconds * 1000,
  receivedAt: seconds * 1000,
  edgeDistanceMeters: null,
  classification: "outside",
  status: "outside",
  campusVersion: "v1",
  trackingSession: "s1",
  deviceId: "device-a",
  ...extra,
});
test("Journey separates interleaved devices and never connects their paths", () => {
  const points = [
    sample(0, 0),
    sample(1, 10, { deviceId: "device-b", lat: 20 }),
    sample(2, 60),
    sample(3, 70, { deviceId: "device-b", lat: 20 }),
  ];
  const result = analyseJourney(points);
  assert.deepEqual(result.segments, [
    [0, 2],
    [1, 3],
  ]);
  assert.ok(result.summary.lineDistanceMeters < 20);
  assert.equal(result.summary.observedSeconds, 120);
});
test("Journey splits time gaps, inaccurate GPS, changed sessions and impossible jumps", () => {
  const pairs = [
    [sample(0, 0), sample(1, 140)],
    [sample(0, 0), sample(1, 60, { accuracy: 100 })],
    [sample(0, 0), sample(1, 60, { trackingSession: "s2" })],
    [sample(0, 0), sample(1, 60, { campusVersion: "v2" })],
    [sample(0, 0), sample(1, 1, { lat: 20 })],
  ];
  for (const points of pairs) {
    const result = analyseJourney(points);
    assert.equal(result.summary.lineDistanceMeters, 0);
    assert.equal(result.summary.outsideObservedSeconds, 0);
    assert.equal(result.breaks.length, 1);
    assert.deepEqual(result.segments, [[0], [1]]);
  }
});
