import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

// Original discussion prompts and fictional viewpoints, not quotations or community consensus.
const seeds = [
  ["weekend", "朋友临时取消周末约定，需要补偿请客吗？", "我把周末留给了朋友，临时取消确实失落。但如果每次道歉都要换成一顿饭，约见面也像签了合同。", "约定需要尊重，补偿也要看取消的原因。"],
  ["group-chat", "群聊里看见消息就必须回复吗？", "有时候我已经看完，只是没有要补充的话。沉默不等于不在乎，但重要安排最好给一个明确回应。", "回复的必要性取决于消息是否需要确认。"],
  ["surprise", "送礼物应该直接问对方想要什么吗？", "猜中的惊喜很难得，猜错的东西却会占柜子。我更愿意收到被认真听见的需求，而不是一次昂贵的猜谜。", "惊喜和实用都重要，关键是了解对方。"],
  ["photo", "出去玩应该先拍照还是先享受当下？", "照片能留下证据，却不一定留得住感受。等大家拍完，菜凉了；可过几年，我也会感谢那个坚持合照的人。", "记录与体验需要平衡，别让同行者一直等待。"],
  ["chores", "室友做家务应该轮流还是按擅长分工？", "轮流看上去公平，可有人讨厌洗碗，有人讨厌拖地。长期按擅长分工又容易忘记，别人做的事也很费劲。", "公平不一定是轮流，也需要看见彼此的付出。"],
  ["spoiler", "知道结局后，一个故事还值得看吗？", "我重看喜欢的电影时从不期待结局改变。我想再走一次那些弯路，看清第一次没注意到的人。", "结局之外，过程和细节也构成故事的价值。"],
] as const;

export class LocalTopicProvider implements TopicProvider {
  readonly candidateIds = seeds.map(([id]) => `original-${id}`);
  async resolve(id: string, signal: AbortSignal): Promise<Topic> {
    if (signal.aborted) throw new Error("ABORTED");
    const seed = seeds.find(([key]) => `original-${key}` === id);
    if (!seed) throw new Error("TOPIC_NOT_FOUND");
    const [, title, material, summary] = seed;
    return {
      id, title, url: "", topAnswerExcerpt: material, topConsensusSummary: summary,
      provenance: { packId: id, source: "original", curatedAt: "2026-09-21T00:00:00.000Z" },
      defaults: {
        1: [summary, "先讲清彼此在意什么，再讨论该怎么做。"],
        2: ["正方：明确规则能减少彼此猜测和误会。", "反方：每次情况不同，统一要求未必公平。"],
        3: ["道理都懂，轮到自己又是另一个故事。", "看完想起一个朋友，也可能就是我。"],
      },
    };
  }
}
