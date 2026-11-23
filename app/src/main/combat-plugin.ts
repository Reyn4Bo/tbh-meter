// Optional per-hero DPS: install / uninstall the in-game combat plugin (mod/TbhMeterCombat on BepInEx 6).
//
// The DEFAULT meter never touches the game folder — the reader is a read-only memory sensor. Only when the
// user turns ON "per-hero DPS" in Settings do we copy the bundled BepInEx pack + plugin into the game
// folder; turning it OFF removes exactly what we added. Bundled (not downloaded) because the app stays
// local-only (the only network traffic is the update check).
//
// Ownership: a manifest (<game>/BepInEx/tbh-meter-install.json) records what WE created. If the user already
// had BepInEx (other mods), we add/remove only our plugin folder and never touch their BepInEx. The game must
// be CLOSED to install/uninstall (winhttp.dll + the plugin DLL are locked while it runs, and BepInEx only
// loads plugins at startup anyway).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CombatPluginError, CombatPluginStatus } from "../shared/ipc-types.js";

/** A leading UTF-8 byte-order mark (written as an escape so the source carries no invisible char). */
const BOM_RE = new RegExp("^" + String.fromCharCode(0xfeff));

export const GAME_EXE = "TaskBarHero.exe";
export const PLUGIN_DIR_REL = join("BepInEx", "plugins", "TbhMeterCombat");
export const PLUGIN_DLL = "TbhMeterCombat.dll";
const MANIFEST_REL = join("BepInEx", "tbh-meter-install.json");
const BEPINEX_MARKER_REL = join("BepInEx", "core", "BepInEx.Unity.IL2CPP.dll");
const BEPINEX_CFG_REL = join("BepInEx", "config", "BepInEx.cfg");

export interface InstallManifest {
  tool: "tbh-meter";
  manifestVersion: 1;
  pluginVersion: string;
  /** True when WE installed BepInEx itself (then uninstall removes it too). */
  ownsBepInEx: boolean;
  /** Paths (relative to the game folder) we created — removed on uninstall. */
  created: string[];
}

// Errors: "unsupported" = bundled resources missing (dev build without staging) · "no-game-dir" = pick the
// game folder manually · "game-running" = close the game first · "io" = a copy/delete failed (perms, AV…).
export type { CombatPluginError, CombatPluginStatus };

export type CombatPluginResult = { ok: true } | { ok: false; error: CombatPluginError; detail?: string };

/** Bundled version string (resources/combat-plugin/version.txt), null when absent. */
export function bundledVersion(resDir: string): string | null {
  try {
    return readFileSync(join(resDir, "version.txt"), "utf-8").trim() || null;
  } catch {
    return null;
  }
}

/** Is dotted version `a` strictly newer than `b`? (numeric parts; a missing/unparseable `b` counts as older,
 *  a missing `a` is never newer). Used so an app build only ever UPGRADES the installed plugin. */
export function isNewerVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** The bundled resources are complete: the BepInEx pack + the plugin DLL + its version. */
export function resourcesComplete(resDir: string): boolean {
  return (
    existsSync(join(resDir, "bepinex", "winhttp.dll")) &&
    existsSync(join(resDir, PLUGIN_DLL)) &&
    bundledVersion(resDir) != null
  );
}

export function isGameDir(dir: string | null | undefined): dir is string {
  return !!dir && existsSync(join(dir, GAME_EXE));
}

export function readManifest(gameDir: string): InstallManifest | null {
  try {
    // tolerate a UTF-8 BOM (a hand-edited / PowerShell-written manifest)
    const text = readFileSync(join(gameDir, MANIFEST_REL), "utf-8").replace(BOM_RE, "");
    const m = JSON.parse(text) as InstallManifest;
    return m && m.tool === "tbh-meter" && Array.isArray(m.created) ? m : null;
  } catch {
    return null;
  }
}

export function combatPluginStatus(
  resDir: string,
  gameDir: string | null,
  gameRunning: boolean,
): CombatPluginStatus {
  const dir = isGameDir(gameDir) ? gameDir : null;
  const manifest = dir ? readManifest(dir) : null;
  return {
    supported: resourcesComplete(resDir),
    gameDir: dir,
    installed: !!dir && existsSync(join(dir, PLUGIN_DIR_REL, PLUGIN_DLL)),
    installedVersion: manifest?.pluginVersion ?? null,
    bundledVersion: bundledVersion(resDir),
    ownsBepInEx: manifest?.ownsBepInEx ?? false,
    gameRunning,
  };
}

