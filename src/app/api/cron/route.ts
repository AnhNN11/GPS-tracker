import { NextResponse } from "next/server";
import { authorizeMonitor } from "@/lib/monitor-auth";
import { sweep } from "@/lib/store";
import { collections } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!(await authorizeMonitor(request.headers.get("authorization"))))
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers },
    );
  try {
    const result = await sweep();
    await (
      await collections()
    ).runtime.updateOne(
      { key: "monitor" },
      { $set: { lastRunAt: Date.now(), lastResult: result } },
      { upsert: true },
    );
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Monitor temporarily unavailable" },
      { status: 503, headers },
    );
  }
}
