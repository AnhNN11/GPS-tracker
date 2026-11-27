import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { startTestDatabase } from "./test-database";
const fixture = await startTestDatabase();
process.env.APP_ORIGIN = "http://localhost:3107";
const { issueSetupToken } = await import("../src/lib/setup");
const { collections, closeDatabase } = await import("../src/lib/db");
const c = await collections();
const password = randomBytes(24).toString("hex");
const setupCode = await issueSetupToken();
const monitorSecret = randomBytes(32).toString("hex");
process.env.CRON_SECRET = monitorSecret;
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
  assert.equal((await (await request("setup/status")).json()).required, true);
  assert.equal(
    (
      await request("setup", "POST", {
        name: "QA Admin",
        email: "admin@example.invalid",
        password,
        code: "wrong".repeat(10),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("setup", "POST", {
        name: "QA Admin",
        email: "admin@example.invalid",
        password,
        code: setupCode,
      })
    ).status,
    200,
  );
  assert.equal((await (await request("setup/status")).json()).required, false);
  assert.equal(
    (
      await request("setup", "POST", {
        name: "Intruder",
        email: "intruder@example.invalid",
        password,
        code: setupCode,
      })
    ).status,
    400,
  );
  assert.equal((await fetch(origin + "/api/cron")).status, 401);

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
  const presetState = await (
    await request("state", "GET", undefined, adminCookie)
  ).json();
  assert.equal(presetState.campus.polygon.length, 64);
  assert.equal(presetState.campus.circle.radiusMeters, 200);
  assert.ok(presetState.campus.boundaryNote.includes("chưa xác minh"));
  const circleInput = {
    ...presetState.campus,
    circle: { center: { lat: 10.7769, lng: 106.7009 }, radiusMeters: 500 },
  };
  assert.equal(
    (await request("campus", "PUT", circleInput, adminCookie)).status,
    200,
  );
  const relocatedCampus = (
    await (await request("state", "GET", undefined, adminCookie)).json()
  ).campus;
  assert.deepEqual(relocatedCampus.circle, circleInput.circle);
  assert.ok(
    relocatedCampus.polygon.every(
      (point: { lat: number; lng: number }) =>
        Math.abs(point.lat - circleInput.circle.center.lat) < 0.01 &&
        Math.abs(point.lng - circleInput.circle.center.lng) < 0.01,
    ),
    "Map boundary must move with the configured center instead of the school pin",
  );
  for (const radiusMeters of [0, 49, 3001]) {
    assert.equal(
      (
        await request(
          "campus",
          "PUT",
          { ...circleInput, circle: { ...circleInput.circle, radiusMeters } },
          adminCookie,
        )
      ).status,
      400,
    );
  }
  const pushConfig = await (
    await request("push/config", "GET", undefined, adminCookie)
  ).json();
  assert.ok(pushConfig.publicKey);
  assert.equal(pushConfig.privateKey, undefined);
  assert.equal(
    (
      await request(
        "push/subscribe",
        "POST",
        {
          endpoint: "https://127.0.0.1/private",
          keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
        },
        adminCookie,
      )
    ).status,
    400,
  );
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
    (await request("campus", "PUT", circleInput, memberCookie)).status,
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
  const postedReading = {
    lat: 14.001,
    lng: 108.001,
    accuracy: 5,
    capturedAt: Date.now(),
  };
  const uploaded = await request(
    "location",
    "POST",
    postedReading,
    memberCookie,
  );
  assert.equal(uploaded.status, 200);
  const receipt = await uploaded.json();
  assert.deepEqual(receipt.reading, postedReading);
  assert.equal(receipt.status, "inside");
  assert.ok(receipt.receivedAt >= postedReading.capturedAt);
  const own = await (
    await request("state", "GET", undefined, memberCookie)
  ).json();
  assert.equal(own.users.length, 1);
  assert.equal(own.me.status, "inside");
  assert.equal(own.me.lastReceivedAt, receipt.receivedAt);
  assert.ok(!JSON.stringify(own).includes(password));
  assert.ok(!("password" in own.me));
  const state = await (
    await request("state", "GET", undefined, adminCookie)
  ).json();
  assert.equal(state.users.length, 2);
  const adminMapPerson = state.users.find(
    (person: { id: string }) => person.id === own.me.id,
  );
  assert.deepEqual(adminMapPerson.reading, postedReading);
  assert.equal(adminMapPerson.lastReceivedAt, receipt.receivedAt);
  const memberId = own.me.id;
  const { acceptReading } = await import("../src/lib/store");
  const { dayInVietnam } = await import("../src/lib/history");
  const now = Date.now() + 1000;
  await acceptReading(
    memberId,
    { lat: 14.001, lng: 108.004, accuracy: 5, capturedAt: now },
    now,
  );
  await acceptReading(
    memberId,
    { lat: 14.001, lng: 108.004, accuracy: 5, capturedAt: now + 60000 },
    now + 60000,
  );
  await acceptReading(
    memberId,
    { lat: 14.001, lng: 108.001, accuracy: 5, capturedAt: now + 120000 },
    now + 120000,
  );
  const dates =
    "from=" +
    dayInVietnam(now - 86400000) +
    "&to=" +
    dayInVietnam(now + 86400000);
  const historyResponse = await request(
    "history?view=samples&" + dates,
    "GET",
    undefined,
    memberCookie,
  );
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.headers.get("cache-control"), "no-store");
  const history = await historyResponse.json();
  assert.equal(history.total, 4);
  assert.equal(history.summary.outsideSamples, 2);
  const journey = await request(
    "history/journey?" + dates,
    "GET",
    undefined,
    memberCookie,
  );
  assert.equal(journey.status, 200);
  assert.equal((await journey.json()).summary.samples, 4);
  assert.equal(
    (await request("history/journey?" + dates, "GET", undefined, adminCookie))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "history/journey?userId=someone-else&" + dates,
        "GET",
        undefined,
        memberCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "history?userId=" +
          state.users.find((u: { role: string }) => u.role === "admin").id,
        "GET",
        undefined,
        memberCookie,
      )
    ).status,
    403,
  );
  const events = await (
    await request(
      "history?view=events&" + dates,
      "GET",
      undefined,
      memberCookie,
    )
  ).json();
  assert.equal(events.total, 1);
  assert.equal(events.rows[0].endReason, "returned");
  const detail = await (
    await request(
      "history/events/" + events.rows[0].id,
      "GET",
      undefined,
      memberCookie,
    )
  ).json();
  assert.ok(detail.points.length >= 3);
  assert.deepEqual(detail.boundary.polygon, boundary.polygon);
  assert.ok(Array.isArray(detail.segments));
  assert.ok(Array.isArray(detail.breaks));
  assert.ok(
    detail.segments
      .flat()
      .every((index: number) => index >= 0 && index < detail.points.length),
  );
  const csv = await request(
    "history?view=samples&format=csv&" + dates,
    "GET",
    undefined,
    adminCookie,
  );
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  assert.ok((await csv.text()).includes("UTC+7"));
  assert.equal(
    (await request("history?from=2026-02-30", "GET", undefined, adminCookie))
      .status,
    400,
  );

  const staleTime = Date.now() - 10 * 60000;
  await c.users.updateOne(
    { id: memberId },
    {
      $set: {
        reading: { lat: 14, lng: 108, accuracy: 5, capturedAt: staleTime },
        tracking_started: staleTime,
      },
    },
  );
  const cron = await fetch(origin + "/api/cron", {
    headers: { Authorization: "Bearer " + monitorSecret },
  });
  assert.equal(cron.status, 200);
  assert.ok((await c.runtime.findOne({ key: "monitor" }))?.lastRunAt);
  assert.equal(
    await c.alerts.countDocuments({
      user_id: memberId,
      type: "stale",
      active: true,
    }),
    1,
  );
  assert.equal(
    (await request("push/config", "GET", undefined, memberCookie)).status,
    403,
  );
  const alertState = await (
    await request("state", "GET", undefined, memberCookie)
  ).json();
  const alert = alertState.alerts.find(
    (item: { type: string }) => item.type === "stale",
  );
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
    "API checks passed: auth, CSRF, radius settings, GPS receipts/history, device journeys, CSV, role isolation and revocation.",
  );
  if (process.argv.includes("--preview")) {
    const { createUser } = await import("../src/lib/auth");
    const { saveCampus, setTracking } = await import("../src/lib/store");
    const { schoolPreset, schoolCenter } = await import(
      "../src/lib/campus-preset"
    );
    await saveCampus(schoolPreset);
    for (let index = 1; index <= 3; index++) {
      const id = await createUser(
        "Học viên kiểm thử " + index,
        `preview${index}@example.invalid`,
        password,
      );
      if (index === 3) continue;
      await setTracking(id, true);
      const last = Date.now();
      const position =
        index === 1
          ? schoolCenter
          : { ...schoolCenter, lat: schoolCenter.lat + 0.004 };
      for (let step = 0; step < 4; step++) {
        const capturedAt = last - (3 - step) * 60000;
        await acceptReading(
          id,
          {
            ...position,
            lng: position.lng + step * 0.0002,
            accuracy: 10,
            capturedAt,
          },
          capturedAt,
          {
            deviceId:
              index === 1
                ? "11111111-1111-4111-8111-111111111111"
                : "22222222-2222-4222-8222-222222222222",
            deviceLabel: index === 1 ? "Android QA" : "iOS QA",
          },
        );
      }
    }
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
