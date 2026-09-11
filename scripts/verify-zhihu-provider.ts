import { createTopicProvider } from "../src/topics/config.ts";
import { charCount } from "../src/contracts/rules.ts";

const provider = createTopicProvider(process.env, false);
const candidateId = process.argv[2] ?? provider.candidateIds[0];
if (!candidateId || !provider.candidateIds.includes(candidateId)) throw new Error("UNKNOWN_TOPIC_CANDIDATE");
const topic = await provider.resolve(candidateId, new AbortController().signal);
process.stdout.write(`${JSON.stringify({
  packId: topic.provenance?.packId,
  questionId: topic.id,
  selectedAnswerUrl: topic.provenance?.selectedAnswerUrl,
  selectedVoteUpCount: topic.provenance?.selectedVoteUpCount,
  excerptLength: charCount(topic.topAnswerExcerpt),
  verifiedAt: topic.provenance?.verifiedAt,
})}\n`);
