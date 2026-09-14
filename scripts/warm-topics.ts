// Resolves every configured candidate once so the first real game does not pay
// the cold fetch + generation cost. Must run with the same
// ZHIHU_TOPIC_CACHE_PATH as the app, since it writes the cache the app reads.
// Prints status and lengths only, never content or credentials.
//
//   docker compose exec -T app node scripts/warm-topics.ts

import { openTopicProvider } from "../src/topics/config.ts";
import { createLlmProviders } from "../src/ai/config.ts";
import { charCount } from "../src/contracts/rules.ts";

const environment = process.env;

// Without a model every topic would silently take the deterministic fallback and
// the cache would then serve that text for the whole TTL, so refuse to warm.
const llm = createLlmProviders(environment, false);
if (!llm.length) throw new Error("NO_LLM_PROVIDERS: warming now would cache fallback content");
if (!environment.ZHIHU_TOPIC_CACHE_PATH) throw new Error("ZHIHU_TOPIC_CACHE_PATH_REQUIRED");

// Fallback events are surfaced, not swallowed: a silent fallback rate is how a
// too-tight generation budget goes unnoticed while the run still reports success.
const provider = await openTopicProvider(environment, false, {
  llm, onAlert: event => process.stdout.write(`${JSON.stringify(event)}\n`),
});
process.stdout.write(`${JSON.stringify({ event: "warm.start", candidates: provider.candidateIds.length,
  models: llm.map(item => `${item.id}:${item.model}`) })}\n`);

let failed = 0;
for (const candidateId of provider.candidateIds) {
  try {
    const topic = await provider.resolve(candidateId, new AbortController().signal);
    process.stdout.write(`${JSON.stringify({ status: "ready", candidateId, questionId: topic.id,
      titleLength: charCount(topic.title), excerptLength: charCount(topic.topAnswerExcerpt),
      summaryLength: charCount(topic.topConsensusSummary), selectedAnswer: Boolean(topic.provenance?.selectedAnswerUrl) })}\n`);
  } catch (error) {
    failed++;
    process.stdout.write(`${JSON.stringify({ status: "failed", candidateId,
      reason: error instanceof Error ? error.message : "UNKNOWN" })}\n`);
  }
}

process.stdout.write(`${JSON.stringify({ event: "warm.done", candidates: provider.candidateIds.length, failed })}\n`);
if (failed) process.exitCode = 1;
