import { describe, expect, it } from "vitest";
import { damageTypeKeys, elementKey, slices } from "./damage-kinds";

describe("damage-kinds", () => {
  it("splits an EDamageType flag combo in flag order (6 = Projectile+AOE, like the in-game tooltip)", () => {
    expect(damageTypeKeys(6)).toEqual(["dmgType.Projectile", "dmgType.AOE"]);
    expect(damageTypeKeys(1)).toEqual(["dmgType.Melee"]);
    expect(damageTypeKeys(10)).toEqual(["dmgType.Projectile", "dmgType.Summon"]);
    expect(damageTypeKeys(0)).toEqual(["dmgType.Other"]);
  });

  it("maps elements, unknown → None", () => {
    expect(elementKey(1)).toBe("element.Fire");
    expect(elementKey(0)).toBe("element.Physical");
    expect(elementKey(99)).toBe("element.None");
  });

  it("slices sort largest first with shares summing to 1; empty → []", () => {
    // the live 1.3.2 Ranger: 84.2% Projectile, 8.4% Projectile+AOE, 5.6% AOE, 1.8% Melee
    const s = slices({ 2: 842, 6: 84, 4: 56, 1: 18 });
    expect(s.map((x) => x.key)).toEqual([2, 6, 4, 1]);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10);
    expect(slices({})).toEqual([]);
    expect(slices(undefined)).toEqual([]);
    expect(slices({ 2: 0 })).toEqual([]);
  });
});
