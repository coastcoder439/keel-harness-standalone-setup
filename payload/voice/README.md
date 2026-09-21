# Sprachlaufzeit des Harness (`voice/`)

Dieser Ordner ist ein Sidecar neben `dashboard/` und `roles/`. Er gehoert NICHT in den
Next-Build: `dashboard/serve.mjs` importiert `voice/launcher.mjs` beim Start, und
`dashboard/lib/companion/profile-service.ts` laedt `voice/profile-service.mjs` erst zur
Laufzeit ueber `KEEL_VOICE_SIDECAR_ROOT`.

**Es gibt genau einen Sprachdienst: Voicebox** (Plan
`docs/packages/focus-dashboard-v4/design/voicebox-integration-2026-09-21.md`). Stimme
(`/generate`), Hoeren (`/transcribe`), Profile und Modelle laufen ueber Voicebox' eigene
HTTP-API auf `127.0.0.1:4299`. Der Sidecar startet nur noch die installierte Voicebox in
einem begrenzten Windows-Job — auf dem **Datenverzeichnis der Voicebox-App**, damit App und
Dashboard dieselben Profile sehen. Entfernt sind: Piper (A14), der eigene Whisper-Dienst
(`stt-server.py`, Port 4298, `start.mjs`), die Privatkopie `runtime/voice/character-data`
und der eigene Modelldownload (`own-voice-model.ts`, Route `/voice/model`).

## Bedienung

Aus dem Harness-Wurzelverzeichnis:

```powershell
node voice/check.mjs                      # Installationsstand + ob Voicebox laeuft; startet nichts
node voice/check.mjs --require-ready      # Exitcode 1, wenn Voicebox nicht laeuft
node voice/migrate-profiles.mjs           # Cortana/Jarvis einmalig in die App-Datenbank uebernehmen (idempotent)
node dashboard/serve.mjs --voice          # Dashboard auf 127.0.0.1:4190, Sprach-Routen frei
```

Flags (identisch im Quellbaum und in der installierten Auslieferung):

| Flag | Wirkung |
| --- | --- |
| `--voice` | Sprachausgabe und Mikrofon-Routen frei |
| `--speech` | nur Sprachausgabe frei |
| `--microphone` | nur Hoeren (Transkription) frei |
| `--no-inference` | KI pausieren (ohne Flag ist die KI AN) |

Kein Flag startet einen Dienst: Voicebox startet aus dem Dashboard heraus (Knopf
„Stimmendienst starten“ bzw. `POST /api/accountability/voice/service {operation:"start"}`)
und wird beim Stop wieder beendet. Der Starter setzt fuer den Dashboard-Kindprozess
`KEEL_PROTOTYPE_ROOT`, `KEEL_VOICE_ROOT`, `KEEL_VOICE_SIDECAR_ROOT`, `KEEL_PROTOTYPE_SPEECH`,
`KEEL_PROTOTYPE_MICROPHONE`, `KEEL_PROTOTYPE_INFERENCE`, `ACCOUNTABILITY_VOICEBOX_URL` und
`KEEL_ROLE_PROFILE_ROOT`.

## Eine Datenbank, ein Modell-Cache

Gemessen 21.09.2026 (Windows): die Voicebox-App startet ihren Server mit
`--data-dir %APPDATA%\sh.voicebox.app` (dort `voicebox.db`, `profiles/`, `generations/`) und
haelt ihre Modelle im Standard-Cache von huggingface_hub (`%USERPROFILE%\.cache\huggingface\hub`,
App-Antwort auf `GET /models/cache-dir`). Der Harness startet `voicebox-server.exe` auf GENAU
diesem Verzeichnis und laesst den Cache unangetastet — Profile, Samples und Modelle sind in
App und Dashboard dieselben Zeilen bzw. Dateien. Laeuft die App gleichzeitig (ihr Server auf
`127.0.0.1:17493`), teilen sich beide Prozesse dieselbe SQLite-Datei.

| Variable | Setzt | Standard |
| --- | --- | --- |
| `KEEL_VOICEBOX_DATA_DIR` | Datenverzeichnis (voicebox.db) | `%APPDATA%\sh.voicebox.app` |
| `KEEL_VOICEBOX_MODELS_DIR` | Modell-Cache (wird als `HF_HUB_CACHE` an Voicebox gereicht) | huggingface-Standard (`HF_HUB_CACHE` → `HF_HOME/hub` → `~/.cache/huggingface/hub`) |
| `KEEL_VOICEBOX_BINARY` | `voicebox-server.exe` | `%LOCALAPPDATA%\Voicebox\voicebox-server.exe` |
| `KEEL_VOICE_PYTHON` | Python fuer den begrenzten Windows-Job (`profile-process.py`) | `<VOICE>/voicebox-env/Scripts/python.exe`, Fallback aeltere Envs |
| `KEEL_VOICE_ROOT` | Schreibwurzel des Harness (Log, `hearing.json`, `tmp/`) | `<harness>/runtime/voice` |
| `KEEL_VOICE_SIDECAR_ROOT` | dieser Ordner | `<KEEL_HARNESS_ROOT>/voice` |
| `KEEL_VOICEBOX_JOB_MIB` | Commit-Grenze des Prozessbaums (2560–16384) | 10240 |

