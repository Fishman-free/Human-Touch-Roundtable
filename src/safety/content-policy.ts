export type ContentRejection = "CONTACT_INFO" | "CREDENTIAL" | "PROMPT_INJECTION" | "ROLE_DISCLOSURE";
export type ContentDecision = { ok: true; text: string } | { ok: false; reason: ContentRejection };

const zeroWidth = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const controls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const contact = [
  /(?:https?:\/\/|www\.)\S+/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  /(?:微信|vx|wechat|qq|加我|联系我).{0,8}[A-Za-z0-9_-]{5,}/i,
];
const credentials = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:sk|pk)-(?:proxy-)?[A-Za-z0-9:_-]{16,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const injection = [
  /忽略.{0,8}(?:以上|之前|前面).{0,8}(?:指令|要求|规则)/,
  /(?:显示|输出|告诉我|泄露).{0,10}(?:系统提示|开发者消息|提示词|prompt)/i,
  /(?:系统提示|开发者消息|提示词|prompt).{0,10}(?:显示|输出|告诉|泄露)/i,
  /(?:system|developer)\s*(?:message|prompt)/i,
];
const roleDisclosure = [
  /(?:身份表|身份列表|所有人的身份|隐藏角色|服务端身份)/,
  /(?:s\d+|\d+号席|我|他|她).{0,8}(?:身份|其实|就是|是).{0,4}(?:普通人|影子|human|shadow)/i,
];

export function normalizePublicText(value: string): string {
  return value.normalize("NFC").replace(/[Ａ-Ｚａ-ｚ０-９]/g,
    character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(zeroWidth, "").replace(controls, "").replace(/\s+/g, " ").trim();
}

function decide(value: string, includeRoles: boolean): ContentDecision {
  const text = normalizePublicText(value);
  if (contact.some(pattern => pattern.test(text))) return { ok: false, reason: "CONTACT_INFO" };
  if (credentials.some(pattern => pattern.test(text))) return { ok: false, reason: "CREDENTIAL" };
  if (injection.some(pattern => pattern.test(text))) return { ok: false, reason: "PROMPT_INJECTION" };
  if (includeRoles && roleDisclosure.some(pattern => pattern.test(text))) return { ok: false, reason: "ROLE_DISCLOSURE" };
  return { ok: true, text };
}

export function checkHumanContent(value: string): ContentDecision { return decide(value, false); }
export function checkAiContent(value: string): ContentDecision { return decide(value, true); }
