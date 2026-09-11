import { createTopicProvider } from "../src/topics/config.ts";
import { charCount } from "../src/contracts/rules.ts";
import { candidateTopicPacks, productionTopicPacks } from "../src/topics/static-topic-provider.ts";
import { VerifiedTopicProvider } from "../src/topics/verified-topic-provider.ts";
import { ZhihuContentClient } from "../src/topics/zhihu-content-client.ts";
import { ZhihuSearchQuestionGateway } from "../src/topics/zhihu-search-gateway.ts";

const candidates = process.argv.includes("--candidates");
const pending = process.argv.includes("--pending");
const candidateMode = process.argv.includes("--candidate");
const selectedPacks = pending
  ? candidateTopicPacks.filter(pack => !productionTopicPacks.some(production => production.packId === pack.packId))
  : candidateTopicPacks;
const provider = candidates || pending || candidateMode
  ? new VerifiedTopicProvider(selectedPacks, new ZhihuSearchQuestionGateway(new ZhihuContentClient({
      accessSecret: process.env.ZHIHU_ACCESS_SECRET ?? "",
      minRequestIntervalMs: Number(process.env.ZHIHU_MIN_REQUEST_INTERVAL_MS ?? 1_000),
    })))
  : createTopicProvider(process.env, false);
const all = process.argv.includes("--all");
const candidate = process.argv.slice(2).find(argument => !argument.startsWith("--"));
const candidateIds = all || candidates || pending ? provider.candidateIds : [candidate ?? provider.candidateIds[0]];
if (!candidateIds.length || candidateIds.some(id => !id || !provider.candidateIds.includes(id))) throw new Error("UNKNOWN_TOPIC_CANDIDATE");
let failed = false;
for (const candidateId of candidateIds) {
  try {
    const topic = await provider.resolve(candidateId!, new AbortController().signal);
    process.stdout.write(`${JSON.stringify({ status: "verified", packId: topic.provenance?.packId,
      questionId: topic.id, selectedAnswerUrl: topic.provenance?.selectedAnswerUrl,
      selectedVoteUpCount: topic.provenance?.selectedVoteUpCount,
      excerptLength: charCount(topic.topAnswerExcerpt), verifiedAt: topic.provenance?.verifiedAt })}\n`);
  } catch (error) {
    failed = true;
    process.stdout.write(`${JSON.stringify({ status: "failed", packId: candidateId,
      reason: error instanceof Error ? error.message : "UNKNOWN" })}\n`);
  }
}
if (failed) process.exitCode = 1;
