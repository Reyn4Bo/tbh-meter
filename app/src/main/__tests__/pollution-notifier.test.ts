import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../shared/ipc-types.js";
import type { LiveSnapshot } from "../../shared/run-types.js";

const { notificationCalls } = vi.hoisted(() => ({
  notificationCalls: [] as Array<{ title?: string; body?: string }>,
}));

vi.mock("electron", () => {
  class FakeNotification {
    static isSupported = vi.fn(() => true);
    constructor(opts: { title?: string; body?: string }) {
      notificationCalls.push(opts);
    }
    show = vi.fn();
  }
  return { Notification: FakeNotification };
});

const { state, liveBus } = vi.hoisted(() => {
  type Handler = (snap: unknown) => void;
  const handlers: Handler[] = [];
  const ev = {
    on(_event: string, fn: Handler) {
      handlers.push(fn);
      return ev;
    },
    emit(_event: string, snap: unknown) {
      for (const fn of [...handlers]) fn(snap);
    },
    removeAllListeners() {
      handlers.length = 0;
    },
  };
  return { state: { settings: { pollutionFullNotify: true } as AppSettings }, liveBus: ev };
});

vi.mock("../settings.js", () => ({ getSettings: () => state.settings }));
vi.mock("../sources/live-source.js", () => ({ getLiveSource: () => liveBus }));
vi.mock("../i18n.js", () => ({ tMain: (key: string) => key }));

// The notifier keeps its last reading at module level (a long-lived process), so each test re-imports a
// FRESH module to stay order-independent.
async function freshNotifier(): Promise<void> {
  vi.resetModules();
  const mod = await import("../pollution-notifier.js");
  mod.initPollutionNotifier();
}

const snap = (value: number | null): LiveSnapshot =>
  ({ pollution: value == null ? null : { value, max: 500, chargeSec: 360 } }) as LiveSnapshot;
const fired = () => notificationCalls.filter((c) => c.title === "notifications.pollutionFullTitle");

beforeEach(() => {
  notificationCalls.length = 0;
  liveBus.removeAllListeners();
  state.settings = { pollutionFullNotify: true } as AppSettings;
});
afterEach(() => liveBus.removeAllListeners());

describe("pollution notifier", () => {
  it("fires once when the gauge reaches its max", async () => {
    await freshNotifier();
    liveBus.emit("live", snap(499));
    liveBus.emit("live", snap(500));
    liveBus.emit("live", snap(500)); // stays full → no repeat
    expect(fired()).toHaveLength(1);
  });

  it("does not fire when the meter starts on an already full gauge", async () => {
    await freshNotifier();
    liveBus.emit("live", snap(500));
    expect(fired()).toHaveLength(0);
  });

  it("an unreadable tick at the moment of filling neither swallows nor fakes the edge", async () => {
    await freshNotifier();
    liveBus.emit("live", snap(499));
    liveBus.emit("live", snap(null));
    liveBus.emit("live", null);
    liveBus.emit("live", snap(500));
    expect(fired()).toHaveLength(1);
  });

  it("respects the setting", async () => {
    state.settings = { pollutionFullNotify: false } as AppSettings;
    await freshNotifier();
    liveBus.emit("live", snap(499));
    liveBus.emit("live", snap(500));
    expect(fired()).toHaveLength(0);
  });
});
