"""Tests for metrics/pollution.py — the live Plaguelands pollution gauge, over FAKE memory.

The cipher words are produced with the ACTk ENCODE (inverse of game/obscured.py), so these tests pin the
pointer path + field offsets + sanity gates; the cipher math itself is pinned by tests/test_obscured.py
(including the live golden vector 27, oracle "28/500").
"""
from config.offsets import Class, Plaguelands, PlaguelandsController, PollutionState
from metrics import pollution
from metrics.pollution import PollutionReader, read_pollution
from tests.conftest import MockReader

M64 = (1 << 64) - 1
M32 = (1 << 32) - 1
K_STATIC, K_CTRL = 0x1000, 0x2000
SF, CTRL, STATE = 0x3000, 0x4000, 0x5000


def _enc_long(v, key=0x53763180A867DC13):
    return ((v & M64) ^ key) + key & M64, key


def _enc_int(v, key=0x2A2A1F1F):
    return ((v & M32) ^ key) + key & M32, key


def _mem(value=28, cap=500, charge=360, ctrl_klass=K_CTRL):
    vh, vk = _enc_long(value)
    mh, mk = _enc_int(cap)
    ch, ck = _enc_int(charge, key=0x11223344)
    return {
        K_STATIC + Class.STATIC_FIELDS: SF,
        SF + Plaguelands.CONTROLLER: CTRL,
        CTRL: ctrl_klass,                              # object header = its class
        CTRL + PlaguelandsController.STATE: STATE,
        STATE + PollutionState.VALUE_HIDDEN: vh, STATE + PollutionState.VALUE_KEY: vk,
        STATE + PollutionState.MAX_HIDDEN: mh, STATE + PollutionState.MAX_KEY: mk,
        STATE + PollutionState.CHARGE_SEC_HIDDEN: ch, STATE + PollutionState.CHARGE_SEC_KEY: ck,
    }


def test_decodes_value_max_and_charge_period():
    r = MockReader(_mem())
    assert read_pollution(r, K_STATIC, K_CTRL) == {"value": 28, "max": 500, "charge_sec": 360}


def test_full_gauge_is_valid():
    assert read_pollution(MockReader(_mem(value=500)), K_STATIC, K_CTRL)["value"] == 500


def test_instance_of_another_class_is_rejected():
    # The static slot must hold a PlaguelandsController — anything else is a moved/wrong struct.
    assert read_pollution(MockReader(_mem(ctrl_klass=0x9999)), K_STATIC, K_CTRL) is None


def test_insane_values_are_rejected_never_shown():
    assert read_pollution(MockReader(_mem(value=501)), K_STATIC, K_CTRL) is None      # above the cap
    assert read_pollution(MockReader(_mem(value=-1)), K_STATIC, K_CTRL) is None
    assert read_pollution(MockReader(_mem(cap=0)), K_STATIC, K_CTRL) is None
    assert read_pollution(MockReader(_mem(cap=pollution.MAX_SANE + 1, value=1)), K_STATIC, K_CTRL) is None
    assert read_pollution(MockReader(_mem(charge=0)), K_STATIC, K_CTRL) is None


def test_null_pointers_and_unreadable_words_give_none():
    for missing in (K_STATIC + Class.STATIC_FIELDS, SF + Plaguelands.CONTROLLER,
                    CTRL + PlaguelandsController.STATE, STATE + PollutionState.VALUE_KEY):
        mem = _mem()
        del mem[missing]
        assert read_pollution(MockReader(mem), K_STATIC, K_CTRL) is None


class _Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_reader_resolves_once_then_reads(monkeypatch):
    walks = []

    def walk(_reader, _tbase, names):
        walks.append(tuple(names))
        return {"Plaguelands": K_STATIC, "PlaguelandsController": K_CTRL}

    monkeypatch.setattr(pollution.typeinfo, "walk_table_names", walk)
    pr = PollutionReader(clock=_Clock())
    r = MockReader(_mem())
    assert pr.read(r, tbase=0xABC)["value"] == 28
    assert pr.read(r, tbase=0xABC)["value"] == 28
    assert len(walks) == 1                       # classes cached after the first walk


def test_reader_without_type_table_or_classes_is_none_and_throttled(monkeypatch):
    walks = []

    def walk(_reader, _tbase, names):
        walks.append(1)
        return {}                                # classes absent (e.g. a future build)

    monkeypatch.setattr(pollution.typeinfo, "walk_table_names", walk)
    clock = _Clock()
    pr = PollutionReader(clock=clock)
    r = MockReader(_mem())
    assert pr.read(r, tbase=None) is None and walks == []      # no calib table yet → no walk at all
    assert pr.read(r, tbase=0xABC) is None
    assert pr.read(r, tbase=0xABC) is None
    assert len(walks) == 1                                     # retry throttled
    clock.t += pollution.RESOLVE_RETRY_SEC
    pr.read(r, tbase=0xABC)
    assert len(walks) == 2


def test_failed_read_drops_cached_classes_for_re_resolve(monkeypatch):
    calls = []
    monkeypatch.setattr(pollution.typeinfo, "walk_table_names",
                        lambda *_a: calls.append(1) or {"Plaguelands": K_STATIC, "PlaguelandsController": K_CTRL})
    clock = _Clock()
    pr = PollutionReader(clock=clock)
    assert pr.read(MockReader(_mem()), tbase=1)["value"] == 28
    assert pr.read(MockReader({}), tbase=1) is None            # e.g. re-attach: old pointers are dead
    clock.t += pollution.RESOLVE_RETRY_SEC
    assert pr.read(MockReader(_mem(value=29)), tbase=1)["value"] == 29
    assert len(calls) == 2
