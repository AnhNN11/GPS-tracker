import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collections } from "./db";
import { verifyPassword, loginAllowed, failedLogin, publicUser } from "./auth";
import { issueClientToken, requireClient } from "./client-auth";
import { acceptReading, campus, setTracking } from "./store";
async function body(request: NextRequest) {
  const text = await request.text();
  if (text.length > 65536) throw new Error("Yêu cầu quá lớn.");
  return JSON.parse(text);
}
// Native clients use explicit, scoped bearer tokens. Browser cookies are never accepted here.
export async function clientApi(request: NextRequest, route: string) {
  const c = await collections();
  if (route === "login" && request.method === "POST") {
    const input = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((s) => s.toLowerCase().trim()),
        password: z.string().min(1).max(128),
        deviceId: z.uuid(),
        deviceLabel: z.string().trim().min(1).max(80),
      })
      .parse(await body(request));
    if (!(await loginAllowed(input.email)))
      return NextResponse.json(
        { error: "Thử sai quá nhiều. Vui lòng chờ 15 phút." },
        { status: 429 },
      );
    const user = await c.users.findOne({ email: input.email });
    if (!user?.enabled || !verifyPassword(input.password, user.password)) {
      await failedLogin(input.email);
      throw new Error("UNAUTHORIZED");
    }
    await c.limits.deleteOne({ key: input.email });
    return NextResponse.json({
      ...(await issueClientToken(user.id, input.deviceId, input.deviceLabel)),
      user: publicUser(user),
    });
  }
  const { user, identity } = await requireClient(
    request.headers.get("authorization"),
  );
  if (route === "me" && request.method === "GET")
    return NextResponse.json({
      user: publicUser(user),
      campus: await campus(),
      serverTime: Date.now(),
      expiresAt: identity.expiresAt.getTime(),
    });
  if (route === "tracking" && request.method === "POST") {
    const input = z
      .object({ enabled: z.boolean(), consent: z.boolean() })
      .parse(await body(request));
    if (input.enabled && !input.consent)
      throw new Error("Cần đồng ý chia sẻ vị trí.");
    await setTracking(user.id, input.enabled);
    return NextResponse.json({ ok: true });
  }
  if (route === "location" && request.method === "POST") {
    const reading = z
      .object({
        lat: z.number().min(-85).max(85),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000),
        capturedAt: z.number().int().positive(),
      })
      .parse(await body(request));
    const receivedAt = Date.now();
    return NextResponse.json({
      status: await acceptReading(user.id, reading, receivedAt, {
        deviceId: identity.deviceId,
        deviceLabel: identity.deviceLabel,
      }),
      reading,
      receivedAt,
    });
  }
  if (route === "logout" && request.method === "POST") {
    await c.clientTokens.deleteOne({ tokenHash: identity.tokenHash });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    { error: "Không tìm thấy chức năng client." },
    { status: 404 },
  );
}
