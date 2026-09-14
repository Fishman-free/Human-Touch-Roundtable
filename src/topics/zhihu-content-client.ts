export interface ZhihuHotItem { title: string; url: string; summary: string; thumbnailUrl: string }
export interface ZhihuSearchItem {
  title: string;
  contentType: string;
  contentId: string;
  contentText: string;
  url: string;
  voteUpCount: number;
  commentCount: number;
  comments: string[];
  rankingScore: number;
}
export interface ZhihuRecommendedQuestion { title: string; url: string }
// ContentToken is deliberately not modelled: nothing consumes it, and requiring
// a field we ignore would turn unrelated upstream drift into a hard failure.
export interface ZhihuQuestionAnswer { contentType: string; url: string; summary: string }
export interface ZhihuAnswerPage { items: ZhihuQuestionAnswer[]; isEnd: boolean; nextOffset?: number }

type Value = Record<string, unknown>;
function object(value: unknown): value is Value { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { if (typeof value !== "string") throw new Error("INVALID_ZHIHU_RESPONSE"); return value; }
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("INVALID_ZHIHU_RESPONSE");
  return value;
}

export class ZhihuContentClient {
  private secret: string;
  private fetch: typeof globalThis.fetch;
  private baseUrl: string;
  private minRequestIntervalMs: number;
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(config: { accessSecret: string; fetch?: typeof globalThis.fetch; baseUrl?: string; minRequestIntervalMs?: number }) {
    if (!config.accessSecret) throw new Error("ZHIHU_ACCESS_SECRET_REQUIRED");
    const url = new URL(config.baseUrl ?? "https://developer.zhihu.com/api/v1/content/");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) {
      throw new Error("INVALID_ZHIHU_BASE_URL");
    }
    this.secret = config.accessSecret;
    this.fetch = config.fetch ?? globalThis.fetch;
    this.baseUrl = url.toString();
    this.minRequestIntervalMs = config.minRequestIntervalMs ?? 1_000;
    if (!Number.isSafeInteger(this.minRequestIntervalMs) || this.minRequestIntervalMs < 0) throw new Error("INVALID_ZHIHU_REQUEST_INTERVAL");
  }

  async hot(limit: number, signal: AbortSignal): Promise<ZhihuHotItem[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("INVALID_ZHIHU_LIMIT");
    const data = await this.request("hot_list", { Limit: String(limit) }, signal);
    if (!Array.isArray(data.Items)) throw new Error("INVALID_ZHIHU_RESPONSE");
    return data.Items.map(value => {
      if (!object(value)) throw new Error("INVALID_ZHIHU_RESPONSE");
      return { title: text(value.Title), url: text(value.Url), summary: text(value.Summary), thumbnailUrl: text(value.ThumbnailUrl) };
    });
  }

  async search(query: string, count: number, signal: AbortSignal): Promise<ZhihuSearchItem[]> {
    const clean = query.trim();
    if (!clean || clean.length > 500 || !Number.isInteger(count) || count < 1 || count > 10) throw new Error("INVALID_ZHIHU_SEARCH");
    const data = await this.request("zhihu_search", { Query: clean, Count: String(count) }, signal);
    if (!Array.isArray(data.Items)) throw new Error("INVALID_ZHIHU_RESPONSE");
    return data.Items.map(value => {
      if (!object(value) || (value.CommentInfoList !== undefined && !Array.isArray(value.CommentInfoList))) throw new Error("INVALID_ZHIHU_RESPONSE");
      return {
        title: text(value.Title), contentType: text(value.ContentType), contentId: text(value.ContentID),
        contentText: text(value.ContentText), url: text(value.Url), voteUpCount: number(value.VoteUpCount),
        commentCount: number(value.CommentCount), rankingScore: number(value.RankingScore),
        comments: (value.CommentInfoList ?? []).map(comment => {
          if (!object(comment)) throw new Error("INVALID_ZHIHU_RESPONSE");
          return text(comment.Content);
        }),
      };
    });
  }

  // Paths below are origin-absolute on purpose: the content base path would
  // otherwise resolve "/api/v1/user/..." to "/api/v1/content/user/...".
  // An absent query uses the account profile; a provided one scopes the results
  // to a topic. The platform rejects a blank query with its own 10001, so a
  // whitespace-only value is refused here instead of spending a request on it.
  async recommendQuestions(query: string | undefined, count: number, signal: AbortSignal): Promise<ZhihuRecommendedQuestion[]> {
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("INVALID_ZHIHU_LIMIT");
    const clean = query?.trim();
    if (clean !== undefined && (!clean || clean.length > 100)) throw new Error("INVALID_ZHIHU_QUERY");
    const data = await this.request("/api/v1/user/question_recommendations",
      clean ? { Query: clean, Count: String(count) } : { Count: String(count) }, signal);
    if (!Array.isArray(data.Items)) throw new Error("INVALID_ZHIHU_RESPONSE");
    return data.Items.map(value => {
      if (!object(value)) throw new Error("INVALID_ZHIHU_RESPONSE");
      return { title: text(value.Title), url: text(value.Url) };
    });
  }

  // One page only. Every page spends one question_answers unit and a single
  // roundtable topic needs one page, so NextOffset is reported but never followed.
  async questionAnswers(questionUrl: string, limit: number, signal: AbortSignal): Promise<ZhihuAnswerPage> {
    if (!/^https:\/\/www\.zhihu\.com\/question\/\d+\/?$/.test(questionUrl) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("INVALID_ZHIHU_QUESTION_QUERY");
    const data = await this.request("/api/v1/content/question_answers",
      { QuestionUrl: questionUrl, Offset: "0", Limit: String(limit) }, signal);
    if (!Array.isArray(data.Items)) throw new Error("INVALID_ZHIHU_RESPONSE");
    // Paging is tolerated as absent: we never paginate, so shape drift there must
    // not fail the feature. The fields we do read stay strict.
    const paging = object(data.Paging) ? data.Paging : undefined;
    const nextOffset = paging && typeof paging.NextOffset === "number" ? paging.NextOffset : undefined;
    return {
      items: data.Items.map(value => {
        if (!object(value)) throw new Error("INVALID_ZHIHU_RESPONSE");
        return { contentType: text(value.ContentType), url: text(value.Url), summary: text(value.Summary) };
      }),
      isEnd: paging?.IsEnd === true,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    };
  }

  private async request(path: string, query: Record<string, string>, signal: AbortSignal): Promise<Value> {
    const job = this.queue.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - Date.now());
      if (delay) await new Promise<void>((resolve, reject) => {
        const handle = setTimeout(resolve, delay);
        signal.addEventListener("abort", () => { clearTimeout(handle); reject(new Error("ABORTED")); }, { once: true });
      });
      if (signal.aborted) throw new Error("ABORTED");
      this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
      return this.requestNow(path, query, signal);
    });
    this.queue = job.then(() => {}, () => {});
    return job;
  }

  private async requestNow(path: string, query: Record<string, string>, signal: AbortSignal): Promise<Value> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await this.fetch(url, { signal, headers: {
      "authorization": `Bearer ${this.secret}`, "x-request-timestamp": String(Math.floor(Date.now() / 1_000)),
      "accept": "application/json", "content-type": "application/json",
    } });
    if (!response.ok) throw new Error(`ZHIHU_HTTP_${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 2 * 1024 * 1024) throw new Error("ZHIHU_RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error("ZHIHU_RESPONSE_TOO_LARGE");
    let envelope: unknown;
    try { envelope = JSON.parse(body); } catch { throw new Error("INVALID_ZHIHU_RESPONSE"); }
    if (!object(envelope) || envelope.Code !== 0 || envelope.Message !== "success" || !object(envelope.Data)) {
      const code = object(envelope) && typeof envelope.Code === "number" ? envelope.Code : "INVALID";
      throw new Error(`ZHIHU_API_${code}`);
    }
    return envelope.Data;
  }
}

export function questionIdFromUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "www.zhihu.com") return null;
  return /^\/question\/(\d+)(?:\/answer\/[^/]+)?\/?$/.exec(url.pathname)?.[1] ?? null;
}
