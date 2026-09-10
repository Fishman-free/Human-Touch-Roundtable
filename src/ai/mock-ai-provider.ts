import type { AiCommand, AiProvider, AiRequest } from "../application/ports.ts";

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const handle = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(handle); reject(new Error("ABORTED")); }, { once: true });
  });
}

function target(request: AiRequest, preferred: "shadow" | "human") {
  const roles = request.context.roles;
  return roles.find(item => item.role === preferred && item.seatId !== request.seatId)?.seatId ??
    roles.find(item => item.seatId !== request.seatId)!.seatId;
}

export class MockAiProvider implements AiProvider {
  async act(request: AiRequest, signal: AbortSignal): Promise<AiCommand> {
    await wait(650 + request.seatId.charCodeAt(request.seatId.length - 1) % 5 * 180, signal);
    if (request.action === "answer") {
      const round = request.context.view.round!;
      if (round === 1) return { type: "answer", round, text: "真正被替代的，往往是流程而不是人" };
      if (round === 2) return { type: "answer", round, stance: "pro", text: "工具正在重写人的时间分配方式" };
      return { type: "answer", round, text: "建议先让AI替我参加无效会议" };
    }
    if (request.action === "accuse") {
      return { type: "accuse", targetSeatId: target(request, "shadow"), text: "你的回答太完整，像是在主动覆盖评分点。" };
    }
    if (request.action === "respond") return { type: "respond", text: "完整不等于机器，我只是不同意把含糊当成人味。" };
    if (request.action === "followup") return { type: "followup", text: "那你能指出自己刚才最主观的一句吗？" };
    return { type: "vote", targetSeatId: target(request, "human") };
  }
}
