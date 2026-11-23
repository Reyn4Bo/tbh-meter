import { describe, expect, it } from "vitest";
import { formatStageCode, parseStageCode } from "../stage-code";

describe("formatStageCode", () => {
  it("formats a normal stage as act-stageNo", () => {
    expect(formatStageCode(3, 9)).toBe("3-9");
    expect(formatStageCode(3, 10)).toBe("3-10");
  });

  it("renders the 1.3.2 Plaguelands acts (21/22/23) as P-<stageNo>, not the meaningless game act", () => {
    expect(formatStageCode(21, 1)).toBe("P-1");
    expect(formatStageCode(22, 20)).toBe("P-20");
    expect(formatStageCode(23, 20)).toBe("P-20"); // was "23-20" in the runs table
  });

  it("is '?' when either side is missing", () => {
    expect(formatStageCode(null, 9)).toBe("?");
    expect(formatStageCode(3, null)).toBe("?");
  });
});

describe("parseStageCode", () => {
  it("round-trips both shapes", () => {
    expect(parseStageCode("3-9")).toEqual({ plague: false, act: 3, stageNo: 9 });
    expect(parseStageCode("P-20")).toEqual({ plague: true, act: null, stageNo: 20 });
  });

  it("still parses a pre-relabel stored code ('23-20') as a numeric act", () => {
    expect(parseStageCode("23-20")).toEqual({ plague: false, act: 23, stageNo: 20 });
  });

  it("returns null for '?' and garbage", () => {
    expect(parseStageCode("?")).toBeNull();
    expect(parseStageCode("x-y")).toBeNull();
    expect(parseStageCode("P-")).toBeNull();
  });
});
