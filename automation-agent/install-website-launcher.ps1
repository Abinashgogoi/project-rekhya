$ErrorActionPreference = "Stop"
$agentDir = Join-Path $env:USERPROFILE "project-rekhya\automation-agent"
$pythonw = Join-Path $agentDir ".venv\Scripts\pythonw.exe"
$launcher = Join-Path $agentDir "src\project_rekhya_agent\launcher.py"
if (-not (Test-Path $pythonw)) { throw "pythonw.exe not found at $pythonw" }
if (-not (Test-Path $launcher)) { throw "launcher.py not found at $launcher" }
$base = "HKCU:\Software\Classes\rekhya"
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name "(default)" -Value "URL:Project Rekhya Protocol"
Set-ItemProperty -Path $base -Name "URL Protocol" -Value ""
New-Item -Path "$base\shell\open\command" -Force | Out-Null
$command = "`"$pythonw`" `"$launcher`" `"%1`""
Set-ItemProperty -Path "$base\shell\open\command" -Name "(default)" -Value $command
Write-Host "Registered rekhya:// website launcher." -ForegroundColor Green
