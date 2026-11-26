import type { Campus } from "./store";
import type { Reading } from "./geo";
export type Person = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  enabled: boolean;
  tracking: boolean;
  trackingStarted: number | null;
  reading: Reading | null;
  status: string;
  lastReceivedAt?: number | null;
};
export type CampusAlert = {
  id: string;
  user_id: string;
  user_name: string;
  type: "outside" | "stale";
  created_at: number;
  resolved_at: number | null;
  acknowledged_at: number | null;
  report: string | null;
  reported_at: number | null;
};
export type State = {
  campus: Campus;
  users: Person[];
  me: Person;
  alerts: CampusAlert[];
  monitor?: { lastRunAt: number | null };
  serverTime: number;
};
