"""1.3.2 stage-signal changes: the stage logs carry a StageCache POINTER instead of plain act/stage ints
(game.models.log_stage), and DeadMonsterUnit was deleted so a manual restart is detected from the
per-stage kill counter StageManager.STAGE_KILLS (game.models.stage_kills + meter_windows.StageReloadDetector),
which — unlike the old list — ALSO resets on a clear/fail, hence the debounce."""
import struct

from config.offsets import (MonsterSpawnManager, StageCache, StageClearLog, StageFailedLog, StageInfoData,
                            StageManager, Unit, UnitHealthController)
from game.models import live_monsters, log_stage, stage_kills
from meter_windows import STAGE_RELOAD_CONFIRM, StageReloadDetector
from tests.conftest import MockReader

LOG, SC, SI = 0x1000, 0x2000, 0x3000


def _stage_mem(sk=4309, act=3, sno=9, cache_off=StageClearLog.STAGE_CACHE):
    return {LOG + cache_off: SC, SC + StageCache.INFO: SI, SI + StageInfoData.STAGE_KEY: sk,
            SI + StageInfoData.ACT: act, SI + StageInfoData.STAGE_NO: sno}


class TestLogStage:
    def test_clear_log_resolves_through_stage_cache(self):
        # live 1.3.2: StageClearLog -> StageCache -> StageInfoData read (4309, 3, 9) on a 3-9 Torment clear.
        r = MockReader(mem=_stage_mem())
        assert log_stage(r, LOG, StageClearLog.STAGE_CACHE) == (4309, 3, 9)

    def test_failed_log_same_path(self):
        r = MockReader(mem=_stage_mem(1210, 2, 10, StageFailedLog.STAGE_CACHE))
        assert log_stage(r, LOG, StageFailedLog.STAGE_CACHE) == (1210, 2, 10)

    def test_null_stage_cache_is_none(self):
        assert log_stage(MockReader(mem={}), LOG, StageClearLog.STAGE_CACHE) is None

    def test_null_info_is_none(self):
        assert log_stage(MockReader(mem={LOG + StageClearLog.STAGE_CACHE: SC}), LOG,
                         StageClearLog.STAGE_CACHE) is None

    def test_implausible_values_are_none(self):
        # a misresolved pointer reads garbage: never surface it as act/stage (caller keeps the catalog's).
        assert log_stage(MockReader(mem=_stage_mem(act=0x7FFF)), LOG, StageClearLog.STAGE_CACHE) is None
        assert log_stage(MockReader(mem=_stage_mem(sk=-5)), LOG, StageClearLog.STAGE_CACHE) is None

    def test_null_entry_is_none(self):
        assert log_stage(MockReader(mem=_stage_mem()), 0, StageClearLog.STAGE_CACHE) is None


class TestStageFailedLogWaves:
    def test_wave_ints_are_swapped_in_1_3_2(self):
        # .ctor(StageCache, int nowWaveNumber, int totalWaveNumber, bool) stores now->0x4C, total->0x48.
        # With the old order a live 3-9 Torment fail printed `wave 30/25` (reached > total).
        assert (StageFailedLog.TOTAL_WAVE, StageFailedLog.NOW_WAVE) == (0x48, 0x4C)


class _HpReader(MockReader):
    """MockReader + the two batch reads live_monsters uses, over a byte-addressed float heap."""

    def __init__(self, mem, lists, floats):
        super().__init__(mem=mem, lists=lists)
        self._f = floats                                     # {addr: float}

    def list_ptrs(self, ptr, cap=600):
        return list(self.list_iter(ptr, cap))

    def read_struct(self, addr, fmt):
        n = struct.calcsize(fmt) // 4
        return tuple(self._f.get(addr + 4 * i, 0.0) for i in range(n))


