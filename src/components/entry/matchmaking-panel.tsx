import type { MatchmakingControls } from "../../client/use-matchmaking.ts";

export function MatchmakingPanel({ controls, disabled }: { controls: MatchmakingControls; disabled: boolean }) {
  const { account, waiting, busy, error } = controls;
  return <section className="matchmaking-panel" aria-label="联网匹配">
    <div className="matchmaking-heading"><strong>找人一起坐下</strong>
      {account?.user && <button type="button" className="nav-rules-button" disabled={busy || disabled} onClick={controls.logout}>退出登录</button>}
    </div>
    {!account ? <p role="status">正在获取登录状态…</p> : !account.enabled ?
      <p>知乎登录暂未开放，你仍可以通过房间号与朋友入席。</p> : !account.user ? <>
        <p>用知乎账号登录后匹配，局内仍使用匿名看山形象。</p>
        <a className="matchmaking-login" href="/api/auth/zhihu/start">使用知乎登录</a>
      </> : <>
        <p>你好，{account.user.name || "知乎用户"}。两名真人成桌，请在匹配后2分钟内双方准备开局。</p>
        <div className="entry-actions"><button type="button" className="primary" disabled={disabled || busy || waiting} onClick={controls.join}>
          {waiting ? "正在寻找另一位玩家…" : "开始匹配"}</button>
          {waiting && <button type="button" className="secondary" disabled={disabled || busy} onClick={controls.cancel}>取消匹配</button>}
        </div>
        <p role="status">{waiting ? "请保持页面在线；关闭页面后约30秒退出等待队列。" : "知乎资料仅自己可见，匹配对手看不到你的账号。"}</p>
      </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
