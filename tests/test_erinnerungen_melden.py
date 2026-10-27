"""Testet die 'due'-Berechnung + Bedingung + for_each der Melde-Automation
gegen die tatsaechliche Blueprint-Datei (nicht gegen eine Kopie der Logik),
damit eine kuenftige Aenderung am Blueprint hier auffliegt.

Die Variable `due` selbst rendert wegen eines eingerueckten `{{ ns.l | tojson }}`
am Ende der YAML-Vorlage NICHT als native Liste, sondern als JSON-Text mit
Leerzeichen davor (HAs NativeEnvironment faellt dann auf einen String zurueck).
Das war der Fix vom 2026-10-27: Bedingung und for_each parsen `due` deshalb
ueber `from_json`, falls es ein String ist. Diese Tests pruefen genau diese
Huelle, nicht den rohen String.
"""
import datetime as dt
import os

from ha_jinja_stub import load_blueprint, make_env

HERE = os.path.dirname(__file__)
BP_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerungen_melden.yaml")
DEFAULT_DEVICES = ["mobile_app_zentraltablet", "mobile_app_t14pro_andreas", "mobile_app_t17pro_andreas"]
NOW = dt.datetime(2026, 10, 27, 12, 0, 0)


def _bp():
    return load_blueprint(BP_PATH)


def _registry(reminders):
    """reminders: dict id -> dict mit faellig/einheit/vorlauf/wiederholung/gemeldet/geraete/meldezeit/intervall/art/name."""
    reg = {}
    for rid, r in reminders.items():
        reg[f"input_datetime.erinnerung_{rid}_faellig"] = (r["faellig"], r.get("name", rid))
        reg[f"input_select.erinnerung_{rid}_vorlauf_einheit"] = (r.get("einheit", "Tage"), None)
        reg[f"input_number.erinnerung_{rid}_vorlauf"] = (str(r.get("vorlauf", 7)), None)
        reg[f"input_number.erinnerung_{rid}_wiederholung"] = (str(r.get("wiederholung", 0)), None)
        reg[f"input_datetime.erinnerung_{rid}_gemeldet"] = (r.get("gemeldet", "1970-01-01 00:00:00"), None)
        reg[f"input_text.erinnerung_{rid}_geraete"] = (r.get("geraete", ""), None)
        reg[f"input_text.erinnerung_{rid}_meldezeit"] = (r.get("meldezeit", "unknown"), None)
        reg[f"input_boolean.erinnerung_{rid}_aktiv"] = (r.get("aktiv", "on"), None)
        if "intervall" in r:
            reg[f"input_number.erinnerung_{rid}_intervall"] = (str(r["intervall"]), None)
        reg[f"input_select.erinnerung_{rid}_art"] = (r.get("art", "Kalender"), None)
    return reg


def _pipeline(reminders, now, inc=None, exc=None, devices=None):
    """Rendert due -> Bedingung -> for_each exakt wie die echte Automation, inklusive
    des from_json-Fallbacks. Gibt (condition_bool, due_list) zurueck."""
    bp = _bp()
    reg = _registry(reminders)
    reg["input_boolean.erinnerungen_aktiv"] = ("on", None)
    env, _ = make_env(reg, now)
    ctx = dict(devices=devices if devices is not None else DEFAULT_DEVICES, inc=inc or [], exc=exc or [], uhr="08:00:00")

    due_raw = env.from_string(bp["variables"]["due"]).render(**ctx)
    cond_ctx = dict(ctx, due=due_raw)
    cond = env.from_string(bp["conditions"][0]["value_template"]).render(**cond_ctx)
    due_list = env.from_string(bp["actions"][0]["repeat"]["for_each"]).render(due=due_raw)
    assert isinstance(due_list, list), (
        f"Regression des 'Repeat for_each must be a list' Bugs: for_each ist {type(due_list)}: {due_list!r}"
    )
    return cond, due_list


def test_faellig_morgen_wird_erkannt():
    reminders = {
        "muell_bio": dict(
            faellig="2026-10-28 00:00:00", einheit="Tage", vorlauf=1, wiederholung=0,
            gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00", art="Kalender", name="Biomüll",
        )
    }
    cond, due = _pipeline(reminders, NOW)
    assert cond is True
    assert len(due) == 1
    assert due[0]["id"] == "muell_bio"
    assert due[0]["knopf"] is False
    assert due[0]["devs"] == DEFAULT_DEVICES
    assert "morgen" in due[0]["msg"]


def test_nichts_faellig_ergibt_leere_liste_und_false_bedingung():
    reminders = {
        "spaeter": dict(
            faellig="2099-12-31 00:00:00", einheit="Tage", vorlauf=1, wiederholung=0,
            gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00",
        )
    }
    cond, due = _pipeline(reminders, NOW)
    assert due == []
    assert cond is False, "Bedingung muss bei leerer Liste False sein (Regression: '[]' als Text hat Laenge 2)"


def test_bereits_gemeldet_heute_erscheint_nicht_erneut():
    reminders = {
        "x": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                  gemeldet="2026-10-27 08:00:05", geraete="", meldezeit="08:00")
    }
    _, due = _pipeline(reminders, NOW)
    assert due == []


