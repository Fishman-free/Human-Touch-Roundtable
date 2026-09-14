import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

// Merges several providers into one candidate list. Order matters twice over:
// candidateIds is indexed by the persisted preparation.candidateIndex modulo its
// length, so keeping the curated packs as a stable prefix means rooms that are
// mid-preparing still resolve the same topic after a mode change.
export class UnionTopicProvider implements TopicProvider {
  readonly candidateIds: readonly string[];
  private delegates: { ids: Set<string>; provider: TopicProvider }[];

  constructor(delegates: readonly TopicProvider[], order: "curated-first" | "dynamic-first" = "curated-first") {
    if (!delegates.length) throw new Error("INVALID_TOPIC_PROVIDER_SET");
    const ordered = order === "dynamic-first" ? [...delegates].reverse() : [...delegates];
    const ids = ordered.flatMap(delegate => [...delegate.candidateIds]);
    // A duplicate id would resolve two candidates to the same topic, and the
    // modulo in RoomRuntime.startTopic would alias them silently.
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error("INVALID_TOPIC_PROVIDER_SET");
    this.candidateIds = ids;
    this.delegates = ordered.map(provider => ({ ids: new Set(provider.candidateIds), provider }));
  }

  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    if (signal.aborted) throw new Error("ABORTED");
    const owner = this.delegates.find(entry => entry.ids.has(candidateId));
    if (!owner) throw new Error("TOPIC_NOT_FOUND");
    return owner.provider.resolve(candidateId, signal);
  }
}
