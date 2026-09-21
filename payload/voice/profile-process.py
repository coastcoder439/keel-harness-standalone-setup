"""Own a bounded Windows Job Object; closing this wrapper stops only its children."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
parser.add_argument("--port", type=int, default=4299)
# Datenverzeichnis der Voicebox-App (voicebox.db, profiles/, generations/). Plan Schritt 1
# (21.09.2026): kein privates character-data mehr; profile-service.mjs reicht den Pfad durch.
parser.add_argument("--data-dir", required=True)
parser.add_argument("--lifetime", type=int, default=300)
args = parser.parse_args()
if os.name != "nt":
    raise RuntimeError("This bounded launcher requires Windows Job Objects.")
# Der Sidecar liegt als <harness>/voice. Die Sprachruntime kommt aus KEEL_VOICE_ROOT
# (gesetzt von voice/config.mjs isolatedVoiceEnvironment); ohne die Variable bleibt
# <harness>/runtime/voice der Standard.
root = Path(os.environ.get("KEEL_VOICE_ROOT") or (Path(__file__).resolve().parents[1] / "runtime" / "voice")).resolve()
root.mkdir(parents=True, exist_ok=True)
kernel = ctypes.WinDLL("kernel32", use_last_error=True)
class BasicLimits(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
class ExtendedLimits(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
kernel.CreateJobObjectW.restype = wintypes.HANDLE
kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
job = kernel.CreateJobObjectW(None, None)
if not job: raise ctypes.WinError(ctypes.get_last_error())
limits = ExtendedLimits()
# Hard commit ceiling for the complete process tree, a CPU affinity mask sized by
# KEEL_VOICEBOX_CPU_CORES (Systemprofil, Paket system-profile 21.09.2026: physische Kerne minus
# zwei; ohne Variable 2 Kerne wie bisher), and KILL_ON_JOB_CLOSE. Libraries can have more idle
# threads, never more CPU cores than the mask allows.
limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x200 | 0x10
try:
    cpu_cores = int(os.environ.get("KEEL_VOICEBOX_CPU_CORES", "2"))
except ValueError:
    cpu_cores = 2
cpu_cores = max(1, min(cpu_cores, os.cpu_count() or 1, 62))
limits.BasicLimitInformation.Affinity = (1 << cpu_cores) - 1
try:
    job_mib = int(os.environ.get("KEEL_VOICEBOX_JOB_MIB", "5120"))
except ValueError:
    job_mib = 5120
job_mib = max(2560, min(16384, job_mib))
limits.JobMemoryLimit = job_mib * 1024 * 1024
if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
    kernel.CloseHandle(job)
    raise ctypes.WinError(ctypes.get_last_error())
stopped = threading.Event()
threading.Thread(target=lambda: (sys.stdin.readline(), stopped.set()), daemon=True).start()
started = time.monotonic()
process = None
try:
    with (root / "profile-server.log").open("a", encoding="utf8") as log:
        process = subprocess.Popen([args.binary, "--parent-pid", str(os.getpid()), "--host", "127.0.0.1", "--port", str(args.port), "--data-dir", str(Path(args.data_dir).resolve())], cwd=root, env=os.environ.copy(), stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        if not kernel.AssignProcessToJobObject(job, wintypes.HANDLE(int(process._handle))):
            process.terminate()
            raise ctypes.WinError(ctypes.get_last_error())
        while process.poll() is None and not stopped.wait(1) and (args.lifetime == 0 or time.monotonic() - started < min(args.lifetime, 600)):
            current = ExtendedLimits()
            kernel.QueryInformationJobObject(job, 9, ctypes.byref(current), ctypes.sizeof(current), None)
            report = {"wrapperPid": os.getpid(), "launcherPid": process.pid, "binary": args.binary, "dataDir": str(Path(args.data_dir).resolve()), "elapsedSeconds": round(time.monotonic() - started, 1), "cpuCores": cpu_cores, "memoryLimitMiB": job_mib, "peakCommitMiB": round(current.PeakJobMemoryUsed / 1048576, 1)}
            (root / "profile-process.json").write_text(json.dumps(report), encoding="utf8")
        if process.poll() is not None and process.returncode:
            raise RuntimeError(f"Profile service exited with {process.returncode}; see profile-server.log.")
finally:
    kernel.CloseHandle(job)
    if process:
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.terminate()
