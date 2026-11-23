// Per-hero DPS rows for the live overlay (the stacked share bar, the party avatars and their hover
// card all read the SAME rows, so a hero's colour/number agree everywhere). Data comes from the
// OPTIONAL in-game combat plugin via the reader (LiveSnapshot.partyDamage); without it this returns
// null and the overlay shows team DPS only.
import type { LiveHeroDamage } from "../../../shared/run-types.js";

/** Fixed per-position palette (bar fill / text), assigned in formation order so slot 0 is always the
 *  same colour. Wide enough for a full 6-hero roster switch mid-session. */
export const HERO_DPS_BG = ["bg-sky-400", "bg-fuchsia-400", "bg-amber-400", "bg-emerald-400", "bg-rose-400", "bg-orange-300"];
export const HERO_DPS_TEXT = ["text-sky-300", "text-fuchsia-300", "text-amber-300", "text-emerald-300", "text-rose-300", "text-orange-200"];

export interface HeroDpsRow {
  heroKey: number;
  damage: number;
  /** damage / elapsed (floored at 1s) — the same reference as the team DPS, so the rows sum to it. */
  dps: number;
  /** damage / Σ damage of the rows (0..1). */
  share: number;
  /** crits / hits (0..1), null before the first hit. */
  critRate: number | null;
  hits: number;
  /** Index into HERO_DPS_BG / HERO_DPS_TEXT. */
  color: number;
  /** EDamageType combo / EDamageAttribute → damage (plugin >= 0.4; {} otherwise). */
  byType: Record<number, number>;
  byAttribute: Record<number, number>;
}

/** Rows in formation order (`party`), followed by any hero that dealt (or, for the TAKEN rows, received)
 *  damage this run but is no longer
 *  deployed (e.g. swapped out). A deployed hero with no damage yet gets a 0 row so the bar/avatars stay
 *  aligned. Null when there is no per-hero data (plugin not running / older reader). Pure. */
export function heroDpsRows(
  party: number[] | null | undefined,
  partyDamage: Record<number, LiveHeroDamage> | null | undefined,
  elapsedSec: number,
): HeroDpsRow[] | null {
  if (!partyDamage) return null;
  const order = [...(party ?? [])];
  for (const k of Object.keys(partyDamage).map(Number)) if (!order.includes(k)) order.push(k);
  if (order.length === 0) return null;
  const total = order.reduce((s, k) => s + (partyDamage[k]?.damage ?? 0), 0);
  const ref = Math.max(elapsedSec, 1);
  return order.map((heroKey, i) => {
    const d = partyDamage[heroKey];
    const damage = d?.damage ?? 0;
    const hits = d?.hits ?? 0;
    return {
      heroKey,
      damage,
      dps: damage / ref,
      share: total > 0 ? damage / total : 0,
      critRate: hits > 0 ? (d?.crits ?? 0) / hits : null,
      hits,
      color: i % HERO_DPS_BG.length,
      byType: d?.byType ?? {},
      byAttribute: d?.byAttribute ?? {},
    };
  });
}

/** Compact share label: "48%", "<1%" for a non-zero sliver, "0%". */
export function sharePct(share: number): string {
  if (share <= 0) return "0%";
  const pct = share * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}
