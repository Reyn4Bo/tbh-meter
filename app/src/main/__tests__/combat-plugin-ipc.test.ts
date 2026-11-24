import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CombatPluginStatus } from "../../shared/ipc-types.js";

// The per-hero DPS toggle's decision layer (main/combat-plugin-ipc.ts): the setting must ONLY flip when the
// game folder really changed (or nothing needed changing), and a refusal must leave both untouched.
// The file work itself is covered by combat-plugin.test.ts; here it is mocked to observe the decisions.

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  settings: { perHeroDps: false, gameDir: null } as unknown as AppSettings,
  status: {} as CombatPluginStatus,
  running: false,
  install: vi.fn(),
  uninstall: vi.fn(),
  rm: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => "/app" },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(ch, fn) },
}));
vi.mock("node:fs", () => ({ rmSync: h.rm }));
vi.mock("../broadcast.js", () => ({ broadcast: h.broadcast }));
vi.mock("../settings.js", () => ({
  getSettings: () => h.settings,
  updateSettings: (p: Partial<AppSettings>) => (h.settings = { ...h.settings, ...p }),
}));
vi.mock("../combat-plugin.js", async (orig) => {
  const real = await orig<typeof import("../combat-plugin.js")>();
  return {
    isNewerVersion: real.isNewerVersion,
    isGameDir: () => true,
    findGameDir: () => "G:/game",
    isGameRunning: () => h.running,
    combatPluginStatus: () => h.status,
    installCombatPlugin: h.install,
    uninstallCombatPlugin: h.uninstall,
  };
});

import { registerCombatPluginIpc, syncCombatPluginOnStartup } from "../combat-plugin-ipc.js";

registerCombatPluginIpc();
const toggle = (enabled: boolean) =>
  h.handlers.get("meter:combat-set")!({}, enabled) as { ok: boolean; error?: string; settings: AppSettings };

const st = (over: Partial<CombatPluginStatus> = {}): CombatPluginStatus => ({
  supported: true,
  gameDir: "G:/game",
  installed: false,
  installedVersion: null,
  bundledVersion: "0.4.0",
  ownsBepInEx: false,
  gameRunning: false,
  ...over,
});

beforeEach(() => {
  h.settings = { perHeroDps: false, gameDir: null } as unknown as AppSettings;
  h.status = st();
  h.running = false;
  h.install.mockReset().mockReturnValue({ ok: true });
  h.uninstall.mockReset().mockReturnValue({ ok: true });
  h.rm.mockReset();
  h.broadcast.mockReset();
});

describe("per-hero DPS toggle", () => {
  it("ON with the game closed installs, then flips the setting and tells every window", () => {
    const r = toggle(true);
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(h.settings.perHeroDps).toBe(true);
    expect(h.broadcast).toHaveBeenCalledWith("meter:settings-changed", expect.objectContaining({ perHeroDps: true }));
  });

  it("ON while the game runs and nothing is installed: refused, setting stays OFF", () => {
    h.running = true;
    h.install.mockReturnValue({ ok: false, error: "game-running" });
    const r = toggle(true);
    expect(r).toMatchObject({ ok: false, error: "game-running" });
    expect(h.settings.perHeroDps).toBe(false);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  it("ON when this version is already installed only flips the setting (no file work; fine with the game open)", () => {
    h.running = true;
    h.status = st({ installed: true, installedVersion: "0.4.0" });
    expect(toggle(true).ok).toBe(true);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.settings.perHeroDps).toBe(true);
  });

  it("ON when an OLDER plugin is installed re-installs (upgrade), not just a flag flip", () => {
    h.status = st({ installed: true, installedVersion: "0.3.0" });
    toggle(true);
    expect(h.install).toHaveBeenCalledTimes(1);
  });

  it("OFF with the game closed uninstalls, wipes the plugin's output folder, flips the setting", () => {
    h.settings = { ...h.settings, perHeroDps: true };
    expect(toggle(false).ok).toBe(true);
    expect(h.uninstall).toHaveBeenCalledTimes(1);
    expect(String(h.rm.mock.calls[0][0])).toMatch(/tbh-meter-mod$/);
    expect(h.settings.perHeroDps).toBe(false);
  });

  it("OFF that had to keep BepInEx (other mods) still succeeds and tells the UI why", () => {
    h.settings = { ...h.settings, perHeroDps: true };
    h.uninstall.mockReturnValue({ ok: true, keptBepInEx: true });
    expect(toggle(false)).toMatchObject({ ok: true, keptBepInEx: true });
    expect(h.settings.perHeroDps).toBe(false);
  });

  it("OFF while the game runs: refused, setting stays ON and the plugin output is kept", () => {
    h.settings = { ...h.settings, perHeroDps: true };
    h.uninstall.mockReturnValue({ ok: false, error: "game-running" });
    expect(toggle(false)).toMatchObject({ ok: false, error: "game-running" });
    expect(h.settings.perHeroDps).toBe(true);
    expect(h.rm).not.toHaveBeenCalled();
  });
});

describe("startup sync (app updated with a newer bundled plugin)", () => {
  it("upgrades only when ON, installed, older, and the game is closed", () => {
    h.settings = { ...h.settings, perHeroDps: true };
    h.status = st({ installed: true, installedVersion: "0.3.0" });
    syncCombatPluginOnStartup();
    expect(h.install).toHaveBeenCalledTimes(1);
  });

  it("never touches the game folder when OFF, already current, or the game is running", () => {
    h.status = st({ installed: true, installedVersion: "0.3.0" });
    syncCombatPluginOnStartup(); // OFF
    h.settings = { ...h.settings, perHeroDps: true };
    h.status = st({ installed: true, installedVersion: "0.4.0" });
    syncCombatPluginOnStartup(); // current
    h.status = st({ installed: true, installedVersion: "0.3.0", gameRunning: true });
    syncCombatPluginOnStartup(); // game running
    expect(h.install).not.toHaveBeenCalled();
  });
});
