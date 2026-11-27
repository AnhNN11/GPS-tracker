import type { Person } from "./types";

export function mapPresence(person: Person, now: number, staleMinutes: number) {
  if (!person.enabled)
    return { label: "Tài khoản đã khóa · vị trí cuối", color: "#64748b" };
  if (!person.tracking)
    return { label: "Đã dừng chia sẻ · vị trí cuối", color: "#64748b" };
  if (
    person.reading &&
    (person.status === "stale" ||
      now - person.reading.capturedAt > staleMinutes * 60000)
  )
    return { label: "Mất cập nhật · vị trí cuối", color: "#985500" };
  const statuses: Record<string, { label: string; color: string }> = {
    inside: { label: "Trong khuôn viên", color: "#087443" },
    outside: { label: "Ngoài khuôn viên", color: "#c32626" },
    pending: { label: "Ngoài vùng · chờ xác nhận", color: "#985500" },
    uncertain: { label: "GPS chưa rõ", color: "#64748b" },
  };
  return statuses[person.status] ?? { label: "Chưa xác định", color: "#64748b" };
}
