import type { Point, Reading, Policy, Candidate } from "./geo";
export type Campus = {
  name: string;
  address: string;
  polygon: Point[];
  policy: Policy;
  boundaryNote?: string;
};
export type UserRow = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: "admin" | "member";
  enabled: number;
  tracking: number;
  tracking_started: number | null;
  reading: Reading | null;
  status: string;
  candidate: Candidate | null;
  created_at: number;
  tracking_session?: string | null;
  reading_received_at?: number | null;
};
export type SampleClassification =
  "inside" | "outside" | "uncertain" | "unconfigured";
export type LocationSample = Reading & {
  id: string;
  user_id: string;
  receivedAt: number;
  classification: SampleClassification;
  status: string;
  edgeDistanceMeters: number | null;
  campusVersion: string;
  trackingSession: string;
};
export type BoundaryVersion = { id: string; campus: Campus; createdAt: number };
export type ExcursionEnd =
  | "returned"
  | "data_gap"
  | "sharing_stopped"
  | "account_disabled"
  | "boundary_changed";
export type Excursion = {
  id: string;
  user_id: string;
  trackingSession: string;
  campusVersion: string;
  active: boolean;
  startedAt: number;
  confirmedAt: number;
  lastOutsideAt: number;
  firstOutside: Reading;
  lastOutside: Reading;
  returnedAt: number | null;
  returnReading: Reading | null;
  closedAt: number | null;
  endReason: ExcursionEnd | null;
};
export type AlertRow = {
  id: string;
  user_id: string;
  type: "outside" | "stale";
  active: boolean;
  created_at: number;
  resolved_at: number | null;
  acknowledged_at: number | null;
  report: string | null;
  reported_at: number | null;
  pushSentAt?: number;
  pushDeliveredTo?: string[];
  pushClaimUntil?: number;
  pushClaim?: string;
};
export type RuntimeRow = {
  key: string;
  tokenHash?: string;
  expiresAt?: number;
  consumedAt?: number;
  completed?: boolean;
  touchedAt?: number;
  lastRunAt?: number;
  lastResult?: { checked: number; flagged: number; remaining: boolean };
  publicKey?: string;
  privateKey?: string;
};
export type PushDevice = {
  id: string;
  user_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
};