def test_wiederholung_meldet_nach_rep_tagen_erneut():
    reminders = {
        "x": dict(faellig="2026-10-20 00:00:00", vorlauf=1, wiederholung=3,
                  gemeldet="2026-10-24 08:00:00", geraete="", meldezeit="08:00")
    }
    _, due_zu_frueh = _pipeline(reminders, dt.datetime(2026, 10, 26, 9, 0))
    assert due_zu_frueh == [], "vor Ablauf der Wiederholungsfrist darf nichts fällig sein"

    _, due_faellig = _pipeline(reminders, dt.datetime(2026, 10, 27, 9, 0))
    assert len(due_faellig) == 1, "nach Ablauf der Wiederholungsfrist muss erneut gemeldet werden"


def test_vorlauf_einheiten_stunden_tage_monate():
    cases = [
        ("Stunden", 5, dt.datetime(2026, 10, 27, 20, 0), True),   # Faellig 00:00 Okt28, Vorlauf 5h -> ab 19:00 Okt27
        ("Stunden", 5, dt.datetime(2026, 10, 27, 18, 0), False),
        ("Monate", 1, dt.datetime(2026, 9, 29, 9, 0), True),
        ("Monate", 1, dt.datetime(2026, 9, 20, 9, 0), False),
    ]
    for einheit, vorlauf, now, expect_due in cases:
        reminders = {"x": dict(faellig="2026-10-28 00:00:00", einheit=einheit, vorlauf=vorlauf,
                                wiederholung=0, gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00")}
        _, due = _pipeline(reminders, now)
        assert (len(due) == 1) == expect_due, f"{einheit}/{vorlauf} bei {now}: erwartet due={expect_due}, war {due}"


def test_stunden_vorlauf_ignoriert_meldezeit():
    reminders = {"x": dict(faellig="2026-10-27 15:00:00", einheit="Stunden", vorlauf=2,
                            wiederholung=0, gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="20:00")}
    _, due = _pipeline(reminders, dt.datetime(2026, 10, 27, 13, 30))
    assert len(due) == 1, "bei Stunden-Vorlauf zaehlt die Meldezeit nicht, nur day_ok=True per Default"


def test_eigene_meldezeit_blockiert_bis_uhrzeit():
    reminders = {"x": dict(faellig="2026-10-28 00:00:00", einheit="Tage", vorlauf=1,
                            wiederholung=0, gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="14:00")}
    _, vor = _pipeline(reminders, dt.datetime(2026, 10, 27, 10, 0))
    _, nach = _pipeline(reminders, dt.datetime(2026, 10, 27, 14, 1))
    assert vor == [], "vor der eigenen Meldezeit darf noch nichts gemeldet werden"
    assert len(nach) == 1, "nach der eigenen Meldezeit muss gemeldet werden"


def test_eigene_geraete_ueberschreiben_standard():
    reminders = {"x": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                            gemeldet="1970-01-01 00:00:00", geraete="mein_handy, zweites_handy",
                            meldezeit="08:00")}
    _, due = _pipeline(reminders, NOW)
    assert due[0]["devs"] == ["mobile_app_mein_handy", "mobile_app_zweites_handy"]


def test_unknown_geraete_faellt_auf_standard_zurueck():
    for wert in ("unknown", "unavailable", ""):
        reminders = {"x": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                                gemeldet="1970-01-01 00:00:00", geraete=wert, meldezeit="08:00")}
        _, due = _pipeline(reminders, NOW)
        assert due[0]["devs"] == DEFAULT_DEVICES, f"geraete={wert!r} sollte auf Standard zurueckfallen"


def test_keine_geraete_unterdrueckt_meldung_komplett():
    reminders = {"x": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                            gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00")}
    _, due = _pipeline(reminders, NOW, devices=[])
    assert due == [], "ohne jedes Zielgeraet darf keine Meldung erzeugt werden"


def test_inaktive_erinnerung_wird_ausgeschlossen():
    reminders = {"x": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                            gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00", aktiv="off")}
    _, due = _pipeline(reminders, NOW)
    assert due == []


def test_ids_auslassen_filtert_wenn_konfiguriert():
    reminders = {
        "muell_bio": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                           gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="14:00"),
        "hebeanlage": dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                            gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00"),
    }
    _, due = _pipeline(reminders, NOW, exc=["muell_bio"])
    assert {d["id"] for d in due} == {"hebeanlage"}


def test_knopf_logik():
    cases = [
        (dict(intervall=6), True),
        (dict(art="Saison"), True),
        (dict(wiederholung=3), True),
        (dict(), False),
    ]
    for extra, expect_knopf in cases:
        base = dict(faellig="2026-10-28 00:00:00", vorlauf=1, wiederholung=0,
                    gemeldet="1970-01-01 00:00:00", geraete="", meldezeit="08:00")
        base.update(extra)
        _, due = _pipeline({"x": base}, NOW)
        assert due[0]["knopf"] is expect_knopf, f"{extra}: knopf sollte {expect_knopf} sein, war {due[0]['knopf']}"
