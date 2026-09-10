export interface RateLimitRule { limit: number; windowMs: number }

export class FixedWindowRateLimiter {
  private buckets = new Map<string, { startedAt: number; count: number; windowMs: number }>();
  private now: () => number;
  private maxBuckets: number;

  constructor(now: () => number = Date.now, maxBuckets = 10_000) {
    this.now = now;
    this.maxBuckets = maxBuckets;
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets <= 0) throw new Error("INVALID_RATE_LIMIT_CAPACITY");
  }

  allow(scope: string, key: string, rule: RateLimitRule): boolean {
    if (!scope || !key || !Number.isSafeInteger(rule.limit) || rule.limit <= 0 ||
      !Number.isSafeInteger(rule.windowMs) || rule.windowMs <= 0) throw new Error("INVALID_RATE_LIMIT");
    const id = `${scope}\0${key}`;
    const now = this.now();
    const bucket = this.buckets.get(id);
    if (!bucket || now - bucket.startedAt >= rule.windowMs || now < bucket.startedAt) {
      if (!bucket && this.buckets.size >= this.maxBuckets) {
        for (const [bucketId, value] of this.buckets) {
          if (now < value.startedAt || now - value.startedAt >= value.windowMs) this.buckets.delete(bucketId);
        }
        if (this.buckets.size >= this.maxBuckets) return false;
      }
      this.buckets.set(id, { startedAt: now, count: 1, windowMs: rule.windowMs });
      return true;
    }
    if (bucket.count >= rule.limit) return false;
    bucket.count++;
    return true;
  }
}

export class ConnectionQuota {
  private counts = new Map<string, number>();
  acquire(key: string, limit: number): boolean {
    if (!key || !Number.isSafeInteger(limit) || limit <= 0) throw new Error("INVALID_CONNECTION_LIMIT");
    const count = this.counts.get(key) ?? 0;
    if (count >= limit) return false;
    this.counts.set(key, count + 1);
    return true;
  }
  release(key: string) {
    const count = this.counts.get(key) ?? 0;
    if (count <= 1) this.counts.delete(key);
    else this.counts.set(key, count - 1);
  }
}