Kein Offline-Zwang mehr (`HF_HUB_OFFLINE` wird fuer den Kindprozess entfernt): Downloads
laufen ausschliesslich ueber Voicebox' eigene Endpunkte, angestossen aus dem Dashboard
(`POST /api/accountability/voice/models {operation:"download"}`). Profilstart und Statuspruefung
laden nichts.

Migration (einmalig, 21.09.2026): `node voice/migrate-profiles.mjs` legt Cortana und Jarvis mit
je einer Referenz (Quelle `focus-dashboard-v4/runtime/voice/references`, Texte aus
`manifest.json`) in der App-Datenbank an und setzt `default_engine: chatterbox` (Owner 21.09.:
Klonstimmen laufen ueber Chatterbox Multilingual; `luxtts` ist nur Englisch und kuerzt Saetze,
Qwen-TTS-Base hat hier keinen Einsatz — beide geloescht). Die Privatkopie der Datenbank liegt
stillgelegt unter `runtime/voice/character-data.stillgelegt-2026-09-21`.

## Modelle und Engines

`GET /api/accountability/voice/models` reicht Voicebox' `/models/status` durch, je Modell mit
`role` (`tts` | `stt` | `llm`) und `recommendation` (ein Satz aus der Plan-Tabelle, sonst leer).
`POST {operation:"download"|"load", model_name}` leitet an `/models/download` bzw.
`/models/load` weiter; Laden per Aufruf gibt es in Voicebox 0.5.0 nur fuer Qwen TTS, alle
anderen Engines laedt Voicebox beim ersten Sprechen selbst (die Route meldet das mit
`voice_model_load_on_demand`).

Genau drei Sprech-Modelle sind im Einsatz (Owner 21.09.2026, alle mehrsprachig inkl. Deutsch;
`ALLOWED_MODELS` in `dashboard/lib/companion/voicebox-models.ts` filtert die Liste und verhindert,
dass geloeschte Modelle wieder angeboten werden):

- `chatterbox-tts` (Chatterbox Multilingual) — Engine `chatterbox`: eigene Stimme, Cortana, Jarvis
  (Klon aus der Referenz, Emotion-Staerke). Gemessen 21.09.2026 auf CPU: englischer Satz vollstaendig
  (4,2 s Audio in 45 s), deutscher Satz verstaendlich (3,9 s Audio in 26 s).
- `qwen-custom-voice-0.6B` / `qwen-custom-voice-1.7B` — Engine `qwen_custom_voice`: fertige
  Preset-Stimmen mit Sprechanweisung, ohne Referenzaufnahme.

Nur-englische Modelle (LuxTTS, Chatterbox Turbo, TADA 1B) und Qwen-TTS-Base werden weder
gelistet noch geladen. `POST /api/accountability/voice/speak` prueft die Bereitschaft GENAU der
Profil-Engine ueber `/models/status` und sendet `engine` an `/generate`.

## Hoeren (Whisper in Voicebox)

Die Hoerstufe liegt weiter als `runtime/voice/hearing.json` `{variant}` (IDs bleiben die
faster-whisper-Namen, damit gespeicherte Wahlen gueltig bleiben):

| Stufe | `variant` | Voicebox-Modell | `/transcribe model=` |
| --- | --- | --- | --- |
| Schnell | `base` | `whisper-base` | `base` |
| Genau | `large-v3-turbo` | `whisper-turbo` | `turbo` |

Gemessen 21.09.2026 gegen Voicebox 0.5.0: `POST /transcribe` nimmt `model` als Groesse
(`base|small|medium|large|turbo`), `language` nur konkret (`de`/`en`; weggelassen erkennt Whisper
selbst) und antwortet `{text, duration}` ohne erkannte Sprache. Bei Gespraechssprache „auto“
schaetzt `transcribeVoiceboxAudio` die Sprache aus dem Text (`guessTranscriptLanguage`,
deutsche/englische Funktionswoerter) und markiert das mit `languageGuessed:true`. Ein
Wechsel der Stufe wirkt beim naechsten Hoeren; Whisper base lud kalt in ≈3,6 s, warm ≈0,7 s.
`GET /api/prototype/status` meldet `transcription.service:"voicebox"` mit Modell und Stand.

