// Plaguelands pollution gauge (game 1.3.2, shown in game as "28/500") — pure helpers shared by the main
// process (cooking live.json + the "full" notification) and the renderer (overlay row + full card).
// The reader decodes it from live memory (reader/metrics/pollution.py); it charges +1 every `chargeSec`
// outside the Plaguelands. It is ACCOUNT state, not per run.

/** The gauge as the reader emits it in live.json (`pollution`). */
export interface RawPollution {
  value: number;
  max: number;
  charge_sec: number;
}

/** The gauge on LiveSnapshot.pollution. */
export interface LivePollution {
  value: number;
  max: number;
  /** Seconds per +1 while charging (360 on 1.3.2). */
  chargeSec: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Validate the reader's gauge: all finite, max > 0, 0 <= value <= max, chargeSec > 0. Anything else
 *  (older reader → absent, unreadable → null, malformed) → null, so the overlay simply hides it. */
export function cookPollution(raw: unknown): LivePollution | null {
  if (!raw || typeof raw !== "object") return null;
  const { value, max, charge_sec: chargeSec } = raw as Partial<RawPollution>;
  if (!finite(value) || !finite(max) || !finite(chargeSec)) return null;
  if (max <= 0 || value < 0 || value > max || chargeSec <= 0) return null;
  return { value, max, chargeSec };
}

/** True when the gauge is at its cap. */
export function isPollutionFull(p: LivePollution | null | undefined): boolean {
  return p != null && p.value >= p.max;
}

/** Seconds until full while charging: (max − value) × chargeSec. An upper bound off by at most one
 *  charge period (the time already accrued toward the next +1 isn't read). 0 when already full. */
export function pollutionEtaSec(p: LivePollution): number {
  return Math.max(0, p.max - p.value) * p.chargeSec;
}

/** Rising edge "just became full": the previous reading was known and below the cap, the current one
 *  is at it. The first reading never fires (no launch spam when the meter starts on a full gauge). */
export function becameFull(prev: LivePollution | null, cur: LivePollution | null): boolean {
  return prev != null && !isPollutionFull(prev) && isPollutionFull(cur);
}
