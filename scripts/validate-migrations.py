from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "database" / "migrations"
NAME_RE = re.compile(r"^(?P<stamp>\d{14})_[a-z0-9_]+\.sql$")

errors: list[str] = []
seen_stamps: dict[str, str] = {}
files = sorted(MIGRATIONS.glob("*.sql"))

if not files:
    errors.append("No SQL migrations found.")

for path in files:
    match = NAME_RE.match(path.name)
    if not match:
        errors.append(f"{path.name}: expected YYYYMMDDHHMMSS_snake_case.sql")
        continue

    stamp = match.group("stamp")
    if stamp in seen_stamps:
        errors.append(f"Duplicate migration timestamp {stamp}: {seen_stamps[stamp]} and {path.name}")
    seen_stamps[stamp] = path.name

    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        errors.append(f"{path.name}: not valid UTF-8")
        continue

    if not text.strip():
        errors.append(f"{path.name}: empty migration")
    if any(token in text for token in ("<<<<<<<", "=======", ">>>>>>>")):
        errors.append(f"{path.name}: unresolved merge conflict marker")
    if re.search(r"\bDROP\s+DATABASE\b", text, flags=re.IGNORECASE):
        errors.append(f"{path.name}: DROP DATABASE is forbidden in tracked migrations")

if files:
    stamps = [NAME_RE.match(p.name).group("stamp") for p in files if NAME_RE.match(p.name)]
    if stamps != sorted(stamps):
        errors.append("Migration filenames are not monotonically ordered.")

if errors:
    print("Migration integrity FAILED:")
    for error in errors:
        print(f" - {error}")
    sys.exit(1)

print(f"Migration integrity OK: {len(files)} migration(s), unique timestamps, UTF-8, no conflict markers.")