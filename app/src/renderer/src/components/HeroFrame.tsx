import { Skull } from "lucide-react";
import { cn } from "~/lib/utils";
import { heroName, levelCurve } from "~/lib/game-data";
import { heroResistances, type HeroResistance, type ResElement } from "~/lib/hero-resistance";
import { HERO_DPS_TEXT, sharePct, type HeroDpsRow } from "~/lib/hero-damage";
import { Breakdown } from "~/components/Breakdown";
import { OverlayTooltip } from "~/components/OverlayTooltip";
import { useHoverTooltip } from "~/lib/use-hover-tooltip";
import { useT } from "~/lib/i18n";
import { formatEta, humanize } from "~/lib/format";
import { expToNextLevel, measuredExpPerSecond, timeToNextLevel } from "../../../shared/exp-model.js";

// One deployed hero in the live Team frame: the idle sprite, its live level (corner badge) + the ETA
// to the next level beneath it, and a hover card. The card shows the leveling detail (within-level
// progress bar, the measured XP/sec, the ETA) AND the hero's EFFECTIVE elemental resistances on the
// current stage (its own resistance minus the difficulty penalty — see hero-resistance.ts). The ETA
// is derived from the meter's MEASURED live XP/sec (the game's own number), so it carries no
// penalty-model risk; a hero at the level cap shows "MAX" and no ETA.

/** Per-hero live leveling snapshot (mirrors LiveSnapshot.partyProgress[heroKey]). */
export interface HeroProgress {
  level: number;
  /** Within-level exp (resets on level-up); remaining = curve[level] − exp. */
  exp: number;
  /** Run-accumulated xp for this hero (level-up-bridged) → the measured rate is gain / elapsed. */
  gain: number;
}

const ELEMENT_DOT: Record<ResElement, string> = {
  Fire: "bg-orange-400",
  Cold: "bg-sky-400",
  Lightning: "bg-yellow-300",
  Chaos: "bg-fuchsia-400",
};

