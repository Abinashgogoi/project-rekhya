from __future__ import annotations

import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HEALTH_URL = "http://127.0.0.1:8765/health"


def _ready(timeout: float = 0.8) -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def _start_agent() -> None:
    if _ready():
        return
    agent_root = Path(__file__).resolve().parents[2]
    executable = agent_root / ".venv" / "Scripts" / "project-rekhya-agent.exe"
    if not executable.exists():
        raise RuntimeError(f"Project Rekhya agent executable not found: {executable}")
    flags = 0
    if sys.platform == "win32":
        flags = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )
    subprocess.Popen(
        [str(executable)], cwd=str(agent_root),
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=flags, close_fds=True,
    )
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _ready():
            return
        time.sleep(0.35)


def main() -> None:
    uri = sys.argv[1] if len(sys.argv) > 1 else "rekhya://prepare"
    if uri.lower().startswith("rekhya://"):
        _start_agent()


if __name__ == "__main__":
    main()
