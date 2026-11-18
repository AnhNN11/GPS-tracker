import { test } from "node:test";
import assert from "node:assert/strict";
import { validOrigin } from "../src/lib/origin";
test("Use explicit public origins even when Next listens on 0.0.0.0", () => {
  assert.equal(
    validOrigin("http://localhost:3107", "http://localhost:3107"),
    true,
  );
  assert.equal(
    validOrigin("https://school.example", "https://school.example"),
    true,
  );
  assert.equal(
    validOrigin(
      "http://192.168.1.20:3000",
      "http://localhost:3000,http://192.168.1.20:3000",
    ),
    true,
  );
  assert.equal(
    validOrigin("https://evil.example", "https://school.example"),
    false,
  );
  assert.equal(validOrigin("null", "https://school.example"), false);
  assert.equal(validOrigin(null, "https://school.example"), false);
  assert.equal(
    validOrigin("https://school.example.evil", "https://school.example"),
    false,
  );
});
