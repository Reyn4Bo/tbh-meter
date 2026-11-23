// Optional: hide the GAME's taskbar button (Settings → "Hide the game's taskbar icon"). TaskBarHero and the
// meter are both idle-in-the-background apps and some players don't want either on the taskbar.
//
// This is a pure Windows-shell UI tweak — it never touches the game's memory or files: the shell's own
// ITaskbarList COM interface removes (DeleteTab) / restores (AddTab) the button of the game's main window.
// No native module: a tiny inline C# via PowerShell (present on every Windows 10/11).
//
// The button comes back whenever the game creates a new window (restart), so while the setting is on we
// re-apply on a slow poll: a cheap `tasklist` every POLL_MS, and the PowerShell call only when the game pid
// changed or REAPPLY_MS passed. Turning the setting off — or quitting the meter — restores the button.
import { execFile, execFileSync } from "node:child_process";
import { GAME_EXE } from "./combat-plugin.js";
import { getSettings } from "./settings.js";

const POLL_MS = 30_000;
const REAPPLY_MS = 120_000;

/** PowerShell: find the game's main window and DeleteTab/AddTab it. Exit 2 = no game window yet. */
function script(hide: boolean): string {
  return `
$ProgressPreference = 'SilentlyContinue'
$p = Get-Process -Name '${GAME_EXE.replace(/\.exe$/i, "")}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit 2 }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList { void HrInit(); void AddTab(IntPtr hwnd); void DeleteTab(IntPtr hwnd); void ActivateTab(IntPtr hwnd); void SetActiveAlt(IntPtr hwnd); }
[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] public class TbhTaskbarList {}
public static class TbhTaskbar { public static void Set(IntPtr h, bool hide) { var t = (ITaskbarList)new TbhTaskbarList(); t.HrInit(); if (hide) t.DeleteTab(h); else t.AddTab(h); } }
"@
[TbhTaskbar]::Set($p.MainWindowHandle, $${hide ? "true" : "false"})
exit 0
`;
}

/** Args for a hidden, profile-less PowerShell run of `script` (UTF-16LE base64 → no quoting pitfalls). */
function psArgs(hide: boolean): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(script(hide), "utf16le").toString("base64"),
  ];
}

/** The running game's pid, or null. */
function gamePid(): number | null {
  try {
    const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${GAME_EXE}`, "/FO", "CSV", "/NH"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    const m = out.match(/^"[^"]+","(\d+)"/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let appliedPid: number | null = null;
let appliedAt = 0;
let busy = false;

function run(hide: boolean, done?: (ok: boolean) => void): void {
  busy = true;
  execFile("powershell", psArgs(hide), { windowsHide: true, timeout: 15_000 }, (err) => {
    busy = false;
    done?.(!err);
  });
}

function tick(): void {
  if (busy || !getSettings().hideGameTaskbarIcon) return;
  const pid = gamePid();
  if (pid == null) {
    appliedPid = null;
    return;
  }
  if (pid === appliedPid && Date.now() - appliedAt < REAPPLY_MS) return;
  run(true, (ok) => {
    // exit 2 (window not created yet) counts as not applied → retried next tick.
    if (ok) {
      appliedPid = pid;
      appliedAt = Date.now();
    }
  });
}

/** Apply the current setting now and (re)arm the poll. Call at startup and whenever the setting changes. */
export function applyGameTaskbarSetting(): void {
  if (process.platform !== "win32") return;
  if (getSettings().hideGameTaskbarIcon) {
    appliedPid = null; // force an immediate apply
    tick();
    if (!timer) timer = setInterval(tick, POLL_MS);
  } else {
    if (timer) clearInterval(timer);
    timer = null;
    if (appliedPid != null || gamePid() != null) run(false); // give the button back
    appliedPid = null;
  }
}

/** App quit: restore the game's button (best effort, bounded) so the game isn't left button-less. */
export function restoreGameTaskbarOnQuit(): void {
  if (process.platform !== "win32" || !getSettings().hideGameTaskbarIcon) return;
  if (timer) clearInterval(timer);
  timer = null;
  try {
    execFileSync("powershell", psArgs(false), { windowsHide: true, timeout: 5_000, stdio: "ignore" });
  } catch {
    // game gone / PowerShell slow — the button returns with the game's next window anyway
  }
}