/** Color the effective value: negative = vulnerable (red), positive = resistant (green), 0 = muted. */
function effClass(v: number): string {
  if (v < 0) return "text-rose-300";
  if (v > 0) return "text-emerald-300";
  return "text-zinc-400";
}

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v}%`;
}

export function HeroFrame({
  heroKey,
  src,
  stats,
  progress,
  items,
  dps,
  taken,
  dead = false,
  elapsedSec,
  mode,
}: {
  heroKey: number;
  src: string;
  stats: Record<number, number> | undefined;
  progress: HeroProgress | undefined;
  /** Equipped item keys (live party_items) — applies item unique mods to the resistances. */
  items?: readonly number[];
  /** This hero's live DPS row (optional combat plugin) — DPS + share under the avatar, detail in the card. */
  dps?: HeroDpsRow;
  /** This hero's live damage-TAKEN row (plugin >= 0.4) — taken/s, share, crits taken, elements in the card. */
  taken?: HeroDpsRow;
  /** Dead right now (awaiting revive): greyed sprite + skull; level/stats shown are last-known. */
  dead?: boolean;
  elapsedSec: number;
  mode: string;
}) {
  const t = useT();
  const { open, anchorRef, hover } = useHoverTooltip<HTMLSpanElement>();
  const info = heroResistances(stats, mode, items);

  // Leveling — all from the MEASURED live rate (no penalty model). need=null ⇒ at the cap.
  const need = progress ? expToNextLevel(progress.level, levelCurve) : null;
  const capped = progress != null && need == null;
  const rate = progress ? measuredExpPerSecond(progress.gain, elapsedSec) : 0;
  const eta = progress ? timeToNextLevel(progress.level, progress.exp, rate, levelCurve) : null;
  const etaLabel = eta == null ? "—" : formatEta(eta);
  const hasEta = progress != null && !capped && etaLabel !== "—";
  const pct = progress && need ? Math.min(100, Math.max(0, (progress.exp / need) * 100)) : 0;

  return (
    <span
      ref={anchorRef}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      className="flex flex-col items-center gap-0.5"
    >
      <span className="relative">
        <span
          className={cn(
            "flex size-7 items-center justify-center overflow-hidden rounded bg-surface-900/80 ring-1",
            dead ? "ring-rose-500/60" : "ring-surface-500/70",
          )}
        >
          <img
            src={src}
            alt=""
            aria-hidden
            className={cn(
              "size-6 max-w-none object-contain [image-rendering:pixelated]",
              dead && "opacity-40 grayscale",
            )}
          />
        </span>
        {dead && (
          // Dead (awaiting revive): skull over the greyed sprite; the badge/numbers below are last-known.
          <Skull className="absolute inset-0 m-auto size-3.5 text-rose-300 drop-shadow" aria-hidden />
        )}
        {progress && (
          <span className="absolute -right-1 -top-1 rounded bg-surface-700 px-0.5 text-[8px] font-bold leading-[1.45] tabular-nums text-zinc-300 ring-1 ring-surface-500/80">
            {progress.level}
          </span>
        )}
      </span>
      {dead ? (
        <span className="font-mono text-[8px] font-semibold leading-none text-rose-300">{t("live.dead")}</span>
      ) : (
        progress && (
          <span
            className={cn(
              // normal-case: the footer is uppercase, but "36m" must not read as "36M" (millions).
              "font-mono text-[8px] font-semibold normal-case leading-none tabular-nums",
              capped ? "text-zinc-600" : hasEta ? "text-emerald-300" : "text-zinc-500",
            )}
          >
            {capped ? t("live.maxed") : etaLabel}
          </span>
        )
      )}
      {dps && (
        // normal-case for the same reason as the ETA: "38.6M" must keep its unit case in the uppercase footer.
        <span className={cn("font-mono text-[8px] font-semibold normal-case leading-none tabular-nums", HERO_DPS_TEXT[dps.color])}>
          {humanize(dps.dps)} · {sharePct(dps.share)}
        </span>
      )}

      {(progress || info || dps || taken) && (
        // placement="top": this frame lives in the overlay's bottom footer, so the card opens the
        // tooltip UPWARD — a downward one would grow the window under the cursor and flicker (see
        // OverlayTooltip).
        <OverlayTooltip anchorRef={anchorRef} open={open} placement="top">
          <div className="flex min-w-[8.5rem] flex-col gap-2">
            <div className="flex items-center justify-between gap-3 border-b border-surface-600/70 pb-1">
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-200">
                {heroName(heroKey)}
                {dead && (
                  <span className="flex items-center gap-0.5 normal-case text-rose-300">
                    <Skull className="size-3" aria-hidden />
                    {t("live.dead")}
                  </span>
                )}
              </span>
              {progress && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                  {capped ? t("live.maxed") : `lv ${progress.level}`}
                </span>
              )}
            </div>

            {progress && !capped && need != null && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <span className="uppercase tracking-wider text-zinc-500">{t("live.timeToLevel")}</span>
                  <span className="font-semibold tabular-nums text-emerald-300">
                    {hasEta ? `→ ${progress.level + 1} · ${etaLabel}` : "—"}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-600">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="font-mono text-[9px] tabular-nums text-zinc-500">
                  {humanize(rate)} xp/s · {pct.toFixed(0)}%
                </span>
              </div>
            )}

            {dps && (
              <div className="flex flex-col gap-0.5 font-mono text-[10px]">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">{t("live.damage")}</span>
                <DmgLine label="DPS" value={humanize(dps.dps)} tone={HERO_DPS_TEXT[dps.color]} />
                <DmgLine label={t("live.dmgShare")} value={sharePct(dps.share)} />
                <DmgLine
                  label={t("live.critRate")}
                  value={dps.critRate == null ? "—" : `${Math.round(dps.critRate * 100)}%`}
                />
                <DmgLine label={t("live.hits")} value={String(dps.hits)} />
                <Breakdown data={dps.byType} kind="type" className="mt-1" />
                {/* Element mix of this hero's damage — mixed-damage heroes (e.g. Hunter) split across elements. */}
                <Breakdown data={dps.byAttribute} kind="element" className="mt-1" />
              </div>
            )}

            {taken && taken.damage > 0 && (
              <div className="flex flex-col gap-0.5 font-mono text-[10px]">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">{t("live.taken")}</span>
                <DmgLine label={`${t("live.taken")}/s`} value={humanize(taken.dps)} tone="text-rose-300" />
                <DmgLine label={t("live.dmgShare")} value={sharePct(taken.share)} />
                <DmgLine
                  label={t("live.critTaken")}
                  value={taken.critRate == null ? "—" : `${Math.round(taken.critRate * 100)}%`}
                />
                <Breakdown data={taken.byAttribute} kind="element" className="mt-1" />
              </div>
            )}

            {info && (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                  Resist · {mode}
                </span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
                  {info.resistances.map((r) => (
                    <ResLine key={r.element} r={r} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </OverlayTooltip>
      )}
    </span>
  );
}

function DmgLine({ label, value, tone = "text-zinc-200" }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex items-center justify-between gap-3 leading-tight">
      <span className="text-zinc-400">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
    </span>
  );
}

function ResLine({ r }: { r: HeroResistance }) {
  return (
    <span className="flex items-center gap-1.5 leading-tight">
      <span className={cn("size-1.5 shrink-0 rounded-full", ELEMENT_DOT[r.element])} />
      <span className="w-14 shrink-0 text-zinc-400">{r.element}</span>
      <span className={cn("tabular-nums font-semibold", effClass(r.effective))}>
        {fmtPct(r.effective)}
      </span>
    </span>
  );
}
