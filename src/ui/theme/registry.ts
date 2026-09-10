import type { GameTheme } from "./types.tsx";
import { mountainCourtTheme } from "./themes/mountain-court.ts";

const themes: Record<string, GameTheme> = { [mountainCourtTheme.id]: mountainCourtTheme };

export function resolveGameTheme(id = "mountain-court"): GameTheme {
  return themes[id] ?? mountainCourtTheme;
}

export function availableGameThemes(): readonly Pick<GameTheme, "id" | "density">[] {
  return Object.values(themes).map(({ id, density }) => ({ id, density }));
}
