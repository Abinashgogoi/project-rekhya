# Direct Cloudflare deployment

Project Rekhya deploys as the full-stack Cloudflare Worker `project-rekhya` with Workers Static Assets. The Vinext build emits the Worker entry point at `dist/server/index.js`, its deployment configuration at `dist/server/wrangler.json`, and browser assets under `dist/client/`.

Required deployment environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `CREDENTIAL_ENCRYPTION_KEY` (secret; never commit or paste into chat)

Authenticate Wrangler to the intended Cloudflare account, then run:

```bash
npm run deploy:cloudflare:dry-run
npm run deploy:cloudflare
```

The deployment script always uses the canonical Worker name `project-rekhya`, preserves dashboard-managed variables, and uploads `CREDENTIAL_ENCRYPTION_KEY` through Wrangler's secret mechanism rather than writing it to source or configuration.