class TestLiveMonstersHp:
    MSM, ML, U, HC = 0x100, 0x200, 0x300, 0x400

    def _reader(self, cur, mx, junk_4c=0.0):
        mem = {self.MSM + MonsterSpawnManager.MONSTER_LIST: self.ML,
               self.MSM + MonsterSpawnManager.SUMMONED_LIST: 0,
               self.U + Unit.HEALTH_CONTROLLER: self.HC}
        floats = {self.HC + UnitHealthController.HP_CURRENT: cur, self.HC + UnitHealthController.HP_MAX: mx,
                  self.HC + 0x4C: junk_4c}
        return _HpReader(mem, {self.ML: [self.U]}, floats)

    def test_reads_cur_and_max_from_offsets(self):
        # live 1.3.2: @0x40 = 36410.6 (cur), @0x4C = 0 (read-and-reset accumulator), @0x50 = 36410.6 (max).
        out = list(live_monsters(self._reader(28745.2, 36410.6), self.MSM))
        assert out == [(self.U, 28745.2, 36410.6)]

    def test_max_is_not_the_old_0x4c_accumulator(self):
        # the pre-1.3.2 hard-coded "<4f"/vals[3] read @0x4C → max 0 → validate_live [dps] withHpMax=0.
        (_u, _cur, mx), = live_monsters(self._reader(100.0, 500.0, junk_4c=0.0), self.MSM)
        assert mx == 500.0


class TestDeadHeroCarry:
    def test_dead_hero_keeps_last_known(self):
        # live: 3 heroes; then 301 + 201 die (out of the HeroList) — the overlay keeps their badge/tooltip.
        from game.build import carry_last_known
        last = {}
        carry_last_known({401: "p401", 301: "p301", 201: "p201"}, last, [401, 301, 201])
        out = carry_last_known({401: "p401b"}, last, [401, 301, 201])
        assert out == {401: "p401b", 301: "p301", 201: "p201"}

    def test_never_seen_hero_absent(self):
        from game.build import carry_last_known
        assert carry_last_known({401: 1}, {}, [401, 999]) == {401: 1}

    def test_dead_heroes(self):
        from game.build import dead_heroes
        assert dead_heroes([401, 301, 201], {401: (97, 0.0)}) == [301, 201]
        assert dead_heroes([401, 301], {}) == []     # empty live read: nobody flagged (could be a failed read)


class TestEquippedItemKeys:
    def test_maps_party_heroes_to_known_item_keys(self):
        from game.build import UNKNOWN_ITEM_KEY, equipped_item_keys
        recs = [{"heroKey": 601, "items": [{"itemKey": 516193}, {"itemKey": UNKNOWN_ITEM_KEY}, {"itemKey": None}]},
                {"heroKey": 101, "items": [{"itemKey": 300001}]},
                {"heroKey": 401, "items": [{"itemKey": 518173}]}]          # not deployed → excluded
        assert equipped_item_keys(recs, [601, 101, 999]) == {601: [516193], 101: [300001]}

    def test_empty_inputs(self):
        from game.build import equipped_item_keys
        assert equipped_item_keys([], [601]) == {} and equipped_item_keys(None, None) == {}


class TestWaveReduction:
    def test_live_runes_give_two(self):
        # live 1.3.2 save: 1171 + 1242 invested (level 1), 1301 not (level 0) → the in-game "关卡波数 -2".
        from metrics.progress import wave_reduction
        runes = [{"key": 1171, "level": 1}, {"key": 1242, "level": 1}, {"key": 1301, "level": 0},
                 {"key": 1001, "level": 5}]
        assert wave_reduction(runes) == 2

    def test_unreadable_runes_degrade_to_zero(self):
        from metrics.progress import wave_reduction
        assert wave_reduction(None) == 0 and wave_reduction([]) == 0


class TestStageTotalMobs:
    def test_full_clear_totals_match_live_kills(self):
        # live 1.3.2 full clears with reduction 2: 3-9 Torment (31 waves × 21) killed 610; Hell
        # Plaguelands 20 (22 × 21) killed 421. The pre-fix total (horde + 1) showed 652 / 463.
        from metrics.progress import stage_total_mobs
        assert stage_total_mobs((3, 9, 31 * 21, 3, 21), 2) == 610
        assert stage_total_mobs((22, 20, 22 * 21, 2, 21), 2) == 421

    def test_no_reduction_is_the_old_total(self):
        from metrics.progress import stage_total_mobs
        assert stage_total_mobs((3, 9, 651, 3, 21), 0) == 652

    def test_boss_only_and_missing(self):
        from metrics.progress import stage_total_mobs
        assert stage_total_mobs((3, 10, 0, 3, 0), 2) == 1      # x-10: just the boss
        assert stage_total_mobs(None, 2) is None

    def test_never_below_one_wave(self):
        from metrics.progress import stage_total_mobs
        assert stage_total_mobs((1, 1, 10, 0, 1), 99) == 2     # 1 wave × 1 + boss


