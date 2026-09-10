export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
const secretKey = /(?:secret|token|authorization|cookie|api.?key|request.?id)/i;

function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message, "message", depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 32).map(item => sanitize(item, "", depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 64).map(([name, item]) => [name, sanitize(item, name, depth + 1)]));
  return String(value);
}

export class JsonLogger {
  private sink: (line: string) => void;
  private now: () => Date;
  constructor(sink: (line: string) => void = line => process.stderr.write(`${line}\n`), now: () => Date = () => new Date()) {
    this.sink = sink; this.now = now;
  }
  info(event: string, fields?: LogFields) { this.write("info", event, fields); }
  warn(event: string, fields?: LogFields) { this.write("warn", event, fields); }
  error(event: string, fields?: LogFields) { this.write("error", event, fields); }
  private write(level: LogLevel, event: string, fields: LogFields = {}) {
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(event)) throw new Error("INVALID_LOG_EVENT");
    this.sink(JSON.stringify({ timestamp: this.now().toISOString(), level, event, ...sanitize(fields) as object }));
  }
}
