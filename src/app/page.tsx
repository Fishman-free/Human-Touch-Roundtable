"use client";

import { useGameSession } from "../client/use-game-session.ts";
import { EntryScreen } from "../components/entry/entry-screen.tsx";
import { GameScreen } from "../components/room/game-screen.tsx";
import { resolveGameTheme } from "../ui/theme/registry.ts";
import { ThemeBoundary } from "../ui/theme/types.tsx";

const theme = resolveGameTheme(process.env.NEXT_PUBLIC_GAME_THEME);

export default function Home() {
  const session = useGameSession();
  return <ThemeBoundary theme={theme}>
    {session.view ? <GameScreen session={session} theme={theme} /> : <EntryScreen session={session} theme={theme} />}
  </ThemeBoundary>;
}
