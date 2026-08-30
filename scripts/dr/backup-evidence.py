from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

url = os.environ.get("PROJECT_REKHYA_SUPABASE_URL", "").rstrip("/")
service_key = os.environ.get("PROJECT_REKHYA_SERVICE_ROLE_KEY", "")
destination_raw = os.environ.get("PROJECT_REKHYA_EVIDENCE_BACKUP_DIR", "")

if not url or not service_key or not destination_raw:
    raise SystemExit(
        "Set PROJECT_REKHYA_SUPABASE_URL, PROJECT_REKHYA_SERVICE_ROLE_KEY and "
        "PROJECT_REKHYA_EVIDENCE_BACKUP_DIR in the secure operator environment."
    )

destination = Path(destination_raw).expanduser().resolve()
repo = Path(__file__).resolve().parents[2]
try:
    destination.relative_to(repo)
except ValueError:
    pass
else:
    raise SystemExit("Evidence backup destination must be outside the public Git repository.")

stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
root = destination / f"project-rekhya-evidence-{stamp}"
root.mkdir(parents=True, exist_ok=True)

headers = {
    "Authorization": f"Bearer {service_key}",
    "apikey": service_key,
}

def request_json(path: str):
    request = urllib.request.Request(f"{url}{path}", headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)

rows = request_json(
    "/rest/v1/evidence_files?"
    + urllib.parse.urlencode({
        "select": "id,storage_provider,storage_bucket,storage_path,object_key,sha256,original_filename,captured_at",
        "order": "captured_at.asc",
        "limit": "10000",
    })
)

manifest = []
errors = []

for index, row in enumerate(rows, 1):
    provider = row.get("storage_provider")
    if provider not in ("supabase", "supabase_storage"):
        errors.append({
            "id": row.get("id"),
            "storage_provider": provider,
            "reason": "Provider requires its own off-site backup mechanism",
        })
        continue

    bucket = row["storage_bucket"]
    object_path = row.get("storage_path") or row.get("object_key")
    encoded = "/".join(urllib.parse.quote(part, safe="") for part in object_path.split("/"))
    object_url = f"{url}/storage/v1/object/authenticated/{urllib.parse.quote(bucket, safe='')}/{encoded}"

    target = root / bucket / object_path
    target.parent.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(object_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response, target.open("wb") as handle:
            digest = hashlib.sha256()
            total = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                digest.update(chunk)
                total += len(chunk)
    except Exception as exc:
        errors.append({"id": row.get("id"), "path": object_path, "reason": str(exc)})
        continue

    actual_hash = digest.hexdigest()
    expected_hash = row.get("sha256")
    if expected_hash and expected_hash.lower() != actual_hash:
        errors.append({"id": row.get("id"), "path": object_path, "reason": "SHA256 mismatch"})

    manifest.append({
        "id": row.get("id"),
        "bucket": bucket,
        "path": object_path,
        "bytes": total,
        "sha256": actual_hash,
        "captured_at": row.get("captured_at"),
    })

summary = {
    "project": "project-rekhya",
    "created_at": datetime.now(timezone.utc).isoformat(),
    "backup_type": "evidence-object-export",
    "objects_downloaded": len(manifest),
    "errors": errors,
    "objects": manifest,
}
(root / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

print(f"Evidence backup: {root}")
print(f"Downloaded: {len(manifest)}")
print(f"Errors: {len(errors)}")
if errors:
    print("ERROR: evidence backup is incomplete. Review manifest.json.", file=sys.stderr)
    sys.exit(2)
print("PASS: all indexed Supabase evidence objects were backed up.")