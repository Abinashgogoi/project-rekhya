# Project Rekhya

Project Rekhya is the integrated operational system for agricultural-insurance app verification, portal reconciliation, evidence preservation, and field collection tracking.

## Repository layout

- `dashboard/` — hosted operational dashboard and spreadsheet import/export logic
- `backend/` — authenticated API support and credential encryption
- `automation-agent/` — physical Android/Appium controller
- `portal-parser/` — strict Master and Transaction Report parsers
- `reports/` — report definitions and operator notes
- `database/` — PostgreSQL/Supabase migrations
- `deployment/` — deployment and environment guidance
- `documentation/` — business rules and security model

## Guardrails

- User ID is the authoritative identity and reconciliation key.
- All date ranges are inclusive and shared across App Entry, Portal Entry, combined views, and exports.
- App Entry counts applications: `Amount = ₹100` plus `Amount > ₹100`; it never sums those rupee amounts.
- Repeated-looking records are preserved for review; they are never destructively deduplicated by Policy ID alone.
- Evidence is stored separately from Excel reports.
- Worker credentials are encrypted at rest and plaintext access is role-gated and audited.

## Local validation

```bash
npm run lint
npm run test:unit
npm run build
PYTHONPATH=automation-agent/src python -m unittest discover -s automation-agent/tests
python -m compileall -q automation-agent/src
```

The Android automation cannot be fully validated without the authorized physical phone, active SIM 1, official app, and a calibrated selector profile. See `automation-agent/README.md` for that controlled hardware milestone.
