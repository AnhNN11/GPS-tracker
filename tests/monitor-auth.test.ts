import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedWorkflow, authorizeMonitor } from "../src/lib/monitor-auth";
test("Only the named workflow on the main branch can monitor production", () => {
  const payload = {
    repository: "AnhNN11/GPS-tracker",
    ref: "refs/heads/main",
    workflow_ref:
      "AnhNN11/GPS-tracker/.github/workflows/gps-monitor.yml@refs/heads/main",
    sub: "repo:AnhNN11/GPS-tracker:ref:refs/heads/main",
    event_name: "schedule",
  };
  assert.ok(trustedWorkflow(payload));
  for (const changed of [
    { repository: "other/repo" },
    { ref: "refs/pull/1/merge" },
    {
      workflow_ref:
        "AnhNN11/GPS-tracker/.github/workflows/other.yml@refs/heads/main",
    },
    { event_name: "pull_request" },
    { sub: "repo:other/repo:ref:refs/heads/main" },
  ])
    assert.equal(trustedWorkflow({ ...payload, ...changed }), false);
});
test("Monitor secret must be configured, strong and match exactly", async () => {
  const old = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "a".repeat(64);
  try {
    assert.equal(await authorizeMonitor(null), false);
    assert.equal(await authorizeMonitor("Bearer invalid"), false);
    assert.equal(await authorizeMonitor("Bearer " + "a".repeat(64)), true);
  } finally {
    if (old) process.env.CRON_SECRET = old;
    else delete process.env.CRON_SECRET;
  }
});
