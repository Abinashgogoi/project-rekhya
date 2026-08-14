# Project Rekhya canonical business rules

- Only User IDs present in the active master dataset are in scope for App Entry, Portal Entry and reconciliation.
- User ID is authoritative. Name mismatch alone does not reject a verified login when User ID matches.
- Start Date and End Date are inclusive and must be identical across App Entry, Portal Entry, combined viewing and export.
- Portal Entry is the count of matched Transaction Report rows for the User ID within the selected range.
- Normal Total is the count of app records with Amount exactly ₹100.
- High Entry is the count of app records with Amount greater than ₹100.
- App Entry is Normal Total plus High Entry. Amounts are classifications, not a rupee sum.
- Policy ID alone is never used for destructive deduplication. Suspicious repetitions remain preserved for manual review.
- Files retain filename, hash, batch, source type, detected date range, row counts and processing status. Overlap is reported rather than silently double-counted.
- Payment fields are manual officer inputs. Blank remains blank; values are not inferred from App Entry.
- Important automated decisions retain evidence. Uncertain reads become Manual Review Required rather than guessed values.
