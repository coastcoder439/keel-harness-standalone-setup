"""Read the installed PyInstaller archive index without executing bundled code."""
import json
import argparse
import dis
import marshal
import os
from pathlib import Path
import struct
import types
import zlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", default=os.environ.get("KEEL_VOICEBOX_BINARY", str(Path(os.environ["LOCALAPPDATA"]) / "Voicebox" / "voicebox-server.exe")))
args = parser.parse_args()
binary = Path(args.binary)
with binary.open("rb") as handle:
    handle.seek(-min(binary.stat().st_size, 65536), 2)
    tail = handle.read()
    marker = tail.rfind(b"MEI\x0c\x0b\x0a\x0b\x0e")
    if marker < 0:
        raise RuntimeError("No readable PyInstaller cookie; binary was not executed.")
    cookie_at = binary.stat().st_size - len(tail) + marker
    cookie = struct.unpack("!8sIIII64s", tail[marker:marker + 88])
    archive_at = cookie_at + 88 - cookie[1]
    handle.seek(archive_at + cookie[2])
    toc = handle.read(cookie[3])
    entries = []
    offset = 0
    while offset < len(toc):
        length, position, compressed, uncompressed, compression, kind = struct.unpack("!iIIIBc", toc[offset:offset + 18])
        name = toc[offset + 18:offset + length].rstrip(b"\0").decode("utf8", "replace")
        entries.append((name, position, compressed, kind.decode()))
        offset += length
    pyz = next(item for item in entries if item[3] == "z")
    handle.seek(archive_at + pyz[1])
    header = handle.read(12)
    toc_offset = struct.unpack("!i", header[8:12])[0]
    handle.seek(archive_at + pyz[1] + toc_offset)
    index = marshal.loads(handle.read(pyz[2] - toc_offset))
    modules = list(dict(index))
    expected = ["backend.config", "torch", "torchaudio", "transformers", "onnxruntime"]
    constants = {}
    loader_code = {}
    download_code = {}
    def strings(code):
        found = []
        for value in code.co_consts:
            if isinstance(value, str) and len(value) < 220:
                found.append(value)
            elif isinstance(value, types.CodeType):
                found.extend(strings(value))
        return found
    model_api_modules = [name for name in modules if name.startswith("backend.") and any(term in name.lower() for term in ("model", "download", "progress"))]
    inspected = ["backend.backends.pytorch_backend", "torch.version", *model_api_modules]
    inspected += [name for name in modules if name.startswith("backend.backends.") and "qwen" in name]
    for name in inspected:
        if name not in modules:
            continue
        entry = dict(index)[name]
        handle.seek(archive_at + pyz[1] + entry[1])
        code = marshal.loads(zlib.decompress(handle.read(entry[2])))
        constants[name] = sorted(set(strings(code)))
        def inspect_downloads(item):
            if "download" in item.co_name.lower():
                download_code[f"{name}:{item.co_qualname}"] = [{"op": op.opname, "arg": op.argrepr} for op in dis.get_instructions(item)]
            for child in item.co_consts:
                if isinstance(child, types.CodeType):
                    inspect_downloads(child)
        inspect_downloads(code)
        if name == "backend.backends.pytorch_backend":
            def inspect_loaders(item):
                if item.co_name in ("<module>", "_load_model_sync", "_get_device"):
                    loader_code[item.co_qualname] = [{"op": op.opname, "arg": op.argrepr} for op in dis.get_instructions(item)]
                for child in item.co_consts:
                    if isinstance(child, types.CodeType):
                        inspect_loaders(child)
            inspect_loaders(code)
    metadata = [entry[0] for entry in entries if any(term in entry[0].lower() for term in ["librosa-", "numba-"]) and entry[0].endswith("METADATA")]
    print(json.dumps({"binary": str(binary), "bytes": binary.stat().st_size, "pythonVersion": cookie[4], "modules": {name: name in modules for name in expected}, "backends": [name for name in modules if name.startswith("backend.backends.")], "modelApiModules": model_api_modules, "qwenModules": [name for name in modules if name.startswith("qwen_tts.")], "packageMetadata": metadata, "loaderConstants": constants, "pytorchLoaderBytecode": loader_code, "downloadBytecode": download_code, "executed": False}, indent=2))
