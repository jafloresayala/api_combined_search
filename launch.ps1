# =============================================================================
#  Component Price Dashboard — Launcher
#  Run this script (or launch.bat) to set up and start the application.
#  Works on any Windows machine that has Python 3.10+ and Node.js 18+ installed.
# =============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Banner {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "   Component Price Dashboard - Launcher    " -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step  { param($n, $msg) Write-Host "[Step $n] $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg)     Write-Host "         OK  $msg" -ForegroundColor Green }
function Write-Warn  { param($msg)     Write-Host "         WARN $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg)     Write-Host "         ERR  $msg" -ForegroundColor Red }

function Assert-Command {
    param($cmd, $install)
    try   { $null = Get-Command $cmd -ErrorAction Stop }
    catch {
        Write-Fail "$cmd not found. $install"
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Starts a long-running process in its own PowerShell window using encoded command
# to handle paths with spaces safely.
function Start-Server {
    param([string]$label, [string]$command)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-EncodedCommand", $encoded
    ) -WindowStyle Normal
    Write-OK "$label window opened"
}

# ── Banner ────────────────────────────────────────────────────────────────────

Write-Banner

# ── 1. Check prerequisites ────────────────────────────────────────────────────

Write-Step 1 "Checking prerequisites..."
Assert-Command "python" "Install Python 3.10+ from https://python.org (check 'Add to PATH')"
Assert-Command "node"   "Install Node.js 18+ from https://nodejs.org"
Assert-Command "npm"    "Install Node.js 18+ from https://nodejs.org"

$pyVer   = python --version 2>&1
$nodeVer = node --version   2>&1
Write-OK "Python  : $pyVer"
Write-OK "Node.js : $nodeVer"

# ── 2. Python virtual environment ─────────────────────────────────────────────

Write-Step 2 "Setting up Python virtual environment..."

$EnvDir    = Join-Path $ScriptDir "env"
$PythonExe = Join-Path $EnvDir "Scripts\python.exe"
$PipExe    = Join-Path $EnvDir "Scripts\pip.exe"
$UvicornExe = Join-Path $EnvDir "Scripts\uvicorn.exe"

if (-not (Test-Path $PipExe)) {
    Write-Host "         Creating virtual environment (first time)..." -ForegroundColor Yellow
    python -m venv $EnvDir
    if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to create venv"; exit 1 }
    Write-OK "Virtual environment created at .\env"
} else {
    Write-OK "Virtual environment found at .\env"
}

# ── 3. Install / sync Python dependencies ─────────────────────────────────────

Write-Step 3 "Installing Python dependencies..."
& $PipExe install -r (Join-Path $ScriptDir "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { Write-Fail "pip install failed"; exit 1 }
Write-OK "All Python packages are ready"

# ── 4. Extract EMS browser cookies ───────────────────────────────────────────

Write-Step 4 "Extracting EMS browser cookies..."
& $PythonExe (Join-Path $ScriptDir "extract_ems_cookies.py")
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Automatic cookie extraction failed."
    Write-Warn "The app will use whatever cookies are already in .env."
    Write-Warn "If EMS calls fail, log in to EMS in your browser and relaunch."
}

# ── 5. Frontend dependencies ──────────────────────────────────────────────────

Write-Step 5 "Checking frontend dependencies..."
$FrontendDir  = Join-Path $ScriptDir "frontend"
$NodeModules  = Join-Path $FrontendDir "node_modules"

if (-not (Test-Path $NodeModules)) {
    Write-Host "         Running npm install (first time — may take a minute)..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    npm install --silent
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "npm install failed"; exit 1 }
    Pop-Location
    Write-OK "Frontend packages installed"
} else {
    Write-OK "Frontend packages found"
}

# ── 6. Start backend server ───────────────────────────────────────────────────

Write-Step 6 "Starting backend server (port 8081)..."

$backendCmd = @"
`$Host.UI.RawUI.WindowTitle = 'Backend - Component Price Dashboard'
Write-Host '  Backend API  http://127.0.0.1:8081' -ForegroundColor Cyan
Write-Host '  Press Ctrl+C to stop.' -ForegroundColor Gray
Write-Host ''
Set-Location '$($ScriptDir -replace "'", "''")'
& '$($UvicornExe -replace "'", "''")' app:app --reload --host 127.0.0.1 --port 8081
"@

Start-Server "Backend" $backendCmd

# Give uvicorn a moment to bind the port before starting the frontend
Start-Sleep -Seconds 2

# ── 7. Start frontend dev server ──────────────────────────────────────────────

Write-Step 7 "Starting frontend dev server (port 5173)..."

$frontendCmd = @"
`$Host.UI.RawUI.WindowTitle = 'Frontend - Component Price Dashboard'
Write-Host '  Frontend UI  http://localhost:5173' -ForegroundColor Cyan
Write-Host '  Press Ctrl+C to stop.' -ForegroundColor Gray
Write-Host ''
Set-Location '$($FrontendDir -replace "'", "''")'
npm run dev -- --host
"@

Start-Server "Frontend" $frontendCmd

# ── 8. Open browser ───────────────────────────────────────────────────────────

Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Application is running!                 " -ForegroundColor Green
Write-Host "   Frontend  :  http://localhost:5173      " -ForegroundColor White
Write-Host "   Backend   :  http://127.0.0.1:8081      " -ForegroundColor White
Write-Host "                                            " -ForegroundColor White
Write-Host "   Close the Backend / Frontend windows    " -ForegroundColor White
Write-Host "   to stop the application.                " -ForegroundColor White
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
