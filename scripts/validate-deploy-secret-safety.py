from pathlib import Path

deploy = (Path(__file__).parents[1] / "scripts" / "deploy-cloudflare.sh").read_text(encoding="utf-8")

forbidden = [
    "wrangler secret put CREDENTIAL_ENCRYPTION_KEY",
    "printf '%s' \"${CREDENTIAL_ENCRYPTION_KEY}\"",
]
for token in forbidden:
    if token in deploy:
        raise SystemExit(f"Unsafe automatic credential-secret rotation detected: {token}")

required = [
    "--keep-vars",
    "wrangler secret list",
    "CREDENTIAL_ENCRYPTION_KEY",
    "without rotating credential secrets",
]
for token in required:
    if token not in deploy:
        raise SystemExit(f"Credential-secret continuity guard missing: {token}")

print("Cloudflare credential-secret continuity guard: OK")
