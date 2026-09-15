# Sprachlaufzeit des Harness (`voice/`)

Dieser Ordner ist ein Sidecar neben `dashboard/` und `roles/`. Er gehoert NICHT in den
Next-Build: `dashboard/serve.mjs` importiert `voice/launcher.mjs` beim Start, und
`dashboard/lib/companion/profile-service.ts` laedt `voice/profile-service.mjs` erst zur
Laufzeit ueber `KEEL_VOICE_SIDECAR_ROOT`. Die Kette nutzt bereits installierte Piper- und
Whisper-Dateien LESEND. Geschrieben wird ausschliesslich nach `<harness>/runtime/voice`
(ueberschreibbar mit `KEEL_VOICE_ROOT`; der Ordner ist gitignoriert). Es gibt keine
automatische Installation und keinen automatischen Stimmwechsel.

## Bedienung

Aus dem Harness-Wurzelverzeichnis:

```powershell
node voice/check.mjs                      # Installationsstand, startet nichts
node voice/check.mjs --require-ready      # Exitcode 1, wenn Piper/Whisper nicht laufen
node dashboard/serve.mjs --voice          # Dienste + Dashboard auf 127.0.0.1:4190
node dashboard/serve.mjs --speech --port 4193
```

Flags (identisch im Quellbaum und in der installierten Auslieferung):

| Flag | Wirkung |
| --- | --- |
| `--voice` | Sprachausgabe (Piper) und Mikrofon (Whisper) |
| `--speech` | nur Sprachausgabe |
| `--microphone` | nur Mikrofon |
| `--no-inference` | KI pausieren (ohne Flag ist die KI AN) |

Der Starter setzt fuer den Dashboard-Kindprozess `KEEL_PROTOTYPE_ROOT`,
`KEEL_VOICE_ROOT`, `KEEL_VOICE_SIDECAR_ROOT`, `KEEL_PROTOTYPE_SPEECH`,
`KEEL_PROTOTYPE_MICROPHONE`, `KEEL_PROTOTYPE_INFERENCE`, `KEEL_PROTOTYPE_PIPER_URL`,
`KEEL_PROTOTYPE_STT_URL`, `ACCOUNTABILITY_VOICEBOX_URL` und `KEEL_ROLE_PROFILE_ROOT`. Die Dienste starten VOR dem
Web-Prozess und werden bei Exit oder Signal wieder gestoppt. Fehlt die Installation,
bricht der Starter mit einer `FEHLER:`-Zeile und Exitcode 2 ab und startet keinen
Webserver; die genaue Liste liefert `node voice/check.mjs`.

- Piper: `127.0.0.1:4297`, Deutsch Thorsten / Englisch Lessac.
- Whisper: `127.0.0.1:4298`, base / CPU / INT8 / zwei Rechenthreads; eine Aufnahme
  gleichzeitig, maximal 30 Sekunden und 8 MB.
- Profildienst (eigene Stimmen): `127.0.0.1:4299`.
- `GET /api/prototype/status` meldet pausierte Pfade ausdruecklich.

Bereits laufende Dienste derselben Kennung (`keel-v4-piper`, `keel-v4-stt`) werden
wiederverwendet und nie fremd beendet; ein fremder Listener auf derselben Adresse ist
ein Fehler, kein Grund zum Abschiessen.

## Wo die Installation gesucht wird

Je Fundstelle in genau dieser Reihenfolge:

1. die ausdrueckliche Umgebungsvariable,
2. die eigene Sprachruntime dieser Installation unter `<KEEL_VOICE_ROOT>`
   (`piper-env/`, `stt-env/`, `models/`),
3. ein ausdruecklich benannter Legacy-Pfad unter dem Repository-Root
   (`KEEL_HARNESS_REPOSITORY_ROOT`): `focus-orb-prototype/runtime` und
   `focus-dashboard-v3/runtime`. Diese Stufe existiert nur, damit eine Werkbank mit
   den frueher eingerichteten Prototyp-Runtimes ohne Neuinstallation weiterlaeuft.

| Variable | Setzt |
| --- | --- |
| `KEEL_VOICE_PIPER_PYTHON` | Python-Interpreter mit Piper |
| `KEEL_VOICE_STT_PYTHON` | Python-Interpreter mit faster-whisper |
| `KEEL_VOICE_PIPER_DE` | `de_DE-thorsten-high.onnx` (mit `.json` daneben) |
| `KEEL_VOICE_PIPER_EN` | `en_US-lessac-medium.onnx` (mit `.json` daneben) |
| `KEEL_VOICE_STT_MODEL` | Ordner mit `model.bin` und `config.json` |
| `KEEL_VOICE_ROOT` | Schreibwurzel der Sprachdaten |
| `KEEL_VOICE_SIDECAR_ROOT` | dieser Ordner (Default `<KEEL_HARNESS_ROOT>/voice`) |

