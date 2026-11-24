import { describe, expect, it } from "vitest";
import { becameFull, cookPollution, isPollutionFull, pollutionEtaSec } from "../pollution.js";

const g = (value: number, max = 500, chargeSec = 360) => ({ value, max, chargeSec });

describe("cookPollution — validates the reader's gauge", () => {
  it("maps the raw gauge (charge_sec -> chargeSec)", () => {
    expect(cookPollution({ value: 28, max: 500, charge_sec: 360 })).toEqual(g(28));
  });

  it("hides anything absent, null or malformed (never a wrong gauge)", () => {
    expect(cookPollution(undefined)).toBeNull();
    expect(cookPollution(null)).toBeNull();
    expect(cookPollution({ value: 28, max: 500 })).toBeNull();                         // no charge_sec
    expect(cookPollution({ value: 501, max: 500, charge_sec: 360 })).toBeNull();       // above the cap
    expect(cookPollution({ value: -1, max: 500, charge_sec: 360 })).toBeNull();
    expect(cookPollution({ value: 0, max: 0, charge_sec: 360 })).toBeNull();
    expect(cookPollution({ value: 1, max: 500, charge_sec: 0 })).toBeNull();
    expect(cookPollution({ value: "28", max: 500, charge_sec: 360 })).toBeNull();
    expect(cookPollution({ value: NaN, max: 500, charge_sec: 360 })).toBeNull();
  });
});

describe("full / eta", () => {
  it("is full only at the cap", () => {
    expect(isPollutionFull(g(499))).toBe(false);
    expect(isPollutionFull(g(500))).toBe(true);
    expect(isPollutionFull(null)).toBe(false);
  });

  it("time to full = remaining points × charge period (28/500 @360s ≈ 47h)", () => {
    expect(pollutionEtaSec(g(28))).toBe(472 * 360);
    expect(pollutionEtaSec(g(500))).toBe(0);
  });
});

describe("becameFull — rising edge for the notification", () => {
  it("fires when a known below-cap reading reaches the cap", () => {
    expect(becameFull(g(499), g(500))).toBe(true);
  });

  it("never fires on the first reading, while staying full, or while charging", () => {
    expect(becameFull(null, g(500))).toBe(false);
    expect(becameFull(g(500), g(500))).toBe(false);
    expect(becameFull(g(27), g(28))).toBe(false);
    expect(becameFull(g(499), null)).toBe(false);
  });
});
