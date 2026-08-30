from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HEALTH_URL = "http://127.0.0.1:8765/health"


def _runtime_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "ProjectRekhya"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with (_runtime_dir() / "launcher.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[{stamp}] {message}\n")


def _agent_ready(timeout: float = 0.8) -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def _revive_existing_agent(timeout: float = 8.0) -> bool:
    try:
        request = urllib.request.Request(
            "http://127.0.0.1:8765/preflight",
            data=b"",
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except Exception as error:
        _log(f"Existing agent revive failed: {type(error).__name__}: {error}")
        return False


def _augmented_env() -> dict[str, str]:
    env = os.environ.copy()
    candidates = [
        Path(env.get("APPDATA", "")) / "npm",
        Path(env.get("LOCALAPPDATA", "")) / "Android" / "Sdk" / "platform-tools",
        Path.home() / "AppData" / "Local" / "Android" / "Sdk" / "platform-tools",
        Path("C:/platform-tools"),
    ]
    existing = env.get("PATH", "").split(os.pathsep)
    additions = [str(path) for path in candidates if str(path) and path.exists()]
    env["PATH"] = os.pathsep.join(additions + existing)
    return env


def _start_agent() -> None:
    if _agent_ready():
        if _revive_existing_agent():
            _log("Existing agent healthy and background loops revived.")
            return
        _log("Existing agent answered /health but revive failed.")
        return

    agent_root = Path(__file__).resolve().parents[2]
    python = agent_root / ".venv" / "Scripts" / "python.exe"
    if not python.exists():
        _log(f"Python executable missing: {python}")
        raise RuntimeError(f"Project Rekhya Python executable not found: {python}")

    env = _augmented_env()
    background_log = _runtime_dir() / "agent-background.log"
    log_handle = background_log.open("a", encoding="utf-8")

    flags = 0
    if sys.platform == "win32":
        flags = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )

    _log(f"Starting agent with cwd={agent_root}")
    process = subprocess.Popen(
        [str(python), "-c", "from project_rekhya_agent.main import run; run()"],
        cwd=str(agent_root),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        creationflags=flags,
        close_fds=True,
    )

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if _agent_ready():
            _log(f"Agent healthy on port 8765; pid={process.pid}")
            return
        if process.poll() is not None:
            _log(f"Agent exited early with code {process.returncode}; see {background_log}")
            return
        time.sleep(0.4)

    _log(f"Agent health timeout after 20 seconds; pid={process.pid}; see {background_log}")


def main() -> None:
    uri = sys.argv[1] if len(sys.argv) > 1 else "rekhya://prepare"
    if not uri.lower().startswith("rekhya://"):
        _log(f"Ignored unsupported URI: {uri}")
        return
    try:
        _start_agent()
    except Exception as error:
        _log(f"Launcher error: {type(error).__name__}: {error}")


if __name__ == "__main__":
    main()
