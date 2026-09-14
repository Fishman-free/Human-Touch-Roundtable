import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Bot, Check, CircleDot, Clock3, Eye, LogOut, MessageSquare, RotateCcw, Scale, Send, Swords, Users, Vote } from "lucide-react";
import type { RoomView } from "../../contracts/public.ts";
import type { GameSession } from "../../client/game-session.ts";
import type { RoomSlots } from "../../ui/room-slots.ts";
import { charCount, PLAYER_LIMITS } from "../../contracts/rules.ts";
import { gamePresentation as copy, seatLabel, seatAlias } from "../../ui/presentation/game-presentation.ts";
import type { GameTheme } from "../../ui/theme/types.tsx";

type SeatGridStyle = CSSProperties & { "--seat-columns": number };

export function GameScreen({ session, theme, slots: overrides }: {
  session: GameSession; theme: GameTheme; slots?: Partial<RoomSlots>;
}) {
  const slots = { ...defaultRoomSlots, ...overrides };
  const view = session.view!;
  return <main className="game-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-symbol" aria-hidden="true">◒</span><strong>{copy.brand.name}</strong><span>/ {session.roomId}</span></div>
      <div className="top-actions">
        <span className={`connection ${session.connected ? "online" : ""}`}><CircleDot size={13} />{session.connected ? "在线" : "重连中"}</span>
        <span className="phase-badge">{copy.phase[view.phase]}</span>
        <button className="icon-button" onClick={session.leave} title="退出当前视图" aria-label="退出当前视图"><LogOut size={18} /></button>
      </div>
    </header>
    {session.error && <div className="notice error" role="alert">{session.error}</div>}
    {view.phase === "lobby" ? <slots.Lobby view={view} busy={session.busy} ready={session.ready} /> :
      view.phase === "preparing" ? <slots.Preparing view={view} /> : <Game view={view} session={session} theme={theme} slots={slots} />}
  </main>;
}

function Lobby({ view, busy, ready }: { view: RoomView; busy: boolean; ready: (value: boolean) => void }) {
  const isPlayer = view.lobby?.selfReady !== undefined;
  return <section className="lobby-band">
    <div className="lobby-count"><span>{view.lobby?.count ?? 0}</span><small>/ {PLAYER_LIMITS.max} 真人已入席</small></div>
    <div className="lobby-copy"><p className="kicker">等待开席</p><h2>{isPlayer ? "全员准备后，圆桌立即开局" : "正在等待玩家准备"}</h2>
      <div className="ready-track"><i style={{ width: `${((view.lobby?.readyCount ?? 0) / Math.max(PLAYER_LIMITS.min, view.lobby?.count ?? 0)) * 100}%` }} />
        <span>{view.lobby?.readyCount ?? 0} 人已准备，至少 {PLAYER_LIMITS.min} 人</span></div></div>
    {isPlayer ? <button className={view.lobby?.selfReady ? "secondary large" : "primary large"} disabled={busy}
      onClick={() => ready(!view.lobby?.selfReady)}>{view.lobby?.selfReady ? "取消准备" : <><Check size={19} />准备</>}</button>
      : <div className="spectator-mark"><Eye size={20} />观战席</div>}
  </section>;
}

function Preparing({ view }: { view: RoomView }) {
  return <section className="preparing"><div className="loader" /><p className="kicker">正在连线知乎问题</p>
    <h2>题目确认后自动开席</h2><p>{view.self ? `你的身份：${copy.role[view.self.role]}` : "观战席已就位"}</p></section>;
}

function Game({ view, session, theme, slots }: { view: RoomView; session: GameSession; theme: GameTheme; slots: RoomSlots }) {
  return <>
    <section className="topic-band"><div><p className="kicker">本局知乎问题</p><h2>{view.topic?.title}</h2>
      <a href={view.topic?.url} target="_blank" rel="noreferrer">查看原问题 <ArrowRight size={14} /></a></div>
      <div className="private-role"><span>你的身份</span><strong>{view.self ? copy.role[view.self.role] : "观战者"}</strong></div></section>
    <slots.StageRail view={view} />
    <slots.Roundtable view={view} theme={theme} />
    {view.phase === "answering" && <slots.Answer view={view} busy={session.busy} submit={session.answer} />}
    {view.phase === "debating" && <slots.Debate view={view} busy={session.busy} accuse={session.accuse}
      respond={session.respond} followup={session.followup} skip={session.skipFollowup} />}
    {view.phase === "voting" && <slots.Voting view={view} busy={session.busy} vote={session.castVote} />}
    {view.phase === "revealed" && <slots.Reveal view={view} theme={theme} session={session} />}
  </>;
}

