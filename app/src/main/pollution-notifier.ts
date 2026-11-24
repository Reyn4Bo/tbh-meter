// Plaguelands pollution "full" notifier — one OS notification the moment the gauge reaches its max
// (e.g. 500/500), so the player knows the Plaguelands are fully charged. Rising edge only (shared
// becameFull): never on the first reading, so launching the meter on a full gauge doesn't nudge — the
// overlay's full card covers that case. Gated by AppSettings.pollutionFullNotify (default on).

import { Notification } from "electron";
import type { LiveSnapshot } from "../shared/run-types.js";
import { becameFull, type LivePollution } from "../shared/pollution.js";
import { getSettings } from "./settings.js";
import { getLiveSource } from "./sources/live-source.js";
import { tMain } from "./i18n.js";

// Ephemeral: the last known gauge. An unreadable tick (null) does NOT reset it, so a brief read gap at
// the moment of filling can't swallow the edge — and can't fabricate one either (prev stays below max).
let last: LivePollution | null = null;

/** Wire once (from registerIpcHandlers): subscribe to the live stream. */
export function initPollutionNotifier(): void {
  getLiveSource().on("live", onLive);
}

function onLive(snap: LiveSnapshot | null): void {
  const cur = snap?.pollution ?? null;
  if (!cur) return;
  const fire = becameFull(last, cur);
  last = cur;
  if (fire && getSettings().pollutionFullNotify && Notification.isSupported()) {
    new Notification({
      title: tMain("notifications.pollutionFullTitle"),
      body: tMain("notifications.pollutionFullBody", { value: cur.value, max: cur.max }),
    }).show();
  }
}
