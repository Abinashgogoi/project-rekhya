from __future__ import annotations

import shutil
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse


class AppiumServiceError(RuntimeError):
    pass


class AppiumService:
    """Ensure a local Appium server exists before creating a WebDriver session."""

    def __init__(self, url: str, log_path: Path | None = None):
        self.url = url
        self.log_path = log_path or Path("appium-agent.log")
        self.process: subprocess.Popen | None = None

    def _target(self) -> tuple[str, int]:
        parsed = urlparse(self.url)
        return parsed.hostname or "127.0.0.1", parsed.port or 4723

    def ready(self, timeout: float = 0.8) -> bool:
        host, port = self._target()
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            return False

    def ensure_started(self, timeout: int = 35) -> bool:
        if self.ready():
            return False

        host, _ = self._target()
        if host not in {"127.0.0.1", "localhost", "0.0.0.0"}:
            raise AppiumServiceError(
                f"Appium is unreachable at {self.url}. Automatic start is only allowed for a local Appium URL."
            )

        executable = shutil.which("appium.cmd") or shutil.which("appium")
        if not executable:
            raise AppiumServiceError(
                "Appium is not running and the 'appium' executable was not found in PATH."
            )

        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        log = self.log_path.open("a", encoding="utf-8")
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        self.process = subprocess.Popen(
            [executable],
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            creationflags=creationflags,
        )

        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.ready():
                return True
            if self.process.poll() is not None:
                raise AppiumServiceError(
                    f"Appium exited while starting. Check {self.log_path}."
                )
            time.sleep(0.5)

        raise AppiumServiceError(
            f"Appium did not become ready at {self.url} within {timeout} seconds. Check {self.log_path}."
        )
