import type { GameTheme } from "../types.tsx";

export const mountainCourtTheme: GameTheme = {
  id: "mountain-court",
  density: "theatrical",
  tokens: {
    color: {
      paper: "#f2efe7", surface: "#fffefa", ink: "#171916", muted: "#6e7069",
      line: "#cbc9bf", onAccent: "#ffffff", danger: "#b5372c", human: "#285d52", shadow: "#a77a26", ai: "#315a77",
    },
    font: {
      body: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
      display: 'STKaiti, KaiTi, "Noto Serif SC", serif',
      numeric: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    },
    radius: { control: "3px", panel: "2px" },
    motion: { fast: "160ms", normal: "260ms" },
    layout: { contentWidth: "1080px", entryWidth: "740px", seatMinWidth: "136px" },
  },
  assets: {},
  seatColumns(seatCount) { return seatCount <= 3 ? 3 : seatCount <= 6 ? 3 : 4; },
};