function StageRail({ view }: { view: RoomView }) {
  let active = 0;
  if (view.phase === "answering") active = (view.round ?? 1) - 1;
  else if (view.phase === "debating") active = 3;
  else if (view.phase === "voting") active = 4;
  else if (view.phase === "revealed") active = 5;
  return <nav className="stage-rail" aria-label="游戏进度">{copy.stages.map((step, index) => <span key={step}
    className={index === active ? "active" : index < active ? "done" : ""}>{index < active ? <Check size={13} /> : index + 1}{step}</span>)}</nav>;
}

function Roundtable({ view, theme }: { view: RoomView; theme: GameTheme }) {
  const answered = new Set(view.round ? view.answers[view.round].map(item => item.seatId) : []);
  const voted = new Set(view.votes.map(item => item.voterSeatId));
  const style: SeatGridStyle = { "--seat-columns": theme.seatColumns(view.seats.length) };
  return <section className="table-scene" aria-label="圆桌座位">
    <div className="roundtable-chat" aria-label="公开发言"><strong>圆桌发言</strong>{view.log.filter(item => item.type === "answer").slice(-3).map(item => <p key={item.seq}><b>{seatAlias(item.seatId)}</b> {item.text}</p>)}</div><div className="table-center"><Scale size={24} /><span>{view.phase === "answering" ? `第 ${view.round} 轮` : copy.phase[view.phase]}</span></div>
    <div className={`seat-grid seat-count-${view.seats.length}`} style={style}>{view.seats.map(seat => {
      const role = view.result?.roles.find(item => item.seatId === seat.seatId)?.role;
      const eliminated = view.result?.eliminatedSeatIds.includes(seat.seatId);
      const active = view.debate?.accuserSeatId === seat.seatId || view.debate?.targetSeatId === seat.seatId;
      const isSelf = seat.seatId === view.self?.seatId;
      const status = eliminated ? "已完成 · 出局" : active ? "当前行动者" : view.phase === "answering" && !answered.has(seat.seatId) ? "等待发言" : "在席";
      const latestAnswer = view.log.filter(item => item.type === "answer" && item.seatId === seat.seatId).at(-1);
      return <article key={seat.seatId} className={`seat ${active ? "speaking" : ""} ${eliminated ? "eliminated" : ""} ${isSelf ? "current-user" : ""}`}>
        {latestAnswer && <div className="seat-chat">{latestAnswer.text}</div>}
        <div className={`seat-avatar ${isSelf ? "self" : ""}`}><img src={`/avatars/image${((seat.displayNumber - 1) % 8) + 1}.png`} alt="" /><span>{seat.displayNumber}</span></div><strong>{seatAlias(seat.seatId)}{isSelf && <em className="self-badge">你</em>}</strong><small>{view.phase === "revealed"
          ? `${role ? copy.role[role] : "未知"}${eliminated ? " · 出局" : " · 存活"}`
          : view.phase === "answering" ? (answered.has(seat.seatId) ? "已发言" : "思考中")
          : view.phase === "voting" ? (voted.has(seat.seatId) ? "已投票" : "观察中") : status}</small>
      </article>;
    })}</div>
  </section>;
}

function Timer({ view }: { view: RoomView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.ceil(((view.deadlineAt ?? now) - now) / 1000));
  return <span className={`timer ${remaining <= 10 ? "urgent" : ""}`}><Clock3 size={16} />
    {Math.floor(remaining / 60).toString().padStart(2, "0")}:{(remaining % 60).toString().padStart(2, "0")}</span>;
}

