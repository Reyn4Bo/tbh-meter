import { useEffect, useState } from "react";
import { Biohazard, X } from "lucide-react";
import type { LivePollution } from "../../../shared/pollution.js";
import { isPollutionFull, pollutionEtaSec } from "../../../shared/pollution.js";
import { bossBoxForStage, isContaminatedBox } from "~/lib/game-data";
import { formatEta } from "~/lib/format";
import { useT } from "~/lib/i18n";
import { cn } from "~/lib/utils";

/** The Plaguelands pollution gauge as a one-line row in the expanded overlay card: icon + label, a
 *  draining-style bar, "28/500", and the time to full while charging. The ETA is hidden ON a plague
 *  stage (the gauge is being spent there, not charged). Renders nothing when the reader has no gauge. */
export function PollutionRow({ pollution, stageKey }: { pollution: LivePollution | null | undefined; stageKey: number | null }) {
  const t = useT();
  if (!pollution) return null;
  const full = isPollutionFull(pollution);
  const onPlague = stageKey != null && isContaminatedBox(bossBoxForStage(stageKey));
  const pct = Math.min(100, (pollution.value / pollution.max) * 100);
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded bg-surface-800/80 px-2 py-1 font-mono text-[11px] font-semibold ring-1 ring-surface-600/60">
      <Biohazard className="size-3.5 shrink-0 text-lime-400" aria-hidden />
      <span className="shrink-0 uppercase tracking-[0.12em] text-zinc-500">{t("live.pollution")}</span>
      <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-surface-700">
        <span
          className={cn("block h-full rounded-full", full ? "bg-emerald-400" : "bg-lime-500/80")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={cn("shrink-0 tabular-nums", full ? "text-emerald-300" : "text-zinc-200")}>
        {pollution.value}/{pollution.max}
      </span>
      {full ? (
        <span className="shrink-0 text-emerald-300" title={t("live.pollutionFull")}>✓</span>
      ) : (
        !onPlague && (
          <span className="shrink-0 normal-case text-zinc-400">
            {t("live.pollutionEta", { eta: formatEta(pollutionEtaSec(pollution)) })}
          </span>
        )
      )}
    </div>
  );
}

/** Overlay card shown below the meter (with the chest cooldowns) while the gauge is FULL — the "go farm
 *  the Plaguelands" nudge, styled like a ready chest card. Self-subscribes to the live snapshot. The X
 *  hides it until the gauge drops below full again (a new fill shows it again). */
export function OverlayPollutionFull() {
  const t = useT();
  const [pollution, setPollution] = useState<LivePollution | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => window.meter.onLive((snap) => setPollution(snap?.pollution ?? null)), []);
  const full = isPollutionFull(pollution);
  useEffect(() => {
    if (!full) setDismissed(false); // re-arm for the next fill
  }, [full]);
  if (!full || dismissed || !pollution) return null;
  return (
    <div className="border-t border-surface-600 bg-surface-900/80 px-1 py-1">
      <div className="group relative flex items-center gap-1 overflow-hidden rounded bg-emerald-500/5 px-1.5 py-0.5 text-[11px] leading-none ring-1 ring-emerald-500/40">
        <Biohazard className="size-3.5 shrink-0 text-lime-400" aria-hidden />
        <span className="shrink-0 font-semibold text-white">{t("live.pollutionFull")}</span>
        <span className="ml-auto flex items-center gap-1.5 pl-2">
          <span className="font-mono tabular-nums text-zinc-300">
            {pollution.value}/{pollution.max}
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-300">
            {t("cooldowns.readyCheck")}
          </span>
          <button
            type="button"
            title={t("common.close")}
            onClick={() => setDismissed(true)}
            className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-500 transition-colors hover:text-rose-300"
          >
            <X className="size-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}
