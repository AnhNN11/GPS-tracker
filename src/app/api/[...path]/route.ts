import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, transaction } from "@/lib/db";
import {
  requireUser,
  sessionUser,
  publicUser,
  startSession,
  endSession,
  verifyPassword,
  createUser,
  failedLogin,
  loginAllowed,
  type UserRow,
} from "@/lib/auth";
import { dashboard, saveCampus, acceptReading, setTracking } from "@/lib/store";
import { validPolygon } from "@/lib/geo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const point = z.object({
  lat: z.number().min(-85).max(85),
  lng: z.number().min(-180).max(180),
});
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1).max(128),
});
async function body(req: NextRequest) {
  const text = await req.text();
  if (text.length > 65536) throw new Error("Yêu cầu quá lớn.");
  return JSON.parse(text);
}
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await ctx.params,
      route = path.join("/"),
      method = req.method;
    if (
      method !== "GET" &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return NextResponse.json(
        { error: "Nguồn yêu cầu không hợp lệ." },
        { status: 403 },
      );
    let result: unknown = { ok: true };
    if (route === "auth/me" && method === "GET") {
      const user = await sessionUser();
      result = { user: user ? publicUser(user) : null };
    } else if (route === "auth/login" && method === "POST") {
      const input = credentials.parse(await body(req));
      if (!loginAllowed(input.email))
        return NextResponse.json(
          { error: "Thử sai quá nhiều. Vui lòng chờ 15 phút." },
          { status: 429 },
        );
      const user = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email) as UserRow | undefined;
      if (
        !user ||
        !user.enabled ||
        !verifyPassword(input.password, user.password)
      ) {
        failedLogin(input.email);
        return NextResponse.json(
          { error: "Email hoặc mật khẩu không đúng." },
          { status: 401 },
        );
      }
      db.prepare("DELETE FROM login_limits WHERE key=?").run(input.email);
      await startSession(user.id);
      result = { user: publicUser(user) };
    } else if (route === "auth/logout" && method === "POST") {
      await endSession();
    } else if (route === "state" && method === "GET") {
      result = dashboard(await requireUser());
    } else if (route === "users" && method === "POST") {
      await requireUser(true);
      const input = credentials
        .extend({
          name: z.string().trim().min(2).max(100),
          password: z.string().min(12).max(128),
        })
        .parse(await body(req));
      if (db.prepare("SELECT id FROM users WHERE email=?").get(input.email))
        throw new Error("Email đã được sử dụng.");
      result = { id: createUser(input.name, input.email, input.password) };
    } else if (path[0] === "users" && path.length === 2 && method === "PATCH") {
      const admin = await requireUser(true),
        input = z.object({ enabled: z.boolean() }).parse(await body(req));
      const target = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(path[1]) as UserRow | undefined;
      if (!target || target.role === "admin" || target.id === admin.id)
        throw new Error("Chỉ có thể thay đổi tài khoản người dùng.");
      transaction(() => {
        db.prepare("UPDATE users SET enabled=? WHERE id=?").run(
          input.enabled ? 1 : 0,
          target.id,
        );
        if (!input.enabled)
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      });
      if (!input.enabled) setTracking(target.id, false);
    } else if (route === "campus" && method === "PUT") {
      await requireUser(true);
      const input = z
        .object({
          name: z.string().trim().min(2).max(150),
          address: z.string().trim().min(2).max(300),
          polygon: z.array(point).min(3).max(100),
          policy: z.object({
            buffer: z.number().min(0).max(100),
            maxAccuracy: z.number().min(5).max(200),
            confirmSeconds: z.number().min(10).max(300),
            staleMinutes: z.number().min(2).max(60),
          }),
        })
        .parse(await body(req));
      if (!validPolygon(input.polygon))
        throw new Error(
          "Ranh giới phải có ít nhất 3 đỉnh, không tự cắt, diện tích ≥100 m² và kích thước ≤10 km.",
        );
      saveCampus(input);
    } else if (route === "tracking" && method === "POST") {
      const user = await requireUser(),
        input = z
          .object({ enabled: z.boolean(), consent: z.boolean() })
          .parse(await body(req));
      if (input.enabled && !input.consent)
        throw new Error("Cần đồng ý chia sẻ vị trí.");
      setTracking(user.id, input.enabled);
    } else if (route === "location" && method === "POST") {
      const user = await requireUser();
      const input = point
        .extend({
          accuracy: z.number().min(0).max(100000),
          capturedAt: z.number().int().positive(),
        })
        .parse(await body(req));
      result = { status: acceptReading(user.id, input) };
    } else if (path[0] === "alerts" && path.length === 3 && method === "POST") {
      const user = await requireUser(),
        alert = db
          .prepare("SELECT user_id FROM alerts WHERE id=?")
          .get(path[1]) as { user_id: string } | undefined;
      if (!alert) throw new Error("Không tìm thấy cảnh báo.");
      if (path[2] === "report") {
        if (alert.user_id !== user.id) throw new Error("FORBIDDEN");
        const input = z
          .object({ report: z.string().trim().min(5).max(2000) })
          .parse(await body(req));
        db.prepare("UPDATE alerts SET report=?,reported_at=? WHERE id=?").run(
          input.report,
          Date.now(),
          path[1],
        );
      } else if (path[2] === "ack") {
        if (user.role !== "admin") throw new Error("FORBIDDEN");
        db.prepare("UPDATE alerts SET acknowledged_at=? WHERE id=?").run(
          Date.now(),
          path[1],
        );
      } else
        return NextResponse.json(
          { error: "Không tìm thấy chức năng." },
          { status: 404 },
        );
    } else
      return NextResponse.json(
        { error: "Không tìm thấy chức năng." },
        { status: 404 },
      );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Yêu cầu không hợp lệ.";
    const status =
      message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "Vui lòng đăng nhập lại."
            : status === 403
              ? "Bạn không có quyền thực hiện."
              : error instanceof z.ZodError
                ? "Dữ liệu không hợp lệ. Kiểm tra thông tin và độ dài mật khẩu (ít nhất 12 ký tự)."
                : error instanceof SyntaxError
                  ? "JSON không hợp lệ."
                  : message,
      },
      { status },
    );
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH };
