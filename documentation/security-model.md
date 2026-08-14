# Project Rekhya security model

Project Rekhya uses Supabase Auth for officer sessions, PostgreSQL row-level security for every exposed table, a private evidence bucket, and server-side AES-GCM encryption for worker credentials.

Operational roles are `admin`, `technical_officer`, `field_officer`, `auditor`, and `pending`. A new account has no operational data access until an administrator assigns a non-pending role. Authorization never relies on user-editable metadata.

The browser receives only the Supabase project URL and publishable key. The credential encryption key and automation-agent API key are server-only environment variables and must never be committed. Credential audit records intentionally omit the ciphertext.

Evidence objects use the private `project-rekhya-evidence` bucket. Database metadata and Storage policies restrict access to active authorized officers. Passwords never appear in filenames, folders, logs, audit payloads, notifications, or Excel exports unless an authorized officer explicitly selects the Password column in a custom export.
