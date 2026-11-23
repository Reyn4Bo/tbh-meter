"""Per-hero damage DEALT and TAKEN from the OPTIONAL in-game combat plugin (mod/TbhMeterCombat, BepInEx).

The reader itself stays READ-ONLY on game memory: it can measure TEAM damage (Σ monster HP drops,
metrics/dps.py) but not who dealt it — that lives only in the transient per-hit DamageInfo (the 1.3.2
read-only attribution experiment failed, held-out R² < 0). The opt-in plugin observes the damage calls
inside the game (Monster.hal = dealt, Hero.hal = taken) and writes CUMULATIVE per-hero counters to
~/tbh-meter-mod/combat.json every second (validated live: its dealt total matched this reader's team
damage at ratio 1.000). Here we only READ that FILE and diff two snapshots for a run window — pure
functions, no memory reads.

Absent plugin / stale file / another game process / plugin restarted mid-run → None, and every consumer
degrades (no per-hero data), exactly like an older reader."""

import json
import os
import time

COMBAT_PATH = os.path.join(os.path.expanduser("~"), "tbh-meter-mod", "combat.json")
FORMAT_VERSION = 1          # mod/TbhMeterCombat Plugin.FormatVersion
STALE_MS = 5000             # the plugin rewrites every 1s; older than this = game closed / plugin idle
_NUMS = ("damage", "hits", "crits", "crit_damage", "base_attack_damage")
_BREAKDOWNS = ("by_type", "by_attribute")   # EDamageType flag combo / EDamageAttribute → damage
_EPS = 1e-6                                 # float noise tolerance when diffing


def _hero_entry(v):
    """One plugin accumulator → {num fields as float, by_type/by_attribute as {int: float}}."""
    out = {f: float(v.get(f) or 0) for f in _NUMS}
    for b in _BREAKDOWNS:
        out[b] = {int(k): float(x or 0) for k, x in (v.get(b) or {}).items()}
    return out


def _hero_map(section):
    out = {}
    for k, v in (section or {}).items():
        hk = int(k)
        if hk > 0 and isinstance(v, dict):
            out[hk] = _hero_entry(v)
    return out


def read_combat(path=COMBAT_PATH, pid=None, now_ms=None):
    """Validated snapshot {"started": ms, "total": float, "heroes": {heroKey: entry}, "taken": {heroKey: entry}}
    (entry = damage/hits/crits/crit_damage/base_attack_damage + by_type/by_attribute) or None. Rejected:
    missing/unreadable/malformed file, a format other than FORMAT_VERSION, a stale `ts`, or a `pid` that isn't
    the attached game's (a leftover from an earlier session). `taken` is {} for a pre-0.4 plugin. Never raises."""
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        if not isinstance(doc, dict) or doc.get("v") != FORMAT_VERSION:
            return None
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        ts = doc.get("ts")
        if not isinstance(ts, (int, float)) or now_ms - ts > STALE_MS:
            return None
        if pid is not None and doc.get("pid") not in (None, pid):
            return None
        return {"started": doc.get("started"), "total": float((doc.get("total") or {}).get("damage") or 0),
                "heroes": _hero_map(doc.get("heroes")), "taken": _hero_map(doc.get("taken"))}
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def _diff(start_map, now_map):
    """Per-hero window delta between two _hero_map sections; heroes with no damage in the window are omitted.
    None when any counter went DOWN (a reset the `started` check didn't catch)."""
    out = {}
    for hk, cur in now_map.items():
        base = start_map.get(hk) or {}
        d = {f: cur[f] - base.get(f, 0.0) for f in _NUMS}
        if any(v < -_EPS for v in d.values()):
            return None
        if d["damage"] <= _EPS:
            continue
        entry = {"damage": round(d["damage"], 2), "hits": int(round(d["hits"])), "crits": int(round(d["crits"])),
                 "crit_damage": round(d["crit_damage"], 2), "base_attack_damage": round(d["base_attack_damage"], 2)}
        for b in _BREAKDOWNS:
            bb = (base.get(b) or {})
            parts = {}
            for k, v in cur[b].items():
                dv = v - bb.get(k, 0.0)
                if dv < -_EPS:
                    return None
                if dv > _EPS:
                    parts[str(k)] = round(dv, 2)
            entry[b] = parts
        out[hk] = entry
    return out


def _window(start, now, section):
    if not start or not now or start.get("started") != now.get("started"):
        return None
    return _diff(start.get(section) or {}, now.get(section) or {})


def run_damage(start, now):
    """Damage DEALT per hero between two read_combat snapshots: {heroKey: {damage, hits, crits, crit_damage,
    base_attack_damage, by_type: {"<flags>": dmg}, by_attribute: {"<attr>": dmg}}}. None when either snapshot
    is missing or the plugin restarted in between (`started` differs → counters reset)."""
    return _window(start, now, "heroes")


def run_taken(start, now):
    """Damage TAKEN per victim hero over the same window (same shape as run_damage). Empty {} with a pre-0.4
    plugin (no `taken` section); None under the same conditions as run_damage."""
    return _window(start, now, "taken")
