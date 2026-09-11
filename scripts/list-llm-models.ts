const key = process.env.GLM_API_KEY;
const endpoint = process.env.GLM_ENDPOINT;
if (!key || !endpoint) throw new Error("GLM_API_KEY_AND_ENDPOINT_REQUIRED");
const chat = new URL(endpoint);
if (chat.protocol !== "https:" || !chat.pathname.endsWith("/chat/completions")) throw new Error("INVALID_GLM_ENDPOINT");
chat.pathname = chat.pathname.slice(0, -"chat/completions".length) + "models";
const response = await fetch(chat, { headers: { authorization: `Bearer ${key}`, accept: "application/json" } });
if (!response.ok) throw new Error(`LLM_MODELS_HTTP_${response.status}`);
const text = await response.text();
if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error("LLM_MODELS_RESPONSE_TOO_LARGE");
let body: unknown;
try { body = JSON.parse(text); } catch { throw new Error("INVALID_LLM_MODELS_RESPONSE"); }
const data = (body as { data?: unknown }).data;
if (!Array.isArray(data)) throw new Error("INVALID_LLM_MODELS_RESPONSE");
const models = data.flatMap(value => typeof (value as { id?: unknown })?.id === "string" ? [(value as { id: string }).id] : []);
process.stdout.write(`${JSON.stringify({ count: models.length, models })}\n`);
