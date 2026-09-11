import type { AiCommand, AiRequest } from "../application/ports.ts";
import { ANSWER_LIMIT, charCount } from "../contracts/rules.ts";

type Value = Record<string, unknown>;
function object(value: unknown): value is Value { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Value, fields: readonly string[]) {
  return Object.keys(value).every(key => fields.includes(key)) && fields.every(key => key in value);
}
const forbidden = [/系统提示/i, /prompt/i, /身份表/, /隐藏角色/, /(?:s\d+|\d+号席).{0,8}(?:是|身份).{0,4}(?:普通人|影子)/];
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value !== value.trim() || !value) throw new Error("INVALID_AI_TEXT");
  if (charCount(value) > limit) throw new Error("AI_OUTPUT_TOO_LONG");
  if (forbidden.some(pattern => pattern.test(value))) throw new Error("UNSAFE_AI_OUTPUT");
  return value;
}
function target(value: unknown, request: AiRequest): string {
  if (typeof value !== "string" || value === request.seatId || !request.context.roles.some(item => item.seatId === value)) {
    throw new Error("INVALID_AI_TARGET");
  }
  return value;
}

export function parseAiCommand(content: string, request: AiRequest): AiCommand {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("INVALID_AI_JSON"); }
  if (!object(value)) throw new Error("INVALID_AI_OUTPUT");
  if (request.action === "answer") {
    const round = request.context.view.round;
    if (round === 2) {
      if (!exact(value, ["stance", "text"]) || (value.stance !== "pro" && value.stance !== "con")) throw new Error("INVALID_AI_OUTPUT");
      return { type: "answer", round, stance: value.stance, text: text(value.text, ANSWER_LIMIT[2] - 3) };
    }
    if ((round !== 1 && round !== 3) || !exact(value, ["text"])) throw new Error("INVALID_AI_OUTPUT");
    return { type: "answer", round, text: text(value.text, ANSWER_LIMIT[round]) };
  }
  if (request.action === "accuse") {
    if (!exact(value, ["targetSeatId", "text"])) throw new Error("INVALID_AI_OUTPUT");
    return { type: "accuse", targetSeatId: target(value.targetSeatId, request), text: text(value.text, 300) };
  }
  if (request.action === "respond") {
    if (!exact(value, ["text"])) throw new Error("INVALID_AI_OUTPUT");
    return { type: "respond", text: text(value.text, 300) };
  }
  if (request.action === "followup") {
    if (exact(value, ["skip"]) && value.skip === true) return { type: "skip-followup" };
    if (!exact(value, ["text"])) throw new Error("INVALID_AI_OUTPUT");
    return { type: "followup", text: text(value.text, 300) };
  }
  if (!exact(value, ["targetSeatId"])) throw new Error("INVALID_AI_OUTPUT");
  return { type: "vote", targetSeatId: target(value.targetSeatId, request) };
}
