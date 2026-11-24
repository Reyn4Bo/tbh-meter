import { describe, expect, it } from "vitest";
import {
  isBlueBox,
  isContaminatedBox,
  isTrackedBox,
  refineDropBox,
  stageCodeForKey,
  blueBoxes,
} from "../chest-boxes.js";
import {
  cooldownMsForBox,
  DEFAULT_COOLDOWN_MIN,
  DEFAULT_CONTAM_COOLDOWN_MIN,
  DEFAULT_DURATIONS,
} from "../cooldown-types.js";
import { clampCooldownMin, cooldownDurations, COOLDOWN_MIN_MINUTES, COOLDOWN_MAX_MINUTES } from "../ipc-types.js";

// Concrete stages from data/stages.json:
//   201420 (Torment Plaguelands 20) → boss box 925220 (contaminated), mob box 915xxx
//   4309   (Torment 3-9)            → boss box 920901 (blue Lv90),   mob box 910901
//   4310   (Torment 3-10, act boss) → boss box 930xxx (act-boss)
const PLAGUE_STAGE = 201420;
const NORMAL_STAGE = 4309;
const ACTBOSS_STAGE = 4310;
// The reader's canonical per-tier keys (it can't see the variant).
const RAW_MOB = 910011;
const RAW_BOSS = 920001;
const RAW_ACT = 930101;

describe("box families", () => {
  it("splits blue (920xxx) from contaminated (925xxx); both are tracked, act-boss is not", () => {
    expect(isBlueBox(920901)).toBe(true);
    expect(isContaminatedBox(920901)).toBe(false);
    expect(isBlueBox(925220)).toBe(false);
    expect(isContaminatedBox(925220)).toBe(true);
    expect(isTrackedBox(920901)).toBe(true);
    expect(isTrackedBox(925220)).toBe(true);
    expect(isTrackedBox(930101)).toBe(false);
    expect(isTrackedBox(935001)).toBe(false);
    expect(isTrackedBox(null)).toBe(false);
  });

  it("keeps contaminated boxes out of the route picker (their '- N' is a stage, not a level)", () => {
    expect(blueBoxes().some((b) => isContaminatedBox(b.boxKey))).toBe(false);
  });
});

describe("refineDropBox (the reader only knows the tier; the stage names the box)", () => {
  it("a stage-boss drop on a Plaguelands stage is that stage's contaminated box", () => {
    expect(refineDropBox(PLAGUE_STAGE, 1, RAW_BOSS)).toBe(925220);
  });

  it("a mob drop on a Plaguelands stage is the contaminated normal box (915xxx)", () => {
    expect(Math.floor(refineDropBox(PLAGUE_STAGE, 0, RAW_MOB) / 1000)).toBe(915);
  });

  it("a normal stage resolves to its exact blue / common box", () => {
    expect(refineDropBox(NORMAL_STAGE, 1, RAW_BOSS)).toBe(920901);
    expect(refineDropBox(NORMAL_STAGE, 0, RAW_MOB)).toBe(910901);
  });

  it("an act-boss drop resolves to the stage's act-boss box", () => {
    expect(Math.floor(refineDropBox(ACTBOSS_STAGE, 2, RAW_ACT) / 1000)).toBe(930);
  });

  it("keeps the raw key when the stage's box isn't of the drop's tier, or the stage is unknown", () => {
    // A stage-boss tier drop on an act-boss stage: its boss box is 930xxx, not a stage-boss family.
    expect(refineDropBox(ACTBOSS_STAGE, 1, RAW_BOSS)).toBe(RAW_BOSS);
    // An act-boss stage has no mob box.
    expect(refineDropBox(ACTBOSS_STAGE, 0, RAW_MOB)).toBe(RAW_MOB);
    expect(refineDropBox(null, 1, RAW_BOSS)).toBe(RAW_BOSS);
    expect(refineDropBox(999999, 1, RAW_BOSS)).toBe(RAW_BOSS);
    expect(refineDropBox(NORMAL_STAGE, 7, RAW_BOSS)).toBe(RAW_BOSS); // unknown tier
  });
});

describe("stageCodeForKey", () => {
  it("formats normal and Plaguelands stages like the rest of the app", () => {
    expect(stageCodeForKey(NORMAL_STAGE)).toBe("3-9");
    expect(stageCodeForKey(PLAGUE_STAGE)).toBe("P-20");
    expect(stageCodeForKey(999999)).toBeNull();
  });
});

describe("cooldown durations", () => {
  it("defaults: blue 3 min (measured), contaminated 3.6 min (× the game's 360/300 ratio)", () => {
    expect(DEFAULT_COOLDOWN_MIN).toBe(3);
    expect(DEFAULT_CONTAM_COOLDOWN_MIN).toBe(3.6);
    expect(DEFAULT_DURATIONS).toEqual({ blueMs: 180_000, contamMs: 216_000 });
  });

  it("picks each box's own timer", () => {
    const d = { blueMs: 1, contamMs: 2 };
    expect(cooldownMsForBox(920901, d)).toBe(1);
    expect(cooldownMsForBox(925220, d)).toBe(2);
  });

  it("derives both durations from the settings, clamped", () => {
    expect(cooldownDurations({ chestCooldownMin: 5, contamCooldownMin: 7.5 })).toEqual({
      blueMs: 300_000,
      contamMs: 450_000,
    });
    // A missing/garbage contaminated value falls back to ITS default, not the blue one.
    expect(cooldownDurations({ chestCooldownMin: 3, contamCooldownMin: NaN }).contamMs).toBe(216_000);
  });
});

describe("clampCooldownMin", () => {
  it("keeps 0.1-min grain (so 3.6 survives) and holds the bounds", () => {
    expect(clampCooldownMin(3.6)).toBe(3.6);
    expect(clampCooldownMin(3.04)).toBe(3);
    expect(clampCooldownMin(3.6 + 0.5)).toBe(4.1); // stepper float noise is rounded away
    expect(clampCooldownMin(0)).toBe(COOLDOWN_MIN_MINUTES);
    expect(clampCooldownMin(999)).toBe(COOLDOWN_MAX_MINUTES);
  });

  it("falls back to the given default for non-finite input (blue default when none given)", () => {
    expect(clampCooldownMin(undefined)).toBe(DEFAULT_COOLDOWN_MIN);
    expect(clampCooldownMin(null, DEFAULT_CONTAM_COOLDOWN_MIN)).toBe(3.6);
  });
});
