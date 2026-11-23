import { describe, expect, it } from "vitest";

import { cookLive, parseLiveJson } from "../sources/live-source.js";
import { computeDps, modeName, resolveStage, round } from "../converter/helpers.js";
import type { RawLive } from "../../shared/live-types.js";

// A current-reader live.json (the raw the reader overwrites ~1×/s; see meter_windows.build_live_record).
function rawLive(over: Partial<RawLive> = {}): RawLive {
  return {
    raw_schema_version: 1,
    run: 8,
    stageKey: 4209,
    act: 2,
    stageNo: 9,
    difficulty: 3, // Torment
    mobs: 68,
    total_mobs: 601,
    damage_now: 2_830_000,
    elapsed: 34,
    gold_now: 14_500,
    xp_now: 19_800,
    party: [101, 201, 301],
    drops: [4, 1, 0],
    ...over,
  };
}

describe("cookLive — derives the overlay snapshot from the reader's raw live", () => {
  it("cooks stage label, mode name and the live counters", () => {
    const snap = cookLive(rawLive());
    expect(snap.runNumber).toBe(8);
    expect(snap.stage).toBe("2-9"); // resolveStage(act, stageNo) — formatted, not a catalog name
    expect(snap.mode).toBe("Torment"); // modeName(difficulty enum)
    expect(snap.stageKey).toBe(4209);
    expect(snap.mobs).toBe(68);
    expect(snap.totalMobs).toBe(601);
    expect(snap.elapsedSec).toBe(34);
    expect(snap.damage).toBe(2_830_000);
    expect(snap.party).toEqual([101, 201, 301]);
    expect(snap.drops).toEqual([4, 1, 0]);
    // live is always approximate (a mid-run snapshot).
    expect(snap.approx).toBe(true);
  });

  it("derives dps with the SAME helper/formula the run record uses (no Python↔TS drift)", () => {
    const raw = rawLive({ damage_now: 4_500_000, elapsed: 90 });
    const snap = cookLive(raw);
    // The converter computes a finished run's dps as computeDps(totalDamage, clearTime, duration);
    // live has no clearTime, so the reference IS the live elapsed. The live snapshot must equal that
    // exact formula fed the same numbers — proving one shared source of truth.
    expect(snap.dps).toBe(round(computeDps(4_500_000, 0, 90)));
    expect(snap.dps).toBeCloseTo(50_000, 5);
  });

  it("keeps goldGain/xpGain as RAW gains (the overlay computes its own per-second rate)", () => {
    const snap = cookLive(rawLive({ gold_now: 14_500, xp_now: 19_800 }));
    expect(snap.goldGain).toBe(14_500);
    expect(snap.xpGain).toBe(19_800);
  });

  it("maps unresolved live gold/xp (null) to null — never a misleading 0", () => {
    const snap = cookLive(rawLive({ gold_now: null, xp_now: null }));
    expect(snap.goldGain).toBeNull();
    expect(snap.xpGain).toBeNull();
    // a real 0 gain stays 0 (distinct from "couldn't read").
    expect(cookLive(rawLive({ gold_now: 0 })).goldGain).toBe(0);
  });

  it('shows "?" for stage/mode when the reader could not resolve the stage', () => {
    const snap = cookLive(rawLive({ act: null, stageNo: null, difficulty: null, stageKey: null }));
    expect(snap.stage).toBe("?");
    expect(snap.mode).toBe("?");
    expect(snap.stageKey).toBeNull();
  });

  it("treats an empty party as null (overlay omits the frame) and tolerates a missing array", () => {
    expect(cookLive(rawLive({ party: [] })).party).toBeNull();
    // a malformed party (non-array) degrades to null rather than throwing.
    expect(cookLive(rawLive({ party: undefined as unknown as number[] })).party).toBeNull();
  });

  it("guards drops the same way as party: non-array -> null, non-finite element -> 0", () => {
    // Symmetric with the party guard above — a malformed drops never throws or leaks NaN.
    expect(cookLive(rawLive({ drops: undefined as unknown as number[] })).drops).toBeNull();
    expect(cookLive(rawLive({ drops: [4, NaN as unknown as number, 0] })).drops).toEqual([4, 0, 0]);
  });

  it("re-keys party_stats (JSON-string keys) to numbers, keeping only finite values", () => {
    const snap = cookLive(
      rawLive({ party_stats: { "201": { "52": 27, "12": 10 }, "101": { "5": 836.4 } } }),
    );
    expect(snap.partyStats).toEqual({ 201: { 52: 27, 12: 10 }, 101: { 5: 836.4 } });
  });

  it("maps a missing/empty/all-invalid party_stats to null (older reader → tooltip hides)", () => {
    expect(cookLive(rawLive({ party_stats: undefined })).partyStats).toBeNull();
    expect(cookLive(rawLive({ party_stats: {} })).partyStats).toBeNull();
    // a hero whose stats are all non-finite is dropped; an empty result is null, not {}.
    expect(
      cookLive(rawLive({ party_stats: { "201": { "12": NaN as unknown as number } } })).partyStats,
    ).toBeNull();
  });

  it("re-keys party_items (JSON-string keys) to numbers, keeping only finite item keys", () => {
    const snap = cookLive(
      rawLive({ party_items: { "601": [516193, NaN as unknown as number, 300001], "101": [] } }),
    );
    expect(snap.partyItems).toEqual({ 601: [516193, 300001], 101: [] });
  });

  it("maps a missing/invalid party_items to null (older reader → no unique mods applied)", () => {
    expect(cookLive(rawLive({ party_items: undefined })).partyItems).toBeNull();
    expect(cookLive(rawLive({ party_items: {} })).partyItems).toBeNull();
    expect(
      cookLive(rawLive({ party_items: { "601": "x" as unknown as number[] } })).partyItems,
    ).toBeNull();
  });

  it("re-keys party_progress (JSON-string keys) to numbers, keeping only all-finite entries", () => {
    const snap = cookLive(
      rawLive({
        party_progress: {
          "101": { level: 91, exp: 1234, gain: 56789 },
          "301": { level: 93, exp: 50, gain: 60000 },
        },
      }),
    );
    expect(snap.partyProgress).toEqual({
      101: { level: 91, exp: 1234, gain: 56789 },
      301: { level: 93, exp: 50, gain: 60000 },
    });
  });

  it("maps a missing/empty/partial party_progress to null (older reader → no ETA chip)", () => {
    expect(cookLive(rawLive({ party_progress: undefined })).partyProgress).toBeNull();
    expect(cookLive(rawLive({ party_progress: {} })).partyProgress).toBeNull();
    // a hero missing a field or carrying a non-finite value is dropped entirely; empty result → null.
    type Prog = { level: number; exp: number; gain: number };
    expect(
      cookLive(rawLive({ party_progress: { "101": { level: 91, exp: NaN as unknown as number, gain: 5 } } }))
        .partyProgress,
    ).toBeNull();
    expect(
      cookLive(rawLive({ party_progress: { "101": { level: 91, gain: 5 } as unknown as Prog } }))
        .partyProgress,
    ).toBeNull();
  });
});

