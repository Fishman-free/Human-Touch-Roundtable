import { createHash, randomBytes } from "node:crypto";

export interface OAuthConfig { appId: string; appKey: string; redirectUri: string; origin: string }
export interface LoginIdentity { id: string; name: string; expiresAt: number }
const nonce = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function oauthConfig(env: Record<string, string | undefined>): OAuthConfig | undefined {
  const appId = env.ZHIHU_OAUTH_APP_ID?.trim();
  const appKey = env.ZHIHU_OAUTH_APP_KEY?.trim();
  // Incomplete credentials keep the optional login feature disabled.
  if (!appId || !appKey) return undefined;
  const redirectUri = env.ZHIHU_OAUTH_REDIRECT_URI ?? "https://airoundtable.stream/api/auth/zhihu/callback";
  const url = new URL(redirectUri);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/api/auth/zhihu/callback") throw new Error("INVALID_OAUTH_REDIRECT_URI");
  return { appId, appKey, redirectUri, origin: url.origin };
}

/** Single-process login sessions. Provider tokens are discarded after fetching the profile. */
export class ZhihuOAuth {
  private states = new Map<string, { browser: string; expiresAt: number }>();
  private sessions = new Map<string, LoginIdentity>();
  private now: () => number;
  private fetcher: typeof fetch;
  readonly config: OAuthConfig | undefined;

  constructor(config: OAuthConfig | undefined, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
    this.config = config; this.fetcher = fetcher; this.now = now;
  }

  start(previousBrowser?: string) {
    if (!this.config) throw new Error("LOGIN_UNAVAILABLE");
    this.prune();
    if (previousBrowser) {
      const browserHash = digest(previousBrowser);
      for (const [key, state] of this.states) if (state.browser === browserHash) this.states.delete(key);
    }
    if (this.states.size >= 1_000) throw new Error("LOGIN_BUSY");
    const state = nonce(); const browser = nonce();
    this.states.set(digest(state), { browser: digest(browser), expiresAt: this.now() + 5 * 60_000 });
    const url = new URL("https://openapi.zhihu.com/authorize");
    url.search = new URLSearchParams({ app_id: this.config.appId, redirect_uri: this.config.redirectUri,
      response_type: "code", state }).toString();
    return { browser, url: url.toString() };
  }

  async finish(state: string, browser: string, code: string): Promise<string> {
    if (!this.config) throw new Error("LOGIN_UNAVAILABLE");
    this.prune();
    const key = digest(state); const pending = this.states.get(key);
    if (!pending || pending.browser !== digest(browser) || !code || code.length > 4_096) {
      throw new Error("INVALID_OAUTH_STATE");
    }
    // Consume synchronously before any network operation; concurrent replay cannot exchange twice.
    this.states.delete(key);
    if (this.sessions.size >= 10_000) throw new Error("LOGIN_BUSY");
    const tokenBody = await this.json("https://openapi.zhihu.com/access_token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ app_id: this.config.appId, app_key: this.config.appKey,
        redirect_uri: this.config.redirectUri, grant_type: "authorization_code", code }),
    });
    const token = typeof tokenBody.access_token === "string" ? tokenBody : record(tokenBody.data);
    if (typeof token.access_token !== "string" || !token.access_token ||
      typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
      throw new Error("OAUTH_PROVIDER_FAILED");
    }
    const profileBody = await this.json("https://openapi.zhihu.com/user", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const profile = typeof profileBody.hash_id === "string" ? profileBody : record(profileBody.data);
    // hash_id is the documented stable string ID. Never round int64 uid through a JS number.
    if (typeof profile.hash_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(profile.hash_id)) {
      throw new Error("OAUTH_PROFILE_INVALID");
    }
    const session = nonce();
    this.sessions.set(digest(session), {
      id: digest(`zhihu:${profile.hash_id}`),
      name: typeof profile.fullname === "string" ? profile.fullname.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 80) : "知乎用户",
      expiresAt: this.now() + Math.min(token.expires_in * 1_000, 24 * 60 * 60_000),
    });
    return session;
  }

  identify(session: string | undefined): LoginIdentity | undefined {
    this.prune();
    return session ? this.sessions.get(digest(session)) : undefined;
  }
  logout(session: string | undefined) { if (session) this.sessions.delete(digest(session)); }
  clear() { this.states.clear(); this.sessions.clear(); }

  private prune() {
    const now = this.now();
    for (const [key, state] of this.states) if (state.expiresAt <= now) this.states.delete(key);
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
  }
  private async json(url: string, options: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body) throw new Error("OAUTH_PROVIDER_FAILED");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > 64 * 1_024) throw new Error("OAUTH_RESPONSE_TOO_LARGE");
        chunks.push(part.value);
      }
      return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } finally { await reader.cancel().catch(() => {}); }
  }
}
