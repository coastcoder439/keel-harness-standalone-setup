# Sessions-Rollen

> Wird von `.claude/session-roles.js` bei SessionStart gelesen. Diese Datei
> ist installationsbezogen: Der Owner trägt nur tatsächlich laufende Sessions
> und ihre aktuelle Paketrolle ein. Das Produkt liefert keine Rollenannahmen aus.

| Session-Titel | Rolle | seit |
|---|---|---|
| Dashboard-Orchestrator | Agent des Dashboards (Ordner dashboard/ dieses Harness): beantwortet den Chat auf der Kommandobrücke und dem persönlichen Board sowie den Sprachbegleiter; legt Aufträge für Sitzungen über die Brücke ab; hält Aufgaben, Termine, Vorhaben und Pläne des Owners nach; antwortet mit dem in den Assistenteneinstellungen gewählten Modell (lokal über Ollama oder Cloud über Claude-/Codex-CLI). Schreibt nichts ohne Bestätigung; Ausführung übernimmt der Dienst. | 19.09.2026 |

Die Zeile „Dashboard-Orchestrator“ ist die Produktrolle des Dashboard-Agenten und gehört zum Harness (Owner 19.09.2026). Darüber hinaus gehören nur benannte Sessions in die Tabelle. Synthetische Testfixtures und
vorgegebene Rollen sind keine dauerhaften Owner-Sessions. Gemeinsam genutzte
Fakten werden im besitzenden Paketbundle oder einem gebundenen Handoff abgelegt.
