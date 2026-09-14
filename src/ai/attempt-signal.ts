// Races an outer abort signal against a per-attempt timeout. Shared by the game
// action gateway and by topic content generation so both apply identical
// cancellation semantics instead of carrying two copies of the same race.

export function attemptSignal(outer: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer.addEventListener("abort", abort, { once: true });
  if (outer.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  return { signal: controller.signal, timedOut: () => !outer.aborted && controller.signal.aborted,
    close: () => { clearTimeout(timeout); outer.removeEventListener("abort", abort); } };
}
