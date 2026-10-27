import datetime as dt
import os

from ha_jinja_stub import load_blueprint, make_env

HERE = os.path.dirname(__file__)
BP_PATH = os.path.join(HERE, "..", "blueprints", "automation", "anc0bude", "erinnerung_sensor.yaml")
NOW = dt.datetime(2026, 10, 27, 12, 0, 0)


def _faellig(sensor_state):
    bp = load_blueprint(BP_PATH)
    reg = {"sensor.zehnderfilterreplace_h": (sensor_state, None)}
    env, _ = make_env(reg, NOW)
    cond = env.from_string(bp["conditions"][0]["value_template"]).render(sensor="sensor.zehnderfilterreplace_h")
    if cond is not True:
        return None
    tpl = bp["actions"][0]["data"]["datetime"]
    return env.from_string(tpl).render(sensor="sensor.zehnderfilterreplace_h")


def test_stunden_werden_korrekt_addiert():
    assert _faellig("72") == "2026-10-30 12:00:00"


def test_null_stunden_heisst_faellig_jetzt():
    assert _faellig("0") == "2026-10-27 12:00:00"


def test_nicht_numerisch_wird_durch_bedingung_abgefangen():
    assert _faellig("unavailable") is None
    assert _faellig("unknown") is None
