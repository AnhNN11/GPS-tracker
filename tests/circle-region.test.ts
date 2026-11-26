import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geodesicDistance,
  pointAtDistance,
  circlePolygon,
  classify,
  edgeDistance,
  defaultPolicy,
  validCircle,
} from "../src/lib/geo";
import { schoolCenter } from "../src/lib/campus-preset";

test("Geodesic distance uses meters, is symmetric and crosses the date line correctly", () => {
  assert.ok(
    Math.abs(
      geodesicDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195.0802335,
    ) < 0.001,
  );
  assert.ok(
    Math.abs(
      geodesicDistance({ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 }) -
        222.3901605,
    ) < 0.001,
  );
  const other = { lat: 14.02, lng: 107.99 };
  assert.ok(
    Math.abs(
      geodesicDistance(schoolCenter, other) -
        geodesicDistance(other, schoolCenter),
    ) < 1e-8,
  );
});
test("Circle classification considers GPS error and buffer in every bearing, including touching edges", () => {
  const circle = { center: schoolCenter, radiusMeters: 200 };
  for (const bearing of [0, 22.5, 45, 90, 135, 180, 225, 270, 315]) {
    for (const [meters, expected] of [
      [160, "inside"],
      [180, "uncertain"],
      [200, "uncertain"],
      [220, "uncertain"],
      [240, "outside"],
    ] as const) {
      const reading = {
        ...pointAtDistance(schoolCenter, bearing, meters),
        accuracy: 10,
        capturedAt: 0,
      };
      assert.equal(
        classify(reading, [], defaultPolicy, circle),
        expected,
        `${bearing}° at ${meters} m`,
      );
      assert.ok(
        Math.abs(edgeDistance(reading, [], circle) - Math.abs(meters - 200)) <
          1e-6,
      );
    }
  }
  assert.equal(
    classify(
      { ...schoolCenter, accuracy: 51, capturedAt: 0 },
      [],
      defaultPolicy,
      circle,
    ),
    "uncertain",
  );
});
test("Increasing radius changes classification, independently of a supplied polygon", () => {
  const small = { center: schoolCenter, radiusMeters: 200 },
    large = { ...small, radiusMeters: 500 };
  const reading = {
    ...pointAtDistance(schoolCenter, 110, 400),
    accuracy: 10,
    capturedAt: 0,
  };
  assert.equal(
    classify(reading, circlePolygon(large), defaultPolicy, small),
    "outside",
  );
  assert.equal(
    classify(reading, circlePolygon(small), defaultPolicy, large),
    "inside",
  );
  assert.ok(validCircle({ ...small, radiusMeters: 50 }));
  assert.ok(validCircle({ ...small, radiusMeters: 3000 }));
  for (const radiusMeters of [0, 49, 3001, Infinity, NaN])
    assert.equal(validCircle({ ...small, radiusMeters }), false);
});
