from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class SelectorProfileError(RuntimeError):
    pass


@dataclass(frozen=True)
class Locator:
    by: str
    value: str


class SelectorProfile:
    def __init__(self, path: Path):
        if not path.exists():
            raise SelectorProfileError("SELECTOR PROFILE REQUIRED: run physical-phone calibration before verification.")
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("project") != "project-rekhya" or payload.get("schema_version") != 1:
            raise SelectorProfileError("Selector profile does not belong to Project Rekhya schema version 1.")
        self.payload = payload

    def locators(self, key: str) -> list[Locator]:
        values = self.payload.get("selectors", {}).get(key)
        if not values:
            raise SelectorProfileError(f"Required calibrated selector is missing: {key}")
        return [Locator(by=item["by"], value=item["value"]) for item in values]

    def region(self, key: str) -> tuple[int, int, int, int]:
        value = self.payload.get("regions", {}).get(key)
        if not isinstance(value, list) or len(value) != 4:
            raise SelectorProfileError(f"Required calibrated screen region is missing: {key}")
        return tuple(int(part) for part in value)
