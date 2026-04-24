#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Revert changes made by apply-cowork-fixes.ps1 using its backup JSON.

.DESCRIPTION
    Reads the JSON written by apply-cowork-fixes.ps1 and restores every
    captured value on the same adapter. If the backup is missing or the
    adapter has since been renamed, the script fails loudly rather than
    guessing.

.PARAMETER BackupFile
    Path to the cowork-fix-backup_<timestamp>.json file. Required. If
    omitted, the script lists the backup files found next to itself and
    exits.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\tools\revert-cowork-fixes.ps1 `
        -BackupFile .\tools\cowork-fix-backup_20260424-091523.json
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$BackupFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

function Write-Step { param([string]$m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-OK   { param([string]$m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    $m" -ForegroundColor Yellow }

if (-not $BackupFile) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    $candidates = Get-ChildItem -LiteralPath $here -Filter 'cowork-fix-backup_*.json' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if ($candidates) {
        Write-Host "Backup files found in $here (newest first):"
        $candidates | Format-Table Name, LastWriteTime, Length -AutoSize
        Write-Host "Re-run with -BackupFile <path>." -ForegroundColor Yellow
    } else {
        Write-Host "No backup files found in $here. Pass -BackupFile <path>." -ForegroundColor Red
    }
    return
}

if (-not (Test-Path -LiteralPath $BackupFile)) {
    throw "Backup file not found: $BackupFile"
}

$backup = Get-Content -LiteralPath $BackupFile -Raw | ConvertFrom-Json
Write-Step "Loaded backup from $(Get-Item -LiteralPath $BackupFile | Select-Object -ExpandProperty FullName)"
Write-Host ($backup | ConvertTo-Json -Depth 5)

# --- adapter ------------------------------------------------------------------

$adapter = Get-NetAdapter -Name $backup.AdapterName -ErrorAction SilentlyContinue
if (-not $adapter) {
    Write-Warn "Adapter '$($backup.AdapterName)' not found by name; trying InterfaceDescription match."
    $adapter = Get-NetAdapter -Physical | Where-Object InterfaceDescription -eq $backup.InterfaceDescription | Select-Object -First 1
}
if (-not $adapter) {
    throw "Can't find the adapter recorded in the backup. Rename it back to '$($backup.AdapterName)' and retry."
}

# --- 1. adapter power management ---------------------------------------------

Write-Step '1. Adapter power management'
$pm = $backup.PowerManagement
$targetAllow = $pm.AllowComputerToTurnOffDevice
if ($PSCmdlet.ShouldProcess($adapter.Name, "Set AllowComputerToTurnOffDevice=$targetAllow")) {
    Set-NetAdapterPowerManagement -Name $adapter.Name -AllowComputerToTurnOffDevice $targetAllow
    Write-OK "AllowComputerToTurnOffDevice -> $targetAllow"
}

# --- 2. advanced properties ---------------------------------------------------

Write-Step '2. NIC advanced properties'
foreach ($name in $backup.AdvancedProperties.PSObject.Properties.Name) {
    $value = $backup.AdvancedProperties.$name
    if ($PSCmdlet.ShouldProcess("$($adapter.Name) / $name", "Set DisplayValue=$value")) {
        try {
            Set-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName $name -DisplayValue $value -ErrorAction Stop
            Write-OK "$name -> $value"
        } catch {
            Write-Warn "$name : $($_.Exception.Message)"
        }
    }
}

# --- 3. USB selective suspend (AC) -------------------------------------------

Write-Step '3. USB selective suspend (AC)'
if ($null -ne $backup.UsbSelectiveSuspendAc) {
    $idx = [int]$backup.UsbSelectiveSuspendAc
    if ($PSCmdlet.ShouldProcess('SCHEME_CURRENT / USB selective suspend AC', "Set index $idx")) {
        & powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 $idx | Out-Null
        & powercfg /setactive SCHEME_CURRENT | Out-Null
        Write-OK "USB selective suspend (AC) -> index $idx"
    }
} else {
    Write-Warn 'USB selective suspend AC not in backup; skipping.'
}

# --- 4. Fast Startup ----------------------------------------------------------

Write-Step '4. Fast Startup (HiberbootEnabled)'
$powerKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
if ($null -ne $backup.HiberbootEnabled) {
    $val = [int]$backup.HiberbootEnabled
    if ($PSCmdlet.ShouldProcess($powerKey, "Set HiberbootEnabled=$val")) {
        Set-ItemProperty -Path $powerKey -Name HiberbootEnabled -Value $val -Type DWord
        Write-OK "HiberbootEnabled -> $val"
    }
} else {
    Write-Warn 'HiberbootEnabled not in backup; skipping.'
}

Write-Host ''
if ($WhatIfPreference) {
    Write-Host "[-WhatIf] No changes made." -ForegroundColor Yellow
} else {
    Write-Host "Revert complete." -ForegroundColor Green
}
