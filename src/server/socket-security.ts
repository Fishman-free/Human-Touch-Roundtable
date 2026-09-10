import { isIP } from "node:net";
import type { ServerOptions } from "socket.io";

export function parseOrigins(value: string): string[] {
  const origins = value.split(",").map(item => item.trim()).filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("INVALID_ALLOWED_ORIGIN"); }
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) throw new Error("INVALID_ALLOWED_ORIGIN");
  }
  return [...new Set(origins)];
}

export function originAllowed(origin: string | undefined, allowed: readonly string[], allowMissing: boolean): boolean {
  return origin === undefined ? allowMissing : allowed.includes(origin);
}

export function socketTransportOptions(allowed: readonly string[], allowMissingOrigin: boolean): Partial<ServerOptions> {
  if (!allowed.length && !allowMissingOrigin) throw new Error("ALLOWED_ORIGINS_REQUIRED");
  return {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    allowRequest(request, callback) {
      const header = request.headers.origin;
      callback(null, originAllowed(Array.isArray(header) ? header[0] : header, allowed, allowMissingOrigin));
    },
  };
}

function normalize(address: string): string {
  const value = address.startsWith("::ffff:") ? address.slice(7) : address;
  return isIP(value) ? value : "unknown";
}

export function resolveClientIp(remoteAddress: string, forwardedFor: string | string[] | undefined, trustedProxyHops: number): string {
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) throw new Error("INVALID_TRUST_PROXY_HOPS");
  const remote = normalize(remoteAddress);
  if (trustedProxyHops === 0) return remote;
  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor ?? "")
    .split(",").map(item => normalize(item.trim())).filter(item => item !== "unknown");
  const chain = [...forwarded, remote];
  const index = chain.length - 1 - trustedProxyHops;
  return index >= 0 ? chain[index] : remote;
}
