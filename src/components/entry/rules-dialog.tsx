import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import gsap from "gsap";

export function RulesDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(dialog, { opacity: 0, y: 8, duration: 0.24, ease: "power2.out", clearProps: "opacity,transform" });
    });
    return () => {
      motion.revert();
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, []);
  return <div className="game-rules-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <header className="game-rules-header"><div><p>开席前须知</p><h2 id="rules-title">人味圆桌局怎么玩？</h2></div>
      <button autoFocus type="button" aria-label="关闭游戏规则" onClick={onClose}><X size={22} /></button></header>
    <div className="game-rules-content">
      <p className="rules-summary">围绕同一道题，经过三轮回答、逐席质询和一次投票，判断谁是 AI，谁在模仿 AI。</p>
      <section><h3>01 · 入席与准备</h3><p>真人玩家 2～5 人，至少 2 人且所有入座玩家都点击「准备」后自动开局，无需房主。开局后不能再加入玩家；观战者随时可进，不占座，也不参与答题和投票。</p>
        <table><caption>座位随真人数量变化</caption><thead><tr><th>真人玩家</th><th>普通人</th><th>影子</th><th>AI</th><th>总座位</th></tr></thead><tbody>{[[2,1,1,1,3],[3,2,1,2,5],[4,2,2,2,6],[5,3,2,3,8]].map(row => <tr key={row[0]}>{row.map((value, i) => <td key={i}>{value}</td>)}</tr>)}</tbody></table>
        <p>公开代号按座位固定为：看山、听雨、观雾、闻花、说岳、读江、拾叶、踏径。代号不代表身份；结算前不会公开其他座位身份。</p></section>
      <section><h3>02 · 三种角色</h3><ul><li><strong>普通人：</strong>真人玩家，目标是投出全部 AI。</li><li><strong>影子：</strong>真人玩家，需要在回答、指认和投票中模仿 AI。普通人未胜且所有影子存活时，影子阵营获胜。</li><li><strong>AI：</strong>由模型参与回答、质询和投票。普通人与影子都未达成胜利条件时，AI 获胜。</li></ul></section>
      <section><h3>03 · 三轮回答</h3><p>三轮使用同一道题，每轮 90 秒，不限发言顺序；确认提交后公开展示，不能修改。</p><ol><li>第一轮：一句话总结高赞共识，最多 30 字。</li><li>第二轮：选择正方或反方，并给一个理由，最多 50 字。</li><li>第三轮：给本局选定的高赞回答写一条评论区回复，最多 40 字。</li></ol><p>超时未提交会记为默认答案，并自动推进。</p></section>
      <section><h3>04 · 逐席质询</h3><p>三轮回答结束后，按座位顺序指认另一位「你是 AI」。指认限时 20 秒，被指认者应答 45 秒，指认者可追问一次，限时 20 秒。全桌围观，辩论总时长最多 8 分钟，到时进入投票。</p></section>
      <section><h3>05 · 一次投票</h3><p>投票限时 60 秒，每个座位一票，不可投自己、不可主动弃权、不可改票。「谁投了谁」实时公开；超时未投票记为未投票，没有效果。</p><p><strong>只有普通人的票能让目标出局：</strong>目标被至少一张普通人票命中即出局。影子和 AI 的票仅作干扰，不影响出局判定。普通人投中同一个 AI 会浪费机会，需要分别命中不同 AI 才能全歼。</p></section>
      <section><h3>06 · 胜负与揭示</h3><p>投票结束后揭示全部身份，依次判断：</p><ol><li>全部 AI 被普通人的票投出：普通人胜，即使同时有影子出局。</li><li>其余一切情况（含影子被投出、普通人未全歼 AI）：影子胜。</li></ol><p>结算页可查看答案、质询、投票记录与身份对照。</p></section>
      <section><h3>断线怎么办？</h3><p>断线后座位保留，重连可恢复原座位与当前状态；断线期间倒计时仍会继续，回答超时按默认答案处理。</p></section>
      <button className="rules-understood" type="button" onClick={onClose}>明白了，准备入席</button>
    </div>
  </div>;
}
