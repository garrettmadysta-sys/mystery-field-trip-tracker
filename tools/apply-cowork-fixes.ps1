#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Apply the "keep Claude Cowork Dispatch reachable" power/NIC fixes.

.DESCRIPTION
    Reversible changes that stop Windows and the USB Ethernet NIC from
    powering down while the PC is otherwise idle. Captures every current
    value to a timestamped JSON backup before writing anything, so
    revert-cowork-fixes.ps1 can undo exactly what this script changed.

    Run elevated. Use -WhatIf to dry-run (no backup written, no changes).

.PARAMETER AdapterName
    Network adapter to harden. Defaults to 'Ethernet 2' (the USB Realtek
    dongle on this machine).

.PARAMETER BackupDir
    Where to write the backup JSON. Defaults to the script directory.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\tools\apply-cowork-fixes.ps1 -WhatIf

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\tools\apply-cowork-fixes.ps1
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$AdapterName = 'Ethernet 2',
    [string]$BackupDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

if (-not $BackupDir) {
    if ($PSScriptRoot) { $BackupDir = $PSScriptRoot } else { $BackupDir = (Get-Location).Path }
}

function Write-Step { param([string]$m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-OK   { param([string]$m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    $m" -ForegroundColor Yellow }

# --- sanity checks ------------------------------------------------------------

$adapter = Get-NetAdapter -Name $AdapterName -ErrorAction SilentlyContinue
if (-not $adapter) {
    Write-Host "Adapter '$AdapterName' not found. Available physical adapters:" -ForegroundColor Red
    Get-NetAdapter -Physical | Format-Table Name, InterfaceDescription, Status -AutoSize
    throw "Re-run with -AdapterName set to one of the above."
}
Write-Step "Target adapter: $($adapter.Name) ($($adapter.InterfaceDescription))"

# --- capture current state ----------------------------------------------------

$backup = [ordered]@{
    Timestamp           = (Get-Date).ToString('o')
    ComputerName        = $env:COMPUTERNAME
    AdapterName         = $adapter.Name
    InterfaceDescription= $adapter.InterfaceDescription
    PowerManagement     = $null
    AdvancedProperties  = @{}
    UsbSelectiveSuspendAc = $null
    HiberbootEnabled    = $null
}

$pm = Get-NetAdapterPowerManagement -Name $adapter.Name -ErrorAction Stop
$backup.PowerManagement = [ordered]@{
    AllowComputerToTurnOffDevice = "$($pm.AllowComputerToTurnOffDevice)"
    WakeOnMagicPacket            = "$($pm.WakeOnMagicPacket)"
    WakeOnPattern                = "$($pm.WakeOnPattern)"
    SelectiveSuspend             = "$($pm.SelectiveSuspend)"
    DeviceSleepOnDisconnect      = "$($pm.DeviceSleepOnDisconnect)"
}

# Locate the MSPower_DeviceEnable CIM instance for this NIC.
# "Allow the computer to turn off this device" corresponds to .Enable:
#   Enable = $true  -> Windows may power-manage the device (checkbox CHECKED)
#   Enable = $false -> Windows may NOT power off the device (checkbox UNCHECKED)
$pnpId = (Get-NetAdapter -Name $adapter.Name).PnPDeviceID
$mspInstance = $null
try {
    $candidates = Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction Stop
    $mspInstance = $candidates | Where-Object { $_.InstanceName -eq "$($pnpId)_0" } | Select-Object -First 1
    if (-not $mspInstance) {
        $mspInstance = $candidates | Where-Object { $_.InstanceName -like "$($pnpId)*" } | Select-Object -First 1
    }
} catch {
    Write-Warn "Could not enumerate MSPower_DeviceEnable: $($_.Exception.Message)"
}
$backup.MspDeviceEnable = if ($mspInstance) {
    [ordered]@{ InstanceName = $mspInstance.InstanceName; Enable = [bool]$mspInstance.Enable }
} else { $null }

$advTargets = @('Energy-Efficient Ethernet','Green Ethernet','Idle Power Saving')
foreach ($name in $advTargets) {
    $p = Get-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName $name -ErrorAction SilentlyContinue
    if ($p) { $backup.AdvancedProperties[$name] = "$($p.DisplayValue)" }
}

# USB selective suspend (AC) — raw hex index via powercfg
$usbQuery = powercfg /query SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 2>&1 | Out-String
$acIdx = [regex]::Match($usbQuery, 'Current AC Power Setting Index:\s+0x([0-9a-fA-F]+)').Groups[1].Value
if ($acIdx) { $backup.UsbSelectiveSuspendAc = [Convert]::ToInt32($acIdx, 16) }

$powerKey  = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
$backup.HiberbootEnabled = (Get-ItemProperty -Path $powerKey -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled

Write-Step 'Captured current state:'
$backup | ConvertTo-Json -Depth 5 | Write-Host

# --- write backup file --------------------------------------------------------

$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $BackupDir "cowork-fix-backup_$stamp.json"

if ($PSCmdlet.ShouldProcess($backupPath, 'Write backup JSON')) {
    $backup | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backupPath -Encoding UTF8
    Write-OK "Backup written: $backupPath"
} else {
    Write-Warn "[-WhatIf] Would write backup to: $backupPath"
}

# --- apply changes ------------------------------------------------------------

Write-Step '1. Adapter power management (Allow computer to turn off this device)'
if (-not $mspInstance) {
    Write-Warn "No MSPower_DeviceEnable instance for PnPDeviceID '$pnpId'. Skipping."
} elseif ($mspInstance.Enable -eq $false) {
    Write-OK 'Already Disabled (MSPower_DeviceEnable.Enable is $false).'
} elseif ($PSCmdlet.ShouldProcess($adapter.Name, 'Set MSPower_DeviceEnable.Enable=$false')) {
    try {
        Set-CimInstance -InputObject $mspInstance -Property @{ Enable = $false } -ErrorAction Stop
        Write-OK 'Allow computer to turn off this device -> Disabled'
    } catch {
        Write-Warn "Failed to set MSPower_DeviceEnable.Enable: $($_.Exception.Message)"
    }
}

Write-Step '2. NIC advanced properties (energy savers)'
foreach ($name in $advTargets) {
    if (-not $backup.AdvancedProperties.ContainsKey($name)) {
        Write-Warn "$name : property not present on this adapter, skipping"
        continue
    }
    if ($backup.AdvancedProperties[$name] -eq 'Disabled') {
        Write-OK "$name : already Disabled"
        continue
    }
    if ($PSCmdlet.ShouldProcess("$($adapter.Name) / $name", 'Set DisplayValue=Disabled')) {
        try {
            Set-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName $name -DisplayValue 'Disabled' -ErrorAction Stop
            Write-OK "$name -> Disabled"
        } catch {
            Write-Warn "$name : $($_.Exception.Message)"
        }
    }
}

Write-Step '3. USB selective suspend (AC) -> Disabled'
if ($PSCmdlet.ShouldProcess('SCHEME_CURRENT / USB selective suspend AC', 'Set index 0')) {
    & powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 | Out-Null
    & powercfg /setactive SCHEME_CURRENT | Out-Null
    Write-OK 'USB selective suspend (AC) -> Disabled'
}

Write-Step '4. Fast Startup -> off'
if ($PSCmdlet.ShouldProcess($powerKey, 'Set HiberbootEnabled=0')) {
    Set-ItemProperty -Path $powerKey -Name HiberbootEnabled -Value 0 -Type DWord
    Write-OK 'HiberbootEnabled -> 0'
}

# --- done ---------------------------------------------------------------------

Write-Host ''
if ($WhatIfPreference) {
    Write-Host "[-WhatIf] No changes made." -ForegroundColor Yellow
} else {
    Write-Host "All fixes applied." -ForegroundColor Green
    Write-Host "To roll back, run:" -ForegroundColor Green
    Write-Host "    powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\revert-cowork-fixes.ps1`" -BackupFile `"$backupPath`"" -ForegroundColor Green
    Write-Host ''
    Write-Host "Next: unplug/replug the USB Ethernet adapter once so the NIC picks up the new settings." -ForegroundColor Cyan
}
