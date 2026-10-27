import datetime as dt
import os
from types import SimpleNamespace

from ha_jinja_stub import load_blueprint, make_env

HERE = os.path.dirname(__file__)
BP_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerung_frost.yaml")
NOW = dt.datetime(2026, 10, 27, 6, 0, 0)


def _day(datetime_str, templow=None, temperature=None):
    return SimpleNamespace(datetime=datetime_str, templow=templow, temperature=temperature)


def _frosttag(tage_liste, frost_ab=-2.0, alarm="", alarm_state="off", now=NOW):
    bp = load_blueprint(BP_PATH)
    reg = {}
    if alarm:
        reg[alarm] = (alarm_state, None)
    env, _ = make_env(reg, now)
    tpl = bp["actions"][0]["choose"][1]["sequence"][1]["variables"]["frosttag"]
    return env.from_string(tpl).render(tage_liste=tage_liste, frost_ab=frost_ab, alarm=alarm)


def test_findet_ersten_frosttag_per_templow():
    tage = [
        _day("2026-01-10T12:00:00", templow=3, temperature=5),
        _day("2026-01-11T12:00:00", templow=-3, temperature=1),
        _day("2026-01-12T12:00:00", templow=-5, temperature=0),
    ]
    out = _frosttag(tage, frost_ab=-2)
    assert out.strip() == "2026-01-11"


def test_faellt_auf_temperature_zurueck_wenn_templow_fehlt():
    tage = [_day("2026-01-10T12:00:00", templow=None, temperature=-4)]
    out = _frosttag(tage, frost_ab=-2)
    assert out.strip() == "2026-01-10"


def test_kein_frosttag_ohne_alarm_loest_guard_nicht_aus():
    """Die rohe Vorlage liefert wegen der YAML-Faltung '  ' (Leerzeichen) statt '' (bekannte
    Eigenheit). Die Bedingung im Blueprint prueft deshalb '(frosttag | trim) != ''` -
    das muss hier auch bei reinem Leerzeichen-Ergebnis korrekt False liefern."""
    bp = load_blueprint(BP_PATH)
    tage = [_day("2026-01-10T12:00:00", templow=5, temperature=6)]
    frosttag_raw = _frosttag(tage, frost_ab=-2, alarm="")
    env, _ = make_env({}, NOW)
    guard_tpl = bp["actions"][0]["choose"][1]["sequence"][2]["if"][0]["value_template"]
    guard = env.from_string(guard_tpl).render(frosttag=frosttag_raw)
    assert guard is False, f"Guard sollte False sein (kein Frosttag, kein Alarm), war {guard!r} fuer frosttag={frosttag_raw!r}"


def test_frostalarm_an_ohne_vorhersage_setzt_heute():
    tage = [_day("2026-01-10T12:00:00", templow=5, temperature=6)]
    out = _frosttag(tage, frost_ab=-2, alarm="binary_sensor.frostalarm", alarm_state="on")
    assert out.strip() == NOW.strftime("%Y-%m-%d")


def test_leere_vorhersageliste_ohne_alarm_loest_guard_nicht_aus():
    bp = load_blueprint(BP_PATH)
    frosttag_raw = _frosttag([], frost_ab=-2, alarm="")
    env, _ = make_env({}, NOW)
    guard_tpl = bp["actions"][0]["choose"][1]["sequence"][2]["if"][0]["value_template"]
    guard = env.from_string(guard_tpl).render(frosttag=frosttag_raw)
    assert guard is False
