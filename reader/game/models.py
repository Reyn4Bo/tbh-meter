"""models.py — LIVE WORLD reads (monsters) for DPS + the runtime stageKey.

Free functions taking (reader, ...), mirroring the monolith (same validated logic).
DPS = Σ of monster HP drops (the game doesn't store damage); HP is a RAW float
(UnitHealthController.HP_CURRENT / HP_MAX)."""

from config.offsets import (MonsterSpawnManager, Unit, UnitHealthController, Monster, StageCache,
                            StageInfoData, StageManager)


# "<Nf" covering HP_CURRENT..HP_MAX inclusive (both 4-byte floats, HP_MAX after HP_CURRENT).
_HP_SPAN_FMT = f"<{(UnitHealthController.HP_MAX - UnitHealthController.HP_CURRENT) // 4 + 1}f"


def live_monsters(reader, msm):
    """Iterates (unit_addr, hp_cur, hp_max) over the live + summoned monsters.

    HOT LOOP (10Hz, every mob on the stage): the pointer list comes out in a BATCH
    (reader.list_ptrs -> read_array_ptrs, 1 syscall for all Units, not 1 per Unit);
    and hp_cur+hp_max come from a SINGLE read (read_struct, 16B: 0x40..0x50) instead of two.
    That leaves 1 syscall to dereference each Unit's HealthController (addresses
    are scattered, so no batching). HP is a RAW float (HP_CURRENT = cur, HP_MAX = max)."""
    for field in (MonsterSpawnManager.MONSTER_LIST, MonsterSpawnManager.SUMMONED_LIST):
        for u in reader.list_ptrs(reader.rptr(msm + field), cap=600):
            hc = reader.rptr(u + Unit.HEALTH_CONTROLLER)
            if not hc:
                continue
            # ONE syscall spanning HP_CURRENT..HP_MAX (both floats); the format is DERIVED from the offsets
            # (it was a hard-coded "<4f"/vals[3], so moving HP_MAX in offsets.py silently changed nothing).
            vals = reader.read_struct(hc + UnitHealthController.HP_CURRENT, _HP_SPAN_FMT)
            if vals is not None:
                yield u, vals[0], vals[-1]


def live_stage_key(reader, msm):
    """LIVE stageKey = Monster.STAGE_KEY (every mob has the same one; flips instantly on a stage
    change — the save's currentStageKey is stale). Mode of the first few reads."""
    keys = []
    for u in reader.list_iter(reader.rptr(msm + MonsterSpawnManager.MONSTER_LIST), cap=600):
        k = reader.ri32(u + Monster.STAGE_KEY)
        if k is not None and 0 < k < 10_000_000:
            keys.append(k)
        if len(keys) >= 10:
            break
    return max(set(keys), key=keys.count) if keys else None


def stage_kills(reader, sm):
    """Monsters killed in the CURRENT stage attempt (StageManager.STAGE_KILLS, PLAIN int), or None.
    Drops to 0 when the stage (re)loads — the stage-reload signal since 1.3.2 deleted DeadMonsterUnit.
    `sm` = the LIVE StageManager (save.pick_live_sm); None/bad read/implausible → None (no signal)."""
    k = reader.ri32(sm + StageManager.STAGE_KILLS) if sm else None
    return k if k is not None and 0 <= k < 10_000_000 else None


def log_stage(reader, entry, cache_off):
    """(stage_key, act, stage_no) of a StageClearLog/StageFailedLog entry, or None.

    Since 1.3.2 the log no longer carries PLAIN act/stage ints: @cache_off (StageClearLog.STAGE_CACHE /
    StageFailedLog.STAGE_CACHE) is a pointer to the stage's StageCache, whose readonly INFO points at the
    catalog StageInfoData (PLAIN ints). StageCache's own scalars are Obscured — never read them. Each hop is
    null-guarded and the values range-checked (memory-safety): a bad read degrades to None and the caller keeps
    the catalog act/stage, exactly like the old `ri32() is None` fallback."""
    sc = reader.rptr(entry + cache_off) if entry else None
    si = reader.rptr(sc + StageCache.INFO) if sc else None
    if not si:
        return None
    sk = reader.ri32(si + StageInfoData.STAGE_KEY)
    act = reader.ri32(si + StageInfoData.ACT)
    sno = reader.ri32(si + StageInfoData.STAGE_NO)
    if sk is None or act is None or sno is None or not (0 < sk < 10_000_000 and 1 <= act <= 200 and 1 <= sno <= 200):
        return None
    return sk, act, sno
