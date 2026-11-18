// Never trust an arbitrary Host or X-Forwarded-Host header as a CSRF allowlist.
export function validOrigin(
  origin: string | null,
  configured = process.env.APP_ORIGIN,
) {
  if (!origin) return false;
  const allowed = (
    configured ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.some((value) => {
    try {
      const expected = new URL(value);
      return (
        (expected.protocol === "https:" || expected.protocol === "http:") &&
        expected.origin === value &&
        origin === expected.origin
      );
    } catch {
      return false;
    }
  });
}
