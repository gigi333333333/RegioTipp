# RegioTipp – FVRZ Tippspiel

Handy-Web-App zum Tippen der genauen Resultate von FVRZ-Spielen (Aktive, Frauen, Junioren A–C).
Punkte nach den Regeln des SRF-Tippspiels: Tendenz 5, Heimtore 1, Gasttore 1, Tordifferenz 3
(genaues Resultat = 10), Cupspiele doppelt. Gruppen werden über den Punkte-Durchschnitt verglichen.

## Aufbau

- `docs/` – die App (reines HTML/CSS/JS, kein Build). Wird über GitHub Pages ausgeliefert.
- `supabase/migrations/` – Datenbankschema (Tabellen, Punkte-Logik, Zugriffsregeln, Zeitpläne).
- `supabase/functions/sync/` – Edge Function, die Tabellen, Spiele und Resultate von footstats.ch importiert.

## Betrieb

- Supabase-Projekt `saguzhqngpyafvwetsnw` (eu-central-2).
- `pg_cron` ruft `sync` stündlich (Tabellen) und zweimal pro Stunde (Spielpläne) auf.
- Der erste registrierte Benutzer wird Admin. Admins können Resultate nachtragen,
  Spiele absagen, den Import manuell starten und weitere Admins ernennen.
