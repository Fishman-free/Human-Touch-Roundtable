import assert from "node:assert/strict";
import test from "node:test";
import { oauthConfig, ZhihuOAuth, type OAuthConfig } from "../src/server/zhihu-oauth.ts";

const config: OAuthConfig = { appId: "fixture-app", appKey: "fixture-app-key", origin: "https://airoundtable.stream",
  redirectUri: "https://airoundtable.stream/api/auth/zhihu/callback" };
function harness() {
  let now = 1_000;
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    return Response.json(String(input).endsWith("access_token") ?
      { code: 20000, data: { access_token: "fixture-provider-token", expires_in: 60 } } :
      { hash_id: "fixture-user", fullname: "测试用户", uid: 969570047710216200, phone: "not-retained" });
  };
  const oauth = new ZhihuOAuth(config, fetcher, () => now);
  const begin = () => { const start = oauth.start(); return { ...start, state: new URL(start.url).searchParams.get("state")! }; };
  return { oauth, calls, begin, advance: (ms: number) => { now += ms; } };
}

test("OAuth未配置时禁用，HTTPS回调必须使用明确路径", () => {
  assert.equal(oauthConfig({}), undefined);
  assert.equal(oauthConfig({ ZHIHU_OAUTH_APP_ID: "app" }), undefined);
  assert.equal(oauthConfig({ ZHIHU_OAUTH_APP_ID: "app", ZHIHU_OAUTH_APP_KEY: "fixture" })?.redirectUri, config.redirectUri);
  assert.throws(() => oauthConfig({ ZHIHU_OAUTH_APP_ID: "app", ZHIHU_OAUTH_APP_KEY: "fixture", ZHIHU_OAUTH_REDIRECT_URI: "http://example.org/callback" }));
});

test("OAuth拒绝缺失、错误、跨浏览器及过期state，且不调用供应商", async () => {
  const h = harness(); const start = h.begin();
  for (const [state, browser] of [["", start.browser], ["wrong", start.browser], [start.state, "other-browser"]]) {
    await assert.rejects(h.oauth.finish(state, browser, "fixture-code"), /INVALID_OAUTH_STATE/);
  }
  h.advance(300_000);
  await assert.rejects(h.oauth.finish(start.state, start.browser, "fixture-code"), /INVALID_OAUTH_STATE/);
  assert.equal(h.calls.length, 0);
});

test("OAuth原子消费state，只在后端换Token并获取最小身份，退出和过期失效", async () => {
  const h = harness(); const start = h.begin();
  const results = await Promise.allSettled([h.oauth.finish(start.state, start.browser, "fixture-code"),
    h.oauth.finish(start.state, start.browser, "fixture-code")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const success = results.find(result => result.status === "fulfilled"); assert(success?.status === "fulfilled");
  const identity = h.oauth.identify(success.value); assert(identity);
  assert.deepEqual(Object.keys(identity).sort(), ["expiresAt", "id", "name"]);
  assert.equal(identity.name, "测试用户"); assert.notEqual(identity.id, "fixture-user");
  assert.equal(h.calls.length, 2);
  const form = h.calls[0].options?.body as URLSearchParams;
  assert.equal(form.get("code"), "fixture-code");
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("redirect_uri"), config.redirectUri);
  assert.deepEqual(h.calls[1].options?.headers, { authorization: "Bearer fixture-provider-token" });
  assert(!JSON.stringify(identity).includes("fixture-provider-token"));
  h.oauth.logout(success.value); assert.equal(h.oauth.identify(success.value), undefined);
  const second = h.begin(); const token = await h.oauth.finish(second.state, second.browser, "fixture-code");
  h.advance(60_000); assert.equal(h.oauth.identify(token), undefined);
});

test("OAuth失败响应、缺少安全字符串身份和超大响应均不能建立会话", async () => {
  for (const response of [Response.json({ code: 404, data: "User don't exist" }),
    Response.json({ uid: 969570047710216200 }), new Response("x".repeat(65_537))]) {
    let calls = 0;
    const oauth = new ZhihuOAuth(config, async () => ++calls === 1 ?
      Response.json({ access_token: "fixture-provider-token", expires_in: 60 }) : response);
    const start = oauth.start(); const state = new URL(start.url).searchParams.get("state")!;
    await assert.rejects(oauth.finish(state, start.browser, "fixture-code"));
    await assert.rejects(oauth.finish(state, start.browser, "fixture-code"), /INVALID_OAUTH_STATE/);
    assert.equal(calls, 2);
  }
});

test("重新发起登录会替换旧浏览器state，关闭服务清空会话", async () => {
  const h = harness(); const first = h.begin(); const second = h.oauth.start(first.browser);
  await assert.rejects(h.oauth.finish(first.state, first.browser, "fixture-code"));
  const token = await h.oauth.finish(new URL(second.url).searchParams.get("state")!, second.browser, "fixture-code");
  assert(h.oauth.identify(token)); h.oauth.clear(); assert.equal(h.oauth.identify(token), undefined);
});
