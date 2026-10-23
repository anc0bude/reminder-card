# Reminder Card

Erinnerungen für Home Assistant: Filter wechseln, Siebe reinigen, Müllabfuhr, Frostschutz fürs Außenwasser. Eine Karte zeigt alles nach Fälligkeit sortiert, ein Assistent legt neue Erinnerungen an, und Blueprints melden fällige Aufgaben auf Handys und Tablets.

Reminders for Home Assistant: a dashboard card that lists recurring tasks by due date, a wizard to create them, and blueprints that send notifications to your devices.

<p align="center"><img src="https://raw.githubusercontent.com/anc0bude/reminder-card/main/preview/preview.png" alt="Reminder Card: Liste der Erinnerungen mit Status, Erledigt-Knopf und geöffneten Einstellungen" width="360"></p>

> **Lizenz / License:** PolyForm Noncommercial 1.0.0. Frei für private und andere nicht kommerzielle Nutzung, **nicht für kommerzielle Nutzung**. Siehe [LICENSE](LICENSE). Das ist „source available“, nicht Open Source.

## Was es kann

- **Karte** mit Status (ok, bald fällig, überfällig), Erledigt-Knopf, Einstellungen je Erinnerung und einem Schalter für die Meldung. Der Schalter schaltet nur die Meldung aus, die Fälligkeit wird weiter berechnet.
- **Intervall und Vorlauf in Stunden, Tagen oder Monaten.**
- **Vier Arten von Terminen:** wiederkehrend (alle N …), aus einem Sensor (verbleibende Stunden), aus einem Kalender (mit Titel-Filter, zum Beispiel Müllabfuhr je Tonne) und saisonal (zum Beispiel vor dem ersten Frost).
- **Assistent in der Karte:** „+“ legt eine Erinnerung an (mit Vorlagen), „Meldungen einrichten“ legt die Automationen an, im Zahnrad lässt sich eine Erinnerung löschen. Dafür braucht der Nutzer Administratorrechte.
- **Meldungen** an alle Geräte der Companion-App, mit „Erledigt“-Knopf direkt in der Meldung.

## Installation

1. HACS → Dashboard → Benutzerdefinierte Repositories → dieses Repository, Typ *Dashboard*. Karte installieren, Seite neu laden.
2. **Blueprints importieren** (HACS installiert keine Blueprints). Einstellungen → Automatisierungen → Blueprints → Blueprint importieren, jeweils die URL einfügen:
   - `https://github.com/anc0bude/reminder-card/blob/main/blueprints/automation/anc0bude/erinnerungen_melden.yaml`
   - `https://github.com/anc0bude/reminder-card/blob/main/blueprints/automation/anc0bude/erinnerung_erledigt.yaml`
   - für Termine aus Sensor, Kalender oder Wetter: `erinnerung_sensor.yaml`, `erinnerung_kalender.yaml`, `erinnerung_frost.yaml` im selben Ordner.
3. Karte ins Dashboard: `type: custom:reminder-card`. Ohne weitere Angaben findet sie alle Erinnerungen selbst.
4. Auf „Jetzt einrichten“ klicken (erscheint, solange die Melde-Automation fehlt), danach „+“ für die erste Erinnerung.

## Karte konfigurieren

```yaml
type: custom:reminder-card
title: Erinnerungen            # optional
master: input_boolean.erinnerungen_aktiv   # optional, Hauptschalter für die Meldungen
reminders:                     # optional; ohne Liste werden alle Erinnerungen gefunden
  - id: hebeanlage
    name: Hebeanlage reinigen
    icon: mdi:pump
    kind: intervall            # intervall | sensor | kalender | saison
```

## Wie es aufgebaut ist

Jede Erinnerung besteht aus Hilfsgrößen mit dem Namensmuster `erinnerung_<id>_…`, die der Assistent anlegt:

| Hilfsgröße | Bedeutung |
|---|---|
| `input_datetime.erinnerung_<id>_faellig` | nächster Termin (Datum und Uhrzeit), der Name ist der Anzeigename |
| `…_zuletzt`, `…_intervall`, `…_intervall_einheit` | nur bei „wiederkehrend“ |
| `…_vorlauf`, `…_vorlauf_einheit`, `…_wiederholung` | wann gemeldet wird |
| `…_gemeldet` | wann zuletzt gemeldet wurde |
| `input_boolean.erinnerung_<id>_aktiv` | Meldung an oder aus (das Symbol der Erinnerung hängt hier) |
| `input_select.erinnerung_<id>_art` | Wiederkehrend, Sensor, Kalender oder Saison |

Ein Fälligkeitsdatum im Jahr 2099 bedeutet „kein Termin“.

**Meldungsregel:** erste Meldung `Vorlauf` vor dem Termin, danach am Termin und alle `Wiederholung` Tage, bis „Erledigt“ gedrückt wird. Erinnerungen mit Vorlauf in Tagen oder Monaten werden erst ab der eingestellten Uhrzeit gemeldet.

## Hinweise

- Der Assistent legt Hilfsgrößen und Automationen mit denselben Schnittstellen an, die auch die Oberfläche von Home Assistant benutzt. Das funktioniert nur für Administratoren.
- Entwickelt und im Einsatz mit Home Assistant 2026.10. Auf anderen Versionen nicht getestet.
- Monatsangaben bei „Erledigt“ in der Meldung werden auf den Tag 28 begrenzt.
