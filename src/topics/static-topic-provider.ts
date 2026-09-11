import type { TopicProvider } from "../application/ports.ts";
import type { TopicPackV1 } from "./topic-pack.ts";
import { normalizeTopicPack, parseTopicPack } from "./topic-pack.ts";

export const curatedTopicPacks: readonly TopicPackV1[] = [{
  schemaVersion: 1, packId: "zhihu-2026-09-11-seasoning-formula", source: "zhihu",
  curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2071256746484392995",
    title: "为啥现在很多做饭教程都是「两勺生抽一勺老抽一勺蚝油」？这是什么万能公式吗？能不能把它们也做成一种调料？",
    url: "https://www.zhihu.com/question/2071256746484392995",
    topAnswerExcerpt: "固定比例适合部分烧焖菜，新手可以用来保底，但不能替代对咸度、上色和食材本味的判断。",
    topConsensusSummary: "固定比例只是新手模板，调味仍要结合食材和做法。",
  }, tags: ["美食", "生活"], defaults: {
    1: ["固定比例只是新手模板，调味还得看菜。", "它降低了门槛，也让很多菜千篇一味。", "万能公式能保底，却很难做出特色。"],
    2: ["正方：统一比例能让厨房新手先把菜做熟。", "反方：食材和火候不同，固定配比只会串味。", "正方：先有可复现的模板，才谈得上灵活调整。"],
    3: ["建议下一步统一锅和食材，误差更小。", "菜还没学会，配方先实现了工业化。", "万能到最后，所有菜都认不出自己。"],
  },
}, {
  schemaVersion: 1, packId: "dev-work-ai", source: "zhihu", curatedAt: "2026-09-10T00:00:00.000Z",
  question: {
    id: "19550517", title: "人工智能会让哪些工作发生根本变化？",
    url: "https://www.zhihu.com/question/19550517",
    topAnswerExcerpt: "工具会替代重复步骤，但复杂判断、责任承担和人与人的沟通仍然重要。",
    topConsensusSummary: "AI先改变重复劳动，再重新划分人的判断与责任。",
  }, tags: ["AI", "工作"], defaults: {
    1: ["AI先接管重复劳动，人留下判断。", "变的是工具，不变的是责任。", "多数工作会被重组，而非消失。"],
    2: ["正方：效率提升会重做大部分工作流程。", "反方：行业责任不会随工具一起自动转移。", "正方：重复步骤越多，变化就会越彻底。"],
    3: ["先别急着失业，周报可能比你先走。", "工具下班了，责任还在工位上。", "省下的时间，最后大概又拿去开会。"],
  },
}, {
  schemaVersion: 1, packId: "dev-choice-effort", source: "zhihu", curatedAt: "2026-09-10T00:00:00.000Z",
  question: {
    id: "20325852", title: "选择真的比努力更重要吗？", url: "https://www.zhihu.com/question/20325852",
    topAnswerExcerpt: "选择决定努力作用的方向，但好选择往往也来自长期积累、试错和行动。",
    topConsensusSummary: "选择决定方向，努力提高抵达的概率，两者不能互相代替。",
  }, tags: ["选择", "成长"], defaults: {
    1: ["选择定方向，努力定能走多远。", "没有行动验证，选择只是想象。", "好选择也来自长期积累。"],
    2: ["正方：方向错了，投入越多偏得越远。", "反方：没有积累，人甚至看不见好选择。", "正方：关键节点的一次判断能改写路径。"],
    3: ["成年人不做选择，成年人先加班。", "道理都懂，选项能不能先少两个？", "努力负责感动自己，结果负责保持沉默。"],
  },
}];

export class StaticTopicProvider implements TopicProvider {
  private packs = new Map(curatedTopicPacks.map(input => { const pack = parseTopicPack(input); return [pack.packId, pack]; }));
  readonly candidateIds = [...this.packs.keys()];
  async resolve(candidateId: string, signal: AbortSignal) {
    if (signal.aborted) throw new Error("ABORTED");
    const pack = this.packs.get(candidateId);
    if (!pack) throw new Error("TOPIC_NOT_FOUND");
    return normalizeTopicPack(pack);
  }
}
