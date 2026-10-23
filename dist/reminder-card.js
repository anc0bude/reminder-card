/* SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Required Notice: Copyright 2026 anc0bude (https://github.com/anc0bude)
 */
/* reminder-card – Erinnerungen mit Fälligkeit, Status und Erledigt-Knopf.
 *
 * type: custom:reminder-card
 * title: Erinnerungen
 * master: input_boolean.erinnerungen_aktiv   # optional, Hauptschalter für die Meldungen (Standard wie hier)
 * reminders:                 # optional: ohne Liste findet die Karte alle Erinnerungen selbst (Hilfsgrößen erinnerung_<id>_*)
 *   - id: hebeanlage            # Hilfsgrößen je Erinnerung (Entity-ID enthält die id):
 *     name: Hebeanlage reinigen #   input_datetime.erinnerung_<id>_faellig / _zuletzt (Datum und Uhrzeit)
 *     icon: mdi:pump            #   input_number.erinnerung_<id>_intervall / _vorlauf / _wiederholung
 *     kind: intervall           #   input_select.erinnerung_<id>_intervall_einheit / _vorlauf_einheit (Stunden, Tage, Monate)
 *                               #   input_boolean.erinnerung_<id>_aktiv (Meldung an/aus; Zählen läuft immer weiter)
 *                               # kind: intervall | sensor | kalender | saison. Fällig am ist nur bei intervall und saison von Hand
 *                               # änderbar (bei sensor und kalender kommt es von dort); Erledigt-Knopf bei intervall und saison
 */
const NO_DATE_YEAR = 2099; // Fälligkeit "kein Termin"
const HOURS = { Stunden: 1, Tage: 24, Monate: 730.5 };
const ICONS = ["mdi:bell-outline", "mdi:wrench", "mdi:tools", "mdi:water", "mdi:pipe", "mdi:pump", "mdi:air-filter", "mdi:filter-outline", "mdi:fridge-outline", "mdi:washing-machine", "mdi:dishwasher", "mdi:stove", "mdi:broom", "mdi:trash-can-outline", "mdi:recycle", "mdi:leaf", "mdi:flower", "mdi:radiator", "mdi:thermometer", "mdi:snowflake", "mdi:smoke-detector-variant", "mdi:battery-alert", "mdi:lightbulb-outline", "mdi:home-roof", "mdi:garage", "mdi:car", "mdi:car-wrench", "mdi:key-outline", "mdi:paw", "mdi:medical-bag", "mdi:calendar-check", "mdi:shower"];
const PRESETS = [
  { title: "Termin aus Kalender", name: "", icon: "mdi:calendar-clock", art: "kalender", filter: "" },
  { title: "Termin nach Frostvorhersage", name: "", icon: "mdi:snowflake-alert", art: "frost" },
  { name: "Wasserfilter Kühlschrank", icon: "mdi:fridge-outline", n: 6, u: "Monate" },
  { name: "Rauchmelder testen", icon: "mdi:smoke-detector-variant", n: 12, u: "Monate" },
  { name: "Heizkörper entlüften", icon: "mdi:radiator", n: 12, u: "Monate" },
  { name: "Salz Wasserenthärter prüfen", icon: "mdi:shaker-outline", n: 2, u: "Monate" },
  { name: "Fettfilter Dunstabzug reinigen", icon: "mdi:stove", n: 3, u: "Monate" },
  { name: "Spülmaschine reinigen", icon: "mdi:dishwasher", n: 3, u: "Monate" },
  { name: "Waschmaschinen-Siebe reinigen", icon: "mdi:washing-machine", n: 6, u: "Monate" },
  { name: "Syphons füllen", icon: "mdi:pipe", n: 6, u: "Monate" },
  { name: "Regenrinne reinigen", icon: "mdi:home-roof", n: 6, u: "Monate" },
  { name: "Reifenwechsel", icon: "mdi:car-wrench", n: 6, u: "Monate" },
];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dts = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
};
const addUnit = (d, n, unit) => {
  const r = new Date(d.getTime());
  if (unit === "Stunden") r.setTime(r.getTime() + n * 3600000);
  else if (unit === "Tage") r.setDate(r.getDate() + n);
  else r.setMonth(r.getMonth() + n);
  return r;
};

class ReminderCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("Konfiguration fehlt");
    this._config = config;
    this._open = this._open || {};
    this._adv = this._adv || {};
    this._sig = null;
    this.innerHTML = `
      <ha-card>
        <style>
          .head{display:flex;align-items:center;gap:10px;padding:12px 16px;font-weight:500;font-size:1.05em}
          .head .sum{margin-left:auto;font-weight:400;font-size:.85em;color:var(--secondary-text-color)}
          .item{border-top:1px solid var(--divider-color)}
          .row{display:flex;align-items:center;gap:12px;padding:10px 16px}
          .row ha-icon{flex:none;--mdc-icon-size:22px}
          .txt{flex:1;min-width:0}
          .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .sub{font-size:.85em;color:var(--secondary-text-color)}
          .st-ok .lead{color:var(--success-color,#43a047)}
          .st-bald .lead,.st-bald .sub b{color:var(--warning-color,#ffa726)}
          .st-over .lead,.st-over .sub b{color:var(--error-color,#db4437)}
          .st-none .lead,.st-none .sub{color:var(--disabled-text-color)}
          ha-switch{flex:none}
          button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--divider-color);background:var(--secondary-background-color);color:var(--primary-text-color);padding:6px 10px}
          button.done{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}
          button.ic{padding:6px 8px;background:transparent;border:0;color:var(--secondary-text-color)}
          .edit{padding:4px 16px 14px 50px;display:flex;flex-direction:column;gap:14px}
          .grp{display:flex;flex-direction:column;gap:10px}
          .gt{font-size:.72em;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--secondary-text-color);border-bottom:1px solid var(--divider-color);padding-bottom:4px}
          .fld label{font-size:.9em;font-weight:500;display:block;margin-bottom:4px}
          .hint{font-size:.78em;color:var(--secondary-text-color);margin-top:4px;line-height:1.35}
          .pair{display:flex;gap:6px;max-width:320px}
          .edit input,.edit select{box-sizing:border-box;padding:7px 8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--secondary-background-color);color:var(--primary-text-color);font:inherit;min-width:0}
          .edit input[type=datetime-local]{width:100%;max-width:320px}
          .pair input{width:80px;flex:none}
          .pair select{flex:1}
          .info{font-size:.85em;color:var(--secondary-text-color);background:var(--secondary-background-color);border-radius:8px;padding:8px 10px}
          .sw{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.65em;color:var(--secondary-text-color)}
          .head button.ic{padding:4px 6px}
          .head .sum.warn{color:var(--warning-color,#ffa726);font-weight:500}
          .mastoff{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:.88em;background:rgba(255,167,38,.15);color:var(--primary-text-color);border-top:1px solid var(--divider-color)}
          .mastoff[hidden]{display:none}
          .mastoff ha-icon{--mdc-icon-size:20px;color:var(--warning-color,#ffa726)}
          .sw.dim{opacity:.4}
          .ipr{display:flex;align-items:center;gap:10px}
          .ipr .prev{--mdc-icon-size:30px;color:var(--primary-color);flex:none}
          .ipw input{width:100%;max-width:320px}
          .ip{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;max-width:420px}
          .ip button{padding:5px;border-radius:8px;background:transparent;line-height:0}
          .ip button.sel{border-color:var(--primary-color);background:var(--secondary-background-color);color:var(--primary-color)}
          .ip ha-icon{--mdc-icon-size:22px}
          .panel{padding:8px 16px 14px;border-top:1px solid var(--divider-color);display:flex;flex-direction:column;gap:12px}
          .panel input,.panel select{box-sizing:border-box;padding:7px 8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--secondary-background-color);color:var(--primary-text-color);font:inherit;min-width:0}
          .panel input[type=text],.panel input[type=time],.panel input[type=datetime-local],.panel select.w-preset,.panel select.w-art{width:100%;max-width:420px}
          .panel input[type=checkbox]{width:auto}
          .panel .fld{min-width:0}
          .panel .fld > select,.panel input[type=file]{width:100%;max-width:420px;text-overflow:ellipsis}
          .panel input.m-time{width:110px;max-width:110px;flex:none}
          .panel .pair > span{min-width:0}
          .panel .pair input[type=time],.edit .pair input[type=time]{width:120px;max-width:120px;flex:none}
          .panel .fld > label:not(.chip){font-size:.9em;font-weight:500;display:block;margin-bottom:4px}
          .fld label.chip{display:inline-flex;width:auto;font-weight:400;font-size:.88em;margin-bottom:0;align-items:center;gap:6px}
          details .fld{margin-top:12px}
          details > summary{margin-bottom:2px}
          .panel summary{cursor:pointer;font-size:.9em;margin-bottom:8px}
          .chips{display:flex;flex-wrap:wrap;gap:8px}
          .chip{display:flex;align-items:center;gap:6px;background:var(--secondary-background-color);border:1px solid var(--divider-color);border-radius:999px;padding:5px 10px;font-size:.88em;margin:0}
          .btns{display:flex;gap:8px;flex-wrap:wrap}
          .foot{border-top:1px solid var(--divider-color)}
          .cfgrow{display:flex;align-items:center;gap:12px;width:100%;padding:10px 16px;background:transparent;border:0;border-radius:0;color:var(--primary-text-color);text-align:left;cursor:pointer;box-sizing:border-box}
          .cfgrow .lead{color:var(--secondary-text-color);flex:none;--mdc-icon-size:22px}
          .cfgrow .txt{flex:1;min-width:0}
          .cfgrow .nm{font-weight:400}
          .cfgrow .chev{color:var(--secondary-text-color);flex:none;transition:transform .15s}
          .cfgrow.open .chev{transform:rotate(90deg)}
          .tabs{display:flex;gap:6px;flex-wrap:wrap}
          .tabs button.sel{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}
          .msg{font-size:.88em;min-height:1em}
          .ok{color:var(--success-color,#43a047)}
          .info{font-size:.88em;background:var(--secondary-background-color);border-radius:8px;padding:8px 10px}
          .err{color:var(--error-color,#db4437)}
          .msg a{color:var(--primary-color)}
          button.danger{color:var(--error-color,#db4437);border-color:var(--error-color,#db4437)}
          button:disabled{opacity:.5;cursor:default}
        </style>
        <div class="head"><ha-icon icon="mdi:bell-ring-outline"></ha-icon><span class="t"></span><span class="sum"></span><button class="ic add" data-act="new" title="Neue Erinnerung"><ha-icon icon="mdi:plus"></ha-icon></button><ha-switch class="master" data-toggle="__master" title="Alle Meldungen an/aus"></ha-switch></div>
        <div class="mastoff" hidden><ha-icon icon="mdi:bell-off-outline"></ha-icon><span>Alle Meldungen sind ausgeschaltet. Fälligkeiten werden weiter berechnet.</span></div>
        <div class="wiz"></div>
        <div class="list"></div>
        <div class="foot"><button type="button" class="cfgrow" data-act="cfg-open"><ha-icon class="lead" icon="mdi:cog-outline"></ha-icon><div class="txt"><div class="nm">Konfiguration</div><div class="sub">Meldungen, Kalender-Import</div></div><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon></button></div>
        <div class="cfgbox"></div>
      </ha-card>`;
    this.querySelector(".t").textContent = config.title || "Erinnerungen";
    this.querySelector(".list").addEventListener("click", (e) => this._click(e));
    this.querySelector(".list").addEventListener("change", (e) => this._change(e));
    this.querySelector(".master").addEventListener("change", (e) => this._toggle(e.target));
    for (const sel of [".list", ".wiz"]) {
      this.querySelector(sel).addEventListener("toggle", (e) => {
        const d = e.target;
        if (d?.dataset?.adv === "__wiz") this._advWiz = d.open;
        else if (d?.dataset?.adv) this._adv[d.dataset.adv] = d.open;
      }, true);
    }
    this.querySelector(".wiz").addEventListener("click", (e) => this._click(e));
    this.querySelector(".foot").addEventListener("click", (e) => this._click(e));
    this.querySelector(".cfgbox").addEventListener("click", (e) => this._click(e));
    this.querySelector(".cfgbox").addEventListener("change", (e) => this._wizChange(e));
    for (const sel of [".list", ".wiz"]) this.querySelector(sel).addEventListener("input", (e) => this._preview(e));
    this.querySelector(".wiz").addEventListener("change", (e) => this._wizChange(e));
    this.querySelector(".head").addEventListener("click", (e) => this._click(e));
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 2 + (this._config && this._hass ? this._list().length : 4);
  }

  _ent(r, kind, key) {
    return `${kind}.erinnerung_${r.id}_${key}`;
  }

  _val(r, kind, key) {
    return this._hass.states[this._ent(r, kind, key)]?.state;
  }

  _masterEntity() {
    return this._config.master || "input_boolean.erinnerungen_aktiv";
  }

  _unit(r, key) {
    const u = this._val(r, "input_select", key);
    return HOURS[u] ? u : "Tage";
  }

  _info(r) {
    const f = parse(this._val(r, "input_datetime", "faellig"));
    const vl = Number(this._val(r, "input_number", "vorlauf") ?? 7);
    const vlUnit = this._unit(r, "vorlauf_einheit");
    const aktiv = this._val(r, "input_boolean", "aktiv") !== "off";
    if (!f) return { missing: true, aktiv };
    if (f.getFullYear() >= NO_DATE_YEAR) return { none: true, aktiv };
    const hours = (f - new Date()) / 3600000;
    const dateOnly = f.getHours() === 0 && f.getMinutes() === 0;
    let days = null;
    let remaining = hours;
    if (dateOnly) {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      days = Math.round((f - t) / 86400000);
      remaining = days * 24;
    }
    const limit = vl * HOURS[vlUnit];
    return { f, hours, days, dateOnly, aktiv, status: remaining < 0 ? "over" : remaining <= limit ? "bald" : "ok", sortKey: hours };
  }

  _when(i) {
    const loc = this._hass.language;
    const fmt = (d) =>
      d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" }) +
      (i.dateOnly ? "" : " " + d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }));
    const near = !i.dateOnly && Math.abs(i.hours) < 48;
    const mins = !i.dateOnly && Math.abs(i.hours) < 1;
    const n = mins ? Math.round(Math.abs(i.hours) * 60) : near ? Math.round(Math.abs(i.hours)) : Math.abs(i.dateOnly ? i.days : Math.round(i.hours / 24));
    const over = (i.dateOnly ? i.days : i.hours) < 0;
    if (over) return `<b>seit ${n} ${mins ? "Min." : near ? "Std." : n === 1 ? "Tag" : "Tagen"} überfällig</b> (${fmt(i.f)})`;
    if (i.dateOnly && i.days === 0) return "<b>heute fällig</b>";
    if (i.dateOnly && i.days === 1) return `<b>morgen</b> (${fmt(i.f)})`;
    const t = `in ${n} ${mins ? "Min." : near ? "Std." : "Tagen"}`;
    return i.status === "bald" ? `<b>${t}</b> (${fmt(i.f)})` : `${t} (${fmt(i.f)})`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    this._loadDefaultTime();
    const items = this._list().map((r) => ({ r, i: this._info(r) }));
    // stabile Reihenfolge: nach Fälligkeit, bei gleichem Termin (oder ohne Termin) nach Name; die Reihenfolge der Entitäten in HA spielt keine Rolle
    items.sort((a, b) => (a.i.f && !a.i.none ? a.i.f.getTime() : Infinity) === (b.i.f && !b.i.none ? b.i.f.getTime() : Infinity)
      ? String(a.r.name).localeCompare(String(b.r.name), "de") || String(a.r.id).localeCompare(String(b.r.id))
      : (a.i.f && !a.i.none ? a.i.f.getTime() : Infinity) - (b.i.f && !b.i.none ? b.i.f.getTime() : Infinity));
    const watched = [["zuletzt", "input_datetime"], ["intervall", "input_number"], ["vorlauf", "input_number"], ["wiederholung", "input_number"], ["intervall_einheit", "input_select"], ["vorlauf_einheit", "input_select"], ["frost_ab", "input_number"], ["frost_tage", "input_number"], ["reset_monat", "input_number"], ["geraete", "input_text"], ["meldezeit", "input_text"]];
    const master = this._hass.states[this._masterEntity()]?.state;
    const sig =
      master + "@" + this._dt + "@" + this._confirm + "@" + (this._admin() && this._setupNeeded()) + "@" +
      items
        .map(({ r, i }) => [r.id, r.name, r.icon, i.dateOnly ? i.days : i.f && Math.round(i.hours), i.status, i.aktiv, ...watched.map(([k, d]) => this._val(r, d, k)), !!this._open[r.id]].join("|"))
        .join("#");
    if (sig === this._sig) return;
    this._sig = sig;
    if (!this._w) this._renderWiz();
    const due = items.filter(({ i }) => i.status === "over" || i.status === "bald").length;
    const state = due ? `${due} bald fällig` : "alles in Ordnung";
    const sum = this.querySelector(".sum");
    sum.textContent = master === "off" ? `Meldungen aus · ${state}` : state;
    sum.classList.toggle("warn", master === "off");
    this.querySelector(".mastoff").hidden = master !== "off";
    const foot = this.querySelector(".foot");
    if (foot) foot.style.display = this._admin() ? "" : "none";
    const ms = this.querySelector(".master");
    ms.style.display = this._hass.states[this._masterEntity()] ? "" : "none";
    ms.checked = master !== "off";
    this.querySelector(".list").innerHTML = items
      .map(({ r, i }) => {
        const cls = i.missing || i.none ? "none" : i.status;
        const base = i.missing ? "Hilfsgrößen fehlen" : i.none ? "kein Termin" : this._when(i);
        const text = i.aktiv ? base : `${base} · Meldung aus`;
        const sw = this._hass.states[this._ent(r, "input_boolean", "aktiv")] ? `<div class="sw${master === "off" ? " dim" : ""}"><ha-switch data-toggle="${r.id}" ${i.aktiv ? "checked" : ""} title="Meldung an/aus"></ha-switch><span>${master === "off" ? "aus" : "Meldung"}</span></div>` : "";
        const done = (r.kind === "intervall" || r.kind === "saison") && !i.missing && !i.none ? `<button class="done" data-act="done" data-id="${r.id}">Erledigt</button>` : "";
        const edit = this._open[r.id] ? this._editHtml(r) : "";
        return `<div class="item st-${cls}"><div class="row"><ha-icon class="lead" icon="${r.icon || "mdi:bell-outline"}"></ha-icon>
          <div class="txt"><div class="nm">${r.name}</div><div class="sub">${text}</div></div>${done}${sw}
          <button class="ic" data-act="edit" data-id="${r.id}" title="Einstellungen"><ha-icon icon="mdi:cog-outline"></ha-icon></button></div>${edit}</div>`;
      })
      .join("");
  }

  _pair(r, numKey, unitKey, max) {
    const n = this._val(r, "input_number", numKey);
    if (n == null) return "";
    const u = this._unit(r, unitKey);
    const hasUnit = this._hass.states[this._ent(r, "input_select", unitKey)];
    const sel = hasUnit
      ? `<select data-set="input_select.${unitKey}" data-id="${r.id}">${Object.keys(HOURS).map((o) => `<option${o === u ? " selected" : ""}>${o}</option>`).join("")}</select>`
      : "";
    return `<div class="pair"><input type="number" min="0" max="${max}" step="1" value="${n}" data-set="input_number.${numKey}" data-id="${r.id}">${sel}</div>`;
  }

  _iconPicker(value, attrs) {
    return `<div class="ipw"><div class="ipr"><ha-icon class="prev" icon="${value || "mdi:help-circle-outline"}"></ha-icon><input type="text" value="${value || ""}" placeholder="mdi:…" ${attrs}></div>
      <div class="ip">${ICONS.map((i) => `<button type="button" class="${i === value ? "sel" : ""}" data-pick="${i}" title="${i}"><ha-icon icon="${i}"></ha-icon></button>`).join("")}</div></div>`;
  }

  _preview(e) {
    const w = e.target.closest?.(".ipw");
    if (!w || e.target.tagName !== "INPUT") return;
    const v = e.target.value.trim();
    w.querySelector(".prev")?.setAttribute("icon", v || "mdi:help-circle-outline");
    w.querySelectorAll(".ip button").forEach((x) => x.classList.toggle("sel", x.dataset.pick === v));
  }

  // Textbausteine für Panel und Assistent (gleiche Wörter an beiden Stellen)
  static HINT = {
    vorlauf: "So lange vor dem Termin wird zum ersten Mal gemeldet.",
    zeit: "Ab dieser Uhrzeit wird gemeldet (bei Vorlauf in Tagen oder Monaten). Bei Vorlauf in Stunden kommt die Meldung sofort.",
    rep: "Alle so viele Tage erneut melden, bis „Erledigt“ gedrückt wird. 0 = nicht wiederholen.",
    geraete: "Standard sind alle Geräte aus der Konfiguration. Wähle einzelne Geräte, wenn nur diese die Meldung bekommen sollen.",
    frost: "Beim Frost wird sofort gemeldet, sobald Frost im Vorhersage-Fenster angesagt ist.",
  };

  _stdTime() {
    return this._dt || "08:00";
  }

  async _loadDefaultTime() {
    if (this._dtLoading || this._dt || !this._admin()) return;
    this._dtLoading = true;
    try {
      const c = await this._hass.callApi("GET", "config/automation/config/erinnerungen_melden");
      const t = String(c?.use_blueprint?.input?.uhrzeit || "").slice(0, 5);
      if (/^\d\d:\d\d$/.test(t)) {
        this._dt = t;
        this._sig = null;
        this._render();
      }
    } catch (e) { /* Standard bleibt 08:00 */ }
  }

  // Wann wird gemeldet? Klartext, z. B. "am Vortag um 08:00 Uhr"
  _meldungText(vl, vlu, mz, frost, due) {
    const n = Number(vl);
    const time = mz || this._stdTime();
    if (frost) return { text: "Gemeldet wird sofort, sobald Frost im Vorhersage-Fenster angesagt ist.", first: null };
    const when = vlu === "Stunden" ? (n === 0 ? "zum Termin" : `${n} ${n === 1 ? "Stunde" : "Stunden"} vorher`)
      : vlu === "Tage" ? (n === 0 ? "am Tag des Termins" : n === 1 ? "am Vortag" : `${n} Tage vorher`)
      : (n === 1 ? "1 Monat vorher" : `${n} Monate vorher`);
    const at = vlu === "Stunden" ? "" : ` um ${time} Uhr`;
    let first = null;
    if (due) {
      first = new Date(due.getTime() - n * HOURS[vlu] * 3600000);
      if (vlu !== "Stunden") {
        const [hh, mm] = time.split(":").map(Number);
        if (first.getHours() * 60 + first.getMinutes() < hh * 60 + mm) first.setHours(hh, mm, 0, 0);
      }
    }
    return { text: `Gemeldet wird ${when}${at}.`, first };
  }

  _meldungInfoHtml(t) {
    const loc = this._hass.language;
    const f = t.first && t.first > new Date() ? ` Nächste erste Meldung: ${t.first.toLocaleDateString(loc)} ${t.first.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}.` : "";
    return `<div class="info w-sum">${t.text}${f}</div>`;
  }

  _geraeteHtml(r) {
    const txt = this._val(r, "input_text", "geraete");
    if (txt == null) return "";
    const list = ["unknown", "unavailable"].includes(txt) ? [] : txt.split(",").map((x) => x.trim()).filter(Boolean);
    const all = !list.length;
    const devs = [...new Set([...this._notifyDevices().map((d) => d.replace("mobile_app_", "")), ...list])].sort();
    return `<label class="chip"><input type="checkbox" data-geraete-all="${r.id}"${all ? " checked" : ""}> Alle Geräte (Standard)</label>
      <div class="chips" style="margin-top:6px">${devs.map((d) => `<label class="chip"><input type="checkbox" data-geraet="${r.id}" value="${d}"${list.includes(d) ? " checked" : ""}${all ? " disabled" : ""}> ${d}</label>`).join("")}</div>`;
  }

  _zeitHtml(r) {
    const txt = this._val(r, "input_text", "meldezeit");
    if (txt == null) return "";
    const own = /^\d\d:\d\d$/.test(txt);
    return `<label class="chip"><input type="checkbox" data-zeit-std="${r.id}"${own ? "" : " checked"}> Standard (${this._stdTime()} Uhr)</label>
      <div class="pair" style="margin-top:6px"><input type="time" data-zeit="${r.id}" value="${own ? txt : this._stdTime()}"${own ? "" : " disabled"}></div>`;
  }

  _setText(r, key, value) {
    return this._hass.callService("input_text", "set_value", { entity_id: this._ent(r, "input_text", key), value });
  }

  _fld(label, control, hint) {
    return control ? `<div class="fld"><label>${label}</label>${control}${hint ? `<div class="hint">${hint}</div>` : ""}</div>` : "";
  }

  _local(d) {
    return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
  }

  _editHtml(r) {
    const loc = this._hass.language;
    const iv = r.kind === "intervall";
    const z = parse(this._val(r, "input_datetime", "zuletzt"));
    const f = parse(this._val(r, "input_datetime", "faellig"));
    const real = f && f.getFullYear() < NO_DATE_YEAR ? f : null;
    const manual = iv || r.kind === "saison";
    const rep = this._val(r, "input_number", "wiederholung");
    const vl = Number(this._val(r, "input_number", "vorlauf") ?? 7);
    const start = real ? new Date(real.getTime() - vl * HOURS[this._unit(r, "vorlauf_einheit")] * 3600000) : null;
    const startTxt = start ? `Aktuell: ab ${start.toLocaleDateString(loc)} ${start.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}.` : "";
    const quelle = r.kind === "sensor" ? "Der Termin wird automatisch aus dem Sensor berechnet und kann hier nicht geändert werden."
      : r.kind === "kalender" ? "Der Termin kommt automatisch aus dem Kalender und kann hier nicht geändert werden." : "";
    const termin = [
      iv ? this._fld("Intervall", this._pair(r, "intervall", "intervall_einheit", 100000), "Wie oft die Aufgabe ansteht. Nach „Erledigt“ beginnt es von vorn.") : "",
      iv && z ? this._fld("Zuletzt erledigt", `<input type="datetime-local" value="${this._local(z)}" data-set="input_datetime.zuletzt" data-id="${r.id}">`, "Wird durch „Erledigt“ gesetzt. Änderst du es, wird der nächste Termin neu berechnet.") : "",
      manual && f ? this._fld("Nächster Termin", `<input type="datetime-local" value="${this._local(real)}" data-set="input_datetime.faellig" data-id="${r.id}">`,
        iv ? "Nur ändern, wenn der Termin abweicht. Beim nächsten „Erledigt“ gilt wieder das Intervall."
           : "Wird bei Frost-Vorhersage automatisch gesetzt. Du kannst ihn hier von Hand setzen.") : "",
      quelle ? `<div class="info">${quelle}</div>` : "",
    ].join("");
    const hasFrost = this._val(r, "input_number", "frost_ab") != null;
    const monthNames = ["", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    const rm = Number(this._val(r, "input_number", "reset_monat") ?? 4);
    const frost = hasFrost ? [
      this._fld("Frost ab (°C)", `<div class="pair"><input type="number" step="1" min="-30" max="15" value="${this._val(r, "input_number", "frost_ab")}" data-set="input_number.frost_ab" data-id="${r.id}"></div>`, "Sinkt der vorhergesagte Tiefstwert auf diese Temperatur oder darunter, wird der Termin auf diesen Tag gesetzt."),
      this._fld("Vorhersage-Fenster (Tage)", `<div class="pair"><input type="number" step="1" min="1" max="7" value="${this._val(r, "input_number", "frost_tage")}" data-set="input_number.frost_tage" data-id="${r.id}"></div>`, "So viele Tage im Voraus wird die Vorhersage geprüft."),
      this._fld("Zurücksetzen im Frühjahr", `<select data-set="input_number.reset_monat" data-id="${r.id}">${monthNames.map((n, m) => (m ? `<option value="${m}"${m === rm ? " selected" : ""}>${n}</option>` : "")).join("")}</select>`, "Am 1. dieses Monats beginnt die Erinnerung von vorn. Pro Winter wird einmal gemeldet."),
    ].join("") : "";
    const vlN = Number(this._val(r, "input_number", "vorlauf") ?? 1);
    const vlU = this._unit(r, "vorlauf_einheit");
    const mzTxt = this._val(r, "input_text", "meldezeit");
    const mzOwn = /^\d\d:\d\d$/.test(mzTxt || "") ? mzTxt : "";
    const info = this._meldungText(vlN, vlU, mzOwn, hasFrost, real);
    const adv = [
      hasFrost ? `<div class="hint">${ReminderCard.HINT.frost}</div>` : this._fld("Erste Meldung vorher", this._pair(r, "vorlauf", "vorlauf_einheit", 100000), ReminderCard.HINT.vorlauf),
      this._fld("Meldezeit", this._zeitHtml(r), ReminderCard.HINT.zeit),
      rep != null ? this._fld("Wiederholung nach dem Termin (Tage)", `<div class="pair"><input type="number" min="0" max="60" step="1" value="${rep}" data-set="input_number.wiederholung" data-id="${r.id}"></div>`, ReminderCard.HINT.rep) : "",
      this._fld("Geräte", this._geraeteHtml(r), ReminderCard.HINT.geraete),
    ].join("");
    const meldung = `${this._meldungInfoHtml(info)}<details data-adv="${r.id}"${this._adv[r.id] ? " open" : ""}><summary>Erweitert</summary>${adv}</details>`;
    const allgemein = this._admin() && !this._config.reminders?.length
      ? `<div class="grp"><div class="gt">Allgemein</div>
          ${this._fld("Anzeigename", `<input type="text" value="${String(r.name).replace(/"/g, "&quot;")}" data-ren="name" data-id="${r.id}">`, "So heißt die Erinnerung in der Karte und in der Meldung.")}
          ${this._fld("Symbol", this._iconPicker(r.icon, `data-ren="icon" data-id="${r.id}"`), "Symbol anklicken oder den Namen eines Material-Design-Symbols eintippen, zum Beispiel mdi:wrench.")}
        </div>` : "";
    return `<div class="edit">
      ${allgemein}
      ${termin ? `<div class="grp"><div class="gt">Termin</div>${termin}</div>` : ""}
      ${frost ? `<div class="grp"><div class="gt">Termin nach Frostvorhersage</div>${frost}</div>` : ""}
      <div class="grp"><div class="gt">Meldung</div>${meldung}</div>
      ${this._admin() ? `<div class="grp"><div class="gt">Löschen</div>${this._confirm === r.id
        ? `<div class="info">Wirklich löschen? Alle Hilfsgrößen und Automationen dieser Erinnerung werden entfernt.</div><div class="btns"><button class="danger" data-act="delete" data-id="${r.id}">Ja, löschen</button><button data-act="cancel-del">Abbrechen</button></div>`
        : `<div class="btns"><button class="danger" data-act="delete" data-id="${r.id}">Erinnerung löschen</button></div>`}</div>` : ""}
    </div>`;
  }

  // ---------- Assistent: Einrichtung, neue Erinnerung, Löschen ----------

  _admin() {
    return !!this._hass.user?.is_admin;
  }

  _ids() {
    return this._list().map((r) => r.id);
  }

  _list() {
    if (this._config.reminders?.length) return this._config.reminders;
    // automatisch erkannt: alle Hilfsgrößen input_datetime.erinnerung_<id>_faellig
    const out = [];
    for (const [eid, st] of Object.entries(this._hass.states)) {
      const m = /^input_datetime\.erinnerung_(.+)_faellig$/.exec(eid);
      if (!m) continue;
      const id = m[1];
      const art = this._hass.states[`input_select.erinnerung_${id}_art`]?.state;
      const kind = { Wiederkehrend: "intervall", Sensor: "sensor", Kalender: "kalender", Saison: "saison" }[art] ||
        (this._hass.states[`input_number.erinnerung_${id}_intervall`] ? "intervall" : "saison");
      out.push({ id, name: st.attributes.friendly_name || id, icon: this._hass.states[`input_boolean.erinnerung_${id}_aktiv`]?.attributes.icon || "mdi:bell-outline", kind });
    }
    return out;
  }

  _setupNeeded() {
    return !Object.entries(this._hass.states).some(([e, s]) => e.startsWith("automation.") && s.attributes.id === "erinnerungen_melden");
  }

  _slug(s) {
    return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  }

  _renderWiz() {
    const wizBox = this.querySelector(".wiz");
    const cfgBox = this.querySelector(".cfgbox");
    if (!wizBox) return;
    const w = this._w;
    const inCfg = !!w && (w.mode === "cfg-meldungen" || (w.mode === "import" && !w.from));
    const box = inCfg ? cfgBox : wizBox;
    (inCfg ? wizBox : cfgBox).innerHTML = "";
    this.querySelector(".cfgrow")?.classList.toggle("open", inCfg);
    if (!w) {
      box.innerHTML = this._banner();
      return;
    }
    if (w.mode === "cfg-meldungen") {
      box.innerHTML = this._meldenHtml(w);
      return;
    }
    if (w.mode === "import") {
      box.innerHTML = this._importHtml(w);
      return;
    }
    const pre = PRESETS.map((p, i) => `<option value="${i}"${w.preset === String(i) ? " selected" : ""}>${p.title || `${p.name} (${p.label || `${p.n} ${p.u}`})`}</option>`).join("");
    const units = (sel) => Object.keys(HOURS).map((o) => `<option${o === sel ? " selected" : ""}>${o}</option>`).join("");
    const sensors = Object.entries(this._hass.states).filter(([e]) => e.startsWith("sensor.")).map(([e]) => `<option value="${e}">`).join("");
    const cals = Object.keys(this._hass.states).filter((e) => e.startsWith("calendar.")).map((e) => `<option value="${e}">`).join("");
    box.innerHTML = `<div class="panel"><div class="gt">Neue Erinnerung</div>
      <div class="fld"><label>Vorlage</label><select class="w-preset"><option value="">Eigene Erinnerung</option>${pre}</select><div class="hint">Eine Vorlage füllt Name, Symbol und Intervall vor. Du kannst alles ändern.</div></div>
      <div class="fld"><label>Name</label><input type="text" class="w-name" value="${w.name || ""}" placeholder="z. B. Wasserfilter Kühlschrank"></div>
      <div class="fld"><label>Symbol</label>${this._iconPicker(w.icon || "mdi:bell-outline", 'class="w-icon"')}<div class="hint">Symbol anklicken oder den Namen eines Material-Design-Symbols eintippen.</div></div>
      <div class="fld"><label>Woher kommt der Termin?</label><select class="w-art">
        <option value="intervall"${w.art === "intervall" ? " selected" : ""}>Wiederkehrend (alle … Stunden, Tage oder Monate)</option>
        <option value="sensor"${w.art === "sensor" ? " selected" : ""}>Termin aus Sensor (Stunden bis zum Wechsel)</option>
        <option value="kalender"${w.art === "kalender" ? " selected" : ""}>Termin aus Kalender</option>
        <option value="frost"${w.art === "frost" ? " selected" : ""}>Termin nach Frostvorhersage</option></select></div>
      ${w.art === "intervall" ? `
        <div class="fld"><label>Intervall</label><div class="pair"><input type="number" min="1" class="w-n" value="${w.n || 6}"><select class="w-u">${units(w.u || "Monate")}</select></div><div class="hint">Wie oft die Aufgabe ansteht.</div></div>
        <div class="fld"><label>Zuletzt erledigt (leer = jetzt)</label><input type="datetime-local" class="w-z" value="${w.z || ""}"><div class="hint">Daraus wird der erste Termin berechnet.</div></div>` : ""}
      ${w.art === "sensor" ? `<div class="fld"><label>Sensor</label><input type="text" class="w-sensor" value="${w.sensor || ""}" list="w-sensors" placeholder="sensor.…"><datalist id="w-sensors">${sensors}</datalist><div class="hint">Der Sensor muss die verbleibenden Stunden bis zum Termin liefern, zum Beispiel „Filter replace“ einer Lüftung.</div></div>` : ""}
      ${w.art === "kalender" ? `<div class="fld"><label>Kalender</label><input type="text" class="w-cal" value="${w.cal || this._defaultCal()}" list="w-cals" placeholder="calendar.…"><datalist id="w-cals">${cals}</datalist></div>
        <div class="fld"><label>Titel enthält (optional)</label><input type="text" class="w-filter" value="${w.filter || ""}" placeholder="z. B. Bioabfall"><div class="hint">Nur Termine mit diesem Text im Titel zählen. Leer = alle Termine.</div></div>
        <div class="btns"><button type="button" data-act="import-open">Termine aus ICS-Datei hinzufügen …</button></div>` : ""}
      ${w.art === "frost" ? this._frostFields(w) : ""}
      ${this._wizInfo(w)}
      <details data-adv="__wiz"${this._advWiz ? " open" : ""}><summary>Erweitert</summary>
        ${w.art === "frost" ? `<div class="hint">${ReminderCard.HINT.frost}</div>` : `<div class="fld"><label>Erste Meldung vorher</label><div class="pair"><input type="number" min="0" class="w-vl" value="${w.vl ?? 1}"><select class="w-vlu">${units(w.vlu || "Tage")}</select></div><div class="hint">${ReminderCard.HINT.vorlauf}</div></div>`}
        <div class="fld"><label>Meldezeit</label><label class="chip"><input type="checkbox" class="w-mzstd"${w.mzstd === false ? "" : " checked"}> Standard (${this._stdTime()} Uhr)</label>
          <div class="pair" style="margin-top:6px"><input type="time" class="w-mz" value="${w.mz || this._stdTime()}"${w.mzstd === false ? "" : " disabled"}></div><div class="hint">${ReminderCard.HINT.zeit}</div></div>
        <div class="fld"><label>Wiederholung nach dem Termin (Tage)</label><div class="pair"><input type="number" min="0" max="60" class="w-rep" value="${w.rep ?? (w.art === "kalender" ? 0 : 3)}"></div><div class="hint">${ReminderCard.HINT.rep}</div></div>
        <div class="fld"><label>Geräte</label><label class="chip"><input type="checkbox" class="w-devall"${w.devall === false ? "" : " checked"}> Alle Geräte (Standard)</label>
          <div class="chips" style="margin-top:6px">${this._notifyDevices().map((d) => d.replace("mobile_app_", "")).map((d) => `<label class="chip"><input type="checkbox" class="w-dev" value="${d}"${(w.devs || []).includes(d) ? " checked" : ""}${w.devall === false ? "" : " disabled"}> ${d}</label>`).join("")}</div><div class="hint">${ReminderCard.HINT.geraete}</div></div>
      </details>
      <div class="msg">${w.msg || ""}</div>
      <div class="btns"><button class="done" data-act="wiz-create" ${w.busy ? "disabled" : ""}>Anlegen</button><button data-act="wiz-close">Abbrechen</button></div></div>`;
  }

  _defaultCal() {
    const cals = Object.keys(this._hass.states).filter((e) => e.startsWith("calendar."));
    return cals.find((e) => /abfall|muell|müll|waste|trash/i.test(e)) || cals[0] || "";
  }

  _frostFields(w) {
    const wx = Object.keys(this._hass.states).filter((e) => e.startsWith("weather."));
    const al = Object.keys(this._hass.states).filter((e) => e.startsWith("binary_sensor.")).map((e) => `<option value="${e}">`).join("");
    const months = ["", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    return `<div class="fld"><label>Wettervorhersage</label><input type="text" class="w-wetter" value="${w.wetter || wx[0] || ""}" list="w-wx"><datalist id="w-wx">${wx.map((e) => `<option value="${e}">`).join("")}</datalist><div class="hint">Wetter-Entität mit täglicher Vorhersage (Tiefstwert).</div></div>
      <div class="fld"><label>Frost ab (°C)</label><div class="pair"><input type="number" step="1" class="w-frostab" value="${w.frostab ?? -2}"></div><div class="hint">Sinkt der vorhergesagte Tiefstwert auf diese Temperatur oder darunter, wird der Termin auf diesen Tag gesetzt.</div></div>
      <div class="fld"><label>Vorhersage-Fenster (Tage)</label><div class="pair"><input type="number" min="1" max="7" class="w-frosttage" value="${w.frosttage ?? 3}"></div><div class="hint">So viele Tage im Voraus wird die Vorhersage geprüft.</div></div>
      <div class="fld"><label>Zurücksetzen im Frühjahr</label><select class="w-resetm">${[3, 4, 5].map((m) => `<option value="${m}"${Number(w.resetm ?? 4) === m ? " selected" : ""}>${months[m]}</option>`).join("")}</select><div class="hint">Am 1. dieses Monats beginnt die Erinnerung von vorn. Pro Winter wird einmal gemeldet.</div></div>
      <div class="fld"><label><input type="checkbox" class="w-folge"${w.folge ? " checked" : ""}> Im Frühjahr erinnern</label><input type="text" class="w-folgename" value="${w.folgename || ""}" placeholder="Name, z. B. Außenwasser wieder aufdrehen"><div class="hint">Legt eine zweite Erinnerung an, die zum Zurücksetzen fällig wird.</div></div>
      <div class="fld"><label>Frostalarm-Sensor (optional)</label><input type="text" class="w-alarm" value="${w.alarm || ""}" list="w-al" placeholder="binary_sensor.…"><datalist id="w-al">${al}</datalist><div class="hint">Löst den Termin zusätzlich aus, wenn der Sensor „an“ meldet und die Vorhersage keinen Frost zeigt. Vorher prüfen, ob der Sensor wirklich nur bei Frost „an“ meldet.</div></div>`;
  }

  _wizInfo(w) {
    const t = this._meldungText(w.vl ?? 1, w.vlu || "Tage", w.mzstd === false ? w.mz : "", w.art === "frost", null);
    return `<div class="info w-sum">${t.text}</div>`;
  }

  _banner() {
    if (!this._admin() || !this._setupNeeded()) return "";
    return `<div class="panel"><div class="gt">Meldungen noch nicht eingerichtet</div><div class="hint">Damit Erinnerungen auf Handy und Tablet ankommen, richtet der Assistent die Meldungen ein.</div><div class="btns"><button class="done" data-act="cfg-meldungen">Jetzt einrichten</button></div></div>`;
  }

  _readWiz() {
    const q = (s) => this.querySelector(`.wiz ${s}`);
    const v = (s) => q(s)?.value;
    const w = { ...this._w };
    if (q(".w-name")) {
      Object.assign(w, {
        name: v(".w-name"), icon: v(".w-icon"), art: v(".w-art"), n: v(".w-n"), u: v(".w-u"), z: v(".w-z"),
        sensor: v(".w-sensor"), cal: v(".w-cal"), filter: v(".w-filter"), vl: v(".w-vl"), vlu: v(".w-vlu"), rep: v(".w-rep"),
        wetter: v(".w-wetter"), frostab: v(".w-frostab"), frosttage: v(".w-frosttage"), resetm: v(".w-resetm"), alarm: v(".w-alarm"),
        folge: q(".w-folge") ? q(".w-folge").checked : w.folge, folgename: v(".w-folgename"),
        mzstd: q(".w-mzstd") ? q(".w-mzstd").checked : w.mzstd, mz: v(".w-mz") || w.mz, devall: q(".w-devall") ? q(".w-devall").checked : w.devall,
        devs: q(".w-devall") ? [...this.querySelectorAll(".wiz .w-dev:checked")].map((c) => c.value) : w.devs,
      });
    }
    return w;
  }

  async _blueprintOk(file) {
    try {
      const b = await this._hass.callWS({ type: "blueprint/list", domain: "automation" });
      return Object.keys(b).some((k) => k.endsWith(file) && !b[k].error);
    } catch (e) {
      return false;
    }
  }

  _blueprintHint(file) {
    const url = `https://github.com/anc0bude/reminder-card/blob/main/blueprints/automation/anc0bude/${file}`;
    return `Das Blueprint <b>${file}</b> fehlt in Home Assistant. <a href="https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=${encodeURIComponent(url)}" target="_blank" rel="noopener">Hier importieren</a>, dann erneut versuchen.`;
  }

  async _mk(domain, id, key, params) {
    await this._hass.callWS({ type: `${domain}/create`, name: `Erinnerung ${id} ${key}`, ...params });
  }

  // Legt die Hilfsgrößen einer Erinnerung an und setzt Startwerte. art: intervall | sensor | kalender | frost | saison
  async _makeReminder(id, name, icon, art, o) {
    const dtp = { has_date: true, has_time: true, icon: "mdi:calendar-clock" };
    const num = { min: 0, max: 100000, step: 1, mode: "box" };
    const unit = { options: ["Stunden", "Tage", "Monate"], icon: "mdi:timer-cog-outline" };
    const iv = art === "intervall";
    await this._mk("input_datetime", id, "faellig", dtp);
    await this._mk("input_datetime", id, "gemeldet", { ...dtp, icon: "mdi:bell-check" });
    if (iv) {
      await this._mk("input_datetime", id, "zuletzt", { ...dtp, icon: "mdi:calendar-check" });
      await this._mk("input_number", id, "intervall", { ...num, min: 1 });
      await this._mk("input_select", id, "intervall_einheit", unit);
    }
    if (art === "frost") {
      await this._mk("input_number", id, "frost_ab", { min: -30, max: 15, step: 1, mode: "box", unit_of_measurement: "°C" });
      await this._mk("input_number", id, "frost_tage", { min: 1, max: 7, step: 1, mode: "box", unit_of_measurement: "Tage" });
      await this._mk("input_number", id, "reset_monat", { min: 1, max: 12, step: 1, mode: "box" });
    }
    await this._mk("input_number", id, "vorlauf", num);
    await this._mk("input_select", id, "vorlauf_einheit", unit);
    await this._mk("input_number", id, "wiederholung", { ...num, max: 60, unit_of_measurement: "Tage" });
    await this._mk("input_text", id, "geraete", { min: 0, max: 255, mode: "text", icon: "mdi:cellphone-message" });
    await this._mk("input_text", id, "meldezeit", { min: 0, max: 5, mode: "text", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$|^$", icon: "mdi:clock-outline" });
    await this._mk("input_boolean", id, "aktiv", { icon });
    await this._mk("input_select", id, "art", { options: ["Wiederkehrend", "Sensor", "Kalender", "Saison"], icon: "mdi:shape-outline" });
    if (!this._hass.states["input_boolean.erinnerungen_aktiv"]) {
      await this._hass.callWS({ type: "input_boolean/create", name: "Erinnerungen aktiv", icon: "mdi:bell-check-outline" });
    }
    const E = (d, k) => `${d}.erinnerung_${id}_${k}`;
    for (let t = 0; t < 30 && !this._hass.states[E("input_boolean", "aktiv")]; t++) await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => setTimeout(r, 800));
    const sv = (d, s, data) => this._hass.callService(d, s, data);
    await this._hass.callWS({ type: "config/entity_registry/update", entity_id: E("input_datetime", "faellig"), name });
    sv("input_boolean", "turn_on", { entity_id: E("input_boolean", "aktiv") });
    sv("input_boolean", "turn_on", { entity_id: "input_boolean.erinnerungen_aktiv" });
    sv("input_datetime", "set_datetime", { entity_id: E("input_datetime", "gemeldet"), datetime: "1970-01-01 00:00:00" });
    sv("input_number", "set_value", { entity_id: E("input_number", "vorlauf"), value: Number(o.vl ?? 1) });
    if (o.mzstd === false && /^\d\d:\d\d$/.test(o.mz || "")) sv("input_text", "set_value", { entity_id: E("input_text", "meldezeit"), value: o.mz });
    if (o.devall === false && o.devs?.length) sv("input_text", "set_value", { entity_id: E("input_text", "geraete"), value: o.devs.join(",").slice(0, 255) });
    sv("input_select", "select_option", { entity_id: E("input_select", "vorlauf_einheit"), option: o.vlu || "Tage" });
    sv("input_number", "set_value", { entity_id: E("input_number", "wiederholung"), value: Number(o.rep ?? 3) });
    sv("input_select", "select_option", { entity_id: E("input_select", "art"), option: { intervall: "Wiederkehrend", sensor: "Sensor", kalender: "Kalender", frost: "Saison", saison: "Saison" }[art] });
    sv("input_datetime", "set_datetime", { entity_id: E("input_datetime", "faellig"), datetime: "2099-12-31 00:00:00" });
    if (art === "frost") {
      sv("input_number", "set_value", { entity_id: E("input_number", "frost_ab"), value: Number(o.frostab ?? -2) });
      sv("input_number", "set_value", { entity_id: E("input_number", "frost_tage"), value: Number(o.frosttage ?? 3) });
      sv("input_number", "set_value", { entity_id: E("input_number", "reset_monat"), value: Number(o.resetm ?? 4) });
    }
    if (iv) {
      const n = Number(o.n) || 6;
      const unitSel = o.u || "Monate";
      const z = o.z ? parse(o.z.replace("T", " ")) : new Date();
      z.setSeconds(0, 0);
      sv("input_number", "set_value", { entity_id: E("input_number", "intervall"), value: n });
      sv("input_select", "select_option", { entity_id: E("input_select", "intervall_einheit"), option: unitSel });
      sv("input_datetime", "set_datetime", { entity_id: E("input_datetime", "zuletzt"), datetime: dts(z) });
      sv("input_datetime", "set_datetime", { entity_id: E("input_datetime", "faellig"), datetime: dts(addUnit(z, n, unitSel)) });
    }
    return E;
  }

  async _create() {
    const w = this._readWiz();
    this._w = w;
    const fail = (m) => { this._w.msg = `<span class="err">${m}</span>`; this._w.busy = false; this._renderWiz(); };
    const name = (w.name || "").trim();
    if (!name) return fail("Bitte einen Namen eingeben.");
    let id = this._slug(name);
    if (!id) return fail("Der Name enthält keine verwendbaren Zeichen.");
    for (let k = 2; this._ids().includes(id); k++) id = `${this._slug(name).slice(0, 36)}_${k}`;
    const art = w.art || "intervall";
    if (art === "frost") Object.assign(w, { vl: 7, vlu: "Tage" }); // größtes Vorhersage-Fenster: Meldung sofort, sobald der Termin feststeht
    const icon = w.icon || "mdi:bell-outline";
    const bpFile = { sensor: "erinnerung_sensor.yaml", kalender: "erinnerung_kalender.yaml", frost: "erinnerung_frost.yaml" }[art];
    if (bpFile && !(await this._blueprintOk(bpFile))) return fail(this._blueprintHint(bpFile));
    if (art === "sensor" && !this._hass.states[w.sensor]) return fail("Bitte einen vorhandenen Sensor wählen.");
    if (art === "kalender" && !this._hass.states[w.cal]) return fail("Bitte einen vorhandenen Kalender wählen.");
    if (art === "frost" && !this._hass.states[w.wetter]?.state) return fail("Bitte eine vorhandene Wetter-Entität wählen.");
    const folgeName = art === "frost" && w.folge ? (w.folgename || "").trim() : "";
    let folgeId = "";
    if (folgeName) {
      folgeId = this._slug(folgeName);
      if (!folgeId) return fail("Der Name der Frühjahrs-Erinnerung enthält keine verwendbaren Zeichen.");
      for (let k = 2; folgeId === id || this._ids().includes(folgeId); k++) folgeId = `${this._slug(folgeName).slice(0, 36)}_${k}`;
    }
    this._w.busy = true;
    this._w.msg = "Wird angelegt …";
    this._renderWiz();
    try {
      const E = await this._makeReminder(id, name, icon, art, w);
      const sv = (d, s, data) => this._hass.callService(d, s, data);
      if (art === "sensor") {
        const hours = Number(this._hass.states[w.sensor].state);
        if (Number.isFinite(hours)) sv("input_datetime", "set_datetime", { entity_id: E("input_datetime", "faellig"), datetime: dts(new Date(Date.now() + hours * 3600000)) });
        await this._hass.callApi("POST", `config/automation/config/erinnerung_${id}_sensor`, {
          alias: `Erinnerung ${name} Termin`, description: "Termin aus Sensor (reminder-card).",
          use_blueprint: { path: "anc0bude/erinnerung_sensor.yaml", input: { sensor: w.sensor, faellig: E("input_datetime", "faellig") } },
        });
      } else if (art === "kalender") {
        await this._hass.callApi("POST", `config/automation/config/erinnerung_${id}_kalender`, {
          alias: `Erinnerung ${name} Termin`, description: "Termin aus Kalender (reminder-card).",
          use_blueprint: { path: "anc0bude/erinnerung_kalender.yaml", input: { kalender: w.cal, faellig: E("input_datetime", "faellig"), suchtext: w.filter || "", tage: 45 } },
        });
        setTimeout(() => {
          const a = Object.entries(this._hass.states).find(([e, s]) => e.startsWith("automation.") && s.attributes.id === `erinnerung_${id}_kalender`);
          if (a) sv("automation", "trigger", { entity_id: a[0], skip_condition: true });
        }, 2500);
      } else if (art === "frost") {
        let folgeFaellig = "";
        if (folgeName) {
          const F = await this._makeReminder(folgeId, folgeName, "mdi:water-pump", "saison", { vl: 0, vlu: "Tage", rep: 3 });
          folgeFaellig = F("input_datetime", "faellig");
        }
        await this._hass.callApi("POST", `config/automation/config/erinnerung_${id}_frost`, {
          alias: `Erinnerung ${name} Termin`, description: "Termin aus Frost-Vorhersage (reminder-card).",
          use_blueprint: { path: "anc0bude/erinnerung_frost.yaml", input: {
            wetter: w.wetter, faellig: E("input_datetime", "faellig"), gemeldet: E("input_datetime", "gemeldet"),
            frost_ab: E("input_number", "frost_ab"), tage: E("input_number", "frost_tage"), reset_monat: E("input_number", "reset_monat"),
            faellig_fruehjahr: folgeFaellig, frostalarm: w.alarm || "" } },
        });
        setTimeout(() => {
          const a = Object.entries(this._hass.states).find(([e, s]) => e.startsWith("automation.") && s.attributes.id === `erinnerung_${id}_frost`);
          if (a) sv("automation", "trigger", { entity_id: a[0], skip_condition: true });
        }, 2500);
      }
      this._w = null;
      this._sig = null;
      this._renderWiz();
      this._render();
    } catch (e) {
      fail(`Anlegen fehlgeschlagen: ${e?.message || e?.error || e}. Bereits angelegte Teile bleiben bestehen und lassen sich über „Löschen“ entfernen.`);
    }
  }

  // ---------- Kalender aus ICS-Datei: neue Termine hinzufügen, ohne Duplikate ----------

  _writableCalendars() {
    return Object.entries(this._hass.states)
      .filter(([e, s]) => e.startsWith("calendar.") && (Number(s.attributes.supported_features) & 1) === 1)
      .map(([e, s]) => ({ id: e, name: s.attributes.friendly_name || e }));
  }

  _importHtml(w) {
    const cals = this._writableCalendars();
    const plan = w.plan;
    const opt = (id, name) => `<option value="${id}"${w.ical === id ? " selected" : ""}>${name} (${id})</option>`;
    return `<div class="panel">${w.from ? "" : this._cfgTabs("import")}<div class="gt">Termine aus ICS-Datei importieren</div>
      <div class="hint">Liest eine .ics-Datei (zum Beispiel den Abfallkalender deiner Gemeinde) und fügt die Termine einem Kalender hinzu. Termine, die dort schon stehen oder mehrfach in der Datei vorkommen, werden nicht doppelt angelegt.</div>
      <div class="fld"><label>Datei</label><input type="file" class="i-file" accept=".ics,text/calendar"><div class="hint">${w.ics ? `${w.ics.name}: ${w.ics.events.length} Termine gelesen${w.ics.skipped ? `, ${w.ics.skipped} mit Wiederholungsregel übersprungen` : ""}.` : "Keine Datei gewählt."}</div></div>
      <div class="fld"><label>Ziel</label><select class="i-target">
        <option value="exist"${w.itarget !== "new" ? " selected" : ""}>Zu einem vorhandenen Kalender hinzufügen</option>
        <option value="new"${w.itarget === "new" ? " selected" : ""}>In einen neuen Kalender importieren</option></select></div>
      ${w.itarget === "new"
        ? `<div class="fld"><label>Name des neuen Kalenders</label><input type="text" class="i-name" value="${w.iname || ""}" placeholder="z. B. Abfall 2027"><div class="hint">Es wird ein „Lokaler Kalender“ angelegt.</div></div>`
        : `<div class="fld"><label>Kalender</label>${cals.length ? `<select class="i-cal"><option value="">Bitte wählen</option>${cals.map((c) => opt(c.id, c.name)).join("")}</select>` : "<i>Kein beschreibbarer Kalender gefunden.</i>"}<div class="hint">Zur Auswahl stehen nur Kalender, in die Termine geschrieben werden können.</div></div>`}
      ${plan ? `<div class="info">Vorschau: <b>${plan.neu}</b> neue Termine${plan.dup ? `, ${plan.dup} schon vorhanden` : ""}${plan.inFile ? `, ${plan.inFile} doppelt in der Datei` : ""}.</div>` : ""}
      <div class="msg">${w.msg || ""}</div>
      <div class="btns"><button class="done" data-act="import-go" ${w.busy || !w.ics ? "disabled" : ""}>${w.itarget === "new" ? "Kalender anlegen und Termine importieren" : "Neue Termine hinzufügen"}</button><button data-act="import-close">${w.from ? "Zurück" : "Schließen"}</button></div></div>`;
  }

  _parseIcs(text) {
    const lines = [];
    for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
      if (/^[ \t]/.test(raw) && lines.length) lines[lines.length - 1] += raw.slice(1);
      else lines.push(raw);
    }
    const events = [];
    let cur = null;
    let skipped = 0;
    const unesc = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
    const toDate = (v) => new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
    const toDt = (v) => {
      const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +(v.slice(13, 15) || 0)));
      return v.endsWith("Z") ? d : new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +(v.slice(13, 15) || 0));
    };
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") { cur = {}; continue; }
      if (line === "END:VEVENT") {
        if (cur && cur.summary && cur.start) {
          if (cur.rrule) skipped++;
          else events.push(cur);
        }
        cur = null;
        continue;
      }
      if (!cur) continue;
      const i = line.indexOf(":");
      if (i < 0) continue;
      const key = line.slice(0, i).split(";")[0].toUpperCase();
      const params = line.slice(0, i).toUpperCase();
      const val = line.slice(i + 1);
      if (key === "SUMMARY") cur.summary = unesc(val).trim();
      else if (key === "DESCRIPTION") cur.description = unesc(val);
      else if (key === "LOCATION") cur.location = unesc(val);
      else if (key === "RRULE") cur.rrule = val;
      else if (key === "DTSTART" || key === "DTEND") {
        const allDay = params.includes("VALUE=DATE") && !params.includes("VALUE=DATE-TIME") || /^\d{8}$/.test(val);
        const d = allDay ? toDate(val) : toDt(val);
        if (Number.isNaN(d.getTime())) continue;
        cur[key === "DTSTART" ? "start" : "end"] = d;
        cur.allDay = allDay;
      }
    }
    for (const e of events) {
      if (!e.end) { e.end = new Date(e.start.getTime()); if (e.allDay) e.end.setDate(e.end.getDate() + 1); }
    }
    return { events, skipped };
  }

  _evKey(summary, start, allDay) {
    return `${String(summary).trim().toLowerCase()}|${allDay ? ymd(start) : Math.round(start.getTime() / 60000)}`;
  }

  async _existingKeys(entity, events) {
    const t0 = new Date(Math.min(...events.map((e) => e.start.getTime())) - 86400000);
    const t1 = new Date(Math.max(...events.map((e) => e.end.getTime())) + 86400000);
    const rows = await this._hass.callApi("GET", `calendars/${entity}?start=${encodeURIComponent(t0.toISOString())}&end=${encodeURIComponent(t1.toISOString())}`);
    const keys = new Set();
    for (const r of rows || []) {
      const dateOnly = !!r.start?.date;
      const start = dateOnly ? parse(r.start.date) : new Date(r.start.dateTime);
      keys.add(this._evKey(r.summary || "", start, dateOnly));
    }
    return keys;
  }

  async _plan() {
    const w = this._w;
    if (!w.ics) return;
    const seen = new Set();
    let inFile = 0;
    const unique = [];
    for (const e of w.ics.events) {
      const k = this._evKey(e.summary, e.start, e.allDay);
      if (seen.has(k)) { inFile++; continue; }
      seen.add(k);
      unique.push(e);
    }
    let dup = 0;
    if (w.itarget !== "new" && w.ical && unique.length) {
      const existing = await this._existingKeys(w.ical, unique);
      dup = unique.filter((e) => existing.has(this._evKey(e.summary, e.start, e.allDay))).length;
    }
    w.plan = { neu: unique.length - dup, dup, inFile };
    this._renderWiz();
  }

  async _importGo() {
    const w = this._w;
    const fail = (m) => { w.busy = false; w.msg = `<span class="err">${m}</span>`; this._renderWiz(); };
    if (!w.ics?.events.length) return fail("Bitte zuerst eine Datei mit Terminen wählen.");
    w.busy = true;
    w.msg = "Wird importiert …";
    this._renderWiz();
    try {
      let entity = w.ical;
      if (w.itarget === "new") {
        const name = (w.iname || "").trim();
        if (!name) return fail("Bitte einen Namen für den neuen Kalender eingeben.");
        const flow = await this._hass.callApi("POST", "config/config_entries/flow", { handler: "local_calendar", show_advanced_options: false });
        const res = await this._hass.callApi("POST", `config/config_entries/flow/${flow.flow_id}`, { calendar_name: name, import: "create_empty" });
        if (res.type !== "create_entry") return fail("Der Kalender konnte nicht angelegt werden.");
        for (let t = 0; t < 40 && !entity; t++) {
          await new Promise((r) => setTimeout(r, 500));
          entity = Object.entries(this._hass.states).find(([e, s]) => e.startsWith("calendar.") && s.attributes.friendly_name === name)?.[0];
        }
        if (!entity) return fail("Der neue Kalender erscheint nicht in Home Assistant.");
      }
      if (!entity || !this._hass.states[entity]) return fail("Bitte einen Kalender wählen.");
      if ((Number(this._hass.states[entity].attributes.supported_features) & 1) !== 1) return fail("In diesen Kalender können keine Termine geschrieben werden.");
      const seen = new Set();
      const unique = [];
      let inFile = 0;
      for (const e of w.ics.events) {
        const k = this._evKey(e.summary, e.start, e.allDay);
        if (seen.has(k)) { inFile++; continue; }
        seen.add(k);
        unique.push(e);
      }
      const existing = w.itarget === "new" ? new Set() : await this._existingKeys(entity, unique);
      const todo = unique.filter((e) => !existing.has(this._evKey(e.summary, e.start, e.allDay)));
      let done = 0;
      let errors = 0;
      for (const e of todo) {
        const data = { entity_id: entity, summary: e.summary };
        if (e.description) data.description = e.description;
        if (e.location) data.location = e.location;
        if (e.allDay) Object.assign(data, { start_date: ymd(e.start), end_date: ymd(e.end > e.start ? e.end : addUnit(e.start, 1, "Tage")) });
        else Object.assign(data, { start_date_time: dts(e.start), end_date_time: dts(e.end > e.start ? e.end : new Date(e.start.getTime() + 3600000)) });
        try {
          await this._hass.callService("calendar", "create_event", data);
          done++;
        } catch (err) {
          errors++;
        }
        if (done % 10 === 0) { w.msg = `Wird importiert … ${done} von ${todo.length}`; this._renderWiz(); }
      }
      w.busy = false;
      w.ical = entity;
      w.done = { done, dup: unique.length - todo.length, inFile, errors };
      w.msg = `<span class="ok">${done} Termine hinzugefügt${unique.length - todo.length ? `, ${unique.length - todo.length} waren schon vorhanden` : ""}${inFile ? `, ${inFile} doppelt in der Datei` : ""}${errors ? `, <span class="err">${errors} Fehler</span>` : ""}.</span>`;
      this._renderWiz();
    } catch (e) {
      fail(`Import fehlgeschlagen: ${e?.message || e?.error || e}`);
    }
  }

  async _importFile(input) {
    const w = this._w;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const parsed = this._parseIcs(await f.text());
      w.ics = { name: f.name, ...parsed };
      w.plan = null;
      w.msg = parsed.events.length ? "" : '<span class="err">In der Datei wurden keine Termine gefunden.</span>';
    } catch (e) {
      w.msg = `<span class="err">Die Datei konnte nicht gelesen werden: ${e?.message || e}</span>`;
    }
    this._renderWiz();
    this._plan();
  }

  _importClose() {
    const w = this._w;
    if (this._wizSaved) {
      const back = { ...this._wizSaved };
      if (w?.ical) back.cal = w.ical;
      this._wizSaved = null;
      this._w = back;
    } else {
      this._w = null;
    }
    this._renderWiz();
    this._sig = null;
    this._render();
  }

  // ---------- Zentrale Konfiguration (Meldungen, Kalender-Import, …) ----------

  _cfgTabs(active) {
    return `<div class="tabs"><button type="button" data-act="cfg-meldungen" class="${active === "meldungen" ? "sel" : ""}">Meldungen</button><button type="button" data-act="cfg-import" class="${active === "import" ? "sel" : ""}">Kalender-Import</button></div>`;
  }

  _notifyDevices() {
    return Object.keys(this._hass.services?.notify || {}).filter((k) => k.startsWith("mobile_app_")).sort();
  }

  async _openMelden() {
    this._w = { mode: "cfg-meldungen", loading: true, melden: [], devs: null, msg: "" };
    this._renderWiz();
    try {
      const ids = Object.entries(this._hass.states).filter(([e, s]) => e.startsWith("automation.") && /^erinnerungen_melden/.test(s.attributes.id || "")).map(([, s]) => s.attributes.id);
      const rows = [];
      for (const id of ids) {
        try {
          const c = await this._hass.callApi("GET", `config/automation/config/${id}`);
          if (c?.use_blueprint?.path?.endsWith("erinnerungen_melden.yaml")) rows.push({ id, cfg: c });
        } catch (e) { /* nicht lesbar */ }
      }
      this._w.melden = rows;
      this._w.devs = rows.length ? [...new Set(rows.flatMap((r) => r.cfg.use_blueprint.input.geraete || []))] : this._notifyDevices();
    } catch (e) {
      this._w.msg = `<span class="err">Die Einstellungen konnten nicht gelesen werden: ${e?.message || e}</span>`;
    }
    this._w.loading = false;
    this._renderWiz();
  }

  _meldenHtml(w) {
    const all = [...new Set([...(w.devs || []), ...this._notifyDevices()])].sort();
    const rows = w.melden.length ? w.melden : [{ id: "erinnerungen_melden", cfg: { alias: "Erinnerungen melden", use_blueprint: { input: { uhrzeit: "08:00:00" } } } }];
    return `<div class="panel">${this._cfgTabs("meldungen")}<div class="gt">Meldungen</div>
      ${w.loading ? "<i>Wird geladen …</i>" : `
      <div class="fld"><label>Standard-Geräte</label><div class="chips">${all.map((d) => `<label class="chip"><input type="checkbox" class="m-dev" value="${d}"${(w.devs || []).includes(d) ? " checked" : ""}> ${d.replace("mobile_app_", "")}</label>`).join("") || "<i>Keine Companion-App gefunden.</i>"}</div><div class="hint">Diese Geräte bekommen die Meldung, wenn bei einer Erinnerung keine eigenen Geräte eingestellt sind (Zahnrad der Erinnerung).</div></div>
      <div class="fld"><label>Standard-Meldezeit</label>${rows.map((r) => `<div class="pair" style="margin-bottom:6px;max-width:420px"><span style="flex:1;align-self:center">${r.cfg.alias || r.id}</span><input type="time" class="m-time" data-id="${r.id}" value="${String(r.cfg.use_blueprint.input.uhrzeit || "08:00:00").slice(0, 5)}"></div>`).join("")}<div class="hint">Gilt für Erinnerungen ohne eigene Meldezeit. Erinnerungen mit Vorlauf in Tagen oder Monaten werden erst ab dieser Uhrzeit gemeldet, Erinnerungen mit Vorlauf in Stunden sofort.${w.melden.length ? "" : " Die Meldungen sind noch nicht eingerichtet, „Speichern“ legt sie an."}</div></div>`}
      <div class="msg">${w.msg || ""}</div>
      <div class="btns"><button class="done" data-act="melden-save" ${w.busy || w.loading ? "disabled" : ""}>Speichern</button><button data-act="melden-test" ${w.busy || w.loading ? "disabled" : ""}>Test-Meldung senden</button><button data-act="import-close">Schließen</button></div></div>`;
  }

  _readMelden() {
    const devs = [...this.querySelectorAll(".cfgbox .m-dev:checked")].map((c) => c.value);
    const times = {};
    this.querySelectorAll(".cfgbox .m-time").forEach((t) => { times[t.dataset.id] = (t.value || "08:00") + ":00"; });
    return { devs, times };
  }

  async _saveMelden() {
    const w = this._w;
    const { devs, times } = this._readMelden();
    const fail = (m) => { w.busy = false; w.msg = `<span class="err">${m}</span>`; this._renderWiz(); };
    if (!devs.length) return fail("Bitte mindestens ein Gerät wählen.");
    for (const f of ["erinnerungen_melden.yaml", "erinnerung_erledigt.yaml"]) {
      if (!(await this._blueprintOk(f))) return fail(this._blueprintHint(f));
    }
    w.busy = true;
    w.msg = "Wird gespeichert …";
    this._renderWiz();
    try {
      if (!this._hass.states["input_boolean.erinnerungen_aktiv"]) {
        await this._hass.callWS({ type: "input_boolean/create", name: "Erinnerungen aktiv", icon: "mdi:bell-check-outline" });
        await new Promise((r) => setTimeout(r, 1500));
        this._hass.callService("input_boolean", "turn_on", { entity_id: "input_boolean.erinnerungen_aktiv" });
      }
      if (w.melden.length) {
        for (const r of w.melden) {
          const { id: _id, ...body } = r.cfg;
          body.use_blueprint = { ...body.use_blueprint, input: { ...body.use_blueprint.input, geraete: devs, uhrzeit: times[r.id] || body.use_blueprint.input.uhrzeit } };
          await this._hass.callApi("POST", `config/automation/config/${r.id}`, body);
        }
      } else {
        await this._hass.callApi("POST", "config/automation/config/erinnerungen_melden", {
          alias: "Erinnerungen melden", description: "Meldet fällige Erinnerungen (reminder-card).",
          use_blueprint: { path: "anc0bude/erinnerungen_melden.yaml", input: { uhrzeit: times.erinnerungen_melden || "08:00:00", geraete: devs, tippen_pfad: "" } },
        });
      }
      const hasErledigt = Object.entries(this._hass.states).some(([e, s]) => e.startsWith("automation.") && s.attributes.id === "erinnerung_erledigt");
      if (!hasErledigt) {
        await this._hass.callApi("POST", "config/automation/config/erinnerung_erledigt", {
          alias: "Erinnerung erledigt (Knopf)", description: "Knopf Erledigt in der Meldung (reminder-card).",
          use_blueprint: { path: "anc0bude/erinnerung_erledigt.yaml", input: {} },
        });
      }
      w.busy = false;
      w.msg = '<span class="ok">Gespeichert.</span>';
      this._sig = null;
      await this._openMelden();
      this._w.msg = '<span class="ok">Gespeichert.</span>';
      this._renderWiz();
    } catch (e) {
      fail(`Speichern fehlgeschlagen: ${e?.message || e?.error || e}`);
    }
  }

  async _testMelden() {
    const { devs } = this._readMelden();
    if (!devs.length) { this._w.msg = '<span class="err">Bitte mindestens ein Gerät wählen.</span>'; this._renderWiz(); return; }
    for (const d of devs) {
      try { await this._hass.callService("notify", d, { title: "Erinnerungen", message: "Dies ist eine Test-Meldung." }); } catch (e) { /* Gerät nicht erreichbar */ }
    }
    this._w.msg = `<span class="ok">Test-Meldung an ${devs.length} Gerät(e) gesendet.</span>`;
    this._renderWiz();
  }

  async _delete(r) {
    if (this._confirm !== r.id) {
      this._confirm = r.id;
      this._sig = null;
      this._render();
      return;
    }
    this._confirm = null;
    try {
      for (const d of ["input_datetime", "input_number", "input_select", "input_boolean", "input_text"]) {
        const items = await this._hass.callWS({ type: `${d}/list` });
        for (const it of items.filter((x) => x.id.startsWith(`erinnerung_${r.id}_`))) {
          await this._hass.callWS({ type: `${d}/delete`, [`${d}_id`]: it.id });
        }
      }
      for (const k of ["sensor", "kalender", "frost"]) {
        try { await this._hass.callApi("DELETE", `config/automation/config/erinnerung_${r.id}_${k}`); } catch (e) { /* gibt es nicht */ }
      }
    } catch (e) {
      console.warn("reminder-card: Löschen fehlgeschlagen", e);
    }
    this._open[r.id] = false;
    this._sig = null;
    this._render();
  }

  async _rename(inp) {
    const id = inp.dataset.id;
    const value = inp.value.trim();
    if (!value) return;
    try {
      if (inp.dataset.ren === "name") {
        await this._hass.callWS({ type: "config/entity_registry/update", entity_id: `input_datetime.erinnerung_${id}_faellig`, name: value });
      } else {
        await this._hass.callWS({ type: "config/entity_registry/update", entity_id: `input_boolean.erinnerung_${id}_aktiv`, icon: value });
      }
    } catch (e) {
      console.warn("reminder-card: Umbenennen fehlgeschlagen", e);
    }
  }

  _wizChange(e) {
    const t = e.target;
    if (this._w?.mode === "import") {
      if (t.classList.contains("i-file")) this._importFile(t);
      else if (t.classList.contains("i-target")) { this._w.itarget = t.value; this._w.plan = null; this._w.msg = ""; this._renderWiz(); this._plan(); }
      else if (t.classList.contains("i-cal")) { this._w.ical = t.value; this._w.plan = null; this._plan(); }
      else if (t.classList.contains("i-name")) this._w.iname = t.value;
      return;
    }
    if (this._w?.mode === "new" && !t.classList.contains("w-preset") && !t.classList.contains("w-art")) {
      if (t.classList.contains("w-devall")) this.querySelectorAll(".wiz .w-dev").forEach((c) => { c.disabled = t.checked; });
      if (t.classList.contains("w-mzstd")) { const z = this.querySelector(".wiz .w-mz"); if (z) z.disabled = t.checked; }
      const w2 = this._readWiz();
      const sum = this.querySelector(".wiz .w-sum");
      if (sum) sum.textContent = this._meldungText(w2.vl ?? 1, w2.vlu || "Tage", w2.mzstd === false ? w2.mz : "", w2.art === "frost", null).text;
    }
    if (t.classList.contains("w-preset")) {
      const w = this._readWiz();
      const p = PRESETS[Number(t.value)];
      w.preset = t.value;
      if (p) {
        Object.assign(w, { name: p.name ?? "", icon: p.icon, art: p.art || "intervall", n: p.n, u: p.u });
        if (p.art === "frost") Object.assign(w, { folge: false, folgename: "" });
        if (p.art === "kalender") Object.assign(w, { filter: p.filter || "", vl: 1, vlu: "Tage", rep: 0, cal: w.cal || this._defaultCal() });
      }
      this._w = w;
      this._renderWiz();
    } else if (t.classList.contains("w-art")) {
      this._w = this._readWiz();
      this._renderWiz();
    }
  }

  _reschedule(r) {
    const z = parse(this._val(r, "input_datetime", "zuletzt"));
    const n = Number(this._val(r, "input_number", "intervall"));
    if (!z || !n) return;
    this._hass.callService("input_datetime", "set_datetime", { entity_id: this._ent(r, "input_datetime", "faellig"), datetime: dts(addUnit(z, n, this._unit(r, "intervall_einheit"))) });
  }

  _toggle(el) {
    const id = el.dataset.toggle;
    const entity_id = id === "__master" ? this._masterEntity() : `input_boolean.erinnerung_${id}_aktiv`;
    this._hass.callService("input_boolean", el.checked ? "turn_on" : "turn_off", { entity_id });
  }

  _click(e) {
    const pick = e.target.closest("button[data-pick]");
    if (pick) {
      const input = pick.closest(".ipw")?.querySelector("input");
      if (input) {
        input.value = pick.dataset.pick;
        pick.closest(".ipw").querySelector(".prev")?.setAttribute("icon", pick.dataset.pick);
        pick.closest(".ip").querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === pick));
        if (input.dataset.ren) this._rename(input);
      }
      return;
    }
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "new") { this._w = this._w && this._w.mode === "new" ? null : { mode: "new", art: "intervall" }; this._renderWiz(); return; }
    if (act === "wiz-close") { this._w = null; this._renderWiz(); return; }
    if (act === "wiz-create") { this._create(); return; }
    if (act === "import-open") {
      this._wizSaved = this._w && this._w.mode === "new" ? this._readWiz() : null;
      this._w = { mode: "import", itarget: "exist", from: !!this._wizSaved, ical: this._wizSaved?.cal || "" };
      this._renderWiz();
      return;
    }
    if (act === "cfg-open" || act === "cfg-meldungen") {
      if (act === "cfg-open" && this._w && (this._w.mode === "cfg-meldungen" || (this._w.mode === "import" && !this._w.from))) { this._w = null; this._renderWiz(); return; }
      this._openMelden();
      return;
    }
    if (act === "cfg-import") { this._w = { mode: "import", itarget: "exist", from: false, ical: "" }; this._renderWiz(); return; }
    if (act === "melden-save") { this._saveMelden(); return; }
    if (act === "melden-test") { this._testMelden(); return; }
    if (act === "import-go") { this._importGo(); return; }
    if (act === "import-close") { this._importClose(); return; }
    if (act === "cancel-del") { this._confirm = null; this._sig = null; this._render(); return; }
    const r = this._list().find((x) => x.id === b.dataset.id);
    if (act === "delete") { this._delete(r); return; }
    if (b.dataset.act === "edit") {
      this._open[r.id] = !this._open[r.id];
      this._sig = null;
      this._render();
      return;
    }
    if (b.dataset.act === "done" && r.kind === "saison") {
      this._hass.callService("input_datetime", "set_datetime", { entity_id: this._ent(r, "input_datetime", "gemeldet"), datetime: this._val(r, "input_datetime", "faellig") });
      return;
    }
    if (b.dataset.act === "done") {
      const now = new Date();
      now.setSeconds(0, 0);
      const n = Number(this._val(r, "input_number", "intervall") || 6);
      this._hass.callService("input_datetime", "set_datetime", { entity_id: this._ent(r, "input_datetime", "zuletzt"), datetime: dts(now) });
      this._hass.callService("input_datetime", "set_datetime", { entity_id: this._ent(r, "input_datetime", "faellig"), datetime: dts(addUnit(now, n, this._unit(r, "intervall_einheit"))) });
    }
  }

  _change(e) {
    const sw = e.target.closest("ha-switch[data-toggle]");
    if (sw) {
      this._toggle(sw);
      return;
    }
    const t = e.target;
    const gId = t.dataset?.geraeteAll || t.dataset?.geraet || t.dataset?.zeitStd || t.dataset?.zeit;
    if (gId) {
      const r = this._list().find((x) => x.id === gId);
      const grp = t.closest(".fld");
      if (t.dataset.geraeteAll !== undefined || t.dataset.geraet !== undefined) {
        const all = grp.querySelector("[data-geraete-all]").checked;
        const picked = [...grp.querySelectorAll("[data-geraet]:checked")].map((c) => c.value);
        const devs = t.dataset.geraeteAll !== undefined && !all ? [...grp.querySelectorAll("[data-geraet]")].map((c) => c.value) : picked;
        this._setText(r, "geraete", all ? "" : devs.join(",").slice(0, 255));
      } else {
        const std = grp.querySelector("[data-zeit-std]").checked;
        const val = grp.querySelector("[data-zeit]").value || "08:00";
        this._setText(r, "meldezeit", std ? "" : val);
      }
      return;
    }
    const ren = e.target.closest("[data-ren]");
    if (ren) {
      this._rename(ren);
      return;
    }
    const inp = e.target.closest("[data-set]");
    if (!inp) return;
    const r = this._list().find((x) => x.id === inp.dataset.id);
    const [kind, key] = inp.dataset.set.split(".");
    const entity_id = this._ent(r, kind, key);
    if (kind === "input_number") this._hass.callService("input_number", "set_value", { entity_id, value: Number(inp.value) });
    else if (kind === "input_select") this._hass.callService("input_select", "select_option", { entity_id, option: inp.value });
    else if (inp.value) this._hass.callService("input_datetime", "set_datetime", { entity_id, datetime: inp.value.replace("T", " ") + ":00" });
    if (key === "intervall" || key === "intervall_einheit" || key === "zuletzt") setTimeout(() => this._reschedule(r), 400);
  }
}

if (!customElements.get("reminder-card")) customElements.define("reminder-card", ReminderCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "reminder-card", name: "Erinnerungen", description: "Erinnerungen mit Fälligkeit, Status und Erledigt-Knopf" });
