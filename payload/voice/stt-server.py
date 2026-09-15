"""Bounded loopback-only faster-whisper service using an existing local model."""
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import io
import json
import os
import threading
import time

MODEL = Path(os.environ["KEEL_VOICE_STT_MODEL"]).resolve()
LIMIT = 8 * 1024 * 1024
state = {"service": "keel-v4-stt", "available": False, "message": "Lokale Spracherkennung lädt.", "model": "faster-whisper base", "device": "cpu", "computeType": "int8", "languages": ["de", "en"], "local": True, "processId": os.getpid()}
lock = threading.Lock()
model = None

def load():
    global model
    began = time.perf_counter()
    try:
        import numpy as np
        from faster_whisper import WhisperModel
        model = WhisperModel(str(MODEL), device="cpu", compute_type="int8", cpu_threads=2, num_workers=1, local_files_only=True)
        segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="de", beam_size=1)
        list(segments)
        state.update(available=True, message="Lokale Spracherkennung bereit.", loadMs=round((time.perf_counter() - began) * 1000))
    except Exception as error:
        state.update(available=False, message=f"Spracherkennung nicht bereit: {error}")
    print(json.dumps(state, ensure_ascii=False), flush=True)

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def reply(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def do_GET(self):
        self.reply(200 if state["available"] else 503, {**state, "busy": lock.locked()}) if self.path == "/status" else self.reply(404, {"error": {"message": "Unbekannter Sprachweg."}})

    def do_POST(self):
        if self.path == "/shutdown":
            if not os.environ.get("KEEL_VOICE_SERVICE_TOKEN") or self.headers.get("x-keel-service-token") != os.environ.get("KEEL_VOICE_SERVICE_TOKEN"):
                self.reply(403, {"error": {"message": "Nur der eigene Starter darf diesen Dienst beenden."}})
                return
            self.reply(202, {"stopping": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if self.path != "/transcribe":
            self.reply(404, {"error": {"message": "Unbekannter Sprachweg."}})
            return
        if not state["available"]:
            self.reply(503, {"error": {"code": "stt_not_ready", "message": state["message"]}})
            return
        if not lock.acquire(blocking=False):
            self.reply(429, {"error": {"code": "stt_busy", "message": "Eine vorherige Aufnahme wird noch beendet. Bitte gleich erneut sprechen."}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > LIMIT:
                self.reply(413, {"error": {"message": "Eine Aufnahme muss zwischen 1 Byte und 8 MB groß sein."}})
                return
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data;"):
                self.reply(415, {"error": {"message": "Audio als multipart/form-data erforderlich."}})
                return
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Die Aufnahme wurde vorzeitig abgebrochen.")
            form = BytesParser(policy=default).parsebytes(("Content-Type: " + content_type + "\r\n\r\n").encode() + body)
            audio, language = None, "auto"
            for part in form.iter_parts():
                name = part.get_param("name", header="content-disposition")
                if name == "file": audio = part.get_payload(decode=True)
                elif name == "language": language = part.get_payload(decode=True).decode("utf-8").strip()
            if language not in ("auto", "de", "en") or not audio:
                self.reply(400, {"error": {"message": "Audio und eine gültige Gesprächssprache sind erforderlich."}})
                return
            from faster_whisper.audio import decode_audio
            started = time.perf_counter()
            samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
            duration = len(samples) / 16000
            if not 0.1 <= duration <= 30:
                self.reply(413, {"error": {"message": "Eine Äußerung muss zwischen 0,1 und 30 Sekunden dauern."}})
                return
            segments, info = model.transcribe(samples, language=None if language == "auto" else language, beam_size=3, best_of=1, vad_filter=True, vad_parameters={"min_silence_duration_ms": 350}, condition_on_previous_text=False)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            if info.language not in ("de", "en") or not text:
                self.reply(422, {"error": {"code": "empty_transcription", "message": "Keine verständliche deutsche oder englische Äußerung erkannt. Bitte erneut sprechen."}})
                return
            self.reply(200, {"text": text, "language": info.language, "duration": duration, "elapsedMs": round((time.perf_counter() - started) * 1000), "model": state["model"], "local": True})
        except Exception as error:
            self.reply(422, {"error": {"code": "invalid_audio", "message": f"Die Aufnahme konnte nicht verarbeitet werden: {error}"}})
        finally:
            lock.release()

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("KEEL_STT_PORT", "4298"))), Handler)
    threading.Thread(target=load, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
