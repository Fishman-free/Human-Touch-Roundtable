import type { CSSProperties, ReactNode } from "react";

export interface GameTheme {
  id: string;
  density: "compact" | "comfortable" | "theatrical";
  tokens: {
    color: { paper: string; surface: string; ink: string; muted: string; line: string; onAccent: string;
      danger: string; human: string; shadow: string; ai: string; table: string; chat: string };
    font: { body: string; display: string; numeric: string };
    radius: { control: string; panel: string };
    motion: { fast: string; normal: string };
    layout: { contentWidth: string; entryWidth: string; seatMinWidth: string };
  };
  assets: { brandMark?: string; paperTexture?: string; revealArtwork?: string };
  seatColumns(seatCount: number): number;
}

type ThemeVariables = CSSProperties & Record<`--${string}`, string | number>;

export function themeVariables(theme: GameTheme): ThemeVariables {
  const { color, font, radius, motion, layout } = theme.tokens;
  return {
    "--paper": color.paper, "--surface": color.surface, "--ink": color.ink,
    "--muted": color.muted, "--line": color.line, "--on-accent": color.onAccent, "--danger": color.danger,
    "--human": color.human, "--shadow": color.shadow, "--ai": color.ai,
    "--table": color.table, "--chat": color.chat,
    "--font-body": font.body, "--font-display": font.display, "--font-numeric": font.numeric,
    "--radius-control": radius.control, "--radius-panel": radius.panel,
    "--motion-fast": motion.fast, "--motion-normal": motion.normal,
    "--content-width": layout.contentWidth, "--entry-width": layout.entryWidth,
    "--seat-min-width": layout.seatMinWidth,
    ...(theme.assets.paperTexture ? { "--paper-texture": `url(${theme.assets.paperTexture})` } : {}),
  };
}

export function ThemeBoundary({ theme, children }: { theme: GameTheme; children: ReactNode }) {
  return <div className="theme-root" data-theme={theme.id} data-density={theme.density}
    style={themeVariables(theme)}>{children}</div>;
}
