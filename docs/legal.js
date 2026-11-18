// Rechtstexte für RegioTipp: Impressum, Datenschutzerklärung, Nutzungsbedingungen.
// Stand: November 2026. Adresse im Impressum bei Aufnahme kommerzieller Tätigkeit ergänzen.

export const OPERATOR = {
  name: "Thomas Tanner",
  email: "kontakt.regiotipp@gmail.com",
  // TODO: Postadresse (z.B. Domiziladresse oder Vereinsadresse) eintragen, sobald RegioTipp Einnahmen erzielt.
  address: "",
};

const STAND = "13. November 2026";
const mail = `<a href="mailto:${OPERATOR.email}">${OPERATOR.email}</a>`;

export function impressumHtml() {
  return `
    <h1>Impressum</h1>
    <div class="card legal">
      <h3>Verantwortlich für RegioTipp</h3>
      <p>${OPERATOR.name}<br>
      ${OPERATOR.address ? OPERATOR.address.replace(/\n/g, "<br>") + "<br>" : "Schweiz<br>"}
      E-Mail: ${mail}</p>
      ${OPERATOR.address ? "" : `<p class="small muted">Die Postadresse wird auf Anfrage per E-Mail mitgeteilt.</p>`}

      <h3>Datenquelle</h3>
      <p>Spielpläne, Resultate und Tabellen werden automatisch von öffentlich zugänglichen Seiten übernommen
      (footstats.ch). Alle Angaben ohne Gewähr. Massgebend sind die offiziellen Angaben des Schweizerischen
      Fussballverbands (SFV) bzw. des Fussballverbands Region Zürich (FVRZ).</p>

      <h3>Keine offizielle Verbindung</h3>
      <p>RegioTipp ist ein unabhängiges Angebot und steht in keiner Verbindung zum SFV, zum FVRZ, zu footstats.ch oder zu
      den genannten Vereinen. Vereinsnamen gehören den jeweiligen Vereinen. Die in der App gezeigten Vereinsabzeichen
      sind eigene, vereinfachte Gestaltungen (Kürzel in Vereinsfarben) und keine offiziellen Vereinswappen.</p>

      <h3>Haftung</h3>
      <p>Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte wird keine Gewähr übernommen.
      Für Inhalte verlinkter Seiten sind ausschliesslich deren Betreiber verantwortlich.</p>
    </div>`;
}

export function datenschutzHtml() {
  return `
    <h1>Datenschutzerklärung</h1>
    <p class="small muted">Stand: ${STAND}</p>
    <div class="card legal">
      <p>Diese Datenschutzerklärung informiert darüber, welche Personendaten RegioTipp bearbeitet, wofür und mit wem.
      Sie richtet sich nach dem Schweizer Datenschutzgesetz (DSG).</p>

      <h3>1. Verantwortlich</h3>
      <p>${OPERATOR.name}, Schweiz, E-Mail: ${mail}</p>

      <h3>2. Welche Daten wir bearbeiten</h3>
      <ul>
        <li><b>Konto:</b> Benutzername, E-Mail-Adresse und Passwort (nur verschlüsselt gespeichert).</li>
        <li><b>Profil (freiwillig):</b> gewählter Verein und ein eigenes Profilbild.</li>
        <li><b>Spieldaten:</b> deine Tipps, Punkte, Ranglistenplätze sowie die Tipprunden, in denen du Mitglied bist.</li>
        <li><b>Technische Daten:</b> Beim Aufruf der App speichern die Hosting-Anbieter kurzzeitig technische Angaben
        wie IP-Adresse, Zeitpunkt und Browser, um den Betrieb und die Sicherheit zu gewährleisten.</li>
      </ul>
      <p>Wir verlangen keine weiteren Angaben wie Adresse, Telefonnummer oder Geburtsdatum.</p>

      <h3>3. Zweck</h3>
      <p>Wir bearbeiten die Daten nur, um das Tippspiel zu betreiben: Anmeldung, Speichern und Auswerten der Tipps,
      Ranglisten, Tipprunden mit Freunden sowie Sicherheit und Fehlerbehebung.</p>

      <h3>4. Was andere sehen</h3>
      <p>Benutzername, Profilbild bzw. Vereinsabzeichen, Verein, Punkte und Rangliste sind für andere angemeldete
      Nutzerinnen und Nutzer sichtbar. Deine Tipps sind für andere erst ab Anpfiff des jeweiligen Spiels sichtbar.
      Deine E-Mail-Adresse ist für andere nie sichtbar.</p>

      <h3>5. Dienstleister und Speicherort</h3>
      <ul>
        <li><b>Supabase</b> (Supabase Inc., USA) betreibt Datenbank, Anmeldung und Dateispeicher.
        Die Daten liegen in einem Rechenzentrum in <b>Zürich (Schweiz)</b>.</li>
        <li><b>GitHub Pages</b> (GitHub Inc., USA) liefert die Webseite aus. Dabei werden technische Daten (z.B. IP-Adresse)
        auch in den USA bearbeitet.</li>
        <li><b>jsDelivr</b> (Content Delivery Network) liefert eine Programmbibliothek aus. Dabei wird die IP-Adresse an
        den Anbieter übermittelt.</li>
      </ul>
      <p>Bei Bearbeitung in den USA stützen wir uns auf das Swiss-U.S. Data Privacy Framework bzw. auf
      Standardvertragsklauseln der Anbieter.</p>

      <h3>6. Keine Werbe-Tracker, keine Weitergabe</h3>
      <p>RegioTipp verwendet keine Werbe- oder Analyse-Tracker. Im Browser werden nur technisch notwendige Angaben
      gespeichert (Anmeldung und Einstellungen wie zuletzt gewählte Filter). Wir verkaufen keine Personendaten und geben
      sie nicht an Sponsoren oder Werbepartner weiter. Falls RegioTipp künftig Sponsoren oder Werbung zeigt, erhalten
      diese keine Personendaten von dir, ausser du willigst ausdrücklich ein.</p>

      <h3>7. Aufbewahrung</h3>
      <p>Wir speichern deine Daten, solange du ein Konto hast. Löschst du dein Konto, werden Profil, Tipps,
      Mitgliedschaften und Profilbild sofort gelöscht. Technische Protokolle der Anbieter werden nach kurzer Zeit
      automatisch gelöscht.</p>

      <h3>8. Deine Rechte</h3>
      <p>Du kannst jederzeit Auskunft über deine Daten verlangen, falsche Daten berichtigen lassen und dein Konto selbst
      löschen (Profil → „Konto löschen“). Für Anfragen schreib an ${mail}. Du kannst dich zudem beim Eidgenössischen
      Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) beschweren.</p>

      <h3>9. Kinder und Jugendliche</h3>
      <p>Wer jünger als 16 Jahre ist, braucht für die Nutzung das Einverständnis der Eltern.</p>

      <h3>10. Änderungen</h3>
      <p>Wir können diese Datenschutzerklärung anpassen. Es gilt die jeweils in der App veröffentlichte Fassung.</p>
    </div>`;
}

