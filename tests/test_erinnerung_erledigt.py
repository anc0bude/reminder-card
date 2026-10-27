import datetime as dt
import os

from ha_jinja_stub import load_blueprint, make_env

HERE = os.path.dirname(__file__)
BP_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerung_erledigt.yaml")


def _bp():
    return load_blueprint(BP_PATH)


def _naechste(now, einheit, menge):
    bp = _bp()
    reg = {
        "input_number.erinnerung_x_intervall": (str(menge), None),
        "input_select.erinnerung_x_intervall_einheit": (einheit, None),
    }
    env, _ = make_env(reg, now)
    actions = bp["actions"]
    tpl = actions[0]["variables"]["naechste"]
    raw = env.from_string(tpl).render(menge=menge, einheit=einheit)
    return env.from_string("{{ wert | trim }}").render(wert=raw)


def test_stunden_rechnet_korrekt():
    now = dt.datetime(2026, 10, 27, 12, 0, 0)
    out = _naechste(now, "Stunden", 6)
    assert out == "2026-10-27 18:00:00"


def test_tage_rechnet_korrekt():
    now = dt.datetime(2026, 10, 27, 12, 0, 0)
    out = _naechste(now, "Tage", 6)
    assert out == "2026-11-02 12:00:00"


def test_monate_rollt_jahr_korrekt():
    now = dt.datetime(2026, 11, 15, 9, 0, 0)
    out = _naechste(now, "Monate", 2)
    assert out == "2027-01-15 09:00:00"


def test_monate_kappt_tag_auf_28():
    now = dt.datetime(2026, 1, 30, 9, 0, 0)
    out = _naechste(now, "Monate", 1)
    assert out == "2026-02-28 09:00:00", "Tag 30 existiert im Februar nicht, muss auf 28 gekappt werden"


def test_keine_fuehrenden_oder_folgenden_leerzeichen_vor_trim():
    """Dokumentiert die bekannte Eigenheit: ohne '| trim' waere der Wert nicht nutzbar."""
    bp = _bp()
    now = dt.datetime(2026, 1, 30, 9, 0, 0)
    reg = {
        "input_number.erinnerung_x_intervall": ("1", None),
        "input_select.erinnerung_x_intervall_einheit": ("Monate", None),
    }
    env, _ = make_env(reg, now)
    tpl = bp["actions"][0]["variables"]["naechste"]
    raw = env.from_string(tpl).render(menge=1, einheit="Monate")
    assert raw != raw.strip(), (
        "Falls dieser Assert jetzt fehlschlaegt, wurde die YAML-Einrueckung der Vorlage "
        "geaendert - bitte pruefen, ob 'naechste | trim' im Blueprint noch gebraucht wird."
    )
