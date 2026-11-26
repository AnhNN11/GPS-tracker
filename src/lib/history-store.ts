import { createHash, randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { collections } from "./db";
import type { Campus, ExcursionEnd, SampleClassification } from "./models";
import { edgeDistance, type Reading, type Candidate } from "./geo";
type Collections = Awaited<ReturnType<typeof collections>>;
export const boundaryId = (campus: Campus) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        name: campus.name,
        address: campus.address,
        polygon: campus.polygon,
        policy: campus.policy,
      }),
    )
    .digest("hex");
export async function ensureBoundary(
  c: Collections,
  session: ClientSession,
  campus: Campus,
) {
  const id = boundaryId(campus);
  if (!(await c.boundaryVersions.findOne({ id }, { session })))
    await c.boundaryVersions.insertOne(
      { id, campus, createdAt: Date.now() },
      { session },
    );
  return id;
}
export async function closeExcursion(
  c: Collections,
  session: ClientSession,
  userId: string,
  endReason: ExcursionEnd,
  at = Date.now(),
  returned?: Reading,
) {
  await c.excursions.updateOne(
    { user_id: userId, active: true },
    {
      $set: {
        active: false,
        endReason,
        closedAt: at,
        returnedAt: returned?.capturedAt ?? null,
        returnReading: returned ?? null,
      },
    },
    { session },
  );
}
export async function recordHistory(
  c: Collections,
  session: ClientSession,
  input: {
    userId: string;
    trackingSession: string;
    campus: Campus;
    reading: Reading;
    classification: SampleClassification;
    status: string;
    candidate: Candidate | null;
    previous: Reading | null;
    receivedAt: number;
  },
) {
  const {
    userId,
    trackingSession,
    campus,
    reading,
    classification,
    status,
    candidate,
    previous,
    receivedAt,
  } = input;
  const campusVersion = await ensureBoundary(c, session, campus);
  if (previous && reading.capturedAt - previous.capturedAt > 130000)
    await closeExcursion(c, session, userId, "data_gap", receivedAt);
  await c.samples.insertOne(
    {
      ...reading,
      id: randomUUID(),
      user_id: userId,
      receivedAt,
      classification,
      status,
      edgeDistanceMeters:
        campus.polygon.length >= 3
          ? edgeDistance(reading, campus.polygon)
          : null,
      campusVersion,
      trackingSession,
    },
    { session },
  );
  if (classification === "inside")
    await closeExcursion(c, session, userId, "returned", receivedAt, reading);
  if (classification === "outside") {
    const existing = await c.excursions.findOne(
      { user_id: userId, active: true },
      { session },
    );
    if (existing)
      await c.excursions.updateOne(
        { id: existing.id },
        { $set: { lastOutsideAt: reading.capturedAt, lastOutside: reading } },
        { session },
      );
    else if (status === "outside")
      await c.excursions.insertOne(
        {
          id: randomUUID(),
          user_id: userId,
          trackingSession,
          campusVersion,
          active: true,
          startedAt: candidate?.since ?? reading.capturedAt,
          confirmedAt: reading.capturedAt,
          lastOutsideAt: reading.capturedAt,
          firstOutside: candidate?.firstReading ?? reading,
          lastOutside: reading,
          returnedAt: null,
          returnReading: null,
          closedAt: null,
          endReason: null,
        },
        { session },
      );
  }
}