export function agbHtml() {
  return `
    <h1>Nutzungsbedingungen</h1>
    <p class="small muted">Stand: ${STAND}</p>
    <div class="card legal">
      <h3>1. Angebot</h3>
      <p>RegioTipp ist ein Tippspiel zu Spielen des regionalen Fussballs. Die Teilnahme ist kostenlos.
      Es wird kein Geld eingesetzt und es gibt keinen Anspruch auf Gewinne. RegioTipp ist kein Geldspiel.</p>

      <h3>2. Konto</h3>
      <p>Für die Teilnahme brauchst du ein Konto. Halte dein Passwort geheim. Pro Person ist ein Konto erlaubt.
      Wer jünger als 16 Jahre ist, braucht das Einverständnis der Eltern.</p>

      <h3>3. Fair Play</h3>
      <ul>
        <li>Benutzernamen, Namen von Tipprunden und Profilbilder dürfen nicht beleidigend, diskriminierend, sexuell,
        gewaltverherrlichend oder rechtswidrig sein und keine Rechte Dritter verletzen.</li>
        <li>Lade nur Bilder hoch, die du selbst gemacht hast oder verwenden darfst.</li>
        <li>Manipulationen, automatisierte Abfragen oder Mehrfachkonten sind verboten.</li>
      </ul>
      <p>Bei Verstössen können Inhalte entfernt und Konten gesperrt oder gelöscht werden.</p>

      <h3>4. Spielregeln und Daten</h3>
      <p>Es gelten die Spielregeln in der App. Spielpläne und Resultate werden automatisch übernommen und können
      verspätet, unvollständig oder fehlerhaft sein. Bei Korrekturen werden die Punkte neu berechnet. Spiele ohne
      Resultat werden nach 21 Tagen als abgesagt gewertet.</p>

      <h3>5. Preise und Sponsoren</h3>
      <p>Falls Sponsoren Preise zur Verfügung stellen, werden die Bedingungen dafür jeweils separat bekannt gegeben.
      Die Teilnahme bleibt immer kostenlos.</p>

      <h3>6. Verfügbarkeit und Haftung</h3>
      <p>RegioTipp wird ohne Gewähr angeboten. Es besteht kein Anspruch auf ständige Verfügbarkeit.
      Die Haftung ist im gesetzlich zulässigen Rahmen ausgeschlossen.</p>

      <h3>7. Beendigung</h3>
      <p>Du kannst dein Konto jederzeit selbst löschen. Der Betreiber kann das Angebot jederzeit ändern oder einstellen.</p>

      <h3>8. Änderungen und Recht</h3>
      <p>Diese Bedingungen können angepasst werden; es gilt die in der App veröffentlichte Fassung.
      Es gilt Schweizer Recht.</p>

      <p class="small muted">Kontakt: ${mail}</p>
    </div>`;
}
