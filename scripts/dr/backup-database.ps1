param(
    [Parameter(Mandatory=$true)]
    [string]$Destination
)

$ErrorActionPreference = "Stop"

if (-not $env:PROJECT_REKHYA_DB_URL) {
    throw "Set PROJECT_REKHYA_DB_URL in the current secure operator environment. Never save it in the repo."
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dest = [System.IO.Path]::GetFullPath($Destination)
$repoFull = [System.IO.Path]::GetFullPath($repo)

if ($dest.StartsWith($repoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup destination must be outside the public Git repository."
}

$supabase = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabase) {
    throw "Supabase CLI is required for logical database backup."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $dest "project-rekhya-db-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

Write-Host "Creating logical backup in $backupDir" -ForegroundColor Cyan

& $supabase.Source db dump --db-url "$env:PROJECT_REKHYA_DB_URL" -f (Join-Path $backupDir "roles.sql") --role-only
if ($LASTEXITCODE -ne 0) { throw "Role backup failed." }

& $supabase.Source db dump --db-url "$env:PROJECT_REKHYA_DB_URL" -f (Join-Path $backupDir "schema.sql")
if ($LASTEXITCODE -ne 0) { throw "Schema backup failed." }

& $supabase.Source db dump --db-url "$env:PROJECT_REKHYA_DB_URL" -f (Join-Path $backupDir "data.sql") --data-only --use-copy
if ($LASTEXITCODE -ne 0) { throw "Data backup failed." }

$manifest = @()
foreach ($name in @("roles.sql","schema.sql","data.sql")) {
    $path = Join-Path $backupDir $name
    $hash = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest += [pscustomobject]@{
        file = $name
        bytes = (Get-Item $path).Length
        sha256 = $hash
    }
}

$meta = [ordered]@{
    project = "project-rekhya"
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    hostname = $env:COMPUTERNAME
    backup_type = "supabase-logical"
    manifest = $manifest
}

$meta | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $backupDir "manifest.json")

Write-Host "Database backup complete." -ForegroundColor Green
Write-Host "Store this folder only on an encrypted/off-site backup location. It contains sensitive operational data." -ForegroundColor Yellow
Write-Host $backupDir