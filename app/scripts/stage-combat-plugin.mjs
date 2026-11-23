// Stage the OPTIONAL per-hero DPS plugin into resources/combat-plugin/ so electron-builder bundles it
// (extraResources → <resourcesPath>/combat-plugin) and main/combat-plugin.ts can install it on demand.
//
//   node scripts/stage-combat-plugin.mjs --bepinex <extracted BepInEx-Unity.IL2CPP-win-x64 dir> \
//                                        --dll <mod/TbhMeterCombat/bin/Release/net6.0/TbhMeterCombat.dll>
//
// The plugin version comes from mod/TbhMeterCombat/Plugin.cs (`Version = "x.y.z"`) — the single source.
// The folder is generated (gitignored). Without it the app still builds and runs; the Settings toggle then
// reports "this build doesn't include the plugin".
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const repo = join(appDir, "..");
const out = join(appDir, "resources", "combat-plugin");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const bepinex = arg("--bepinex");
const dll = arg("--dll") ?? join(repo, "mod", "TbhMeterCombat", "bin", "Release", "net6.0", "TbhMeterCombat.dll");
if (!bepinex || !existsSync(join(bepinex, "winhttp.dll"))) {
  console.error("stage-combat-plugin: --bepinex must point at an extracted BepInEx IL2CPP win-x64 folder (has winhttp.dll)");
  process.exit(1);
}
if (!existsSync(dll)) {
  console.error(`stage-combat-plugin: plugin DLL not found at ${dll} — run: dotnet build mod/TbhMeterCombat -c Release`);
  process.exit(1);
}
const pluginCs = readFileSync(join(repo, "mod", "TbhMeterCombat", "Plugin.cs"), "utf-8");
const version = pluginCs.match(/public const string Version = "([^"]+)"/)?.[1];
if (!version) {
  console.error("stage-combat-plugin: couldn't read Version from Plugin.cs");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(bepinex, join(out, "bepinex"), { recursive: true });
cpSync(dll, join(out, "TbhMeterCombat.dll"));
writeFileSync(join(out, "version.txt"), `${version}\n`);
// LGPL-2.1 requires the license text to travel with the redistributed BepInEx binaries.
cpSync(join(repo, "mod", "LICENSE-BepInEx-LGPL-2.1.txt"), join(out, "LICENSE-BepInEx-LGPL-2.1.txt"));
writeFileSync(
  join(out, "THIRD-PARTY.txt"),
  "bepinex/ — BepInEx 6 (IL2CPP, win-x64), https://github.com/BepInEx/BepInEx — LGPL-2.1\n" +
    "(full text: LICENSE-BepInEx-LGPL-2.1.txt; source: https://github.com/BepInEx/BepInEx).\n" +
    "Redistributed unmodified; installed into the game folder only when the user enables per-hero DPS.\n",
);
console.log(`stage-combat-plugin: staged plugin v${version} + BepInEx into ${out}`);
