import { charCount } from "../contracts/rules.ts";
import type { ZhihuQuestionGateway, ZhihuQuestionReference } from "./verified-topic-provider.ts";
import { questionIdFromUrl, ZhihuContentClient } from "./zhihu-content-client.ts";
import { checkHumanContent } from "../safety/content-policy.ts";
import { excerpt, title } from "./zhihu-text.ts";

function queries(value: string) {
  const quoted = [...value.matchAll(/「([^」]{4,80})」/g)].map(match => match[1]).sort((a, b) => b.length - a.length);
  const keywords = value.replace(/[？?]/g, "").replace(/为什么/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set(quoted.length ? [...quoted, value] : [keywords, value])];
}

export class ZhihuSearchQuestionGateway implements ZhihuQuestionGateway {
  private client: ZhihuContentClient;
  constructor(client: ZhihuContentClient) { this.client = client; }

  async verify(question: ZhihuQuestionReference, signal: AbortSignal) {
    let answers = [] as Awaited<ReturnType<ZhihuContentClient["search"]>>;
    for (const query of queries(question.title)) {
      const items = await this.client.search(query, 10, signal);
      answers = items.filter(item => item.contentType.toLowerCase() === "answer" &&
        title(item.title) === title(question.title) && questionIdFromUrl(item.url) === question.id && item.contentText.trim());
      if (answers.length) break;
    }
    if (!answers.length) throw new Error("ZHIHU_QUESTION_ANSWER_NOT_FOUND");
    answers.sort((left, right) => right.voteUpCount - left.voteUpCount || right.rankingScore - left.rankingScore);
    const safe = answers.map(selected => ({ selected, decision: checkHumanContent(excerpt(selected.contentText, 200)) }))
      .find(item => item.decision.ok);
    if (!safe || !safe.decision.ok) throw new Error("UNSAFE_ZHIHU_ANSWER");
    const { selected } = safe;
    const topAnswerExcerpt = safe.decision.text;
    if (!topAnswerExcerpt || charCount(topAnswerExcerpt) > 200) throw new Error("INVALID_ZHIHU_ANSWER");
    return {
      id: question.id, title: question.title, url: question.url, topAnswerExcerpt,
      selectedAnswerUrl: selected.url, selectedVoteUpCount: selected.voteUpCount,
      comments: selected.comments.map(value => excerpt(value, 120)).filter(Boolean),
    };
  }
}
