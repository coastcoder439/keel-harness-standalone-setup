"""Warm installed neutral voices. All generated data belongs to V4."""
import json
import sys
import time
import wave
import os
from pathlib import Path
from piper import PiperVoice
from piper.config import PiperConfig
import onnxruntime

specs = json.loads(sys.argv[1])
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
voices, variants = {}, []
started = time.perf_counter()
for spec in specs:
    variant = {key: value for key, value in spec.items() if key != "model"}
    try:
        if not spec.get("model"):
            raise ValueError("Das lokale Modell fehlt.")
        settings = onnxruntime.SessionOptions()
        settings.intra_op_num_threads = 2
        settings.inter_op_num_threads = 1
        settings.enable_cpu_mem_arena = False
        config = json.loads(Path(spec["model"] + ".json").read_text(encoding="utf-8"))
        voices[spec["id"]] = PiperVoice(config=PiperConfig.from_dict(config), session=onnxruntime.InferenceSession(spec["model"], sess_options=settings, providers=["CPUExecutionProvider"]), download_dir=output)
        variant["available"] = True
    except Exception as error:
        variant.update(available=False, error=str(error))
    variants.append(variant)
print(json.dumps({"ready": bool(voices), "variants": variants, "workerProcessId": os.getpid(), "loadMs": round((time.perf_counter() - started) * 1000)}), flush=True)
for line in sys.stdin:
    job = {}
    try:
        job = json.loads(line)
        identifier = job["id"]
        if not isinstance(identifier, str) or not identifier.startswith("piper-") or not all(c.isalnum() or c == "-" for c in identifier):
            raise ValueError("Ungültige Ausgabe-ID.")
        text = job["text"]
        if not isinstance(text, str) or not 0 < len(text.strip()) <= 1200:
            raise ValueError("Der Text muss zwischen 1 und 1200 Zeichen enthalten.")
        voice = voices.get(job.get("voice"))
        if voice is None:
            raise ValueError("Die gewählte Sprache ist lokal nicht installiert.")
        began = time.perf_counter()
        with wave.open(str(output / (identifier + ".wav")), "wb") as audio:
            voice.synthesize_wav(text.strip(), audio)
        print(json.dumps({"id": identifier, "elapsedMs": round((time.perf_counter() - began) * 1000)}), flush=True)
    except Exception as error:
        print(json.dumps({"id": job.get("id"), "error": str(error)}), flush=True)
