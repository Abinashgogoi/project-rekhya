param(
    [Parameter(Mandatory=$true)]
    [string]$BackupDirectory
)

$ErrorActionPreference = "Stop"
$dir = (Resolve-Path $BackupDirectory).Path
$manifestPath = Join-Path $dir "manifest.json"

if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found."
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.project -ne "project-rekhya") {
    throw "Not a Project Rekhya backup manifest."
}

foreach ($item in $manifest.manifest) {
    $path = Join-Path $dir $item.file
    if (-not (Test-Path $path)) {
        throw "Missing backup file: $($item.file)"
    }
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $item.sha256) {
        throw "SHA256 mismatch: $($item.file)"
    }
    if ((Get-Item $path).Length -ne [int64]$item.bytes) {
        throw "Size mismatch: $($item.file)"
    }
}

Write-Host "PASS: database backup manifest and SHA256 checks are valid." -ForegroundColor Green
Write-Host "This verifies backup integrity, not a full restore. Restore drills must target a non-production Supabase project."