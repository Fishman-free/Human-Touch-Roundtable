const key = process.env.GLM_API_KEY;
const endpoint = process.env.GLM_ENDPOINT;
const model = process.env.GLM_MODEL;
if (!key || !endpoint || !model) throw new Error("GLM_API_KEY_ENDPOINT_MODEL_REQUIRED");
const response = await fetch(endpoint, { method: "POST", headers: {
  authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json",
}, body: JSON.stringify({ model, messages: [{ role: "user", content: "只输出JSON：{\"ok\":true}" }],
  temperature: 0, max_tokens: 40, response_format: { type: "json_object" } }) });
const body = await response.text();
let value: unknown;
try { value = JSON.parse(body); } catch { value = { nonJsonBodyLength: body.length }; }
function shape(input: unknown, depth = 0): unknown {
  if (depth > 5) return "truncated";
  if (typeof input === "string") return { type: "string", length: input.length };
  if (typeof input === "number" || typeof input === "boolean" || input === null) return { type: typeof input };
  if (Array.isArray(input)) return { type: "array", length: input.length, first: input.length ? shape(input[0], depth + 1) : undefined };
  if (typeof input === "object") return Object.fromEntries(Object.entries(input as Record<string, unknown>)
    .slice(0, 50).map(([name, item]) => [name, shape(item, depth + 1)]));
  return { type: typeof input };
}
process.stdout.write(`${JSON.stringify({ httpStatus: response.status, shape: shape(value) })}\n`);
