export type SessionPolicy = { idleMs: number; absoluteMs: number; activityMs: number; marginMs: number; warningMs: number };
export function sessionPolicy(env: Record<string, string | undefined> = process.env): SessionPolicy {
  const number = (key: string, fallback: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isFinite(value) || value <= 0 || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    idleMs: number('WSS_SESSION_IDLE_MINUTES', 120, 1440) * 60_000,
    absoluteMs: number('WSS_SESSION_ABSOLUTE_HOURS', 12, 168) * 3_600_000,
    activityMs: number('WSS_SESSION_ACTIVITY_SECONDS', 60, 600) * 1000,
    marginMs: number('WSS_SESSION_REFRESH_MARGIN_SECONDS', 120, 600) * 1000,
    warningMs: number('WSS_SESSION_WARNING_MINUTES', 5, 60) * 60_000,
  };
}
export type SessionAccount = {
  subject: string; email: string; signedInAt: number; lastActivityAt: number;
  idleExpiresAt: number; absoluteExpiresAt: number;
  providerExpiresAt: number; providerIssuedAt: number; refreshToken?: string;
  refreshRetryAt?: number; reauthenticationRequired?: boolean;
};
export function eligible(account: SessionAccount | undefined, now: number) {
  return !!account?.subject && Number.isFinite(account.signedInAt) &&
    account.idleExpiresAt > now && account.absoluteExpiresAt > now && !account.reauthenticationRequired;
}
export function refreshDue(account: SessionAccount, now: number, policy: SessionPolicy) {
  const margin = Math.min(policy.marginMs, Math.max(1, (account.providerExpiresAt - account.providerIssuedAt) / 4));
  return now >= account.providerExpiresAt - margin && now >= (account.refreshRetryAt || 0);
}
export function qualifyActivity(account: SessionAccount, now: number, policy: SessionPolicy) {
  if (!eligible(account, now)) return false;
  account.lastActivityAt = now;
  account.idleExpiresAt = Math.min(now + policy.idleMs, account.absoluteExpiresAt);
  return true;
}
