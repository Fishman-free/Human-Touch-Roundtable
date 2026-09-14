import { ArrowRight, CircleDot, Eye, Users, HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { RulesDialog } from "./rules-dialog.tsx";
import type { GameSession } from "../../client/game-session.ts";
import type { GameTheme } from "../../ui/theme/types.tsx";

export function EntryScreen({ session, theme }: { session: GameSession; theme?: GameTheme }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const text = "坐下来，带着一个观点，也带着一点犹豫。";
    const media = gsap.matchMedia();
    media.add({ reduce: "(prefers-reduced-motion: reduce)", animate: "(prefers-reduced-motion: no-preference)" }, context => {
      if (context.conditions?.reduce) { setTyped(text); return; }
      let index = 0;
      setTyped("");
      const timer = window.setInterval(() => {
        setTyped(text.slice(0, ++index));
        if (index >= text.length) window.clearInterval(timer);
      }, 55);
      gsap.timeline({ defaults: { ease: "power2.out", clearProps: "transform,opacity" } })
        .from(".entry-nav", { opacity: 0, y: -8, duration: 0.35 }, 0)
        .from(".entry-mascot", { opacity: 0, y: 24, scale: 0.96, duration: 0.7 }, 0)
        .from(".entry-eyebrow, .entry-description", { opacity: 0, y: 8, duration: 0.4, stagger: 0.08 }, 0.15)
        .from(".entry-workspace", { opacity: 0, y: 8, duration: 0.4 }, 0.4);
      return () => window.clearInterval(timer);
    }, root);
    return () => media.revert();
  }, []);
  return <main className="entry-hero" ref={root}>
    <div className="entry-backdrop" aria-hidden="true" />
    <figure className="entry-mascot" aria-hidden="true"><img src="/avatars/1-trim.png" alt="" width="1449" height="1207" fetchPriority="high" /><figcaption>看山 · 等你入席</figcaption></figure>
    <nav className="entry-nav"><div className="entry-nav-brand"><span>◒</span><strong>人味圆桌局</strong></div><div className="entry-links"><a href="#enter">入席</a><a href="#rules">观战</a><button type="button" className="nav-rules-button" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}><HelpCircle size={18} />规则</button></div><div className="entry-nav-status"><i className={session.connected ? "is-online" : ""} />{session.connected ? "服务在线" : "连接中"}</div><button className="menu-button" aria-label="打开菜单">☰</button></nav>
    <section className="entry-content" id="enter"><p className="entry-eyebrow">欢迎来到人味圆桌局 · 在真实观点之间，听见人的判断</p><h1>{typed}<span className="type-cursor">▌</span></h1><p className="entry-description">一张桌，八个匿名座位。回答、质询、投票，看看观点背后是谁。</p>
    <div className="entry-workspace">
      <div className="mode-switch" aria-label="进入身份"><button className={session.mode === "player" ? "active" : ""} onClick={() => session.setMode("player")}><Users size={17} />玩家</button><button className={session.mode === "spectator" ? "active" : ""} onClick={() => session.setMode("spectator")}><Eye size={17} />观战</button></div>
      <label htmlFor="room">房间号</label><input id="room" placeholder="输入房间号" value={session.roomId} maxLength={24} autoComplete="off" onChange={event => session.setRoomId(event.target.value.toLowerCase())} onKeyDown={event => { if (event.key === "Enter") session.join(); }} />
      <div className="entry-actions"><button className="primary" disabled={!session.connected || session.busy} onClick={session.join}>进入房间<ArrowRight size={18} /></button><button className="secondary" disabled={!session.connected || session.busy} onClick={session.create}>创建新房</button></div>
      <div className={`entry-status ${session.connected ? "online" : ""}`}><CircleDot size={14} />{session.connected ? "服务已连接 · 随时可以入席" : "正在连接服务"}</div>{session.error && <p className="form-error" role="alert">{session.error}</p>}
    </div></section>
    <footer className="entry-footer">匿名代号按座位固定映射 · 看山 / 听雨 / 观雾 / 闻花</footer>
    {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
  </main>;
}
