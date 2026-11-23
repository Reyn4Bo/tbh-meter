// The compact stage CODE shown in the runs table, the run detail header, the live overlay, the
// cooldown cards and the planner ("3-9"). ONE formatter + parser so every surface agrees and the
// planner can map a stored code back to a stage key.
//
// Game 1.3.2 Plaguelands: the game numbers their acts 21 (Nightmare) · 22 (Hell) · 23 (Torment) —
// meaningless to a player (the difficulty already has its own chip), so they render as "P-<stageNo>"
// ("P-20" = Plaguelands stage 20). Detected from the act alone, so the formatter stays pure (no
// catalog lookup) and works for the converter (main) and the renderer alike.

/** Lowest game-internal act number of the Plaguelands (1.3.2: 21/22/23 = Nightmare/Hell/Torment). */
export const PLAGUE_ACT_MIN = 21;
/** Code prefix for a Plaguelands stage ("P-20"). */
export const PLAGUE_CODE_PREFIX = "P";

/** "act-stageNo" (e.g. "3-9"), "P-stageNo" for a Plaguelands act, "?" when either side is missing
 *  (the UI never shows "null-null"). */
export function formatStageCode(act: number | null, stageNo: number | null): string {
  if (act == null || stageNo == null) return "?";
  return act >= PLAGUE_ACT_MIN ? `${PLAGUE_CODE_PREFIX}-${stageNo}` : `${act}-${stageNo}`;
}

/** Inverse of formatStageCode: `{ plague: true, act: null, stageNo }` for "P-20" (the act depends on
 *  the difficulty — callers resolve it with the mode), `{ plague: false, act, stageNo }` for "3-9",
 *  null for "?" / anything unparseable. */
export function parseStageCode(
  code: string,
): { plague: boolean; act: number | null; stageNo: number } | null {
  // Strict: both sides present and integral ("P-" / "-9" / "3-" must not parse — Number("") is 0).
  const m = /^(P|\d+)-(\d+)$/.exec(code);
  if (!m) return null;
  const stageNo = Number(m[2]);
  return m[1] === PLAGUE_CODE_PREFIX
    ? { plague: true, act: null, stageNo }
    : { plague: false, act: Number(m[1]), stageNo };
}
