import os
from types import SimpleNamespace

from ha_jinja_stub import load_blueprint, make_env
import datetime as dt

HERE = os.path.dirname(__file__)
BP_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerung_kalender.yaml")
NOW = dt.datetime(2026, 10, 27, 0, 10, 0)


def _event(summary, start_date):
    return SimpleNamespace(summary=summary, start=start_date)


def _naechster(eintraege, suchtext=""):
    bp = load_blueprint(BP_PATH)
    env, _ = make_env({}, NOW)
    tpl = bp["actions"][1]["variables"]["naechster"]
    return env.from_string(tpl).render(eintraege=eintraege, suchtext=suchtext)


def test_kein_termin_ergibt_2099():
    out = _naechster([], suchtext="Bioabfall")
    assert out.strip() == "2099-12-31"


def test_findet_naechsten_passenden_termin():
    eintraege = [
        _event("Restmüll Tonnen und Container", "2026-11-05"),
        _event("Bioabfall - Groß-Zimmern", "2026-10-28"),
        _event("Gelber Sack - Groß-Zimmern", "2026-10-28"),
        _event("Bioabfall - Groß-Zimmern", "2026-11-11"),
    ]
    out = _naechster(eintraege, suchtext="Bioabfall")
    assert out.strip() == "2026-10-28"


def test_suche_ist_case_insensitive():
    eintraege = [_event("GELBER SACK - Ort", "2026-10-28")]
    out = _naechster(eintraege, suchtext="gelber sack")
    assert out.strip() == "2026-10-28"


def test_leerer_suchtext_findet_alles():
    eintraege = [_event("Irgendwas", "2026-10-30"), _event("Anderes", "2026-10-28")]
    out = _naechster(eintraege, suchtext="")
    assert out.strip() == "2026-10-28"


def test_rohwert_hat_leerzeichen_aber_datetime_feld_trimmt_sie(tmp_path=None):
    """naechster selbst enthaelt wegen der YAML-Faltung Leerzeichen (bekannte Eigenheit,
    siehe test_erinnerung_erledigt.py) - das eigentliche Service-Feld muss sie per '| trim'
    entfernen, sonst ginge ein ungueltiges Datum an input_datetime.set_datetime."""
    bp = load_blueprint(BP_PATH)
    env, _ = make_env({}, NOW)
    eintraege = [_event("Bioabfall", "2026-10-28")]
    naechster_raw = env.from_string(bp["actions"][1]["variables"]["naechster"]).render(
        eintraege=eintraege, suchtext="Bioabfall"
    )
    datetime_tpl = bp["actions"][2]["data"]["datetime"]
    rendered = env.from_string(datetime_tpl).render(naechster=naechster_raw)
    assert rendered == "2026-10-28 00:00:00"
