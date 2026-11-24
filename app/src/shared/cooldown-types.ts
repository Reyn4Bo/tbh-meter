// Blue-chest cooldown tracker — SHARED types + the cooldown duration + pure time math.
// Lives in shared/ (NOT main) because BOTH the renderer (progress fill, ready check) and
// the main process (notification scheduling) need the cooldown duration and the remaining-time
// math, and the renderer cannot import main-process code (same reason COUNT_FLOOR_SEC is here).

import { isContaminatedBox } from "./chest-boxes.js";

/**
 * A tracked chest cooldown, keyed by `boxKey` — the in-game "Stage Boss Box LvNN" (a 920xxx
 * STAGEBOX) or a Plaguelands "Contaminated Stage Box" (925xxx, one per plague stage). The box IS the chest level, so there is ONE cooldown per level, shared across every
 * stage AND difficulty that drops it (Lv65 dropping in Hell and Torment is a single cooldown).
 * Captured the moment the reader's stage-boss (blue) chest count rose for the current stage.
 * `dropAt` is epoch ms; the chest is ready again at `dropAt + cooldownMs`. The chest level,
 * sprite, drop rate and farm spots are all DERIVED from `boxKey` in the renderer (game-data) —
 * never stored here (SSOT: the data file owns them). `lastStageKey`/`mode` are the most recent
 * drop's stage + display mode, kept for the "open stage" link and an origin label.
 */
export interface ChestCooldown {
  boxKey: number;
  dropAt: number;
  /** Stage of the most recent drop (the "open stage" link + origin hint). Absent on a route
   *  placeholder — a level pinned to the route that has not dropped yet. */
  lastStageKey?: number;
  /** Display mode captured at the most recent drop ("Torment"); a label fallback. */
  mode?: string;
  /** Hidden from the live OVERLAY only (the overlay's X is a declutter, not a delete): the
   *  entry stays active and visible in the runs-window tab, and a re-detected drop brings it
   *  back (the fresh entry is un-hidden). The tab's X deletes the entry outright. */
  hidden?: boolean;
}

/**
 * Default blue-chest cooldown, in minutes — the measured respawn interval between a stage-boss
 * (blue) box dropping and being able to drop again. Game 1.3.2, 186 clears of one stage: the drop
 * chance is ~3% before ~150 s since the last drop and 25–45% from 180 s on, so ~3 min (the old 13
 * was a pre-1.3.2 observation, far too long now). Exposed as a user setting
 * (AppSettings.chestCooldownMin, via clampCooldownMin); this is only the fallback default.
 * Timestamp-anchored math (below) means changing the duration re-derives every countdown without
 * migration (persisted `dropAt` keeps working — only remaining time shifts).
 */
export const DEFAULT_COOLDOWN_MIN = 3;
export const DEFAULT_COOLDOWN_MS = DEFAULT_COOLDOWN_MIN * 60 * 1000;
/** The pre-1.3.2 blue default. A stored value equal to it (from before the defaults revision)
 *  is treated as "never changed" and moved to DEFAULT_COOLDOWN_MIN (settings.ts). */
export const LEGACY_DEFAULT_COOLDOWN_MIN = 13;
/** Current cooldown-defaults revision (AppSettings.cooldownDefaultsRev). 2 = blue default 13 → 3 min. */
export const COOLDOWN_DEFAULTS_REV = 2;

/**
 * Contaminated (925xxx) / blue (920xxx) cooldown ratio — the game's own ItemInfoData.DropCooldown
 * (360 vs 300). The unit of that column doesn't match real time (300 ≠ the measured ~3 min), but
 * the ratio between two boxes of the same table is the best available prior: too few contaminated
 * drops exist to measure it directly (2–4% base rate). User-adjustable like the blue one.
 */
export const CONTAM_COOLDOWN_RATIO = 360 / 300;
/** Default contaminated-box cooldown in minutes (3.6), rounded to the 0.1-min setting grain. */
export const DEFAULT_CONTAM_COOLDOWN_MIN = Math.round(DEFAULT_COOLDOWN_MIN * CONTAM_COOLDOWN_RATIO * 10) / 10;

/** The cooldown length per tracked box family, in ms (from the two user settings). */
export interface CooldownDurations {
  blueMs: number;
  contamMs: number;
}

export const DEFAULT_DURATIONS: CooldownDurations = {
  blueMs: DEFAULT_COOLDOWN_MS,
  contamMs: DEFAULT_CONTAM_COOLDOWN_MIN * 60 * 1000,
};

/** The cooldown length (ms) of one box: contaminated boxes run on their own timer. */
export function cooldownMsForBox(boxKey: number, d: CooldownDurations): number {
  return isContaminatedBox(boxKey) ? d.contamMs : d.blueMs;
}

/**
 * Cooldown state broadcast to every window on `meter:cooldowns`:
 *  - `active`: the current per-box lines (the overlay + live tracker). The `X` clears these.
 *  - `log`: append-only history of detected drops (the runs-window tab). The `X` never touches it.
 */
export interface CooldownState {
  active: ChestCooldown[];
  log: ChestCooldown[];
}

/** Ms remaining until the chest is ready again (0 once ready). Pure; anchored to `dropAt`
 *  so it survives app/game restarts and never accumulates `setInterval` drift. The cooldown
 *  duration is passed in (the user setting) — defaulting to DEFAULT_COOLDOWN_MS. */
export function remainingMs(cd: ChestCooldown, now: number, cooldownMs = DEFAULT_COOLDOWN_MS): number {
  return Math.max(0, cd.dropAt + cooldownMs - now);
}

/** True once the cooldown has fully elapsed (ready to farm again). */
export function isReady(cd: ChestCooldown, now: number, cooldownMs = DEFAULT_COOLDOWN_MS): boolean {
  return remainingMs(cd, now, cooldownMs) <= 0;
}

/** Remaining time as a 0..1 fraction — the width of the draining background fill (1 at the
 *  moment of the drop, shrinking to 0 at ready). */
export function remainingFraction(cd: ChestCooldown, now: number, cooldownMs = DEFAULT_COOLDOWN_MS): number {
  return cooldownMs <= 0 ? 0 : remainingMs(cd, now, cooldownMs) / cooldownMs;
}
