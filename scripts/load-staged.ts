import { spawn } from "node:child_process";
import { cpus, totalmem, freemem } from "node:os";

const durationMs = Number(process.env.LOAD_DURATION_MS ?? 30 * 60 * 1_000);
const phases = [10, 40];
if (!Number.isSafeInteger(durationMs) || durationMs < 1_000) throw new Error("INVALID_LOAD_DURATION_MS");
const startedAt = new Date().toISOString();
const samples: Array<Record<string, number>> = [];
const sample = () => samples.push({ atMs: Date.now(), freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), cpus: cpus().length });
sample();
for (const clients of phases) {
  process.stdout.write(JSON.stringify({ phase: `spectator-${clients}`, clients, startedAt: new Date().toISOString() }) + "\n");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "load:smoke"], { stdio: "inherit", env: { ...process.env, LOAD_CLIENTS: String(clients) } });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`LOAD_PHASE_FAILED:${clients}:${code}`)));
  });
  sample();
}
const deadline = Date.now() + durationMs;
while (Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, Math.min(30_000, deadline - Date.now()))); sample(); }
process.stdout.write(JSON.stringify({ status: "completed", startedAt, durationMs, phases, samples, limitations: [
  "Existing load-smoke creates spectator rooms and does not simulate complete player games or real AI calls.",
  "Run this harness on the target host with external CPU, memory, file descriptor and disk monitors.",
  "Thirty-minute local production mode is not a public capacity or SLA result.",
] }) + "\n");
