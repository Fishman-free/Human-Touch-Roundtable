import type { RoomView } from "../../contracts/public.ts";
import { ANSWER_LIMIT } from "../../contracts/rules.ts";

export const gamePresentation = {
  brand: { name: "人味圆桌局", subtitle: "知乎问题上的匿名人机辨认局" },
  phase: {
    lobby: "候场", preparing: "选题", answering: "发言", debating: "辩论", voting: "投票", revealed: "揭示",
  } satisfies Record<RoomView["phase"], string>,
  role: { human: "普通人", shadow: "影子", ai: "AI" },
  winner: { human: "普通人胜利", shadow: "影子胜利", ai: "AI胜利" },
  rounds: {
    1: { title: "一句话总结", prompt: "总结该问题的高赞共识", limit: ANSWER_LIMIT[1] },
    2: { title: "正反站边", prompt: "选择立场，给出一个理由", limit: ANSWER_LIMIT[2] },
    3: { title: "神回复", prompt: "给最高赞回答写一条评论区回复", limit: ANSWER_LIMIT[3] },
  },
  stages: ["第一轮", "第二轮", "第三轮", "辩论", "投票", "揭示"],
} as const;

export function seatLabel(seatId?: string) {
  return seatId ? `${Number(seatId.slice(1))}号席` : "未指定";
}
