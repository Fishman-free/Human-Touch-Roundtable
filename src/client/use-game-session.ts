"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { RoomView, ClientToServerEvents, ServerToClientEvents, SocketCommandAck } from "../contracts/public.ts";
import type { GameSession } from "./game-session.ts";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type JoinMode = "player" | "spectator";
const storageKey = "roundtable-session-v1";
const errorText: Record<string, string> = {
  INVALID_INPUT: "输入格式不正确", ROOM_NOT_FOUND: "房间不存在", ROOM_EXISTS: "房间号已被使用",
  ROOM_UNAVAILABLE: "房间暂时不可用", INVALID_SESSION: "会话已失效", STORAGE_UNAVAILABLE: "保存失败，请重试",
  ROOM_CONFLICT: "房间正在其他进程运行", FORBIDDEN: "当前身份不能执行此操作", ROOM_FULL: "房间已满",
  WRONG_PHASE: "当前阶段不能执行此操作", STALE_PHASE: "阶段已经推进，请按最新状态操作", DUPLICATE: "操作已经确认",
  INVALID_TARGET: "不能选择这个座位", COMMAND_ID_REUSED: "请求标识已被其他操作使用", COMMAND_LIMIT: "本局操作记录已满",
  NOT_JOINED: "尚未进入房间", WRONG_MATCH: "对局已经更换",
};

function id() { return crypto.randomUUID().replaceAll("-", "_"); }

export function useGameSession(): GameSession {
  const socketRef = useRef<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<RoomView>();
  const [roomId, setRoomId] = useState("roundtable");
  const [mode, setMode] = useState<JoinMode>("player");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const socket: GameSocket = io();
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return;
      try {
        const session = JSON.parse(stored) as { roomId: string; sessionToken: string };
        socket.emit("room:resume", session, result => {
          if (result.ok) { setRoomId(result.roomId); setView(result.view); }
          else { sessionStorage.removeItem(storageKey); setView(undefined); setError(errorText[result.error] ?? result.error); }
        });
      } catch { sessionStorage.removeItem(storageKey); }
    });
    socket.on("disconnect", () => { setConnected(false); setBusy(false); });
    socket.on("room:state", setView);
    socket.on("session:replaced", () => {
      sessionStorage.removeItem(storageKey);
      setError("此会话已在另一个页面接管");
      setView(undefined);
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  function enter(event: "room:create" | "room:join") {
    const socket = socketRef.current;
    const normalized = roomId.trim().toLowerCase();
    if (!socket || !connected || !/^[a-z0-9-]{1,24}$/.test(normalized)) {
      setError("房间号只能使用小写字母、数字和连字符"); return;
    }
    setBusy(true); setError("");
    socket.emit(event, { requestId: crypto.randomUUID(), roomId: normalized, mode }, result => {
      setBusy(false);
      if (!result.ok) { setError(errorText[result.error] ?? result.error); return; }
      sessionStorage.setItem(storageKey, JSON.stringify({ roomId: result.roomId, sessionToken: result.sessionToken }));
      setRoomId(result.roomId); setView(result.view);
    });
  }
  function leave() {
    sessionStorage.removeItem(storageKey);
    socketRef.current?.disconnect(); socketRef.current?.connect();
    setView(undefined); setError("");
  }
  function ack(result: SocketCommandAck) {
    setBusy(false);
    setError(result.ok ? "" : errorText[result.error] ?? result.error);
  }
  function base() { return { commandId: id(), matchId: view!.matchId, phaseToken: view!.phaseToken }; }
  function emit(action: () => void) {
    if (!socketRef.current?.connected || !view || busy) return;
    setBusy(true); setError(""); action();
  }

  return {
    connected, view, roomId, setRoomId, mode, setMode, busy, error,
    create: () => enter("room:create"), join: () => enter("room:join"), leave,
    ready: (ready: boolean) => emit(() => socketRef.current?.emit("room:ready", { ...base(), ready }, ack)),
    answer: (text: string, stance?: "pro" | "con") => emit(() => socketRef.current?.emit("game:answer",
      { ...base(), round: view!.round!, text, ...(stance ? { stance } : {}) }, ack)),
    accuse: (targetSeatId: string, text: string) => emit(() => socketRef.current?.emit("game:accuse", { ...base(), targetSeatId, text }, ack)),
    respond: (text: string) => emit(() => socketRef.current?.emit("game:respond", { ...base(), text }, ack)),
    followup: (text: string) => emit(() => socketRef.current?.emit("game:followup", { ...base(), text }, ack)),
    skipFollowup: () => emit(() => socketRef.current?.emit("game:skip-followup", base(), ack)),
    castVote: (targetSeatId: string) => emit(() => socketRef.current?.emit("game:vote", { ...base(), targetSeatId }, ack)),
  };
}

export type { GameSession } from "./game-session.ts";
