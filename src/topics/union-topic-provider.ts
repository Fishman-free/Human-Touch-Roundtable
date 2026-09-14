import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

// Merges several providers into one candidate list. Order matters twice over:
// candidateIds is indexed by the persisted preparation.candidateIndex modulo its
// length, so keeping the curated packs as a stable prefix means rooms that are
// mid-preparing still resolve the same topic after a mode change.
export class UnionTopicProvider implements TopicProvider {
  private delegates: readonly TopicProvider[];

  constructor(delegates: readonly TopicProvider[], order: "curated-first" | "dynamic-first" = "curated-first") {
    if (!delegates.length) throw new Error("INVALID_TOPIC_PROVIDER_SET");
    this.delegates = order === "dynamic-first" ? [...delegates].reverse() : [...delegates];
    this.assertUnique(this.candidateIds);
  }

  // Flattened live from the delegates on every read. A snapshot taken here would
  // hide every candidate the refresh loop appends afterwards, and RoomRuntime
  // samples this list modulo its length each time a room opens.
  get candidateIds(): readonly string[] {
    return this.delegates.flatMap(delegate => [...delegate.candidateIds]);
  }

  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    if (signal.aborted) throw new Error("ABORTED");
    const owner = this.delegates.find(delegate => delegate.candidateIds.includes(candidateId));
    if (!owner) throw new Error("TOPIC_NOT_FOUND");
    return owner.resolve(candidateId, signal);
  }

  // A duplicate id would resolve two candidates to the same topic, and the modulo
  // in RoomRuntime.startTopic would alias them silently.
  private assertUnique(ids: readonly string[]): void {
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error("INVALID_TOPIC_PROVIDER_SET");
  }
}
