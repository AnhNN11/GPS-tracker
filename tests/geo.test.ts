import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  defaultPolicy,
  validPolygon,
  advanceOutside,
} from "../src/lib/geo";
const polygon = [
  { lat: 14, lng: 108 },
  { lat: 14, lng: 108.002 },
  { lat: 14.002, lng: 108.002 },
  { lat: 14.002, lng: 108 },
];
test("A campus is a polygon, including concave outlines, not a circle", () => {
  assert.ok(validPolygon(polygon));
  assert.equal(
    classify(
      { lat: 14.001, lng: 108.001, accuracy: 5, capturedAt: 0 },
      polygon,
      defaultPolicy,
    ),
    "inside",
  );
  assert.equal(
    classify(
      { lat: 14.001, lng: 108.004, accuracy: 5, capturedAt: 0 },
      polygon,
      defaultPolicy,
    ),
    "outside",
  );
  const concave = [
    { lat: 14, lng: 108 },
    { lat: 14, lng: 108.004 },
    { lat: 14.002, lng: 108.002 },
    { lat: 14.004, lng: 108.004 },
    { lat: 14.004, lng: 108 },
  ];
  assert.ok(validPolygon(concave));
  assert.equal(
    classify(
      { lat: 14.002, lng: 108.0035, accuracy: 5, capturedAt: 0 },
      concave,
      defaultPolicy,
    ),
    "outside",
  );
});
test("GPS uncertainty overlaps fence on either side: do not claim a violation", () => {
  for (const lat of [13.99995, 14, 14.00005])
    assert.equal(
      classify(
        { lat, lng: 108.001, accuracy: 15, capturedAt: 0 },
        polygon,
        defaultPolicy,
      ),
      "uncertain",
    );
  assert.equal(
    classify(
      { lat: 14.001, lng: 108.004, accuracy: 100, capturedAt: 0 },
      polygon,
      defaultPolicy,
    ),
    "uncertain",
  );
  assert.equal(
    classify(
      { lat: 14.001, lng: 108.001, accuracy: 5, capturedAt: 0 },
      [],
      defaultPolicy,
    ),
    "unconfigured",
  );
});
test("Reject self-intersections, degenerate, repeated and excessively large boundaries", () => {
  assert.equal(
    validPolygon([polygon[0], polygon[2], polygon[1], polygon[3]]),
    false,
  );
  assert.equal(
    validPolygon([polygon[0], polygon[1], polygon[1], polygon[2]]),
    false,
  );
  assert.equal(
    validPolygon([
      { lat: 14, lng: 108 },
      { lat: 14, lng: 108.001 },
      { lat: 14, lng: 108.002 },
    ]),
    false,
  );
  assert.equal(
    validPolygon([
      { lat: 14, lng: 108 },
      { lat: 15, lng: 108 },
      { lat: 15, lng: 109 },
    ]),
    false,
  );
});
test("Outside confirmation needs consecutive fresh samples and elapsed time", () => {
  let result = advanceOutside(null, 1000, defaultPolicy);
  assert.equal(result.confirmed, false);
  result = advanceOutside(result.candidate, 16000, defaultPolicy);
  assert.equal(result.confirmed, false);
  result = advanceOutside(result.candidate, 31000, defaultPolicy);
  assert.equal(result.confirmed, true);
  result = advanceOutside(result.candidate, 200000, defaultPolicy);
  assert.equal(result.confirmed, false);
  assert.equal(result.candidate.count, 1);
});
