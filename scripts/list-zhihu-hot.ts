import { questionIdFromUrl, ZhihuContentClient } from "../src/topics/zhihu-content-client.ts";

const secret = process.env.ZHIHU_ACCESS_SECRET;
if (!secret) throw new Error("ZHIHU_ACCESS_SECRET_REQUIRED");
const client = new ZhihuContentClient({ accessSecret: secret });
const items = (await client.hot(30, new AbortController().signal)).flatMap(item => {
  const questionId = questionIdFromUrl(item.url);
  return questionId ? [{ questionId, title: item.title, url: item.url,
    summary: item.summary.replace(/\s+/g, " ").trim().slice(0, 240) }] : [];
});
const json = JSON.stringify(items);
process.stdout.write(process.argv.includes("--base64") ? `${Buffer.from(json).toString("base64")}\n` : `${json}\n`);
