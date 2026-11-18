import type { Point, Reading, Policy, Candidate } from "./geo";
export type Campus = {
  name: string;
  address: string;
  polygon: Point[];
  policy: Policy;
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
};
