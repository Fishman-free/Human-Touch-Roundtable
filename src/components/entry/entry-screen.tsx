import { ArrowRight, CircleDot, Eye, Scale, Users } from "lucide-react";
import type { GameSession } from "../../client/game-session.ts";
import type { GameTheme } from "../../ui/theme/types.tsx";
import { gamePresentation as copy } from "../../ui/presentation/game-presentation.ts";

export function EntryScreen({ session, theme }: { session: GameSession; theme?: GameTheme }) {
  return <main className="entry-shell">
    <header className="entry-brand">{theme?.assets.brandMark
      ? <img className="brand-artwork" src={theme.assets.brandMark} alt="" />
      : <Scale size={38} strokeWidth={1.4} />}<div><h1>{copy.brand.name}</h1><p>{copy.brand.subtitle}</p></div></header>
    <section className="entry-workspace">
      <div className="mode-switch" aria-label="进入身份">
        <button className={session.mode === "player" ? "active" : ""} onClick={() => session.setMode("player")}><Users size={17} />玩家</button>
        <button className={session.mode === "spectator" ? "active" : ""} onClick={() => session.setMode("spectator")}><Eye size={17} />观战</button>
      </div>
      <label htmlFor="room">房间号</label>
      <input id="room" value={session.roomId} maxLength={24} autoComplete="off"
        onChange={event => session.setRoomId(event.target.value.toLowerCase())}
        onKeyDown={event => { if (event.key === "Enter") session.join(); }} />
      <div className="entry-actions">
        <button className="primary" disabled={!session.connected || session.busy} onClick={session.join}>进入房间<ArrowRight size={18} /></button>
        <button className="secondary" disabled={!session.connected || session.busy} onClick={session.create}>创建新房</button>
      </div>
      <div className={`entry-status ${session.connected ? "online" : ""}`}><CircleDot size={14} />{session.connected ? "服务已连接" : "正在连接服务"}</div>
      {session.error && <p className="form-error" role="alert">{session.error}</p>}
    </section>
  </main>;
}
