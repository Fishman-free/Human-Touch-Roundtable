import type { GameTheme } from "../types.tsx";

export const mountainCourtTheme: GameTheme = {
  id: "mountain-court",
  density: "theatrical",
  tokens: {
    color: {
      paper: "#F2F7FC", surface: "#FFFFFF", ink: "#24364B", muted: "#61758A",
      line: "#D7E4F0", onAccent: "#FFFFFF", danger: "#B85C67", human: "#356FA8", shadow: "#9A789B", ai: "#607F96", table: "#E6EFF8", chat: "#DCEAF6",
    },
    font: {
      body: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
      display: 'STKaiti, KaiTi, "Noto Serif SC", serif',
      numeric: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    },
    radius: { control: "10px", panel: "16px" },
    motion: { fast: "160ms", normal: "260ms" },
    layout: { contentWidth: "1080px", entryWidth: "740px", seatMinWidth: "136px" },
  },
  assets: { brandMark: "/avatars/image0.png" },
  seatColumns(seatCount) { return seatCount <= 3 ? 3 : seatCount <= 6 ? 3 : 4; },
};
