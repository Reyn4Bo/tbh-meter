import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  combatPluginStatus,
  foreignMods,
  installCombatPlugin,
  isNewerVersion,
  parseLibraryFolders,
  PLUGIN_DIR_REL,
  PLUGIN_DLL,
  readManifest,
  uninstallCombatPlugin,
} from "../combat-plugin.js";

let root: string;
let res: string;
let game: string;

function touch(p: string, body = "x"): void {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tbh-combat-"));
  res = join(root, "res");
  game = join(root, "game");
  // bundled resources: a mini BepInEx pack + plugin + version
  touch(join(res, "bepinex", "winhttp.dll"));
  touch(join(res, "bepinex", "doorstop_config.ini"));
  touch(join(res, "bepinex", "BepInEx", "core", "BepInEx.Unity.IL2CPP.dll"));
  touch(join(res, "bepinex", "dotnet", "coreclr.dll"));
  touch(join(res, PLUGIN_DLL), "plugin-v3");
  touch(join(res, "version.txt"), "0.3.0\n");
  // the game folder
  touch(join(game, "TaskBarHero.exe"));
  touch(join(game, "GameAssembly.dll"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("installCombatPlugin / uninstallCombatPlugin", () => {
  it("fresh game: installs BepInEx + plugin + a console-off config, owns BepInEx, and uninstalls back to pristine", () => {
    expect(installCombatPlugin(res, game, false)).toEqual({ ok: true });
    expect(existsSync(join(game, "winhttp.dll"))).toBe(true);
    expect(readFileSync(join(game, PLUGIN_DIR_REL, PLUGIN_DLL), "utf-8")).toBe("plugin-v3");
    expect(readFileSync(join(game, "BepInEx", "config", "BepInEx.cfg"), "utf-8")).toContain("Enabled = false");
    const m = readManifest(game)!;
    expect(m.ownsBepInEx).toBe(true);
    expect(m.pluginVersion).toBe("0.3.0");
    expect(combatPluginStatus(res, game, false)).toMatchObject({ installed: true, installedVersion: "0.3.0", ownsBepInEx: true });

    expect(uninstallCombatPlugin(game, false)).toEqual({ ok: true });
    for (const p of ["winhttp.dll", "doorstop_config.ini", "BepInEx", "dotnet"]) expect(existsSync(join(game, p))).toBe(false);
    expect(existsSync(join(game, "TaskBarHero.exe"))).toBe(true); // game files untouched
    expect(existsSync(join(game, "GameAssembly.dll"))).toBe(true);
  });

  it("user already has BepInEx (other mods): adds only our plugin and removes only it", () => {
    touch(join(game, "winhttp.dll"), "theirs");
    touch(join(game, "BepInEx", "core", "BepInEx.Unity.IL2CPP.dll"), "theirs");
    touch(join(game, "BepInEx", "plugins", "OtherMod", "Other.dll"));
    expect(installCombatPlugin(res, game, false)).toEqual({ ok: true });
    expect(readManifest(game)!.ownsBepInEx).toBe(false);
    expect(readFileSync(join(game, "winhttp.dll"), "utf-8")).toBe("theirs"); // never overwritten
    expect(existsSync(join(game, "BepInEx", "config", "BepInEx.cfg"))).toBe(false); // their config untouched

    expect(uninstallCombatPlugin(game, false)).toEqual({ ok: true });
    expect(existsSync(join(game, PLUGIN_DIR_REL))).toBe(false);
    expect(existsSync(join(game, "BepInEx", "plugins", "OtherMod", "Other.dll"))).toBe(true);
    expect(existsSync(join(game, "winhttp.dll"))).toBe(true);
    expect(readManifest(game)).toBeNull();
  });

  it("we installed BepInEx, then the user added another mod: turning OFF keeps BepInEx and their mod", () => {
    expect(installCombatPlugin(res, game, false)).toEqual({ ok: true });
    touch(join(game, "BepInEx", "plugins", "OtherMod", "Other.dll"), "theirs");

    expect(uninstallCombatPlugin(game, false)).toEqual({ ok: true, keptBepInEx: true });
    expect(existsSync(join(game, PLUGIN_DIR_REL))).toBe(false); // ours gone
    expect(readFileSync(join(game, "BepInEx", "plugins", "OtherMod", "Other.dll"), "utf-8")).toBe("theirs");
    for (const p of ["winhttp.dll", "doorstop_config.ini", join("BepInEx", "core"), "dotnet"]) {
      expect(existsSync(join(game, p))).toBe(true); // their mod still loads
    }
    expect(readManifest(game)).toBeNull(); // BepInEx is now theirs

    // Turning ON again treats BepInEx as the user's: only our plugin comes and goes.
    expect(installCombatPlugin(res, game, false)).toEqual({ ok: true });
    expect(readManifest(game)!.ownsBepInEx).toBe(false);
    expect(uninstallCombatPlugin(game, false)).toEqual({ ok: true });
    expect(existsSync(join(game, PLUGIN_DIR_REL))).toBe(false);
    expect(existsSync(join(game, "BepInEx", "plugins", "OtherMod", "Other.dll"))).toBe(true);
    expect(existsSync(join(game, "winhttp.dll"))).toBe(true);
  });

  it("a patcher added on our BepInEx also keeps it", () => {
    installCombatPlugin(res, game, false);
    touch(join(game, "BepInEx", "patchers", "SomePatcher.dll"));
    expect(uninstallCombatPlugin(game, false)).toEqual({ ok: true, keptBepInEx: true });
    expect(existsSync(join(game, "BepInEx", "patchers", "SomePatcher.dll"))).toBe(true);
  });

  it("foreignMods ignores our own plugin folder and empty/absent folders", () => {
    expect(foreignMods(game)).toEqual([]);
    installCombatPlugin(res, game, false);
    mkdirSync(join(game, "BepInEx", "patchers"), { recursive: true });
    expect(foreignMods(game)).toEqual([]);
    touch(join(game, "BepInEx", "plugins", "OtherMod", "Other.dll"));
    expect(foreignMods(game)).toEqual([join("BepInEx", "plugins", "OtherMod")]);
  });

  it("refuses while the game runs, without a game folder, or without bundled resources", () => {
    expect(installCombatPlugin(res, game, true)).toEqual({ ok: false, error: "game-running" });
    expect(uninstallCombatPlugin(game, true)).toEqual({ ok: false, error: "game-running" });
    expect(installCombatPlugin(res, join(root, "nope"), false)).toEqual({ ok: false, error: "no-game-dir" });
    expect(installCombatPlugin(join(root, "nores"), game, false)).toEqual({ ok: false, error: "unsupported" });
    expect(existsSync(join(game, "winhttp.dll"))).toBe(false);
  });

  it("re-install updates the plugin DLL and keeps ownership", () => {
    installCombatPlugin(res, game, false);
    writeFileSync(join(res, PLUGIN_DLL), "plugin-v4");
    writeFileSync(join(res, "version.txt"), "0.4.0");
    expect(installCombatPlugin(res, game, false)).toEqual({ ok: true });
    expect(readFileSync(join(game, PLUGIN_DIR_REL, PLUGIN_DLL), "utf-8")).toBe("plugin-v4");
    expect(readManifest(game)).toMatchObject({ ownsBepInEx: true, pluginVersion: "0.4.0" });
  });
});

describe("readManifest", () => {
  it("tolerates a UTF-8 BOM (PowerShell 5.1 `Set-Content -Encoding utf8` writes one)", () => {
    const m = { tool: "tbh-meter", manifestVersion: 1, pluginVersion: "0.3.0", ownsBepInEx: true, created: ["BepInEx"] };
    touch(join(game, "BepInEx", "tbh-meter-install.json"), String.fromCharCode(0xfeff) + JSON.stringify(m));
    expect(readManifest(game)).toMatchObject({ ownsBepInEx: true, pluginVersion: "0.3.0" });
  });
});

describe("isNewerVersion", () => {
  it("only upgrades, never downgrades", () => {
    expect(isNewerVersion("0.4.0", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.3.0", "0.4.0")).toBe(false); // an older app must not downgrade
    expect(isNewerVersion("0.4.0", "0.4.0")).toBe(false);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.4.0", null)).toBe(true);
    expect(isNewerVersion(null, "0.4.0")).toBe(false);
  });
});

describe("parseLibraryFolders", () => {
  it("extracts and unescapes library paths", () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"G:\\\\steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"E:\\\\SteamLibrary"\n\t}\n}';
    expect(parseLibraryFolders(vdf)).toEqual(["G:\\steam", "E:\\SteamLibrary"]);
  });
});
