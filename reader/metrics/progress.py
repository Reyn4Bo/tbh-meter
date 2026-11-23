"""Kills/min and stage state.

Kills: a per-stage kill counter (StageManager.STAGE_KILLS since 1.3.2 deleted DeadMonsterUnit) only
grows within a stage; the diff between ticks is how many died. Accumulate over a 60s window -> kills in
the last min.
"""

from shared.utils import RollingWindow, now

# Account runes whose effect is STATTYPE WaveCountReduction (game 1.3.2 RuneInfoData/RuneLevelInfoData):
# {runeKey: waves removed PER invested level}. Each is a 1-level node removing 1 wave from EVERY stage
# (the in-game rune panel's "关卡波数 -N"). NOT in FINAL_STATS (an account rune, not a hero stat), so the
# reader derives it from the save's RuneSaveData. Game data → re-check RuneLevelInfoData on a game update.
WAVE_REDUCTION_RUNES = {1171: 1, 1242: 1, 1301: 1}


def wave_reduction(runes):
    """Waves removed from every stage by the invested WaveCountReduction runes. `runes` = [{key, level}]
    (build.read_runes); None/unreadable → 0 (degrade to the catalog total, the pre-1.3.2 behavior).
    Live-confirmed (1.3.2): runes 1171+1242 at level 1 → 2, matching the in-game "关卡波数 -2"."""
    return sum(WAVE_REDUCTION_RUNES[r["key"]] * max(0, r.get("level") or 0)
               for r in runes or () if r.get("key") in WAVE_REDUCTION_RUNES)


def stage_total_mobs(si, reduction=0):
    """Monsters a full clear kills: horde waves AFTER the rune reduction × mobs per wave, + 1 boss.
    `si` = a stage_info row (act, stage_no, horde, diff, wave_mobs); None → None. Live-confirmed (1.3.2,
    reduction 2): 3-9 Torment 31 waves × 21 → 29 × 21 + 1 = 610, Hell Plaguelands 20 22 × 21 → 421 —
    exactly the kills the meter counted on full clears (the old horde+1 showed 652 / 463).
    Boss-only rows (wave_mobs 0) are unaffected. Never drops below 1 horde wave."""
    if not si:
        return None
    horde, wave_mobs = si[2], (si[4] if len(si) > 4 else 0)
    if reduction and wave_mobs:
        horde = max(1, horde // wave_mobs - reduction) * wave_mobs
    return horde + 1


class ProgressTracker:
    def __init__(self):
        self._kills_window = RollingWindow(window_seconds=60.0)
        self._last_dead: int | None = None
        self.total_kills: int = 0

    def update(self, dead_count: int, timestamp: float | None = None) -> None:
        ts = now() if timestamp is None else timestamp
        if dead_count is None:
            return
        if self._last_dead is not None:
            delta = dead_count - self._last_dead
            if delta > 0:                 # new kills
                self._kills_window.add(delta, ts)
                self.total_kills += delta
            # delta < 0 = list reset (stage change); ignore the jump
        self._last_dead = dead_count

    def kills_per_minute(self, timestamp: float | None = None) -> float:
        # 60s window: the window total IS "kills in the last minute"
        return self._kills_window.total(timestamp)
