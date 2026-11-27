import { test } from "node:test";
import assert from "node:assert/strict";
import { boundaryDraftKey } from "../src/lib/boundary-draft";
import { schoolPreset } from "../src/lib/campus-preset";

test("Boundary drafts detect edits and recognize when the user reverts them", () => {
  const baseline = boundaryDraftKey("circle", schoolPreset, []);
  const changed = {
    ...schoolPreset,
    circle: { ...schoolPreset.circle!, radiusMeters: 450 },
  };
  assert.notEqual(boundaryDraftKey("circle", changed, []), baseline);
  changed.circle.radiusMeters = schoolPreset.circle!.radiusMeters;
  assert.equal(boundaryDraftKey("circle", changed, []), baseline);
  assert.notEqual(
    boundaryDraftKey("circle", { ...changed, name: "Other" }, []),
    baseline,
  );
  assert.notEqual(
    boundaryDraftKey(
      "circle",
      {
        ...changed,
        policy: { ...changed.policy, buffer: 20 },
      },
      [],
    ),
    baseline,
  );
});
test("Only the active boundary shape participates in the unsaved-state check", () => {
  const polygon = schoolPreset.polygon;
  const baseline = boundaryDraftKey("polygon", schoolPreset, polygon);
  assert.equal(
    boundaryDraftKey(
      "polygon",
      { ...schoolPreset, circle: undefined },
      polygon,
    ),
    baseline,
  );
  assert.notEqual(
    boundaryDraftKey("polygon", schoolPreset, polygon.slice(1)),
    baseline,
  );
  assert.notEqual(boundaryDraftKey("circle", schoolPreset, polygon), baseline);
});
