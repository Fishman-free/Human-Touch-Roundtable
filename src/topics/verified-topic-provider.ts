import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";
import { normalizeTopicPack, parseTopicPack, type TopicPackV1 } from "./topic-pack.ts";

export interface ZhihuQuestionReference { id: string; title: string; url: string }
export interface ZhihuVerifiedQuestion extends ZhihuQuestionReference {
  topAnswerExcerpt: string;
  selectedAnswerUrl: string;
  selectedVoteUpCount: number;
  comments: string[];
}
export interface ZhihuQuestionGateway {
  verify(question: ZhihuQuestionReference, signal: AbortSignal): Promise<ZhihuVerifiedQuestion>;
}

// The gateway must use an approved Zhihu capability. This provider deliberately
// does not guess an undocumented question-details endpoint or scrape HTML.
export class VerifiedTopicProvider implements TopicProvider {
  readonly candidateIds: readonly string[];
  private packs: Map<string, TopicPackV1>;
  private gateway: ZhihuQuestionGateway;
  private now: () => Date;

  constructor(packs: readonly unknown[], gateway: ZhihuQuestionGateway, now: () => Date = () => new Date()) {
    const parsed = packs.map(parseTopicPack);
    this.packs = new Map(parsed.map(pack => [pack.packId, pack]));
    if (this.packs.size !== parsed.length || parsed.length === 0) throw new Error("INVALID_TOPIC_PACK_SET");
    this.candidateIds = parsed.map(pack => pack.packId);
    this.gateway = gateway;
    this.now = now;
  }

  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    const pack = this.packs.get(candidateId);
    if (!pack) throw new Error("TOPIC_PACK_NOT_FOUND");
    const reference = await this.gateway.verify({ id: pack.question.id, title: pack.question.title, url: pack.question.url }, signal);
    if (reference.id !== pack.question.id || reference.title.trim() !== pack.question.title || reference.url !== pack.question.url) {
      throw new Error("TOPIC_REFERENCE_MISMATCH");
    }
    const topic = normalizeTopicPack(pack, this.now().toISOString());
    topic.topAnswerExcerpt = reference.topAnswerExcerpt;
    topic.provenance!.selectedAnswerUrl = reference.selectedAnswerUrl;
    topic.provenance!.selectedVoteUpCount = reference.selectedVoteUpCount;
    return topic;
  }
}
