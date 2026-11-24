import { describe, expect, it, vi } from "vitest";

// settings.ts pulls in electron (app.getPath) at import time; stub it so we can unit-test the
// pure migration/sanitize helpers without the Electron runtime.
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/userData" } }));

import { migrateChestCooldowns, migrateBlueCooldownMin, sanitizeRoute } from "../settings.js";

// Real stage→box facts from the synced data:
//   4208 (Torment 2-8) & 4109 (Torment 1-9) → BOTH box 920801 (the duplicate-Lv80 case)
//   1101 (Normal 1-1) → box 920011
//   1110 (Normal 1-10) → box 930101 (act-boss, NOT a blue box → dropped)
describe("migrateBlueCooldownMin (rev 2: blue default 13 → 3 min)", () => {
  it("moves the untouched old default (13, pre-rev-2 file) to the new default", () => {
    expect(migrateBlueCooldownMin(13, undefined)).toBe(3);
    expect(migrateBlueCooldownMin(13, 1)).toBe(3);
    expect(migrateBlueCooldownMin(undefined, undefined)).toBe(3);
  });

  it("keeps a value the user changed before rev 2", () => {
    expect(migrateBlueCooldownMin(8, undefined)).toBe(8);
  });

  it("keeps everything once the file is at rev 2 — a deliberate 13 included", () => {
    expect(migrateBlueCooldownMin(13, 2)).toBe(13);
    expect(migrateBlueCooldownMin(4.5, 2)).toBe(4.5);
  });

  it("clamps garbage like any other load", () => {
    expect(migrateBlueCooldownMin("x", 2)).toBe(3);
    expect(migrateBlueCooldownMin(500, 2)).toBe(60);
  });
});

describe("migrateChestCooldowns (legacy per-stage → box-keyed)", () => {
  it("keeps contaminated (925xxx) cooldowns across a restart", () => {
    expect(migrateChestCooldowns([{ boxKey: 925220, dropAt: 7, lastStageKey: 201420 }], true)).toEqual([
      { boxKey: 925220, dropAt: 7, lastStageKey: 201420 },
    ]);
  });

  it("derives boxKey from a legacy stageKey entry and keeps the stage as lastStageKey", () => {
    const out = migrateChestCooldowns(
      [{ stageKey: 4208, stage: "X", mode: "Torment", dropAt: 100 }],
      false,
    );
    expect(out).toEqual([{ boxKey: 920801, dropAt: 100, lastStageKey: 4208, mode: "Torment" }]);
  });

  it("collapses the SAME box across stages to the most recent drop (active list)", () => {
    const out = migrateChestCooldowns(
      [
        { stageKey: 4208, dropAt: 100 }, // box 920801
        { stageKey: 4109, dropAt: 200 }, // box 920801 too → same chest level
      ],
      true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].boxKey).toBe(920801);
    expect(out[0].dropAt).toBe(200); // newest kept
    expect(out[0].lastStageKey).toBe(4109);
  });

  it("keeps every entry for the history log (collapse = false)", () => {
    const out = migrateChestCooldowns(
      [
        { stageKey: 4208, dropAt: 100 },
        { stageKey: 4109, dropAt: 200 },
      ],
      false,
    );
    expect(out.map((c) => c.boxKey)).toEqual([920801, 920801]);
  });

  it("drops entries that don't resolve to a blue box (act-boss / unmapped)", () => {
    const out = migrateChestCooldowns(
      [
        { stageKey: 1110, dropAt: 1 }, // 930101 act-boss → not blue
        { stageKey: 999999, dropAt: 2 }, // unmapped
        { stageKey: 1101, dropAt: 3 }, // 920011 → kept
      ],
      false,
    );
    expect(out).toEqual([{ boxKey: 920011, dropAt: 3, lastStageKey: 1101 }]);
  });

  it("passes already-box-keyed entries through and ignores junk", () => {
    expect(migrateChestCooldowns([{ boxKey: 920801, dropAt: 50 }], false)).toEqual([
      { boxKey: 920801, dropAt: 50 },
    ]);
    expect(migrateChestCooldowns([{ dropAt: 1 }, null, "nope"], false)).toEqual([]); // no key
    expect(migrateChestCooldowns(undefined, true)).toEqual([]);
  });
});

describe("sanitizeRoute", () => {
  it("keeps only finite blue-box keys, de-duplicated, order preserved", () => {
    expect(sanitizeRoute([920801, 920011, 920801, 930101, "x", 5, null])).toEqual([920801, 920011]);
  });
  it("returns [] for a non-array", () => {
    expect(sanitizeRoute(undefined)).toEqual([]);
    expect(sanitizeRoute("nope")).toEqual([]);
  });
});