Die Umgebungsvariable `KEEL_VOICE_STT_VARIANT` erzwingt eine Stufe; `KEEL_PROTOTYPE_STT_URL`,
`KEEL_VOICE_STT_PYTHON` und `KEEL_VOICE_STT_MODEL` sind ohne Wirkung (entfernt).

## Einrichtungshilfe

Die Pruefung liegt in `install-report.mjs` (`installationReport(env)`, `voiceModelReport(env)`,
`hearingModelReport(env, variant)`). `check.mjs` gibt sie auf der Konsole aus, und
`GET /api/accountability/voice/setup` liefert sie dem Dashboard. Geprueft werden nur Dateien:
Binary, Python, Datenverzeichnis (`voicebox.db` vorhanden?), Modell-Cache; welche Modelle
Voicebox als heruntergeladen fuehrt, sagt der laufende Dienst (`/models/status`). Das Feld
`microphone` bleibt fuer die Oberflaeche: installiert = Voicebox installiert UND das Whisper-Repo
der gewaehlten Stufe liegt im Cache. Nichts wird gestartet oder geladen.

## Eigene Stimmen und Stimmendienst

`profile-service.mjs` startet das installierte Binary ueber `profile-process.py`
(`--data-dir` = Datenverzeichnis der App). Der Windows-Job begrenzt den Prozessbaum auf zwei
CPU-Kerne und standardmaessig 10240 MiB zugesicherten Speicher (`KEEL_VOICEBOX_JOB_MIB`,
geklemmt auf 2560–16384). Der Start braucht mindestens 3 GiB freien Arbeitsspeicher, wartet
hoechstens 60 Sekunden auf Bereitschaft und beendet bei Fehler den selbst gestarteten Prozess.
Ein laufender fremder Dienst wird nicht beendet.

Der Vertrag:

- `GET /api/accountability/voice/service`: `{ok,status,available,owned,message}`;
  `POST` mit `{operation:"start"|"stop"}`, Mutation erfordert denselben Origin. Start meldet
  zunaechst `status:"starting"`; die Oberflaeche fragt den GET-Status ab, bis `ready` oder `error`.
- `GET /api/accountability/voice/status` liefert die Profile und `voicebox.synthesis`
  (Chatterbox Multilingual in Voicebox vorhanden?).
- `GET|POST /api/accountability/voice/models` — siehe „Modelle und Engines“.
- `GET|POST /api/accountability/voice/hearing` — Stufe lesen/setzen, Stand laut Voicebox.
- `POST /api/accountability/voice/transcribe` — Hoeren ueber Voicebox (`provider:"local"`) oder
  den eingerichteten Online-Dienst (`provider:"online"`).
- `POST /api/accountability/voice/profiles` akzeptiert optional `language:"de"` oder
  `language:"en"`; ohne Feld bleibt Deutsch der Default. Neue Profile bekommen `default_engine:"chatterbox"`.

Cortana und Jarvis sind feste Preset-Optionen; sie sprechen nur ueber ihr eigenes Klonprofil
mit Referenzaufnahme und der Engine des Profils, nie mit einer anderen Stimme. Die abgelehnten
Alt-Assets (`drycen`, `jgkawell`, `lux`) bleiben gesperrt (HTTP 410).

## Latenz

Die Grenzwerte stehen in `dashboard/lib/companion/latency-limits.ts` und gespiegelt in
`latency-run.mjs` (`LATENCY_LIMITS`); ein Test vergleicht beide Zahl fuer Zahl.

| Fall | Ziel | langsam ab | zu langsam ab |
| --- | --- | --- | --- |
| bis hoerbare Stimme | 1000 ms | 1500 ms | 3000 ms |
| bis vollstaendige Antwort | 6000 ms | 6000 ms | 10000 ms |

Die Live-Mess-Runden von `latency-run.mjs` stammten aus dem entfernten Piper-Weg (A14) und sind
stillgelegt; die Auswertungsfunktionen bleiben in Gebrauch und getestet (`voice/latency-run.test.mjs`).

## Pruefung

```powershell
# Modellfreie Regressionen (brauchen den Dashboard-Quellbaum; nicht Teil der Auslieferung)
node --test voice/*.test.mjs

# Flag- und Discovery-Vertrag der Starter
node --test test/voice-sidecar.test.js
```

Automatische Audiotests sind keine menschliche Hoerpruefung. Klangqualitaet und eine echte
menschliche Mikrofonaufnahme sind durch diese Tests nicht belegt.
