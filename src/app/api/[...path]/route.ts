import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collections } from "@/lib/db";
import { MongoError, MongoServerError } from "mongodb";
import { validOrigin } from "@/lib/origin";
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
import {
  dashboard,
  saveCampus,
  acceptReading,
  setTracking,
  disableUser,
} from "@/lib/store";
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
    if (method !== "GET" && !validOrigin(req.headers.get("origin")))
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
      if (!(await loginAllowed(input.email)))
        return NextResponse.json(
          { error: "Thử sai quá nhiều. Vui lòng chờ 15 phút." },
          { status: 429 },
        );
      const user = await (
        await collections()
      ).users.findOne({ email: input.email });
      if (
        !user ||
        !user.enabled ||
        !verifyPassword(input.password, user.password)
      ) {
        await failedLogin(input.email);
        return NextResponse.json(
          { error: "Email hoặc mật khẩu không đúng." },
          { status: 401 },
        );
      }
      await (await collections()).limits.deleteOne({ key: input.email });
      await startSession(user.id);
      result = { user: publicUser(user) };
    } else if (route === "auth/logout" && method === "POST") {
      await endSession();
    } else if (route === "state" && method === "GET") {
      result = await dashboard(await requireUser());
    } else if (route === "users" && method === "POST") {
      await requireUser(true);
      const input = credentials
        .extend({
          name: z.string().trim().min(2).max(100),
          password: z.string().min(12).max(128),
        })
        .parse(await body(req));
      if (await (await collections()).users.findOne({ email: input.email }))
        throw new Error("Email đã được sử dụng.");
      result = {
        id: await createUser(input.name, input.email, input.password),
      };
    } else if (path[0] === "users" && path.length === 2 && method === "PATCH") {
      const admin = await requireUser(true),
        input = z.object({ enabled: z.boolean() }).parse(await body(req));
      const target = await (await collections()).users.findOne({ id: path[1] });
      if (!target || target.role === "admin" || target.id === admin.id)
        throw new Error("Chỉ có thể thay đổi tài khoản người dùng.");
      await disableUser(target.id, input.enabled);
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
      await saveCampus(input);
    } else if (route === "tracking" && method === "POST") {
      const user = await requireUser(),
        input = z
          .object({ enabled: z.boolean(), consent: z.boolean() })
          .parse(await body(req));
      if (input.enabled && !input.consent)
        throw new Error("Cần đồng ý chia sẻ vị trí.");
      await setTracking(user.id, input.enabled);
    } else if (route === "location" && method === "POST") {
      const user = await requireUser();
      const input = point
        .extend({
          accuracy: z.number().min(0).max(100000),
          capturedAt: z.number().int().positive(),
        })
        .parse(await body(req));
      result = { status: await acceptReading(user.id, input) };
    } else if (path[0] === "alerts" && path.length === 3 && method === "POST") {
      const user = await requireUser(),
        alert = await (await collections()).alerts.findOne({ id: path[1] });
      if (!alert) throw new Error("Không tìm thấy cảnh báo.");
      if (path[2] === "report") {
        if (alert.user_id !== user.id) throw new Error("FORBIDDEN");
        const input = z
          .object({ report: z.string().trim().min(5).max(2000) })
          .parse(await body(req));
        await (
          await collections()
        ).alerts.updateOne(
          { id: path[1] },
          { $set: { report: input.report, reported_at: Date.now() } },
        );
      } else if (path[2] === "ack") {
        if (user.role !== "admin") throw new Error("FORBIDDEN");
        await (
          await collections()
        ).alerts.updateOne(
          { id: path[1] },
          { $set: { acknowledged_at: Date.now() } },
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
    if (error instanceof MongoServerError && error.code === 11000)
      return NextResponse.json(
        { error: "Dữ liệu trùng. Hãy kiểm tra email và thử lại." },
        { status: 409 },
      );
    if (
      error instanceof MongoError ||
      (error instanceof Error && error.message === "DB_UNAVAILABLE")
    )
      return NextResponse.json(
        { error: "Không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau." },
        { status: 503 },
      );
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
