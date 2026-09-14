// Diagnostic probe for the two question endpoints behind dynamic topics.
// It prints response shapes, item counts and remaining quota only: never
// content, never credentials. Not imported by the app, not run by CI.
//
//   ZHIHU_ACCESS_SECRET="..." node scripts/probe-zhihu-question-apis.ts
//   ZHIHU_ACCESS_SECRET="..." node scripts/probe-zhihu-question-apis.ts --diff
//   ZHIHU_ACCESS_SECRET="..." node scripts/probe-zhihu-question-apis.ts --answers=https://www.zhihu.com/question/19550517

const secret = process.env.ZHIHU_ACCESS_SECRET ?? "";
if (!secret) {
  process.stderr.write("ZHIHU_ACCESS_SECRET is required\n");
  process.exit(2);
}

const args = process.argv.slice(2);
const diff = args.includes("--diff");
const answersUrl = args.find(value => value.startsWith("--answers="))?.slice("--answers=".length)
  ?? "https://www.zhihu.com/question/19550517";
const origin = "https://developer.zhihu.com";

async function call(path: string, query: Record<string, string>) {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: {
    authorization: `Bearer ${secret}`,
    "x-request-timestamp": String(Math.floor(Date.now() / 1_000)),
    accept: "application/json",
  } });
  const body = await response.text();
  try {
    const envelope = JSON.parse(body) as Record<string, unknown>;
    return { status: response.status, code: envelope.Code, message: envelope.Message, data: envelope.Data };
  } catch {
    return { status: response.status, code: "NON_JSON", message: `bytes=${body.length}` };
  }
}

// Shapes only. String values are reported as lengths so a probe run can never
// leak Zhihu content or a credential into a log.
function describe(value: unknown): unknown {
  if (typeof value === "string") return `<string:${value.length}>`;
  if (typeof value === "number" || typeof value === "boolean") return typeof value;
  if (Array.isArray(value)) return value.length ? [describe(value[0])] : "[]";
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, describe(item)]));
  }
  return String(value);
}

function itemCount(data: unknown): number | string {
  if (!data || typeof data !== "object") return "n/a";
  const items = (data as Record<string, unknown>).Items;
  return Array.isArray(items) ? items.length : "n/a";
}

const quota = await call("/api/v1/quota", { APIIDs: "creator,question_answers,zhihu_search" });
if (Array.isArray(quota.data)) {
  const rows = (quota.data as Record<string, unknown>[]).map(row =>
    `${row.APIID}=${row.TotalUsed}/${row.TotalQuota}`);
  process.stdout.write(`${JSON.stringify({ probe: "quota", status: quota.status, remaining: rows })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ probe: "quota", status: quota.status, code: quota.code, message: quota.message })}\n`);
}

if (diff) {
  // Differential check: a parameter name is confirmed only when changing its
  // value changes the item count, since unknown query params are ignored.
  // Six requests total; run --quota above first if headroom is unknown.
  for (const count of [1, 20]) {
    const result = await call("/api/v1/user/question_recommendations", { Count: String(count) });
    process.stdout.write(`${JSON.stringify({ probe: "recommendations", param: "Count", value: count,
      status: result.status, code: result.code, items: itemCount(result.data) })}\n`);
  }
  for (const limit of [1, 5]) {
    const result = await call("/api/v1/content/question_answers",
      { QuestionUrl: answersUrl, Offset: "0", Limit: String(limit) });
    process.stdout.write(`${JSON.stringify({ probe: "answers", param: "Limit", value: limit,
      status: result.status, code: result.code, items: itemCount(result.data) })}\n`);
  }
} else {
  const recommendations = await call("/api/v1/user/question_recommendations", { Count: "3" });
  process.stdout.write(`${JSON.stringify({ probe: "recommendations", status: recommendations.status,
    code: recommendations.code, message: recommendations.message, shape: describe(recommendations.data) })}\n`);

  const answers = await call("/api/v1/content/question_answers",
    { QuestionUrl: answersUrl, Offset: "0", Limit: "3" });
  process.stdout.write(`${JSON.stringify({ probe: "answers", status: answers.status,
    code: answers.code, message: answers.message, shape: describe(answers.data) })}\n`);
}
