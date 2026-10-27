"""Minimal Nachbildung der Home-Assistant-Jinja-Umgebung, um Blueprint-Vorlagen
ausserhalb von HA genau so zu rendern wie HA es tut (gleiche trim/lstrip-Regeln,
gleiche Filter/Funktionen). Liest die YAML-Blueprints mit PyYAML, damit das
Falten (`>-`) exakt nach Spec passiert statt von Hand nachgerechnet zu werden.
"""
import datetime as dt
import json
import re

import jinja2
import jinja2.nativetypes
import yaml

BLUEPRINT_DIR = None  # wird von den Tests gesetzt


class _InputLoader(yaml.SafeLoader):
    pass


_InputLoader.add_constructor("!input", lambda loader, node: f"!input {loader.construct_scalar(node)}")


def load_blueprint(path):
    with open(path, encoding="utf-8") as f:
        return yaml.load(f, Loader=_InputLoader)


def _parse_dt(value):
    if isinstance(value, dt.datetime):
        return value
    if isinstance(value, str):
        v = value.strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return dt.datetime.strptime(v, fmt)
            except ValueError:
                continue
    raise ValueError(f"cannot parse datetime: {value!r}")


class FakeState:
    def __init__(self, entity_id, state, name=None):
        self.entity_id = entity_id
        self.state = state
        self.name = name or entity_id

    def __repr__(self):
        return f"FakeState({self.entity_id!r}, {self.state!r})"


class DomainStates:
    def __init__(self, registry, domain):
        self._registry = registry
        self._domain = domain

    def __iter__(self):
        prefix = self._domain + "."
        return iter(s for eid, s in self._registry.items() if eid.startswith(prefix))


class StatesProxy:
    def __init__(self, registry):
        self._registry = registry

    def __call__(self, entity_id, default="unknown"):
        s = self._registry.get(entity_id)
        return s.state if s is not None else default

    def __getattr__(self, domain):
        return DomainStates(self._registry, domain)


class Clock:
    """Steuerbare 'Jetzt-Zeit' fuer deterministische Tests."""

    def __init__(self, now):
        self.set(now)

    def set(self, now):
        self._now = now

    def now(self):
        return self._now

    def today_at(self, time_str):
        parts = [int(x) for x in time_str.split(":")]
        h, m = parts[0], parts[1] if len(parts) > 1 else 0
        return self._now.replace(hour=h, minute=m, second=0, microsecond=0)

    def as_timestamp(self, value, default=None):
        try:
            if isinstance(value, (int, float)):
                return float(value)
            return _parse_dt(value).timestamp()
        except Exception:
            return default


def regex_replace(value, find, replace, ignorecase=False):
    flags = re.IGNORECASE if ignorecase else 0
    return re.sub(find, replace, str(value), flags=flags)


def timestamp_custom(value, fmt, local=True):
    return dt.datetime.fromtimestamp(value).strftime(fmt)


def make_env(registry, now):
    """registry: dict entity_id -> (state, name). now: datetime."""
    reg = {eid: FakeState(eid, st, nm) for eid, (st, nm) in registry.items()}
    clock = Clock(now)

    # HA rendert Templates mit NativeEnvironment: liefert den echten Python-Typ
    # zurueck, aber NUR wenn das Template nach dem Rendern aus genau einem
    # Ausdrucks-Knoten besteht - jede uebrige Text-/Leerzeichen-Ausgabe laesst
    # es (wie HA) auf einen String zurueckfallen. Genau das bildet die Bugklasse ab.
    env = jinja2.nativetypes.NativeEnvironment(trim_blocks=True, lstrip_blocks=True)
    env.globals["states"] = StatesProxy(reg)
    env.globals["now"] = clock.now
    env.globals["today_at"] = clock.today_at
    env.globals["as_timestamp"] = clock.as_timestamp
    env.globals["timedelta"] = dt.timedelta
    env.globals["is_state"] = lambda eid, val: reg.get(eid) is not None and reg[eid].state == val
    env.globals["namespace"] = jinja2.utils.Namespace

    env.filters["is_number"] = lambda v: isinstance(v, (int, float)) or (
        isinstance(v, str) and re.match(r"^-?\d+(\.\d+)?$", v.strip()) is not None
    )
    env.filters["regex_replace"] = regex_replace
    env.filters["from_json"] = json.loads
    env.filters["timestamp_custom"] = timestamp_custom
    env.filters["abs"] = abs

    return env, clock


def render(env, template_str, **extra_vars):
    return env.from_string(template_str).render(**extra_vars)
