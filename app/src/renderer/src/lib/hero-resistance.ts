// Per-hero EFFECTIVE elemental resistance for the live overlay's Team tooltip.
//
// FORMULA — confirmed live against the game panel:
//
//   effective(element) = ownResistance(element) − decrease(element) − difficultyPenalty
//   ownResistance(Fire|Cold|Lightning) = AllElementalResistance + perElementResistance
//   ownResistance(Chaos)                = ChaosResistance        ← AllElemental does NOT cover Chaos
//
// - 1.00.x data points (hero 201, 3-9 Torment): AllElemental=27 → Fire/Cold/Lightning 33%, Chaos 60%;
//   +10 Fire gem → Fire 23%, rest unchanged.
// - decrease(element) = the Decrease<Element>Resistance stats game 1.3.2 added to FINAL_STATS (ids 70/72/
//   77/80). Confirmed live (Slayer 601, 3-9 Torment): Fire 147 + All 36 − Decrease 10 − 60 = 113%, Chaos
//   136 − 0 − 60 = 76% — both exactly the in-game panel.
//
// difficultyPenalty is the per-difficulty all-resistance debuff (BuffInfoData 9100011-34, unchanged in 1.3.2):
// Normal 0 · Nightmare 20 · Hell 40 · Torment 60. A negative `effective` means the hero is VULNERABLE
// (taking extra damage of that element) — the stat the game only exposes one hero at a time in a panel.
//
// ITEM UNIQUE MODS (GearInfoData.UniqueModKey) change the result but are NOT in FINAL_STATS, so they are
// applied here from the hero's equipped item keys (live.json party_items):
// - Eternal Armor (516193, mod 1000024 ElementResistUnifyToHighest): Fire/Cold/Lightning all take the
//   HIGHEST of the three effective values. Confirmed live: Slayer with it showed Fire/Cold/Lightning 113%
//   (Fire's value) where the per-element math gives Cold −54 / Lightning −39.
// - Dimensional Armor (518173, mod 1000025 ChaosResistFromHighestElement): Chaos takes the highest
//   elemental effective value. Applied by analogy with 1000024 — NOT yet confirmed against the game panel.

// StatType ids — baked from the reader's StatType(IntEnum) in config/offsets.py (same source as
// game-data.ts STAT_NAMES). Only the resistance-relevant ids are needed here.
const STAT_FIRE_RES = 12;
const STAT_COLD_RES = 13;
const STAT_LIGHTNING_RES = 14;
const STAT_CHAOS_RES = 15;
const STAT_ALL_ELEMENTAL_RES = 52;
// Game 1.3.2 additions (StatType 70/72/77/80 in the 1.3.2 dump).
const STAT_DECREASE_FIRE_RES = 70;
const STAT_DECREASE_COLD_RES = 72;
const STAT_DECREASE_LIGHTNING_RES = 77;
const STAT_DECREASE_CHAOS_RES = 80;

/** Equipped item keys whose unique mod rewrites resistances (GearInfoData.UniqueModKey, game 1.3.2). */
export const ITEM_ELEMENT_RES_UNIFY_TO_HIGHEST = 516193; // Eternal Armor
export const ITEM_CHAOS_RES_FROM_HIGHEST_ELEMENT = 518173; // Dimensional Armor

// Difficulty → flat all-resistance penalty, keyed by the cooked mode name (LiveSnapshot.mode).
const MODE_PENALTY: Record<string, number> = {
  Normal: 0,
  Nightmare: 20,
  Hell: 40,
  Torment: 60,
};

export type ResElement = "Fire" | "Cold" | "Lightning" | "Chaos";
export const RES_ELEMENTS: ResElement[] = ["Fire", "Cold", "Lightning", "Chaos"];
const ELEMENTAL: ResElement[] = ["Fire", "Cold", "Lightning"];

export interface HeroResistance {
  element: ResElement;
  /** The hero's own resistance to this element (AllElemental + per-element − decrease; Chaos = ChaosRes −
   *  decrease), after any item unique mod. */
  own: number;
  /** Effective resistance after the stage penalty (= own − penalty). Negative = vulnerable. */
  effective: number;
}

export interface HeroResistanceInfo {
  /** The difficulty penalty applied (0 on Normal/unknown). */
  penalty: number;
  resistances: HeroResistance[];
}

/** Effective elemental resistances for one hero, given its live FINAL_STATS, the stage mode and (when the
 *  reader sends them) its equipped item keys. Returns null when the hero has no stats (older reader / not
 *  deployed) so callers hide the tooltip. */
export function heroResistances(
  stats: Record<number, number> | undefined | null,
  mode: string,
  items?: readonly number[] | null,
): HeroResistanceInfo | null {
  if (!stats) return null;
  const penalty = MODE_PENALTY[mode] ?? 0;
  const all = stats[STAT_ALL_ELEMENTAL_RES] ?? 0;
  const own: Record<ResElement, number> = {
    Fire: all + (stats[STAT_FIRE_RES] ?? 0) - (stats[STAT_DECREASE_FIRE_RES] ?? 0),
    Cold: all + (stats[STAT_COLD_RES] ?? 0) - (stats[STAT_DECREASE_COLD_RES] ?? 0),
    Lightning: all + (stats[STAT_LIGHTNING_RES] ?? 0) - (stats[STAT_DECREASE_LIGHTNING_RES] ?? 0),
    // AllElemental excludes Chaos (confirmed live)
    Chaos: (stats[STAT_CHAOS_RES] ?? 0) - (stats[STAT_DECREASE_CHAOS_RES] ?? 0),
  };
  // Unique mods operate on the post-decrease values (the penalty is the same for every element, so taking
  // the max before or after subtracting it is equivalent).
  const highestElemental = Math.max(...ELEMENTAL.map((e) => own[e]));
  if (items?.includes(ITEM_ELEMENT_RES_UNIFY_TO_HIGHEST)) {
    for (const e of ELEMENTAL) own[e] = highestElemental;
  }
  if (items?.includes(ITEM_CHAOS_RES_FROM_HIGHEST_ELEMENT)) {
    own.Chaos = highestElemental;
  }
  return {
    penalty,
    resistances: RES_ELEMENTS.map((element) => ({
      element,
      own: own[element],
      effective: own[element] - penalty,
    })),
  };
}
