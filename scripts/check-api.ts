import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { startTestDatabase } from "./test-database";
const fixture = await startTestDatabase();
process.env.APP_ORIGIN = "http://localhost:3107";
const { createUser } = await import("../src/lib/auth");
const { collections, closeDatabase } = await import("../src/lib/db");
const c = await collections();
const password = randomBytes(24).toString("hex");
await createUser("QA Admin", "admin@example.invalid", password, "admin");
const origin = "http://localhost:3107";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "-p",
    "3107",
  ],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
child.stdout?.on("data", (c) => (logs += c));
child.stderr?.on("data", (c) => (logs += c));
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  withOrigin = true,
) {
  return fetch(origin + "/api/" + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(withOrigin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(origin + "/api/auth/me");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(ready, logs);
  assert.equal((await request("state")).status, 401);
  assert.equal(
    (
      await request(
        "auth/login",
        "POST",
        { email: "admin@example.invalid", password },
        undefined,
        false,
      )
    ).status,
    403,
  );
  const login = await request("auth/login", "POST", {
    email: "admin@example.invalid",
    password,
  });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.ok(login.headers.get("set-cookie")?.includes("HttpOnly"));
  const boundary = {
    name: "Test campus",
    address: "Test address",
    polygon: [
      { lat: 14, lng: 108 },
      { lat: 14, lng: 108.002 },
      { lat: 14.002, lng: 108.002 },
      { lat: 14.002, lng: 108 },
    ],
    policy: {
      buffer: 10,
      maxAccuracy: 50,
      confirmSeconds: 30,
      staleMinutes: 5,
    },
  };
  assert.equal(
    (await request("campus", "PUT", boundary, adminCookie)).status,
    200,
  );
  assert.equal(
    (
      await request(
        "campus",
        "PUT",
        {
          ...boundary,
          polygon: [
            boundary.polygon[0],
            boundary.polygon[2],
            boundary.polygon[1],
            boundary.polygon[3],
          ],
        },
        adminCookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "users",
        "POST",
        { name: "Test Member", email: "member@example.invalid", password },
        adminCookie,
      )
    ).status,
    200,
  );
  const member = await request("auth/login", "POST", {
    email: "member@example.invalid",
    password,
  });
  assert.equal(member.status, 200);
  const memberCookie = member.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await request(
        "users",
        "POST",
        { name: "Intruder", email: "intruder@example.invalid", password },
        memberCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("campus", "PUT", boundary, memberCookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "tracking",
        "POST",
        { enabled: true, consent: false },
        memberCookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "tracking",
        "POST",
        { enabled: true, consent: true },
        memberCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "location",
        "POST",
        { lat: 14.001, lng: 108.001, accuracy: 5, capturedAt: Date.now() },
        memberCookie,
      )
    ).status,
    200,
  );
  const own = await (
    await request("state", "GET", undefined, memberCookie)
  ).json();
  assert.equal(own.users.length, 1);
  assert.equal(own.me.status, "inside");
  assert.ok(!JSON.stringify(own).includes(password));
  assert.ok(!("password" in own.me));
  const state = await (
    await request("state", "GET", undefined, adminCookie)
  ).json();
  assert.equal(state.users.length, 2);
  const memberId = own.me.id;
  const staleTime = Date.now() - 10 * 60000;
  await c.users.updateOne(
    { id: memberId },
    {
      $set: {
        reading: { lat: 14, lng: 108, accuracy: 5, capturedAt: staleTime },
      },
    },
  );
  const { sweep } = await import("../src/lib/store");
  await sweep();
  const alertState = await (
    await request("state", "GET", undefined, memberCookie)
  ).json();
  const alert = alertState.alerts[0];
  assert.equal(alert.type, "stale");
  assert.equal(
    (await request(`alerts/${alert.id}/ack`, "POST", {}, memberCookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        `alerts/${alert.id}/report`,
        "POST",
        { report: "Đang kiểm tra kết nối mạng." },
        memberCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `alerts/${alert.id}/report`,
        "POST",
        { report: "Không phải tài khoản của tôi." },
        adminCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`alerts/${alert.id}/ack`, "POST", {}, adminCookie)).status,
    200,
  );
  assert.equal(
    (
      await request(
        `users/${memberId}`,
        "PATCH",
        { enabled: false },
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("state", "GET", undefined, memberCookie)).status,
    401,
  );
  await request("auth/logout", "POST", {}, adminCookie);
  assert.equal(
    (await request("state", "GET", undefined, adminCookie)).status,
    401,
  );
  console.log(
    "API checks passed: authentication, cookie, CSRF, roles, account locking, campus validation, consent, GPS, reports, acknowledgement and session revocation.",
  );
  if (process.argv.includes("--preview")) {
    console.log("Isolated QA preview: " + origin);
    console.log("QA login: admin@example.invalid / " + password);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  child.kill();
  await new Promise<void>((r) => {
    if (child.exitCode !== null) r();
    else child.once("exit", () => r());
  });
  await closeDatabase();
  await fixture.stop();
}
