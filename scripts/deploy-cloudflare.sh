#!/usr/bin/env bash
set -euo pipefail

project_name="project-rekhya"
config_path="dist/server/wrangler.json"
runtime_root="${PWD}/.sites-runtime"

required_public=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
for variable_name in "${required_public[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 2
  fi
done

export XDG_CONFIG_HOME="${runtime_root}/xdg-config"
export WRANGLER_WRITE_LOGS=false
export WRANGLER_LOG_PATH="${runtime_root}/wrangler/logs"
export MINIFLARE_REGISTRY_PATH="${runtime_root}/wrangler/registry"
mkdir -p "${XDG_CONFIG_HOME}" "${WRANGLER_LOG_PATH}" "${MINIFLARE_REGISTRY_PATH}"

npm run build

deploy_args=(deploy --config "${config_path}" --name "${project_name}" --keep-vars
  --var "NEXT_PUBLIC_SUPABASE_URL:${NEXT_PUBLIC_SUPABASE_URL}"
  --var "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}")

if [[ "${1:-}" == "--dry-run" ]]; then
  npx wrangler "${deploy_args[@]}" --dry-run --outdir /tmp/project-rekhya-cloudflare-dry-run
  exit 0
fi

if [[ -z "${CREDENTIAL_ENCRYPTION_KEY:-}" ]]; then
  echo "Missing required secret environment variable: CREDENTIAL_ENCRYPTION_KEY" >&2
  exit 2
fi

npx wrangler "${deploy_args[@]}"
printf '%s' "${CREDENTIAL_ENCRYPTION_KEY}" | npx wrangler secret put CREDENTIAL_ENCRYPTION_KEY --config "${config_path}" --name "${project_name}"

echo "Project Rekhya deployed to Cloudflare Worker ${project_name}."
