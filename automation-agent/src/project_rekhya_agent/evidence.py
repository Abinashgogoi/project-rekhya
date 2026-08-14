from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class EvidenceStore:
    CATEGORIES = {"identity": "01_Login_Identity", "dashboard": "02_Dashboard", "unpaid": "03_Unpaid_List", "outside_range": "04_Pre_Cutoff_or_Outside_Range", "errors": "05_Errors"}

    def __init__(self, root: Path):
        self.root = root.resolve()

    def account_dir(self, user_id: str, name: str) -> Path:
        safe_id = "".join(character for character in user_id if character.isalnum() or character in "-_")
        safe_name = "_".join("".join(character for character in part if character.isalnum()) for part in name.split())[:60]
        path = self.root / f"{safe_id}_{safe_name or 'Unknown'}"
        for directory in self.CATEGORIES.values():
            (path / directory).mkdir(parents=True, exist_ok=True)
        return path

    def screenshot_path(self, user_id: str, name: str, category: str, label: str) -> Path:
        directory = self.account_dir(user_id, name) / self.CATEGORIES[category]
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        safe_label = "_".join(label.split())
        return directory / f"{stamp}_{safe_label}.png"

    def write_metadata(self, user_id: str, name: str, payload: dict[str, Any]) -> Path:
        destination = self.account_dir(user_id, name) / "verification_metadata.json"
        destination.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        return destination

    @staticmethod
    def sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()