function AnswerStage({ view, busy, submit }: { view: RoomView; busy: boolean; submit: GameSession["answer"] }) {
  const [text, setText] = useState("");
  const [stance, setStance] = useState<"pro" | "con">("pro");
  const round = view.round!;
  useEffect(() => { setText(""); setStance("pro"); }, [round]);
  const presentation = copy.rounds[round];
  const used = charCount(round === 2 ? `${stance === "pro" ? "正方" : "反方"}：${text.trim()}` : text.trim());
  const canAnswer = view.actions.includes("answer");
  // Everyone has spoken, but the round stays open for a beat: the service holds the
  // phase so the last answers can be read, and this line says so instead of asking
  // the player to keep waiting for seats that are already done.
  const roundSpoken = view.round ? view.answers[view.round].length >= view.seats.length : false;
  return <section className="play-band"><header className="stage-header"><div><p className="kicker">第 {round} 轮</p>
    <h2>{presentation.title}</h2><p>{presentation.prompt}</p></div><Timer view={view} /></header>
    {round === 3 && view.topic?.topAnswerExcerpt && <blockquote className="source-answer">{view.topic.topAnswerExcerpt}</blockquote>}
    <div className="answer-stream">{view.answers[round].map(answer => <article key={answer.seatId}><span>{seatLabel(answer.seatId)}</span><p>{answer.text}</p></article>)}</div>
    {canAnswer ? <div className="composer">{round === 2 && <div className="stance-switch">
      <button className={stance === "pro" ? "active" : ""} onClick={() => setStance("pro")}>正方</button>
      <button className={stance === "con" ? "active" : ""} onClick={() => setStance("con")}>反方</button></div>}
      <textarea value={text} onChange={event => setText(event.target.value)} placeholder="写下你的回答" rows={3} />
      <div className="composer-foot"><span className={used > presentation.limit ? "over" : ""}>{used} / {presentation.limit}</span>
        <button className="primary" disabled={busy || !text.trim() || used > presentation.limit}
          onClick={() => submit(text, round === 2 ? stance : undefined)}><Send size={17} />确认发言</button></div></div>
      : <div className="waiting-line"><Check size={17} />{roundSpoken ? "本轮发言已结束，请浏览各方回答"
        : view.self ? "你的回答已锁定，等待其他座位" : "正在观看本轮发言"}</div>}
  </section>;
}

function DebateStage(props: { view: RoomView; busy: boolean; accuse: GameSession["accuse"];
  respond: GameSession["respond"]; followup: GameSession["followup"]; skip: GameSession["skipFollowup"] }) {
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  useEffect(() => { setTarget(""); setText(""); }, [props.view.phaseToken]);
  const actions = props.view.actions;
  const entries = props.view.log.filter(item => ["accusation", "response", "followup", "skip-followup"].includes(item.type));
  function send() {
    if (actions.includes("accuse")) props.accuse(target, text);
    else if (actions.includes("respond")) props.respond(text);
    else if (actions.includes("followup")) props.followup(text);
  }
  const actionable = actions.some(item => ["accuse", "respond", "followup", "skip-followup"].includes(item));
  return <section className="play-band"><header className="stage-header"><div><p className="kicker">顺序行动</p><h2><Swords size={23} />圆桌质询</h2>
    <p>{seatLabel(props.view.debate?.accuserSeatId)} 指认 · {props.view.debate?.targetSeatId ? `${seatLabel(props.view.debate.targetSeatId)} 应答` : "等待选择目标"}</p></div><Timer view={props.view} /></header>
    <div className="debate-stream">{entries.map(entry => <article key={entry.seq}><span>{seatLabel(entry.seatId)} · {entry.type === "accusation"
      ? `指认 ${seatLabel(entry.targetSeatId ?? undefined)}` : entry.type === "response" ? "回应" : entry.type === "followup" ? "追问" : "结束追问"}</span><p>{entry.text ?? "没有追加问题"}</p></article>)}</div>
    {actionable ? <div className="composer">{actions.includes("accuse") && <select value={target} onChange={event => setTarget(event.target.value)}>
      <option value="">选择指认座位</option>{props.view.seats.filter(seat => seat.seatId !== props.view.self?.seatId)
        .map(seat => <option value={seat.seatId} key={seat.seatId}>{seatLabel(seat.seatId)}</option>)}</select>}
      <textarea value={text} onChange={event => setText(event.target.value)} rows={3}
        placeholder={actions.includes("respond") ? "回应这次指认" : actions.includes("followup") ? "追加一个问题" : "说出你的判断"} />
      <div className="composer-foot"><span>{actions.includes("respond") ? "回应" : actions.includes("followup") ? "追问" : "指认"}</span><div>
        {actions.includes("skip-followup") && <button className="secondary" disabled={props.busy} onClick={props.skip}>不再追问</button>}
        <button className="primary" disabled={props.busy || !text.trim() || (actions.includes("accuse") && !target)} onClick={send}><MessageSquare size={17} />发送</button>
      </div></div></div> : <div className="waiting-line"><Eye size={17} />观察他们的反应</div>}
  </section>;
}

