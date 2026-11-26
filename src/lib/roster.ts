import type { Person } from "./types";
export function rosterCounts(
  people: Person[],
  now: number,
  staleMinutes: number,
) {
  const roster = people.filter((p) => p.role === "member" && p.enabled);
  const fresh = (p: Person) =>
    !!p.tracking &&
    !!p.reading &&
    now - p.reading.capturedAt <= staleMinutes * 60000;
  const inside = roster.filter((p) => fresh(p) && p.status === "inside").length;
  const outside = roster.filter(
    (p) => fresh(p) && p.status === "outside",
  ).length;
  return {
    total: roster.length,
    inside,
    outside,
    unknown: roster.length - inside - outside,
    fresh: roster.filter(fresh).length,
  };
}
