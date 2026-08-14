# Project Rekhya deployment

The hosted dashboard is deployed from the repository root through the Project Rekhya Sites/Cloudflare runtime. Supabase provides Auth, PostgreSQL, Realtime and the private evidence bucket. The Android automation agent remains on the authorized technical PC because it requires ADB, Appium, the physical phone and SIM 1.

Production environment variables are managed by the hosting platform. `.env` files, private keys and credentials are excluded from Git. The machine-safe identifier is always `project-rekhya`; the displayed application name is always `Project Rekhya`.
