import { cn } from "~/lib/utils";
import { sharePct } from "~/lib/hero-damage";
import { ELEMENT_BG, TYPE_BG, damageTypeKeys, elementKey, slices } from "~/lib/damage-kinds";
import { useT } from "~/lib/i18n";

/** Stacked share bar + legend for a damage-type or element breakdown (combat plugin >= 0.4). Renders nothing
 *  for an empty breakdown (an older plugin). `kind` picks the labels/colours: damage TYPE (flag combos like
 *  "Projectile+AOE", coloured by rank) or ELEMENT (fixed hues). `max` caps the legend (the rest folds away). */
export function Breakdown({
  data,
  kind,
  max = 4,
  className,
}: {
  data: Record<number, number> | null | undefined;
  kind: "type" | "element";
  max?: number;
  className?: string;
}) {
  const t = useT();
  const parts = slices(data);
  if (parts.length === 0) return null;
  const color = (key: number, i: number): string =>
    kind === "element" ? (ELEMENT_BG[key] ?? "bg-zinc-500") : TYPE_BG[Math.min(i, TYPE_BG.length - 1)];
  const label = (key: number): string =>
    kind === "element" ? t(elementKey(key)) : damageTypeKeys(key).map((k) => t(k)).join("+");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex h-1 overflow-hidden rounded-full bg-surface-700">
        {parts.map((p, i) => (
          <span key={p.key} className={cn("h-full", color(p.key, i))} style={{ width: `${p.share * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] leading-tight">
        {parts.slice(0, max).map((p, i) => (
          <span key={p.key} className="flex items-center gap-1">
            <span className={cn("size-1.5 shrink-0 rounded-sm", color(p.key, i))} />
            <span className="text-zinc-400">{label(p.key)}</span>
            <span className="tabular-nums text-zinc-200">{sharePct(p.share)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
