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
import { validPolygon, circlePolygon } from "@/lib/geo";
import { readJourney } from "@/lib/journey";
import { setupStatus, createInitialAdmin } from "@/lib/setup";
import { pushPublicKey, savePushDevice } from "@/lib/push";
import {
  parseHistoryQuery,
  readHistory,
  excursionDetail,
  historyCsv,
} from "@/lib/history";
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
async function handleRequest(
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
    if (route === "setup/status" && method === "GET") {
      result = await setupStatus();
    } else if (route === "setup" && method === "POST") {
      const input = credentials
        .extend({
          name: z.string().trim().min(2).max(100),
          password: z.string().min(12).max(128),
          code: z.string().min(32).max(256),
        })
        .parse(await body(req));
      if (!(await loginAllowed("admin-setup")))
        return NextResponse.json(
          { error: "Thử sai quá nhiều. Vui lòng chờ 15 phút." },
          { status: 429 },
        );
      let user;
      try {
        user = await createInitialAdmin(input);
      } catch (e) {
        await failedLogin("admin-setup");
        throw e;
      }
      await startSession(user.id);
      result = { user: publicUser(user) };
    } else if (route === "push/config" && method === "GET") {
      await requireUser(true);
      result = { publicKey: await pushPublicKey() };
    } else if (route === "push/subscribe" && method === "POST") {
      const user = await requireUser(true);
      const input = z
        .object({
          endpoint: z.url().max(2048),
          keys: z.object({
            p256dh: z
              .string()
              .min(80)
              .max(200)
              .regex(/^[A-Za-z0-9_-]+={0,2}$/),
            auth: z
              .string()
              .min(16)
              .max(80)
              .regex(/^[A-Za-z0-9_-]+={0,2}$/),
          }),
        })
        .parse(await body(req));
      await savePushDevice(user.id, input);
    } else if (route === "push/unsubscribe" && method === "POST") {
      const user = await requireUser();
      const input = z
        .object({ endpoint: z.string().max(2048) })
        .parse(await body(req));
      await (
        await collections()
      ).pushDevices.deleteOne({ user_id: user.id, endpoint: input.endpoint });
    } else if (route === "auth/me" && method === "GET") {
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
    } else if (route === "history/journey" && method === "GET") {
      result = await readJourney(
        await requireUser(),
        parseHistoryQuery(req.nextUrl.searchParams),
        req.nextUrl.searchParams.get("deviceId") || undefined,
      );
    } else if (route === "history" && method === "GET") {
      const user = await requireUser(),
        query = parseHistoryQuery(req.nextUrl.searchParams),
        csv = req.nextUrl.searchParams.get("format") === "csv";
      const history = await readHistory(user, query, csv);
      if (csv)
        return new NextResponse(historyCsv(query.view, history.rows), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="gps-${query.view}-${query.from}-${query.to}.csv"`,
          },
        });
      result = history;
    } else if (
      path[0] === "history" &&
      path[1] === "events" &&
      path.length === 3 &&
      method === "GET"
    ) {
      result = await excursionDetail(await requireUser(), path[2]);
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
          polygon: z.array(point).min(3).max(100).optional(),
          circle: z
            .object({
              center: point,
              radiusMeters: z.number().min(50).max(3000),
            })
            .optional(),
          policy: z.object({
            buffer: z.number().min(0).max(100),
            maxAccuracy: z.number().min(5).max(200),
            confirmSeconds: z.number().min(10).max(300),
            staleMinutes: z.number().min(2).max(60),
          }),
        })
        .parse(await body(req));
      const polygon = input.circle
        ? circlePolygon(input.circle)
        : input.polygon;
      if (!polygon || (!input.circle && !validPolygon(polygon)))
        throw new Error(
          "Ranh giới phải có ít nhất 3 đỉnh, không tự cắt, diện tích ≥100 m² và kích thước ≤10 km.",
        );
      await saveCampus({
        ...input,
        polygon,
        boundaryNote: input.circle
          ? `Vùng tạm ${input.circle.radiusMeters} m quanh tâm đã cấu hình; chưa xác minh hàng rào trường.`
          : "Đa giác do quản trị viên thiết lập.",
      });
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
          deviceId: z.uuid().optional(),
          deviceLabel: z.string().trim().min(1).max(80).optional(),
        })
        .parse(await body(req));
      const receivedAt = Date.now();
      const { deviceId, deviceLabel, ...reading } = input;
      result = {
        status: await acceptReading(
          user.id,
          reading,
          receivedAt,
          deviceId
            ? { deviceId, deviceLabel: deviceLabel ?? "Thiết bị" }
            : undefined,
        ),
        reading,
        receivedAt,
      };
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
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const response = await handleRequest(req, ctx);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH };
