/** Private-to-current-browser HTTP responses; never include these in RoomView. */
export interface AccountStatus {
  enabled: boolean;
  user: { name: string } | null;
  guest: boolean;
}

export type MatchStatus = { status: "idle" } | { status: "waiting"; waiting: number } |
  { status: "matched"; roomId: string; sessionToken: string };