function VotingStage({ view, busy, vote }: { view: RoomView; busy: boolean; vote: GameSession["castVote"] }) {
  const [target, setTarget] = useState("");
  useEffect(() => { setTarget(""); }, [view.phaseToken]);
  const canVote = view.actions.includes("vote");
  return <section className="play-band"><header className="stage-header"><div><p className="kicker">每人仅一票</p>
    <h2><Vote size={23} />最终投票</h2><p>已公开的投票不能撤回</p></div><Timer view={view} /></header>
    <div className="vote-grid">{view.seats.filter(seat => seat.seatId !== view.self?.seatId).map(seat => <button key={seat.seatId}
      className={target === seat.seatId ? "selected" : ""} disabled={!canVote} onClick={() => setTarget(seat.seatId)}>
      <span>{seat.displayNumber}</span>{seatLabel(seat.seatId)}</button>)}</div>
    {canVote && <button className="primary confirm-vote" disabled={busy || !target} onClick={() => vote(target)}><Vote size={18} />确认投给 {seatLabel(target)}</button>}
    <div className="vote-ledger"><h3>公开票路</h3>{view.votes.length ? view.votes.map(item => <p key={item.voterSeatId}>
      <span>{seatLabel(item.voterSeatId)}</span><ArrowRight size={14} /><strong>{seatLabel(item.targetSeatId ?? undefined)}</strong></p>)
      : <p className="muted">尚无人投票</p>}</div>
  </section>;
}

function RevealStage({ view, theme, session }: { view: RoomView; theme: GameTheme; session: GameSession }) {
  const result = view.result!;
  return <section className="reveal-band"><div className={`verdict ${result.winner}`}><span>本局裁决</span><h2>{copy.winner[result.winner]}</h2></div>
    <div className="rematch-band">
      {session.canRematch
        ? <><button className="primary large" disabled={session.busy} onClick={session.rematch}><RotateCcw size={18} />再来一局</button>
          <button className="secondary large" disabled={session.busy} onClick={session.leave}>回到大厅</button>
          <p>回到匹配队列，和新的对手再开一局。</p></>
        : <><button className="primary large" onClick={session.leave}><ArrowRight size={18} />回到大厅</button>
          <p>用知乎账号登录后，这里可以直接一键重新匹配。</p></>}
    </div>
    {theme.assets.revealArtwork && <img className="reveal-artwork" src={theme.assets.revealArtwork} alt="" />}
    <div className="identity-list">{view.seats.map(seat => { const role = result.roles.find(item => item.seatId === seat.seatId)!.role;
      return <article key={seat.seatId}><div className={`role-icon ${role}`}>{role === "ai" ? <Bot /> : role === "shadow" ? <Eye /> : <Users />}</div>
        <div><strong>{seatLabel(seat.seatId)}</strong><span>{copy.role[role]} · {result.eliminatedSeatIds.includes(seat.seatId) ? "出局" : "存活"}</span></div></article>;
    })}</div>
    <div className="full-log"><h3>完整对局日志</h3>{view.log.filter(item => item.type !== "phase").map(item => <article key={item.seq}>
      <time>#{item.seq.toString().padStart(2, "0")}</time><span>{item.type === "answer" ? `第${item.round}轮 · ${seatLabel(item.seatId)}`
        : item.type === "vote" ? `${seatLabel(item.seatId)} 投给 ${seatLabel(item.targetSeatId ?? undefined)}` : `${seatLabel(item.seatId)} · ${item.type}`}</span><p>{item.text}</p></article>)}</div>
  </section>;
}

export const defaultRoomSlots: RoomSlots = {
  Lobby, Preparing, StageRail, Roundtable, Answer: AnswerStage, Debate: DebateStage,
  Voting: VotingStage, Reveal: RevealStage,
};
