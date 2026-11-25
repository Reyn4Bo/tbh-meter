// Damage TYPE / ELEMENT breakdown helpers (combat plugin >= 0.4). The plugin keys each hit by the game's own
// enums: EDamageType is a [Flags] combo (6 = Projectile|AOE — shown "Projectile+AOE", like the in-game
// tooltip), EDamageAttribute an element. Pure; labels are resolved through i18n by the caller.
import type { DictKey } from "../../../shared/i18n/index.js";

/** EDamageType flags, in the game's order (dump: Melee 1 · Projectile 2 · AOE 4 · Summon 8 · DOT 16 · Trap 32). */
export const DMG_TYPE_FLAGS = [
  [1, "Melee"],
  [2, "Projectile"],
  [4, "AOE"],
  [8, "Summon"],
  [16, "DOT"],
  [32, "Trap"],
] as const;

/** EDamageAttribute (dump: Physical 0 · Fire 1 · Cold 2 · Lightning 3 · Chaos 4 · AllElement 5 · NONE 6). */
export const ELEMENT_NAMES: Record<number, "Physical" | "Fire" | "Cold" | "Lightning" | "Chaos" | "AllElement" | "None"> = {
  0: "Physical",
  1: "Fire",
  2: "Cold",
  3: "Lightning",
  4: "Chaos",
  5: "AllElement",
  6: "None",
};

/** Fixed element colours (same hues as the resistance tooltip's dots). */
export const ELEMENT_BG: Record<number, string> = {
  0: "bg-zinc-300",
  1: "bg-orange-400",
  2: "bg-sky-400",
  3: "bg-yellow-300",
  4: "bg-fuchsia-400",
  5: "bg-emerald-400",
  6: "bg-zinc-500",
};

/** Damage-type colours by RANK (largest slice first) — types are combos, so no fixed per-type hue. */
/** Damage-TYPE colours, by rank. Deliberately avoids every ELEMENT_BG hue (no sky/orange/yellow/fuchsia/zinc):
 *  the type bar sits right above the element bar in the tooltip and run detail, so a shared colour would read
 *  as "Projectile = Cold". Rank 0 is teal, not indigo: the run detail's per-hero DPS-share bar (brand) sits just
 *  above, and an indigo type bar merged into it. */
export const TYPE_BG = ["bg-teal-400", "bg-violet-400", "bg-rose-400", "bg-lime-400", "bg-indigo-400", "bg-stone-500"];

export interface Slice {
  key: number;
  value: number;
  /** value / Σ values (0..1). */
  share: number;
}

/** A breakdown map → slices sorted largest first, with shares. [] for an empty/absent map. */
export function slices(map: Record<number, number> | null | undefined): Slice[] {
  if (!map) return [];
  const entries = Object.entries(map)
    .map(([k, v]) => ({ key: Number(k), value: v }))
    .filter((e) => Number.isFinite(e.key) && e.value > 0);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return [];
  return entries.sort((a, b) => b.value - a.value).map((e) => ({ ...e, share: e.value / total }));
}

/** i18n keys of a damage-type flag combo, in flag order ([] → the "other" key). */
export function damageTypeKeys(flags: number): DictKey[] {
  const keys = DMG_TYPE_FLAGS.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => `dmgType.${name}` as DictKey);
  return keys.length > 0 ? keys : ["dmgType.Other"];
}

/** i18n key of an element. */
export function elementKey(attr: number): DictKey {
  return `element.${ELEMENT_NAMES[attr] ?? "None"}` as DictKey;
}