/** Install (or update) the plugin into `gameDir`. Adds BepInEx only when absent (then owns it). Idempotent. */
export function installCombatPlugin(resDir: string, gameDir: string | null, gameRunning: boolean): CombatPluginResult {
  if (!resourcesComplete(resDir)) return { ok: false, error: "unsupported" };
  if (!isGameDir(gameDir)) return { ok: false, error: "no-game-dir" };
  if (gameRunning) return { ok: false, error: "game-running" };
  try {
    const prev = readManifest(gameDir);
    const created = new Set(prev?.created ?? []);
    let ownsBepInEx = prev?.ownsBepInEx ?? false;
    if (!existsSync(join(gameDir, BEPINEX_MARKER_REL))) {
      // No BepInEx yet → install the bundled pack; every top-level entry is ours.
      const pack = join(resDir, "bepinex");
      for (const entry of readdirSync(pack)) {
        if (!existsSync(join(gameDir, entry))) created.add(entry);
        cpSync(join(pack, entry), join(gameDir, entry), { recursive: true, force: true });
      }
      ownsBepInEx = true;
    }
    if (ownsBepInEx && !existsSync(join(gameDir, BEPINEX_CFG_REL))) {
      // Our BepInEx: start without the log console window (BepInEx keeps this and fills the other keys).
      mkdirSync(join(gameDir, "BepInEx", "config"), { recursive: true });
      writeFileSync(join(gameDir, BEPINEX_CFG_REL), "[Logging.Console]\n\nEnabled = false\n", "utf-8");
    }
    const pluginDir = join(gameDir, PLUGIN_DIR_REL);
    mkdirSync(pluginDir, { recursive: true });
    cpSync(join(resDir, PLUGIN_DLL), join(pluginDir, PLUGIN_DLL), { force: true });
    if (!ownsBepInEx) created.add(PLUGIN_DIR_REL);
    const manifest: InstallManifest = {
      tool: "tbh-meter",
      manifestVersion: 1,
      pluginVersion: bundledVersion(resDir) ?? "?",
      ownsBepInEx,
      created: [...created],
    };
    writeFileSync(join(gameDir, MANIFEST_REL), JSON.stringify(manifest, null, 2), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "io", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Remove what we installed (per the manifest); without a manifest, just our plugin folder. */
export function uninstallCombatPlugin(gameDir: string | null, gameRunning: boolean): CombatPluginResult {
  if (!isGameDir(gameDir)) return { ok: false, error: "no-game-dir" };
  if (gameRunning) return { ok: false, error: "game-running" };
  try {
    const manifest = readManifest(gameDir);
    const targets = manifest ? [...manifest.created] : [PLUGIN_DIR_REL];
    if (manifest && !manifest.ownsBepInEx && !targets.includes(PLUGIN_DIR_REL)) targets.push(PLUGIN_DIR_REL);
    for (const rel of targets) {
      // Only ever delete INSIDE the game folder, and never the game's own files.
      if (rel.includes("..") || rel === "" || rel.toLowerCase() === GAME_EXE.toLowerCase()) continue;
      rmSync(join(gameDir, rel), { recursive: true, force: true });
    }
    if (!manifest?.ownsBepInEx) rmSync(join(gameDir, MANIFEST_REL), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "io", detail: e instanceof Error ? e.message : String(e) };
  }
}

// ── Windows probes (not unit-tested: they shell out) ──────────────────────────────────────────

/** Is TaskBarHero.exe running? */
export function isGameRunning(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${GAME_EXE}`, "/NH"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    return out.toLowerCase().includes(GAME_EXE.toLowerCase());
  } catch {
    return false;
  }
}

/** Steam library roots from libraryfolders.vdf text ("path"  "G:\\steam"). Pure, for tests. */
export function parseLibraryFolders(vdf: string): string[] {
  const out: string[] = [];
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, "\\"));
  return out;
}

/** Locate the game folder via Steam (registry SteamPath → libraryfolders.vdf). Null when not found. */
export function findGameDir(): string | null {
  if (process.platform !== "win32") return null;
  const roots = new Set<string>();
  for (const [key, value] of [
    ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
  ]) {
    try {
      const out = execFileSync("reg", ["query", key, "/v", value], { encoding: "utf-8", windowsHide: true });
      const m = out.match(/REG_SZ\s+(.+)\s*$/m);
      if (m) roots.add(m[1].trim().replace(/\//g, "\\"));
    } catch {
      // key absent
    }
  }
  const libs = new Set<string>(roots);
  for (const root of roots) {
    try {
      const vdf = readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf-8");
      for (const p of parseLibraryFolders(vdf)) libs.add(p);
    } catch {
      // no vdf
    }
  }
  for (const lib of libs) {
    const dir = join(lib, "steamapps", "common", "TaskbarHero");
    if (isGameDir(dir)) return dir;
  }
  return null;
}
