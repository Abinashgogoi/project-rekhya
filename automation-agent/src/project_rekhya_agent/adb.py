from __future__ import annotations

import subprocess
from dataclasses import asdict, dataclass


class DeviceError(RuntimeError):
    pass


@dataclass(frozen=True)
class PreflightResult:
    device_connected: bool
    adb_authorized: bool
    sim_detected: bool
    official_app_ready: bool
    internet_ready: bool
    device_serial: str | None
    problems: tuple[str, ...]

    def as_dict(self):
        return asdict(self)


class AdbDevice:
    def __init__(self, serial: str | None = None, adb: str = "adb"):
        self.serial = serial
        self.adb = adb

    def _run(self, *arguments: str, timeout: int = 20, check: bool = True) -> str:
        command = [self.adb]
        if self.serial:
            command.extend(["-s", self.serial])
        command.extend(arguments)
        completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        if check and completed.returncode:
            raise DeviceError((completed.stderr or completed.stdout).strip() or "ADB command failed")
        return completed.stdout.strip()

    def preflight(self, package: str) -> PreflightResult:
        problems: list[str] = []
        devices = self._run("devices", "-l", check=False).splitlines()[1:]
        candidates = [line for line in devices if line.strip()]
        if self.serial:
            candidates = [line for line in candidates if line.startswith(self.serial)]
        connected = bool(candidates)
        authorized = connected and any(" device " in f" {line} " for line in candidates)
        serial = self.serial or (candidates[0].split()[0] if candidates else None)
        if not connected:
            problems.append("ANDROID DEVICE NOT CONNECTED")
        elif not authorized:
            problems.append("ADB NOT AUTHORIZED")
        if not authorized:
            return PreflightResult(connected, False, False, False, False, serial, tuple(problems))
        if not self.serial:
            self.serial = serial
        sim_state = self._run("shell", "getprop", "gsm.sim.state", check=False).upper()
        sim_detected = any(state in sim_state for state in ("READY", "LOADED", "IMSI"))
        if not sim_detected:
            problems.append("SIM 1 NOT DETECTED")
        package_ready = bool(self._run("shell", "pm", "path", package, check=False))
        if not package_ready:
            problems.append("OFFICIAL APP NOT INSTALLED")
        connectivity = self._run("shell", "dumpsys", "connectivity", check=False).lower()
        internet_ready = "validated" in connectivity or "state: connected" in connectivity
        if not internet_ready:
            problems.append("PHONE INTERNET NOT VERIFIED")
        return PreflightResult(True, True, sim_detected, package_ready, internet_ready, serial, tuple(problems))

    def start_settings(self):
        self._run("shell", "am", "start", "-a", "android.settings.NETWORK_OPERATOR_SETTINGS")

    def screenshot(self, destination: str):
        with open(destination, "wb") as output:
            command = [self.adb]
            if self.serial:
                command.extend(["-s", self.serial])
            command.extend(["exec-out", "screencap", "-p"])
            completed = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, timeout=30, check=False)
        if completed.returncode:
            raise DeviceError(completed.stderr.decode(errors="replace"))
