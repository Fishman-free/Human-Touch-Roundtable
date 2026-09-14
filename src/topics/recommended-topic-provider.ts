// Turns a platform-recommended Zhihu question into a playable Topic. The
// question and its answers are real platform data; only topConsensusSummary and
// defaults are machine-generated, and those fall back to deterministic text so a
// model outage can never stall a room.

import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";
import { charCount } from "../contracts/rules.ts";
import { checkHumanContent } from "../safety/content-policy.ts";
import { questionIdFromUrl, ZhihuContentClient, type ZhihuQuestionAnswer } from "./zhihu-content-client.ts";
import { excerpt } from "./zhihu-text.ts";
import { canonicalQuestionUrl, CANDIDATE_TITLE_LIMIT, type RecommendedCandidate, type RecommendedSeed } from "./recommended-seed.ts";
import { fallbackTopicContent, normalizeTopicContent, type TopicContent, type TopicContentGenerator } from "./topic-content-generator.ts";

export const ANSWER_EXCERPT_LIMIT = 200;

export function candidateIdFor(questionId: string): string {
  return `zhihu-q${questionId}`;
}

function answerUrlFor(value: string, questionId: string): string | undefined {
  if (questionIdFromUrl(value) !== questionId) return undefined;
  try {
    const { pathname } = new URL(value);
    return /^\/question\/\d+\/answer\/[^/?#]+$/.test(pathname) ? `https://www.zhihu.com${pathname}` : undefined;
  } catch {
    return undefined;
  }
}

export interface RecommendedTopicProviderDependencies {
  client: ZhihuContentClient;
  content: TopicContentGenerator;
  answerLimit?: number;
  fallback?: "static" | "fail";
  now?: () => Date;
  onEvent?: (event: Record<string, unknown>) => void;
}

export class RecommendedTopicProvider implements TopicProvider {
  readonly candidateIds: readonly string[];
  private candidates: Map<string, RecommendedCandidate>;
  private curatedAt: string;
  private client: ZhihuContentClient;
  private content: TopicContentGenerator;
  private answerLimit: number;
  private fallback: "static" | "fail";
  private now: () => Date;
  private onEvent?: (event: Record<string, unknown>) => void;

  constructor(seed: RecommendedSeed, deps: RecommendedTopicProviderDependencies) {
    this.candidates = new Map(seed.candidates.map(candidate => [candidateIdFor(candidate.questionId), candidate]));
    // An empty dynamic half is legitimate at boot (no seed, fetch failed) but it
    // must not be handed to the union, which would then have nothing to merge.
    if (!this.candidates.size) throw new Error("INVALID_RECOMMENDED_SEED");
    this.candidateIds = [...this.candidates.keys()];
    this.curatedAt = seed.fetchedAt;
    this.client = deps.client;
    this.content = deps.content;
    this.answerLimit = deps.answerLimit ?? 20;
    this.fallback = deps.fallback ?? "static";
    this.now = deps.now ?? (() => new Date());
    this.onEvent = deps.onEvent;
    if (!Number.isInteger(this.answerLimit) || this.answerLimit < 1 || this.answerLimit > 50) {
      throw new Error("INVALID_ZHIHU_QUESTION_QUERY");
    }
  }

  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    if (signal.aborted) throw new Error("ABORTED");
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error("TOPIC_NOT_FOUND");
    const { questionId } = candidate;
    const title = this.screenTitle(candidate.title);

    // One question_answers unit per cold resolve; wrapped by PersistentTopicCache
    // so this runs once per candidate per TTL rather than once per game.
    const page = await this.client.questionAnswers(candidate.url, this.answerLimit, signal);
    const selected = this.selectAnswer(page.items, questionId);

    let generated: TopicContent;
    try {
      // The generator port is injectable, so its output is normalized rather than
      // trusted: off-spec content falls back here instead of being persisted by
      // the topic cache as a topic the core would reject.
      generated = normalizeTopicContent(await this.content.generate({ title, topAnswerExcerpt: selected.text }, signal));
      this.emit({ event: "topic.generated.ok", candidateId });
    } catch (error) {
      if (signal.aborted) throw new Error("ABORTED");
      // "fail" is the escape hatch for operators who would rather advance to the
      // next candidate than show machine-written fallback text.
      if (this.fallback === "fail") throw new Error("TOPIC_CONTENT_UNAVAILABLE");
      this.emit({ event: "topic.generated.fallback", candidateId,
        reason: error instanceof Error ? error.message : "UNKNOWN" });
      generated = normalizeTopicContent(fallbackTopicContent({ title, topAnswerExcerpt: selected.text }));
    }

    return {
      id: questionId,
      title,
      // Rebuilt from the parsed id rather than the API string: drops tracking
      // parameters and satisfies validateTopic's URL pattern by construction.
      url: canonicalQuestionUrl(questionId),
      topAnswerExcerpt: selected.text,
      topConsensusSummary: generated.topConsensusSummary,
      defaults: generated.defaults,
      provenance: {
        packId: candidateId,
        source: "zhihu",
        curatedAt: this.curatedAt,
        verifiedAt: this.now().toISOString(),
        // selectedVoteUpCount is deliberately absent: this endpoint returns no
        // vote count, and inventing one would misreport the platform's data.
        ...(selected.answerUrl ? { selectedAnswerUrl: selected.answerUrl } : {}),
      },
    };
  }

  private screenTitle(value: string): string {
    const decision = checkHumanContent(value);
    if (!decision.ok || !decision.text || charCount(decision.text) > CANDIDATE_TITLE_LIMIT) {
      throw new Error("UNSAFE_ZHIHU_TITLE");
    }
    return decision.text;
  }

  // Takes the first safe answer in the order the platform returned it. Unlike
  // ZhihuSearchQuestionGateway we have no VoteUpCount here, so no ordering claim
  // is made and the excerpt must not be described as the highest-voted answer.
  private selectAnswer(items: readonly ZhihuQuestionAnswer[], questionId: string): { text: string; answerUrl?: string } {
    for (const item of items) {
      if (item.contentType.toLowerCase() !== "answer") continue;
      const decision = checkHumanContent(excerpt(item.summary, ANSWER_EXCERPT_LIMIT));
      if (!decision.ok || !decision.text || charCount(decision.text) > ANSWER_EXCERPT_LIMIT) continue;
      const answerUrl = answerUrlFor(item.url, questionId);
      return answerUrl ? { text: decision.text, answerUrl } : { text: decision.text };
    }
    throw new Error("UNSAFE_ZHIHU_ANSWER");
  }

  private emit(event: Record<string, unknown>) {
    try { this.onEvent?.(event); } catch { /* Observability cannot alter gameplay. */ }
  }
}