class TestStageKills:
    SM = 0x5000

    def test_reads_counter(self):
        assert stage_kills(MockReader(mem={self.SM + StageManager.STAGE_KILLS: 609}), self.SM) == 609

    def test_no_sm_is_none(self):
        assert stage_kills(MockReader(mem={}), None) is None

    def test_garbage_is_none(self):
        assert stage_kills(MockReader(mem={self.SM + StageManager.STAGE_KILLS: -1}), self.SM) is None


class TestStageReloadDetector:
    def test_growth_never_fires(self):
        d = StageReloadDetector()
        assert not any(d.update(k, t * 0.1) for t, k in enumerate(range(0, 300, 7)))

    def test_unexplained_drop_fires_once_after_confirm(self):
        d = StageReloadDetector()
        d.update(380, 0.0)
        d.update(400, 0.5)                                            # this run is killing
        assert d.update(0, 1.0) is False                              # candidate, not yet confirmed
        assert d.update(3, 1.0 + STAGE_RELOAD_CONFIRM - 0.01) is False
        assert d.update(5, 1.0 + STAGE_RELOAD_CONFIRM) is True        # confirmed manual restart
        assert d.update(8, 10.0) is False                             # only ONCE

    def test_clear_cancels_the_drop(self):
        # live 1.3.2: the counter zeroes on the clear's tick; the loop update()s BEFORE the log scan and
        # cancel()s after a clear/fail closed the run → no 'abandoned' for a real clear.
        d = StageReloadDetector()
        d.update(588, 0.0)
        d.update(609, 0.05)
        d.update(0, 0.1)
        d.cancel()
        assert not any(d.update(k, 0.2 + i) for i, k in enumerate((0, 21, 42)))

    def test_clear_seen_a_tick_after_the_drop_still_cancels(self):
        d = StageReloadDetector()
        d.update(588, 0.0)
        d.update(609, 0.05)
        assert d.update(0, 0.1) is False   # zero seen one tick EARLY
        d.cancel()                          # StageClearLog arrives on the next tick
        assert d.update(0, 0.2 + STAGE_RELOAD_CONFIRM) is False

    def test_fail_then_delayed_reload_is_not_a_restart(self):
        # live 1.3.2 (3-9 Torment, party wiped): StageFailedLog at t=0 closes the run while the counter stays
        # frozen at 113; the stage reloads ~2s LATER (113 -> 0). That reload belongs to the fail, NOT a manual
        # restart: before guard 2 it confirmed after the 3s adopt grace → a phantom 3s 'abandoned' run.
        d = StageReloadDetector()
        d.update(100, -1.0)
        d.update(113, -0.5)
        d.cancel()                                       # fail log closes the run at t=0
        ticks = [(113, 0.1), (113, 1.0), (0, 2.0), (0, 3.0), (0, 3.6), (20, 5.0), (40, 8.0)]
        assert not any(d.update(k, t) for k, t in ticks)

    def test_manual_restart_after_a_fail_is_still_detected(self):
        # after the fail's own reload, the NEW attempt kills mobs; restarting it is a real manual restart.
        d = StageReloadDetector()
        d.update(113, 0.0)
        d.cancel()
        for k, t in [(113, 0.5), (0, 2.0), (21, 4.0), (42, 6.0)]:
            d.update(k, t)
        assert d.update(0, 7.0) is False
        assert d.update(0, 7.0 + STAGE_RELOAD_CONFIRM) is True

    def test_small_jitter_ignored(self):
        d = StageReloadDetector()
        d.update(100, 0.0)
        d.update(98, 0.1)                   # within the -2 tolerance
        assert d.update(99, 0.1 + STAGE_RELOAD_CONFIRM) is False

    def test_unreadable_ticks_ignored(self):
        d = StageReloadDetector()
        d.update(100, 0.0)
        assert d.update(None, 0.1) is False
        assert d.update(101, 0.2) is False

    def test_reset_forgets_baseline(self):
        d = StageReloadDetector()
        d.update(500, 0.0)
        d.reset()
        d.update(0, 0.1)                     # new game instance: not a drop
        assert d.update(0, 0.1 + STAGE_RELOAD_CONFIRM) is False
