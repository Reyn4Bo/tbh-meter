// IPC + lifecycle for the optional per-hero DPS plugin (main/combat-plugin.ts does the file work).
// The toggle in Settings reflects what is INSTALLED: turning it on installs into the game folder, turning
// it off uninstalls; a failure (game running, folder not found…) leaves the setting unchanged and reports why.
import { app, dialog, ipcMain } from "electron";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CombatPluginStatus, CombatPluginToggleResult } from "../shared/ipc-types.js";
import { broadcast } from "./broadcast.js";
import {
  combatPluginStatus,
  findGameDir,
  installCombatPlugin,
  isGameDir,
  isNewerVersion,
  isGameRunning,
  uninstallCombatPlugin,
  type CombatPluginResult,
} from "./combat-plugin.js";
import { getSettings, updateSettings } from "./settings.js";

/** Bundled plugin resources: <resourcesPath>/combat-plugin when packaged (extraResources), else
 *  app/resources/combat-plugin (dev; staged by scripts/stage-combat-plugin.mjs). */
function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "combat-plugin")
    : join(app.getAppPath(), "resources", "combat-plugin");
}

let detectedGameDir: string | null | undefined;

/** The manual override when valid, else the Steam auto-detection (cached for the session). */
function gameDir(): string | null {
  const manual = getSettings().gameDir;
  if (isGameDir(manual)) return manual;
  if (detectedGameDir === undefined) detectedGameDir = findGameDir();
  return detectedGameDir;
}

function status(): CombatPluginStatus {
  return combatPluginStatus(resourcesDir(), gameDir(), isGameRunning());
}

export function registerCombatPluginIpc(): void {
  ipcMain.handle("meter:combat-status", () => status());

  ipcMain.handle("meter:combat-set", (_e, enabled: boolean): CombatPluginToggleResult => {
    const running = isGameRunning();
    const current = combatPluginStatus(resourcesDir(), gameDir(), running);
    // Already installed at this build's version → turning ON is just the setting (works with the game open).
    const alreadyCurrent =
      enabled && current.installed && !isNewerVersion(current.bundledVersion, current.installedVersion);
    const res: CombatPluginResult = alreadyCurrent
      ? { ok: true }
      : enabled
        ? installCombatPlugin(resourcesDir(), gameDir(), running)
        : uninstallCombatPlugin(gameDir(), running);
    let settings = getSettings();
    if (res.ok && !enabled) {
      // The plugin's own output folder — nothing else writes there; leave no trace after turning it off.
      try {
        rmSync(join(homedir(), "tbh-meter-mod"), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    if (res.ok) {
      settings = updateSettings({ perHeroDps: enabled });
      broadcast("meter:settings-changed", settings);
    }
    return res.ok
      ? { ok: true, keptBepInEx: res.keptBepInEx, status: status(), settings }
      : { ok: false, error: res.error, detail: res.detail, status: status(), settings };
  });

  ipcMain.handle("meter:combat-pick-game-dir", async (): Promise<CombatPluginStatus | null> => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    const settings = updateSettings({ gameDir: r.filePaths[0] });
    broadcast("meter:settings-changed", settings);
    return status();
  });
}

/** App start: when per-hero DPS is ON and this build bundles a NEWER plugin than the installed one,
 *  update it — only while the game is closed (the DLL is locked otherwise; we retry next launch). */
export function syncCombatPluginOnStartup(): void {
  try {
    if (!getSettings().perHeroDps) return;
    const s = status();
    // Only UPGRADE: an older app build must never downgrade a newer plugin someone installed.
    if (s.supported && s.installed && !s.gameRunning && isNewerVersion(s.bundledVersion, s.installedVersion)) {
      installCombatPlugin(resourcesDir(), s.gameDir, false);
    }
  } catch {
    // best effort — never block startup over the optional plugin
  }
}
