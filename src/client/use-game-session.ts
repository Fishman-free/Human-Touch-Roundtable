"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { RoomView, ClientToServerEvents, ServerToClientEvents, SocketCommandAck } from "../contracts/public.ts";
import type { GameSession } from "./game-session.ts";
import { CommandOutbox, type CommandSubmission, type OutboxTransport } from "./command-outbox.ts";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type JoinMode = "player" | "spectator";
const storageKey = "roundtable-session-v1";
const outboxKey = "roundtable-command-outbox-v1";
const errorText: Record<string, string> = {
  INVALID_INPUT: "输入格式不正确", ROOM_NOT_FOUND: "房间不存在", ROOM_EXISTS: "房间号已被使用",
  ROOM_UNAVAILABLE: "房间暂时不可用", INVALID_SESSION: "会话已失效", STORAGE_UNAVAILABLE: "保存失败，请重试",
  ROOM_CONFLICT: "房间正在其他进程运行", FORBIDDEN: "当前身份不能执行此操作", ROOM_FULL: "房间已满",
  WRONG_PHASE: "当前阶段不能执行此操作", STALE_PHASE: "阶段已经推进，请按最新状态操作", DUPLICATE: "操作已经确认",
  INVALID_TARGET: "不能选择这个座位", COMMAND_ID_REUSED: "请求标识已被其他操作使用", COMMAND_LIMIT: "本局操作记录已满",
  NOT_JOINED: "尚未进入房间", WRONG_MATCH: "对局已经更换",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
  CONTENT_REJECTED: "内容包含不适合公开发送的信息，请修改后重试",
};

function id() { return crypto.randomUUID().replaceAll("-", "_"); }

export function useGameSession(): GameSession {
  const socketRef = useRef<GameSocket | null>(null);
  const outboxRef = useRef<CommandOutbox | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<RoomView>();
  const [roomId, setRoomId] = useState("roundtable");
  const [mode, setMode] = useState<JoinMode>("player");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Browsers omit Origin on same-origin GET polling handshakes, which the production origin check rejects;
    // the WebSocket handshake always carries Origin.
    const socket: GameSocket = io({ transports: ["websocket"] });
    socketRef.current = socket;
    const transport: OutboxTransport = (submission, acknowledge) => {
      const emit = socket.emit.bind(socket) as (event: string, input: unknown,
        callback: (ack: SocketCommandAck) => void) => void;
      emit(submission.event, submission.input, acknowledge);
    };
    const outbox = new CommandOutbox({
      storage: { get: () => sessionStorage.getItem(outboxKey), set: value => sessionStorage.setItem(outboxKey, value),
        remove: () => sessionStorage.removeItem(outboxKey) },
      onAck: result => { setBusy(false); setError(result.ok ? "" : errorText[result.error] ?? result.error); },
      onUncertain: () => { setBusy(false); setError("操作确认超时；重连或刷新后会继续确认，请勿重复提交"); },
    });
    outboxRef.current = outbox;
    setBusy(outbox.hasPending());
    socket.on("connect", () => {
      setConnected(true);
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) { outbox.clear(); setBusy(false); return; }
      try {
        const session = JSON.parse(stored) as { roomId: string; sessionToken: string };
        socket.emit("room:resume", session, result => {
          if (result.ok) { setRoomId(result.roomId); setView(result.view); outbox.resume(transport); }
          else { sessionStorage.removeItem(storageKey); outbox.clear(); setView(undefined); setBusy(false);
            setError(errorText[result.error] ?? result.error); }
        });
      } catch { sessionStorage.removeItem(storageKey); outbox.clear(); setBusy(false); }
    });
    socket.on("disconnect", () => { setConnected(false); outbox.pause(); setBusy(outbox.hasPending()); });
    socket.on("room:state", setView);
    socket.on("session:replaced", () => {
      sessionStorage.removeItem(storageKey);
      outbox.clear();
      setError("此会话已在另一个页面接管");
      setView(undefined);
    });
    socket.on("session:expired", () => {
      sessionStorage.removeItem(storageKey);
      outbox.clear();
      setBusy(false); setView(undefined); setError("会话已过期，请重新进入房间");
    });
    return () => { outbox.pause(); socket.disconnect(); socketRef.current = null; outboxRef.current = null; };
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
    outboxRef.current?.clear();
    socketRef.current?.disconnect(); socketRef.current?.connect();
    setView(undefined); setError("");
  }
  function base() { return { commandId: id(), matchId: view!.matchId, phaseToken: view!.phaseToken }; }
  function transport(): OutboxTransport {
    return (submission, acknowledge) => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      const emit = socket.emit.bind(socket) as (event: string, input: unknown,
        callback: (ack: SocketCommandAck) => void) => void;
      emit(submission.event, submission.input, acknowledge);
    };
  }
  function emit(submission: CommandSubmission) {
    if (!socketRef.current?.connected || !view || busy) return;
    const outbox = outboxRef.current;
    if (!outbox || !outbox.submit(submission, transport())) {
      setError("上一项操作仍在等待确认，请勿重复提交"); return;
    }
    setBusy(true); setError("");
  }

  return {
    connected, view, roomId, setRoomId, mode, setMode, busy, error,
    create: () => enter("room:create"), join: () => enter("room:join"), leave,
    ready: (ready: boolean) => emit({ event: "room:ready", input: { ...base(), ready } }),
    answer: (text: string, stance?: "pro" | "con") => emit({ event: "game:answer",
      input: { ...base(), round: view!.round!, text, ...(stance ? { stance } : {}) } }),
    accuse: (targetSeatId: string, text: string) => emit({ event: "game:accuse", input: { ...base(), targetSeatId, text } }),
    respond: (text: string) => emit({ event: "game:respond", input: { ...base(), text } }),
    followup: (text: string) => emit({ event: "game:followup", input: { ...base(), text } }),
    skipFollowup: () => emit({ event: "game:skip-followup", input: base() }),
    castVote: (targetSeatId: string) => emit({ event: "game:vote", input: { ...base(), targetSeatId } }),
  };
}

export type { GameSession } from "./game-session.ts";