`node voice/check.mjs` nennt je Dienst, welches Stueck fehlt, welche Variable es setzt
und welche Pfade durchsucht wurden.

## Eigene Stimmen

Der Profilservice ist unabhaengig von Piper, Whisper und Agentenmodell. Der Knopf
„Stimmendienst starten" in den Einstellungen verwendet die vorhandene
Voicebox-Installation auf `127.0.0.1:4299`. Dabei wird kein Synthesemodell geladen und
kein Profil angelegt.

`profile-service.mjs` startet das installierte Binary ueber `profile-process.py`. Der
Windows-Job begrenzt den eigenen Prozessbaum auf zwei CPU-Kerne und standardmaessig
5120 MiB zugesicherten Speicher (`KEEL_VOICEBOX_JOB_MIB`, geklemmt auf 2560-16384). Der
Start braucht mindestens 3 GiB freien Arbeitsspeicher, wartet hoechstens 60 Sekunden auf
Bereitschaft und beendet bei Fehler den selbst gestarteten Prozess. Ein laufender fremder
Dienst wird nicht beendet. Liegt das Binary nicht unter
`%LOCALAPPDATA%/Voicebox/voicebox-server.exe`, zeigt `KEEL_VOICEBOX_BINARY` darauf.

Der Voicebox-Kindprozess behaelt Netzwerkzugriff, damit ausschliesslich der ausdruecklich
angeklickte Modelldownload ueber die Model-API arbeiten kann. Profilstart und
Statuspruefung laden nichts. Die Syntheseroute prueft den vollstaendigen isolierten Cache
vor `/generate`; ein fehlendes Modell startet deshalb auch bei einer normalen Stimmprobe
keinen automatischen Download.

Der Vertrag:

- `GET /api/accountability/voice/service`: `{ok,status,available,owned,message}`.
- `POST /api/accountability/voice/service` mit `{operation:"start"}` oder
  `{operation:"stop"}`; Mutation erfordert denselben Origin.
- Start meldet zunaechst `status:"starting"`. Die Oberflaeche fragt den GET-Status ab, bis
  `ready` oder `error` eintritt. HTTP-Erfolg allein bedeutet keine Bereitschaft.
- `GET /api/accountability/voice/status` liefert die eigenen Profile und separat
  `voicebox.synthesis:{available,model,message}`.
- `GET /api/accountability/voice/model` liefert den reloadfaehigen Einrichtungsstand als
  `setup`: `state` (`missing`, `downloading`, `ready`, `canceled`, `error`), feste
  Modellmetadaten, Ressourcenhinweis sowie `canDownload`, `canCancel`, `modelReady` und
  `canAttemptSynthesis`. Die letzten beiden bestaetigen nur die Modelldateien, keinen
  RAM-, Klang- oder Audioerfolg.
- `GET /api/accountability/voice/model/progress` reicht den vorhandenen
  Voicebox-SSE-Stream gleichen Ursprungs durch; solange Voicebox keine Zahlen meldet,
  bleibt `setup.progress.indeterminate:true` statt eines erfundenen Prozentwerts.
- `POST /api/accountability/voice/model` mit `{operation:"download"}` startet
  ausschliesslich den Download von `qwen-tts-0.6B` in den isolierten Cache;
  `{operation:"cancel"}` bricht ihn ab. Beide Mutationen erfordern denselben Origin.
- `POST /api/accountability/voice/profiles` akzeptiert optional `language:"de"` oder
  `language:"en"`; ohne Feld bleibt Deutsch der Default.

Cortana und Jarvis sind feste Preset-Optionen. Solange ihr lokaler Klon
(Voicebox/Qwen) kein geprueftes Referenzprofil und Synthesemodell hat, zeigen sie einen
ehrlichen Nicht-bereit-Status und geben nie eine andere Stimme als Original aus. Die
abgelehnten Alt-Assets (`drycen`, `jgkawell`, `lux`) bleiben gesperrt: ihre frueheren
Referenz- und Sample-URLs antworten mit HTTP 410.

## Pruefung

```powershell
# Modellfreie Regressionen (brauchen den Dashboard-Quellbaum; nicht Teil der Auslieferung)
node --test voice/profile-service.test.mjs voice/provider-contract.test.mjs voice/regression.test.mjs voice/web-start.test.mjs voice/own-voice-model.test.mjs voice/coaching-topic.test.mjs

# Flag- und Discovery-Vertrag der Starter
node --test test/voice-sidecar.test.js

# Nach Ressourcenabstimmung: echte neutrale Piper-Ausgabe in Whisper-Erkennung
node voice/verify-local.mjs
```

Automatische Audiotests sind keine menschliche Hoerpruefung. Klangqualitaet und eine echte
menschliche Mikrofonaufnahme sind durch diese Tests nicht belegt.
