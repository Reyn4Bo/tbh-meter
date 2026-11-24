"""pollution.py — the LIVE Plaguelands pollution gauge (game 1.3.2: "28/500"), for the overlay.

WHAT: {value, max, charge_sec} — the current pollution, its cap, and the seconds per +1 while charging.
The game charges +1 every `charge_sec` (360) outside the Plaguelands and keeps the CURRENT integer value
in memory (it ticks in place; no elapsed-time extrapolation is needed or done here).

WHERE (config/offsets.py::Plaguelands/PlaguelandsController/PollutionState): the static class
`Plaguelands` holds the live `PlaguelandsController` in a static field; the controller points at the
pollution state, whose fields are ACTk Obscured and are DECODED in place (game/obscured.py — algorithms
read from the binary; no PLAIN substitute exists, see obscured-data-offlimits).

WHY NOT `TARGETS` (rva-index-resolution's usual route for a new class): every name in TARGETS must be in
the calib index or the whole fast path falls back to the multi-minute cold scan — adding these would
force a CACHE_FMT bump + calib_seed re-capture and tie run tracking to an OPTIONAL overlay value. Instead
the two STABLE names are resolved lazily here with the same scan-free table walk the calibration uses
(typeinfo.walk_table_names, ~0.1 s, every slot validated by the class_name round-trip). Failure only
blanks this value; it never touches the run pipeline.

SAFETY: read-only; every deref null-guarded; the controller instance must point back at the resolved
PlaguelandsController class (object header == K); the decoded values must be sane (0 < max <= MAX_SANE,
0 <= value <= max, charge_sec > 0) or the read is None — never a wrong number.
"""
import time

from config.offsets import Class, Plaguelands, PlaguelandsController, PollutionState
from game.obscured import decode_obscured_int, decode_obscured_long
from il2cpp import typeinfo

STATIC_CLASS = "Plaguelands"
CONTROLLER_CLASS = "PlaguelandsController"
# Far above the real cap (500) — only rejects garbage from a wrong/moved struct.
MAX_SANE = 100_000
# A failed resolve (classes missing on a future build / not loaded yet) walks the whole type table, so
# retry at most this often instead of every ~1 s tick.
RESOLVE_RETRY_SEC = 60.0


def read_pollution(reader, k_static, k_controller):
    """Decode the gauge from already-resolved classes. Pure over `reader` (no clock, no table walk).
    {"value", "max", "charge_sec"} or None on ANY bad read / failed sanity check."""
    sf = reader.rptr(k_static + Class.STATIC_FIELDS)
    ctrl = reader.rptr(sf + Plaguelands.CONTROLLER) if sf else None
    if not ctrl or reader.rptr(ctrl) != k_controller:      # instance must be a PlaguelandsController
        return None
    st = reader.rptr(ctrl + PlaguelandsController.STATE)
    if not st:
        return None
    value = decode_obscured_long(reader.ru64(st + PollutionState.VALUE_HIDDEN),
                                 reader.ru64(st + PollutionState.VALUE_KEY))
    cap = decode_obscured_int(reader.ru32(st + PollutionState.MAX_HIDDEN),
                              reader.ru32(st + PollutionState.MAX_KEY))
    charge = decode_obscured_int(reader.ru32(st + PollutionState.CHARGE_SEC_HIDDEN),
                                 reader.ru32(st + PollutionState.CHARGE_SEC_KEY))
    if value is None or cap is None or charge is None:
        return None
    if not (0 < cap <= MAX_SANE and 0 <= value <= cap and charge > 0):
        return None
    return {"value": value, "max": cap, "charge_sec": charge}


class PollutionReader:
    """Per-session reader: resolves the two classes once (lazily, by table walk), then decodes each tick.
    A failed read drops the cached classes so the next attempt re-resolves (e.g. after a re-attach the
    `tbase` changes); resolution attempts are throttled to RESOLVE_RETRY_SEC."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._classes = None          # (k_static, k_controller)
        self._last_try = None

    def _resolve(self, reader, tbase):
        now = self._clock()
        if self._last_try is not None and now - self._last_try < RESOLVE_RETRY_SEC:
            return None
        self._last_try = now
        found = typeinfo.walk_table_names(reader, tbase, (STATIC_CLASS, CONTROLLER_CLASS))
        if STATIC_CLASS in found and CONTROLLER_CLASS in found:
            self._classes = (found[STATIC_CLASS], found[CONTROLLER_CLASS])
        return self._classes

    def read(self, reader, tbase):
        """The live gauge dict, or None (no type table yet, classes not found, or a bad read)."""
        if not tbase:
            return None
        classes = self._classes or self._resolve(reader, tbase)
        if classes is None:
            return None
        snap = read_pollution(reader, *classes)
        if snap is None:
            self._classes = None      # stale (re-attach / moved) → re-resolve on a later tick
        return snap
