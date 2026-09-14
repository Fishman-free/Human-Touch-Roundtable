import type { CSSProperties } from "react";
import type { RoomView } from "../../contracts/public.ts";
import type { GameTheme } from "../../ui/theme/types.tsx";
import { seatAlias } from "../../ui/presentation/game-presentation.ts";

/** Standalone visual fixture for reviewing the seat ring without a live session. */
export function RoundtablePreview({ view, theme }: { view: RoomView; theme: GameTheme }) {
  return <section className="table-scene" aria-label="圆桌预览">
    <div className="table-center">圆桌局</div>
    <div className="seat-grid" style={{ "--seat-columns": theme.seatColumns(view.seats.length) } as CSSProperties}>
      {view.seats.map((seat) => <article className="seat" key={seat.seatId}>
        <div className="seat-avatar"><span>{seat.displayNumber}</span></div>
        <strong>{seatAlias(seat.seatId)}</strong><small>预览席位</small>
      </article>)}
    </div>
  </section>;
}
