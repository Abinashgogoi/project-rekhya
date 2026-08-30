# Project Rekhya Disaster Recovery

## Recovery objectives

Project Rekhya is a field-operations system. The current production target is:

- **RPO (maximum acceptable data loss): 24 hours** during normal operation.
- **Active field-run target RPO: one run boundary**. Take a logical database backup before a high-pressure full run and another after the run completes.
- **RTO (target time to restore service): 4 hours** for database + dashboard + technical-controller recovery.
- Evidence must be recoverable independently because Supabase database backups contain Storage metadata but do not restore deleted Storage objects.

If Point-in-Time Recovery is enabled for the Supabase project, use its finer recovery point instead of the 24-hour target.

## Backup layers

### 1. Source / deployment

The canonical source is GitHub `main`. Cloudflare production is rebuilt from tracked source. No production secret belongs in Git.

Recovery:
1. Clone `Abinashgogoi/project-rekhya`.
2. Restore server-only environment variables from the approved secret store.
3. Run the Production Gate.
4. Deploy the canonical Cloudflare Worker `project-rekhya`.
5. Confirm the deployment in Cloudflare before resuming operations.

### 2. Supabase database

Use Supabase native backups where available. In addition, before and after major verification runs create a logical backup:

```powershell
$env:PROJECT_REKHYA_DB_URL = "<secure database connection string>"
powershell -ExecutionPolicy Bypass -File .\scripts\dr\backup-database.ps1 -Destination "X:\ProjectRekhya-Backups"
```

Never place database backup files in this public repository.

Integrity check:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dr\verify-database-backup.ps1 -BackupDirectory "X:\ProjectRekhya-Backups\project-rekhya-db-YYYYMMDD-HHMMSS"
```

A hash pass is not a restore test.

### 3. Evidence objects

Database backup alone is insufficient for screenshot evidence.

For Supabase Storage evidence, run with server-side values only:

```powershell
$env:PROJECT_REKHYA_SUPABASE_URL = "https://<project>.supabase.co"
$env:PROJECT_REKHYA_SERVICE_ROLE_KEY = "<service role key>"
$env:PROJECT_REKHYA_EVIDENCE_BACKUP_DIR = "X:\ProjectRekhya-Backups"
& ".\automation-agent\.venv\Scripts\python.exe" ".\scripts\dr\backup-evidence.py"
```

The service-role key must never be placed in source, logs, screenshots or chat.

If evidence is configured for Google Cloud Storage, maintain an independent bucket backup / retention policy there. The Supabase evidence script intentionally refuses to pretend that a non-Supabase provider was backed up.

### 4. Technical controller

The local controller is replaceable infrastructure. Recovery does not depend on the old PC if these are available:

- GitHub repository
- approved `.env` values from the secret store
- Android SDK / ADB
- Node.js + Appium + UiAutomator2
- authorized physical phone and SIM 1

Recovery steps:
1. Clone the repository.
2. Recreate `automation-agent/.venv`.
3. Install `automation-agent`.
4. Restore `.env` from the secret store.
5. Install/register `rekhya://` using `automation-agent/install-website-launcher.ps1`.
6. Connect and authorize the phone.
7. Use **Prepare Android** on the website.
8. Do not resume a production run until Android, SIM, Official App and Cloud Sync are green.

## Restore drill

A production restore drill must **never overwrite the live Supabase project**.

Quarterly, and after any material database architecture change:

1. Create a temporary non-production Supabase project.
2. Restore the latest logical roles/schema/data backup into it.
3. Validate worker count, portal counts, verification summaries, evidence metadata and reconciliation totals.
4. Verify a sample of evidence objects against the evidence backup manifest SHA256 values.
5. Record start time, finish time, result and observed RTO.
6. Delete the temporary recovery project only after the drill report is saved.

## Incident order

1. Stop/pause Android automation.
2. Preserve logs and current screenshots.
3. Identify the last trusted database/evidence recovery point.
4. Restore to non-production first when diagnosis is uncertain.
5. Verify User-ID counts and reconciliation before switching production back on.
6. Resume from a safe account boundary. Never resume from an unverified authenticated PMFBY session.

## Production DR gate

DR is **PASS** only when:

- a fresh database backup completes,
- its SHA256 manifest verifies,
- evidence backup completes with zero unexplained missing Supabase objects,
- a non-production restore drill succeeds inside the RTO target,
- controller rebuild steps have been demonstrated on a clean environment or spare machine.

Until the first restore drill is executed, DR status is **Implemented, restore drill pending**.