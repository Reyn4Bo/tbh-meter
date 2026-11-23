import { describe, expect, it } from "vitest";
import { heroDpsRows, sharePct } from "./hero-damage";

// Numbers from the live 1.3.2 validation (93s window, Sorcerer/Ranger/Priest party).
const DMG = {
  301: { damage: 4.442e9, hits: 478, crits: 351, critDamage: 3.9e9, byType: {}, byAttribute: {} },
  201: { damage: 4.296e9, hits: 403, crits: 392, critDamage: 4.2e9, byType: {}, byAttribute: {} },
  401: { damage: 4.488e8, hits: 513, crits: 45, critDamage: 1e8, byType: {}, byAttribute: {} },
};

describe("heroDpsRows", () => {
  it("is null without plugin data", () => {
    expect(heroDpsRows([301, 201, 401], null, 93)).toBeNull();
    expect(heroDpsRows([301, 201, 401], undefined, 93)).toBeNull();
  });

  it("orders by formation, shares sum to 1, dps uses the team reference", () => {
    const rows = heroDpsRows([201, 301, 401], DMG, 93)!;
    expect(rows.map((r) => r.heroKey)).toEqual([201, 301, 401]);
    expect(rows.map((r) => r.color)).toEqual([0, 1, 2]);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
    expect(rows[1].dps).toBeCloseTo(4.442e9 / 93, 0);
    expect(rows[2].critRate).toBeCloseTo(45 / 513, 10);
  });

  it("keeps a deployed hero with no damage yet as a 0 row, and appends a swapped-out damage dealer", () => {
    const rows = heroDpsRows([101, 301], { 301: DMG[301], 601: { damage: 10, hits: 1, crits: 0, critDamage: 0, byType: {}, byAttribute: {} } }, 5)!;
    expect(rows.map((r) => r.heroKey)).toEqual([101, 301, 601]);
    expect(rows[0]).toMatchObject({ damage: 0, share: 0, critRate: null });
  });

  it("floors elapsed at 1s like computeDps", () => {
    expect(heroDpsRows([301], { 301: { damage: 50, hits: 1, crits: 0, critDamage: 0, byType: {}, byAttribute: {} } }, 0)![0].dps).toBe(50);
  });
});

describe("sharePct", () => {
  it("formats", () => {
    expect(sharePct(0.484)).toBe("48%");
    expect(sharePct(0.004)).toBe("<1%");
    expect(sharePct(0)).toBe("0%");
  });
});
