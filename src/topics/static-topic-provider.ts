import type { TopicProvider } from "../application/ports.ts";
import type { TopicPackV1 } from "./topic-pack.ts";
import { normalizeTopicPack, parseTopicPack } from "./topic-pack.ts";

const allTopicPacks: readonly TopicPackV1[] = [{
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
  schemaVersion: 1, packId: "zhihu-2026-09-11-living-room", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2079581505047762015",
    title: "一设计师称中国客厅已失去意义，反映了当下怎样的家庭生活变化？你家还有客厅吗，是怎样的？",
    url: "https://www.zhihu.com/question/2079581505047762015",
    topAnswerExcerpt: "客厅没有消失，只是从待客中心变成了家庭成员按自身习惯使用的公共空间。",
    topConsensusSummary: "客厅功能正从对外待客转向家庭内部使用。",
  }, tags: ["居住", "家庭"], defaults: {
    1: ["客厅没消失，只是不再专门等客人。", "空间还在，待客中心的地位变了。", "客厅正从门面变成家庭共享区。"],
    2: ["正方：社交外移后，传统待客客厅确实过时。", "反方：客厅仍是家庭成员最重要的共享空间。", "正方：居住面积有限，空间应该服从真实使用。"],
    3: ["客厅失去的不是意义，是给客人的面子。", "沙发还在，只是客人改成了外卖员。", "以前客厅等亲戚，现在客厅等投影。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-short-drama", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2081408366807442163",
    title: "如何看待红果短剧日活1.68亿已超「爱优腾芒」四家总和？为啥大众会在影视娱乐上出现这么强烈的偏好转变？",
    url: "https://www.zhihu.com/question/2081408366807442163",
    topAnswerExcerpt: "短剧用更低时间成本提供密集情绪回报，适应了碎片化使用场景，也改变了内容分发和付费方式。",
    topConsensusSummary: "低时间成本和高情绪密度推动观众转向短剧。",
  }, tags: ["影视", "短剧"], defaults: {
    1: ["观众不是没耐心，只是不愿等剧情热身。", "短剧用更少时间交付更密集的情绪。", "碎片时间重写了影视内容的节奏。"],
    2: ["正方：短剧更适合当下碎片化娱乐需求。", "反方：高刺激密度也会压缩内容的耐看度。", "正方：用户用观看时长投出了最直接的一票。"],
    3: ["以前怕烂尾，现在一顿饭就能验证。", "不是剧情变短，是观众的耐心开始计费。", "长剧还在铺垫，短剧已经大结局了。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-front-camera", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2080609977136148977",
    title: "网友称把前置摄像头关掉刷手机可以保护眼睛，这是真的吗？如果属实，是因为哪些原理？",
    url: "https://www.zhihu.com/question/2080609977136148977",
    topAnswerExcerpt: "前置摄像头本身通常不是主要伤眼来源，屏幕亮度、距离、持续近距离用眼和休息频率更值得关注。",
    topConsensusSummary: "护眼关键在屏幕使用习惯，而非关闭前置摄像头。",
  }, tags: ["健康", "手机"], defaults: {
    1: ["关摄像头不等于关掉近距离用眼负担。", "护眼主要看亮度、距离和休息频率。", "前摄不是重点，持续盯屏才是。"],
    2: ["正方：减少无关功能有助于提醒自己控制使用。", "反方：关闭前摄不能替代真正的用眼休息。", "反方：把相关性当因果只会制造护眼偏方。"],
    3: ["建议顺便关机，护眼效果可能更稳定。", "前摄先背锅，屏幕在旁边继续发光。", "眼睛说问题不在镜头，在你不肯放下。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-ancient-night", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2072659682137728925", title: "古代没有电灯，晚上过了8点，古人都怎么打发时间？",
    url: "https://www.zhihu.com/question/2072659682137728925",
    topAnswerExcerpt: "古人的夜生活受季节、阶层和城市制度影响，既有早睡劳作，也有夜市、宴饮、阅读和家庭活动。",
    topConsensusSummary: "古代夜生活因阶层与城市而异，并非人人早睡。",
  }, tags: ["历史", "生活"], defaults: {
    1: ["古人并非都早睡，夜生活也分阶层。", "灯火有限，但夜市和家庭活动并不少。", "季节、城市和身份决定夜晚怎么过。"],
    2: ["正方：照明成本让多数人的夜晚更早结束。", "反方：大城市夜市和娱乐并不比想象单调。", "正方：日出而作的生活更依赖自然节律。"],
    3: ["没有手机，但第二天也得照常上班。", "古人不刷短视频，改刷隔壁家的八卦。", "灯油太贵，熬夜先通过家庭预算审批。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-status-industries", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2080939659190854977", title: "为什么皮鞋、手表、西装、酒这些行业崩溃了？",
    url: "https://www.zhihu.com/question/2080939659190854977",
    topAnswerExcerpt: "传统商务体面消费受到工作方式、代际偏好和替代品冲击，但品类内部仍有明显分化，不能简单称为消失。",
    topConsensusSummary: "传统商务体面消费衰退，但行业内部仍在分化。",
  }, tags: ["消费", "行业"], defaults: {
    1: ["体面消费退潮，实用和舒适接过了预算。", "行业并未消失，只是传统商务需求收缩。", "工作方式变化重写了成年人的体面清单。"],
    2: ["正方：商务场景减少正在削弱传统品类需求。", "反方：品类只是分化，不能把转型叫作崩溃。", "正方：年轻人的身份表达已经换了载体。"],
    3: ["不是成年人不体面，是体面改穿运动鞋了。", "手表负责讲故事，手机负责告诉时间。", "西装没输给潮流，先输给了居家办公。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-parent-boundary", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2080336124539400817",
    title: "如何看待张家齐妈妈聊天记录大篇幅说教、教育短视频？为什么这会引起大家的反感？你有这样的父母吗？",
    url: "https://www.zhihu.com/question/2080336124539400817",
    topAnswerExcerpt: "关心一旦只剩单向说教，就容易忽略成年子女的边界和回应意愿，使沟通变成持续施压。",
    topConsensusSummary: "单向说教忽视成年子女边界，关心容易变成压力。",
  }, tags: ["家庭", "沟通"], defaults: {
    1: ["关心若没有边界，很容易变成持续施压。", "问题不在分享，而在只说不听。", "成年后的亲子沟通需要尊重拒绝回应。"],
    2: ["正方：父母表达关心不该被简单视为控制。", "反方：无视反馈的说教会消耗亲密关系。", "反方：成年子女有权决定接收什么建议。"],
    3: ["建议反向转发《如何停止转发教育视频》。", "已读不回，也是成年人最后的边界。", "聊天框很热闹，对话可能一次都没发生。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-daily-beer", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "2080303059578705354", title: "一天一瓶啤酒，对身体有害吗？",
    url: "https://www.zhihu.com/question/2080303059578705354",
    topAnswerExcerpt: "酒精没有面向健康的安全推荐量，每日饮酒会累积风险，也不应把酒精当作改善睡眠的工具。",
    topConsensusSummary: "每日饮酒会累积健康风险，助眠也不是合理理由。",
  }, tags: ["健康", "饮酒"], defaults: {
    1: ["每天饮酒会累积风险，少量不等于无害。", "酒精能让人困，却不等于改善睡眠。", "健康角度没有推荐每天喝酒的理由。"],
    2: ["正方：成年人可以在知情前提下控制少量饮酒。", "反方：每天固定摄入会把偶尔变成长期风险。", "反方：助眠收益不能抵消睡眠质量和依赖风险。"],
    3: ["一瓶负责哄睡，第二天负责解释疲惫。", "酒说自己适量，杯子通常没有刻度。", "每天一点的重点，可能不是一点而是每天。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-drinking-water", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "37558063", title: "正确的喝水习惯是什么？", url: "https://www.zhihu.com/question/37558063",
    topAnswerExcerpt: "饮水需求受体重、活动量、气候和饮食影响，通常应分散饮用并观察口渴与尿液状态，不必机械追求固定杯数。",
    topConsensusSummary: "饮水量因人而异，分散饮用比机械凑杯数更重要。",
  }, tags: ["健康", "习惯"], defaults: {
    1: ["饮水因人而异，不必机械追求八杯。", "少量多次，并根据活动和气候调整。", "口渴和身体状态比固定数字更有参考。"],
    2: ["正方：固定目标能帮助忙碌的人记得喝水。", "反方：统一杯数忽略体重、饮食和活动差异。", "正方：简单规则比完全凭感觉更容易执行。"],
    3: ["水杯完成了KPI，肾脏还在加班。", "八杯水到了，第九杯开始负责焦虑。", "喝水别卷，厕所已经先表示反对。"],
  },
}, {
  schemaVersion: 1, packId: "zhihu-2026-09-11-rest-fatigue", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z",
  question: {
    id: "1981112146696893075", title: "不上班为什么也很疲惫？", url: "https://www.zhihu.com/question/1981112146696893075",
    topAnswerExcerpt: "休息不等于恢复，长期压力、作息紊乱、缺少结构和持续的信息刺激，都可能让不上班的日子依然疲惫。",
    topConsensusSummary: "停止工作不等于获得恢复，压力与作息仍会消耗人。",
  }, tags: ["工作", "心理"], defaults: {
    1: ["不上班只是停工，不代表身心已经恢复。", "压力、作息和信息刺激仍在持续消耗。", "没有结构的休息也可能越休越累。"],
    2: ["正方：脱离工作后，疲惫主要来自生活失序。", "反方：长期工作压力不会在离岗当天消失。", "反方：休息质量比是否上班更能解释疲惫。"],
    3: ["班不上了，脑子还在后台运行。", "身体提交了休假，焦虑拒绝审批。", "不上班的第一项工作，是解释为什么还累。"],
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

export const candidateTopicPacks = allTopicPacks.filter(pack => !pack.packId.startsWith("dev-"));
const verifiedPackIds = new Set([
  "zhihu-2026-09-11-seasoning-formula",
  "zhihu-2026-09-11-living-room",
  "zhihu-2026-09-11-status-industries",
]);
export const productionTopicPacks = candidateTopicPacks.filter(pack => verifiedPackIds.has(pack.packId));

export class StaticTopicProvider implements TopicProvider {
  private packs = new Map(allTopicPacks.map(input => { const pack = parseTopicPack(input); return [pack.packId, pack]; }));
  readonly candidateIds = [...this.packs.keys()];
  async resolve(candidateId: string, signal: AbortSignal) {
    if (signal.aborted) throw new Error("ABORTED");
    const pack = this.packs.get(candidateId);
    if (!pack) throw new Error("TOPIC_NOT_FOUND");
    return normalizeTopicPack(pack);
  }
}
