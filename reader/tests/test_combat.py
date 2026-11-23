"""metrics/combat.py — the optional in-game combat plugin's combat.json → per-hero damage dealt/taken per run.
The reader only READS the plugin's file (memory stays read-only); every failure degrades to None."""
import json

from metrics.combat import FORMAT_VERSION, STALE_MS, read_combat, run_damage, run_taken

NOW = 1_800_000_000_000


def _acc(damage, hits=1, crits=0, crit_damage=0.0, base=0.0, by_type=None, by_attr=None):
    return {"damage": damage, "hits": hits, "crits": crits, "crit_damage": crit_damage,
            "base_attack_damage": base, "by_type": by_type or {}, "by_attribute": by_attr or {}}


def _write(tmp_path, **over):
    doc = {"v": FORMAT_VERSION, "plugin": "0.4.0", "pid": 4242, "ts": NOW - 500, "started": 111,
           "errors": 0, "total": {"damage": 300.0},
           "heroes": {"601": _acc(200.0, 10, 4, 120.0, 50.0, {"2": 150.0, "6": 50.0}, {"0": 200.0}),
                      "101": _acc(100.0, 5, 1, 30.0)},
           "others": {},
           "taken": {"101": _acc(40.0, 8, 2, 15.0, 0.0, {"1": 40.0}, {"1": 30.0, "0": 10.0})}}
    doc.update(over)
    p = tmp_path / "combat.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return str(p)


class TestReadCombat:
    def test_valid_snapshot_with_breakdowns_and_taken(self, tmp_path):
        s = read_combat(_write(tmp_path), pid=4242, now_ms=NOW)
        assert s["started"] == 111 and s["total"] == 300.0
        assert s["heroes"][601]["damage"] == 200.0 and s["heroes"][601]["by_type"] == {2: 150.0, 6: 50.0}
        assert s["taken"][101]["by_attribute"] == {1: 30.0, 0: 10.0}

    def test_pre_0_4_plugin_has_no_taken(self, tmp_path):
        p = _write(tmp_path)
        doc = json.loads(open(p, encoding="utf-8").read())
        del doc["taken"]
        open(p, "w", encoding="utf-8").write(json.dumps(doc))
        assert read_combat(p, now_ms=NOW)["taken"] == {}

    def test_missing_file(self, tmp_path):
        assert read_combat(str(tmp_path / "nope.json"), now_ms=NOW) is None

    def test_stale_file_rejected(self, tmp_path):
        # game closed / plugin idle: the 1s rewrite stopped
        assert read_combat(_write(tmp_path, ts=NOW - STALE_MS - 1), now_ms=NOW) is None

    def test_other_game_process_rejected(self, tmp_path):
        assert read_combat(_write(tmp_path), pid=9999, now_ms=NOW) is None

    def test_pid_less_file_accepted_when_fresh(self, tmp_path):
        # a v0.2-era file had no pid — freshness alone still guards against a dead session
        assert read_combat(_write(tmp_path, pid=None), pid=4242, now_ms=NOW) is not None

    def test_wrong_format_or_garbage(self, tmp_path):
        assert read_combat(_write(tmp_path, v=FORMAT_VERSION + 1), now_ms=NOW) is None
        p = tmp_path / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        assert read_combat(str(p), now_ms=NOW) is None

    def test_non_hero_keys_skipped(self, tmp_path):
        # the plugin keys an unreadable hero as -1
        s = read_combat(_write(tmp_path, heroes={"-1": _acc(5), "301": _acc(7)}), now_ms=NOW)
        assert set(s["heroes"]) == {301}


def _snap(started=111, heroes=None, taken=None):
    def m(d):
        return {int(k): {**_acc(**v), "by_type": {int(a): b for a, b in v.get("by_type", {}).items()},
                         "by_attribute": {int(a): b for a, b in v.get("by_attr", {}).items()}}
                for k, v in (d or {}).items()}
    return {"started": started, "total": 0.0, "heroes": m(heroes), "taken": m(taken)}


class TestRunDamage:
    def test_window_delta_with_breakdowns(self):
        start = _snap(heroes={"601": dict(damage=100.0, hits=5, crits=1, crit_damage=20.0, base=10.0,
                                          by_type={"2": 100.0}, by_attr={"0": 100.0})})
        now = _snap(heroes={"601": dict(damage=350.0, hits=15, crits=5, crit_damage=140.0, base=60.0,
                                        by_type={"2": 250.0, "6": 100.0}, by_attr={"0": 300.0, "1": 50.0}),
                            "101": dict(damage=40.0, hits=2, by_type={"1": 40.0})})
        assert run_damage(start, now) == {
            601: {"damage": 250.0, "hits": 10, "crits": 4, "crit_damage": 120.0, "base_attack_damage": 50.0,
                  "by_type": {"2": 150.0, "6": 100.0}, "by_attribute": {"0": 200.0, "1": 50.0}},
            101: {"damage": 40.0, "hits": 2, "crits": 0, "crit_damage": 0.0, "base_attack_damage": 0.0,
                  "by_type": {"1": 40.0}, "by_attribute": {}},   # new hero mid-run
        }

    def test_idle_hero_omitted(self):
        s = _snap(heroes={"601": dict(damage=100.0)})
        assert run_damage(s, s) == {}

    def test_plugin_restart_invalidates(self):
        # counters reset → a diff would be negative garbage
        assert run_damage(_snap(started=111, heroes={"601": dict(damage=900.0)}),
                          _snap(started=222, heroes={"601": dict(damage=10.0)})) is None

    def test_counter_going_down_invalidates(self):
        assert run_damage(_snap(heroes={"601": dict(damage=900.0)}), _snap(heroes={"601": dict(damage=10.0)})) is None

    def test_missing_snapshot(self):
        assert run_damage(None, _snap()) is None and run_damage(_snap(), None) is None


class TestRunTaken:
    def test_taken_window(self):
        start = _snap(taken={"101": dict(damage=10.0, hits=2, by_attr={"1": 10.0})})
        now = _snap(taken={"101": dict(damage=50.0, hits=9, crits=2, by_attr={"1": 35.0, "0": 15.0})})
        r = run_taken(start, now)
        assert r[101]["damage"] == 40.0 and r[101]["hits"] == 7 and r[101]["crits"] == 2
        assert r[101]["by_attribute"] == {"1": 25.0, "0": 15.0}

    def test_pre_0_4_plugin_gives_empty(self):
        assert run_taken(_snap(), _snap()) == {}

    def test_restart_invalidates(self):
        assert run_taken(_snap(started=1), _snap(started=2)) is None
