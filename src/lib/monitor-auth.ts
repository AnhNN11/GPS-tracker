import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash, timingSafeEqual } from "node:crypto";
export const monitorAudience = "campus-guard-monitor";
const issuer = "https://token.actions.githubusercontent.com";
const jwks = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"));
export function trustedWorkflow(
  payload: JWTPayload,
  repository = process.env.MONITOR_GITHUB_REPOSITORY || "AnhNN11/GPS-tracker",
) {
  const defaultRepo = repository === "AnhNN11/GPS-tracker";
  const repositoryId =
    process.env.MONITOR_GITHUB_REPOSITORY_ID ||
    (defaultRepo ? "1462212250" : "");
  const ownerId =
    process.env.MONITOR_GITHUB_OWNER_ID || (defaultRepo ? "110618502" : "");
  if (!repositoryId || !ownerId) return false;
  const [owner, name] = repository.split("/");
  const subjects = [
    `repo:${repository}:ref:refs/heads/main`,
    `repo:${owner}@${ownerId}/${name}@${repositoryId}:ref:refs/heads/main`,
  ];
  return (
    payload.repository === repository &&
    payload.repository_id === repositoryId &&
    payload.repository_owner_id === ownerId &&
    payload.ref === "refs/heads/main" &&
    payload.workflow_ref ===
      repository + "/.github/workflows/gps-monitor.yml@refs/heads/main" &&
    ["schedule", "workflow_dispatch", "push"].includes(
      String(payload.event_name),
    ) &&
    subjects.includes(String(payload.sub))
  );
}
export async function authorizeMonitor(header: string | null) {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (token.length > 16000) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && secret.length >= 32) {
    const hash = (s: string) => createHash("sha256").update(s).digest();
    if (timingSafeEqual(hash(token), hash(secret))) return true;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: monitorAudience,
      algorithms: ["RS256"],
      maxTokenAge: "10m",
      clockTolerance: 5,
    });
    return trustedWorkflow(payload);
  } catch {
    return false;
  }
}
