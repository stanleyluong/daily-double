// Best-effort in-memory rate limiter. State is per server instance, so this
// is a speed bump against casual abuse, not a hard guarantee — acceptable for
// a low-stakes game where the expensive call (board generation) is cached.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
