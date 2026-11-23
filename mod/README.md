# mod/ — optional in-game combat plugin (per-hero DPS)

**Experimental, opt-in.** Everything else in tbh-meter is a *read-only* sensor (`reader/` reads game
memory, never writes or injects). Per-hero damage cannot be obtained that way: the attacker of a hit
exists only in the transient `DamageInfo` passed to the damage call (a read-only statistical attempt was
tried on game 1.3.2 and failed — held-out R² < 0). This folder holds a small **BepInEx 6 (IL2CPP)**
plugin that runs *inside* the game and **observes** that call. It never changes a game value.

## What it does

- Native detour on `Monster.hal(DamageInfo, bool)` — the monster "take damage" entry. Per hit it reads
  the monster's HP before/after the original call (the real damage, overkill excluded) and credits it to
  the attacking hero (summons attack as their hero).
- Every second writes **cumulative** counters to `%USERPROFILE%\tbh-meter-mod\combat.json`
  (per hero: damage, hits, crits, crit damage, base-attack damage, by damage type/element/source; stamped
  with the game `pid`).
- The reader (`reader/metrics/combat.py`) reads that **file** (not memory), diffs it per run and emits
  live `party_damage` + raw `hero_damage`; the app shows per-hero DPS / share / crit rate.
- Without the plugin, everything degrades to team DPS only.

Validated live on 1.3.2: plugin total = reader team damage at ratio **1.000** (62 s and 93 s windows, two
different parties); a diagnostic build that also hooked every HP mutator found **zero** monster damage
bypassing `Monster.hal`.

## Risks — read before installing

- It loads code into the game process. The game ships ACTk anti-cheat (incl. an `InjectionDetector`, which
  per ACTk's docs is inactive on IL2CPP builds) and has online features (trading stash, Steam market). A
  ban/flag risk **cannot be ruled out**. The plugin does not touch, disable or evade any anti-cheat.
- A game update can move the offsets below; the plugin then logs an error and idles (or, with a wrong
  offset on a found method, could misread). Re-check after every game update (see Maintenance).

## Install (Windows)

**Normally you don't do this by hand:** the app's **Settings → Per-hero DPS** toggle installs the bundled
BepInEx pack + this plugin into the game folder (and removes exactly what it added when turned off). It
records what it created in `<game>\BepInEx\tbh-meter-install.json`; if BepInEx was already there (other
mods) it only adds/removes `BepInEx\plugins\TbhMeterCombat\`. The game must be closed. App packaging: build
the plugin, then `node app/scripts/stage-combat-plugin.mjs --bepinex <extracted BepInEx>` before
electron-builder (it bundles `app/resources/combat-plugin/`).

Manual install (development):

1. Download **BepInEx 6 IL2CPP win-x64** (bleeding edge, `BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.*.zip`)
   from <https://builds.bepinex.dev/projects/bepinex_be> and extract it into the game folder
   (next to `TaskBarHero.exe`). Launch the game once — the first start generates interop assemblies
   (a few minutes) — then close it.
2. Build: `dotnet build mod\TbhMeterCombat -c Release -p:GameDir="<game folder>"` (.NET SDK 6+).
3. Copy `mod\TbhMeterCombat\bin\Release\net6.0\TbhMeterCombat.dll` into
   `<game folder>\BepInEx\plugins\TbhMeterCombat\` and start the game.
4. Check `<game folder>\BepInEx\LogOutput.log` for `[tbh-meter combat] hooked; writing ...`.

## Uninstall

Delete from the game folder: `winhttp.dll`, `doorstop_config.ini`, `.doorstop_version`, `changelog.txt`,
`BepInEx\`, `dotnet\` (the BepInEx files) — or just `BepInEx\plugins\TbhMeterCombat\` to keep BepInEx.

## Maintenance (game update)

`Plugin.cs` → `Off` mirrors `reader/config/offsets.py` (`Unit.HEALTH_CONTROLLER`, `UnitHealthController.HP_CURRENT`,
`Unit.CACHE`, `HeroRuntime.INFO`, `HeroInfoData.HERO_KEY`) plus the `DamageInfo` struct layout and the
method name `hal` (obfuscated → may drift). After a game update: re-dump, compare, and re-verify the
x64 signature of the damage entry by disassembly before shipping. Bump `Plugin.FormatVersion` together
with `reader/metrics/combat.py::FORMAT_VERSION` on any breaking change to `combat.json`.
