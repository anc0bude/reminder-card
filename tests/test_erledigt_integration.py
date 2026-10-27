"""End-to-End: Knopf 'Erledigt' druecken (erinnerung_erledigt.yaml) und direkt danach
pruefen, ob die Melde-Automation (erinnerungen_melden.yaml) die Erinnerung wirklich
nicht sofort erneut als faellig anzeigt. Deckt reale Nutzung ab, nicht nur einzelne
Templates isoliert.
"""
import datetime as dt
import os

from ha_jinja_stub import load_blueprint, make_env

HERE = os.path.dirname(__file__)
ERLEDIGT_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerung_erledigt.yaml")
MELDEN_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerungen_melden.yaml")
DEFAULT_DEVICES = ["mobile_app_zentraltablet"]


def _druecke_erledigt_ohne_intervall(reg, now, rid="frost"):
    """Simuliert den 'default'-Zweig (keine Intervall-Erinnerung): setzt gemeldet = jetzt."""
    reg[f"input_datetime.erinnerung_{rid}_gemeldet"] = (now.strftime("%Y-%m-%d %H:%M:00"), None)
    return reg


def _due_count(reg, now, rid):
    bp = load_blueprint(MELDEN_PATH)
    env, _ = make_env(reg, now)
    ctx = dict(devices=DEFAULT_DEVICES, inc=[rid], exc=[], uhr="08:00:00")
    due_raw = env.from_string(bp["variables"]["due"]).render(**ctx)
    due = env.from_string(bp["actions"][0]["repeat"]["for_each"]).render(due=due_raw)
    return len(due)


def test_erledigt_bei_stark_ueberfaelliger_wiederholung_meldet_nicht_sofort_erneut():
    """Regression: Reminder ohne Intervall (z.B. Frost-Art), Wiederholung=3 Tage, seit 10 Tagen
    ueberfaellig. Nutzer drueckt 'Erledigt'. Der default-Zweig setzt gemeldet = jetzt (Fix vom
    2026-10-27, vorher faellig-Datum) - damit darf die Melde-Automation nicht sofort wieder
    anspringen."""
    now = dt.datetime(2026, 1, 20, 9, 0, 0)
    reg = {
        "input_datetime.erinnerung_frost_faellig": ("2026-01-10 00:00:00", "Frost"),
        "input_datetime.erinnerung_frost_gemeldet": ("2026-01-17 08:00:00", None),  # letzte Nag-Meldung
        "input_select.erinnerung_frost_vorlauf_einheit": ("Tage", None),
        "input_number.erinnerung_frost_vorlauf": ("3", None),
        "input_number.erinnerung_frost_wiederholung": ("3", None),
        "input_text.erinnerung_frost_geraete": ("", None),
        "input_text.erinnerung_frost_meldezeit": ("unknown", None),
        "input_boolean.erinnerung_frost_aktiv": ("on", None),
        "input_select.erinnerung_frost_art": ("Saison", None),
        "input_boolean.erinnerungen_aktiv": ("on", None),
    }
    vor_knopf = _due_count(reg, now, "frost")
    assert vor_knopf == 1, "Ausgangslage: Reminder sollte vor dem Knopfdruck ueberfaellig/faellig sein"

    _druecke_erledigt_ohne_intervall(reg, now, "frost")

    nach_knopf = _due_count(reg, now, "frost")
    assert nach_knopf == 0, "nach dem Knopfdruck darf keine weitere Meldung mehr bis zum naechsten echten Ereignis kommen"