describe("parseLiveJson — parse the reader's live.json text then cook", () => {
  it("parses a valid live.json and cooks it", () => {
    const snap = parseLiveJson(JSON.stringify(rawLive()));
    expect(snap?.stage).toBe("2-9");
    expect(snap?.mode).toBe("Torment");
    expect(snap?.dps).toBeCloseTo(round(computeDps(2_830_000, 0, 34)), 5);
  });

  it("returns null for non-JSON text (e.g. a half-written file before the atomic rename lands)", () => {
    expect(parseLiveJson("")).toBeNull();
    expect(parseLiveJson("{ not json")).toBeNull();
    expect(parseLiveJson("null")).toBeNull();
  });

  it("returns null for a JSON object that is not a live record (defensive — never cook garbage)", () => {
    // missing the run / elapsed markers a live record always carries.
    expect(parseLiveJson(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseLiveJson(JSON.stringify({ run: 5 }))).toBeNull(); // no elapsed
    expect(parseLiveJson(JSON.stringify({ elapsed: 5 }))).toBeNull(); // no run
  });
});

describe("cookLive matches modeName/resolveStage exactly (shared with the converter)", () => {
  it("uses the same mode mapping for every difficulty", () => {
    for (const d of [0, 1, 2, 3]) {
      expect(cookLive(rawLive({ difficulty: d })).mode).toBe(modeName(d));
    }
  });
  it("uses the same stage formatting", () => {
    expect(cookLive(rawLive({ act: 3, stageNo: 10 })).stage).toBe(resolveStage(3, 10));
  });
});

describe("cookLive — party_damage (optional combat plugin)", () => {
  it("re-keys to numbers and camelCases crit_damage", () => {
    const snap = cookLive(
      rawLive({ party_damage: { "601": { damage: 250, hits: 10, crits: 4, crit_damage: 120 } } }),
    );
    expect(snap.partyDamage).toEqual({
      601: { damage: 250, hits: 10, crits: 4, critDamage: 120, byType: {}, byAttribute: {} },
    });
  });

  it("parses the type/element breakdowns and party_taken (plugin >= 0.4)", () => {
    const snap = cookLive(
      rawLive({
        party_damage: {
          "601": { damage: 250, hits: 10, crits: 4, crit_damage: 120, by_type: { "6": 200, "2": 50, x: 1 }, by_attribute: { "0": 250 } },
        },
        party_taken: { "101": { damage: 40, hits: 7, crits: 2, crit_damage: 15, by_attribute: { "1": 30, "0": 10 } } },
      }),
    );
    expect(snap.partyDamage![601].byType).toEqual({ 6: 200, 2: 50 });
    expect(snap.partyTaken).toEqual({ 101: { damage: 40, hits: 7, crits: 2, critDamage: 15, byType: {}, byAttribute: { 1: 30, 0: 10 } } });
    expect(cookLive(rawLive({})).partyTaken).toBeNull();
  });

  it("null/absent → null (plugin not running); {} stays {} (running, nobody hit yet); bad rows dropped", () => {
    expect(cookLive(rawLive({ party_damage: null })).partyDamage).toBeNull();
    expect(cookLive(rawLive({ party_damage: undefined })).partyDamage).toBeNull();
    expect(cookLive(rawLive({ party_damage: {} })).partyDamage).toEqual({});
    expect(
      cookLive(rawLive({ party_damage: { "601": { damage: NaN, hits: 1, crits: 0, crit_damage: 0 } } })).partyDamage,
    ).toEqual({});
  });
});

describe("cookLive — party_dead", () => {
  it("keeps finite hero keys; absent → null (older reader)", () => {
    expect(cookLive(rawLive({ party_dead: [301, NaN as unknown as number, 201] })).partyDead).toEqual([301, 201]);
    expect(cookLive(rawLive({})).partyDead).toBeNull();
  });
});
