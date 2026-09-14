"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountStatus, MatchStatus } from "../contracts/public.ts";

export interface MatchmakingControls {
  account: AccountStatus | null;
  waiting: boolean;
  busy: boolean;
  error: string;
  join(): void;
  cancel(): void;
  logout(): void;
}

export function useMatchmaking(suspended: boolean,
  onMatched: (roomId: string, sessionToken: string) => void): MatchmakingControls {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(true);
  const lock = useRef(false);
  const alive = useRef(false);
  const suspendedRef = useRef(suspended); suspendedRef.current = suspended;
  const matchedRef = useRef(onMatched); matchedRef.current = onMatched;

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    if (new URLSearchParams(location.search).get("login") === "failed") {
      setError("知乎登录未完成，请重试；若持续失败，请核对应用回调配置");
      history.replaceState(null, "", location.pathname);
    }
    void fetch("/api/auth/session", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const status: AccountStatus = await response.json();
      if (alive.current) setAccount(status);
    }).catch(() => { if (!controller.signal.aborted) setError("暂时无法获取登录状态，请刷新重试"); });
    return () => { alive.current = false; controller.abort(); };
  }, []);

  async function request(action: "join" | "poll" | "cancel") {
    if (lock.current || suspendedRef.current) return;
    lock.current = true;
    if (action !== "poll") setBusy(true);
    try {
      const response = await fetch(`/api/matchmaking?action=${action}`, {
        method: "POST", signal: AbortSignal.timeout(10_000), cache: "no-store",
      });
      if (response.status === 401) {
        setAccount(current => current ? { ...current, user: null } : current);
        setWaiting(false); throw new Error("登录已过期，请重新登录知乎");
      }
      if (!response.ok) throw new Error("匹配暂时不可用，请稍后重试");
      const result: MatchStatus = await response.json();
      if (!alive.current || suspendedRef.current) return;
      setError(""); setWaiting(result.status === "waiting");
      if (result.status !== "waiting") setTracking(false);
      if (result.status === "matched") matchedRef.current(result.roomId, result.sessionToken);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error && failure.name === "Error" ? failure.message : "网络中断，正在等待恢复匹配状态");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  useEffect(() => {
    if (!account?.user || suspended || !tracking) return;
    void request("poll");
    const timer = window.setInterval(() => { void request("poll"); }, 3_000);
    return () => window.clearInterval(timer);
    // Polling follows account/room lifecycle; current callbacks and the request lock are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.user, suspended, tracking]);

  async function logout() {
    if (lock.current || suspendedRef.current) return;
    lock.current = true; setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(10_000) });
      if (!response.ok && response.status !== 401) throw new Error();
      setAccount(current => current ? { ...current, user: null } : current); setWaiting(false); setError("");
    } catch { setError("退出失败，请检查网络后重试"); }
    finally { lock.current = false; setBusy(false); }
  }
  return { account, waiting, busy, error, join: () => { setTracking(true); void request("join"); },
    cancel: () => { void request("cancel"); }, logout: () => { void logout(); } };
}
