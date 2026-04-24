#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only diagnostic for Windows PCs that Claude Cowork Dispatch reports as asleep.

.DESCRIPTION
    Collects power, sleep, Modern-Standby, NIC power-management, Wake-on-LAN,
    scheduled-task, and Claude/Cowork process/service state into a single report.
    Prints to the console and writes a timestamped .txt next to the script.
    Makes NO changes to the system.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\tools\diagnose-cowork-sleep.ps1
#>

[CmdletBinding()]
param(
    [string]$OutputDir
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

if (-not $OutputDir) {
    if ($PSScriptRoot) { $OutputDir = $PSScriptRoot } else { $OutputDir = (Get-Location).Path }
}
if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $OutputDir "diagnose-cowork-sleep_$stamp.txt"

Start-Transcript -Path $reportPath -Force | Out-Null

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 78)
    Write-Host "  $Title"
    Write-Host ('=' * 78)
}

function Invoke-Safe {
    param([scriptblock]$Block, [string]$Label)
    try { & $Block } catch { Write-Warning "[$Label] $($_.Exception.Message)" }
}

$findings = New-Object System.Collections.Generic.List[string]
function Add-Finding { param([string]$msg) [void]$findings.Add("- $msg") }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Section '0. Run info'
"Run at     : $(Get-Date)"
"Host       : $env:COMPUTERNAME"
"User       : $env:USERDOMAIN\$env:USERNAME"
"Elevated   : $isAdmin"
"PS version : $($PSVersionTable.PSVersion)"
"Report file: $reportPath"
if (-not $isAdmin) {
    Write-Host "(Note: 'powercfg /requests' and '/energy' reveal more when elevated.)"
}

Write-Section '1. Environment'
Invoke-Safe -Label 'ComputerInfo' -Block {
    Get-ComputerInfo -Property `
        OsName, OsVersion, OsBuildNumber, OsArchitecture, `
        CsManufacturer, CsModel, CsSystemSkuNumber, CsPowerPlatformRole, `
        OsLastBootUpTime, OsUptime, BiosVersion |
        Format-List | Out-String | Write-Host
}

Write-Section '2. Sleep states available (powercfg /a)'
Invoke-Safe -Label 'powercfg /a' -Block {
    $a = powercfg /a 2>&1 | Out-String
    Write-Host $a
    if ($a -match 'S0 Low Power Idle')            { Add-Finding "Modern Standby (S0) is in use. Behaviour differs from classic S3: NIC may stay powered, magic-packet WoL may not apply the usual way, and Dispatch presence depends on Modern-Standby networking being allowed." }
    if ($a -match 'Standby \(S3\)\s*$')           { Add-Finding "Legacy S3 sleep is available." }
    if ($a -match 'Hibernation has not been enabled') { Add-Finding "Hibernation is disabled. Fine on its own, but Fast Startup depends on it." }
}

Write-Section '3. Active power plan and timeouts'
Invoke-Safe -Label 'power plan' -Block {
    $active = powercfg /getactivescheme 2>&1 | Out-String
    Write-Host $active

    $sleep = powercfg /query SCHEME_CURRENT SUB_SLEEP  2>&1 | Out-String
    Write-Host $sleep
    Write-Host (powercfg /query SCHEME_CURRENT SUB_VIDEO 2>&1 | Out-String)
    Write-Host (powercfg /query SCHEME_CURRENT SUB_DISK  2>&1 | Out-String)

    # Standby idle timeout (sleep subgroup 238c9fa8-..., setting 29f6c1db-...)
    $reAc = '(?is)Subgroup GUID:\s+238c9fa8-0aad-41ed-83f4-97be242c8f20.*?Power Setting GUID:\s+29f6c1db-86da-48c5-9fdb-f2b67b1f44da.*?Current AC Power Setting Index:\s+0x([0-9a-f]+)'
    $reDc = '(?is)Subgroup GUID:\s+238c9fa8-0aad-41ed-83f4-97be242c8f20.*?Power Setting GUID:\s+29f6c1db-86da-48c5-9fdb-f2b67b1f44da.*?Current DC Power Setting Index:\s+0x([0-9a-f]+)'
    $acM = [regex]::Match($sleep, $reAc)
    $dcM = [regex]::Match($sleep, $reDc)
    if ($acM.Success) {
        $secs = [Convert]::ToInt32($acM.Groups[1].Value, 16)
        Write-Host ("AC standby idle timeout: {0} s ({1} min)" -f $secs, [math]::Round($secs/60,1))
        if ($secs -gt 0 -and $secs -le 3600) {
            Add-Finding "AC standby idle timeout is $([math]::Round($secs/60,1)) min — the PC sleeps on AC. Set to 0 (Never) to keep Dispatch reachable."
        }
    }
    if ($dcM.Success) {
        $secs = [Convert]::ToInt32($dcM.Groups[1].Value, 16)
        Write-Host ("DC standby idle timeout: {0} s ({1} min)" -f $secs, [math]::Round($secs/60,1))
    }
}

Write-Section '4. Fast Startup & Hibernation'
Invoke-Safe -Label 'fast startup' -Block {
    $pw        = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
    $hiberboot = (Get-ItemProperty -Path $pw -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
    $hiberfile = (Get-ItemProperty -Path $pw -Name HiberFileType     -ErrorAction SilentlyContinue).HiberFileType
    "HiberbootEnabled (Fast Startup): $hiberboot"
    "HiberFileType                  : $hiberfile   (0=Full, 1=Reduced, missing=hibernation off)"
    if ($hiberboot -eq 1) {
        Add-Finding "Fast Startup is ON. It can interfere with Wake-on-LAN from a full shutdown and with services starting predictably. Consider disabling if WoL is needed."
    }
}

Write-Section '5. Last wake, wake timers, current power requests'
Invoke-Safe -Label 'lastwake'  -Block { powercfg /lastwake  2>&1 | Out-String | Write-Host }
Invoke-Safe -Label 'waketimers' -Block {
    $wt = powercfg /waketimers 2>&1 | Out-String
    Write-Host $wt
    if ($wt -match 'no active wake timers') {
        Add-Finding "No active wake timers. For Dispatch to wake a sleeping PC you need either a scheduled task with 'Wake the computer' checked, or Wake-on-LAN on the NIC plus a sender on the LAN."
    }
}
Invoke-Safe -Label 'requests' -Block {
    $r = powercfg /requests 2>&1 | Out-String
    Write-Host $r
}

Write-Section '6. Recent Kernel-Power / shutdown events (last 20)'
Invoke-Safe -Label 'events' -Block {
    $filter = @{
        LogName      = 'System'
        ProviderName = 'Microsoft-Windows-Kernel-Power','Microsoft-Windows-Power-Troubleshooter','USER32'
        Id           = 1, 41, 42, 107, 109, 1074
    }
    Get-WinEvent -FilterHashtable $filter -MaxEvents 20 -ErrorAction Stop |
        Select-Object TimeCreated, Id, ProviderName,
            @{n='FirstLine';e={ ($_.Message -split "`r?`n")[0].Trim() }} |
        Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
}

Write-Section '7. Network adapters — power management & WoL'
Invoke-Safe -Label 'adapters' -Block {
    $ups = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up'
    if (-not $ups) { Write-Host '(no physical adapters Up)'; return }
    foreach ($a in $ups) {
        Write-Host ''
        Write-Host ">> $($a.Name)  ($($a.InterfaceDescription))"
        $pm = Get-NetAdapterPowerManagement -Name $a.Name -ErrorAction SilentlyContinue
        if ($pm) {
            $pm | Format-List DeviceSleepOnDisconnect, AllowComputerToTurnOffDevice, WakeOnMagicPacket, WakeOnPattern, SelectiveSuspend |
                Out-String | Write-Host
            if ($pm.AllowComputerToTurnOffDevice -eq 'Enabled') {
                Add-Finding "Adapter '$($a.Name)' allows Windows to power it off. For Dispatch reliability, set to Disabled."
            }
            if ($pm.WakeOnMagicPacket -eq 'Disabled') {
                Add-Finding "Adapter '$($a.Name)' has Wake-on-Magic-Packet Disabled. Enable it if remote wake is desired."
            }
        }
        $adv = Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue |
            Where-Object DisplayName -match 'Wake|Energy|Green|Power|EEE|ARP|NS Offload|Magic'
        if ($adv) {
            $adv | Format-Table DisplayName, DisplayValue -AutoSize | Out-String | Write-Host
        }
    }
}

Write-Section '8. USB selective suspend'
Invoke-Safe -Label 'usb' -Block {
    $q = powercfg /query SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 2>&1 | Out-String
    Write-Host $q
    if ($q -match 'Current AC Power Setting Index:\s+0x0*1\b') {
        Add-Finding "USB selective suspend is ENABLED on AC. If Dispatch reaches the PC via a USB NIC/dongle, this can drop the link."
    }
}

Write-Section '9. Scheduled tasks — wake-to-run, plus anything claude/cowork'
Invoke-Safe -Label 'tasks' -Block {
    $all  = Get-ScheduledTask -ErrorAction SilentlyContinue
    $wake = $all | Where-Object { $_.Settings.WakeToRun }
    if ($wake) {
        Write-Host '>> Wake-to-run tasks:'
        $wake | Format-Table TaskPath, TaskName, State -AutoSize | Out-String | Write-Host
    } else {
        Write-Host '(no scheduled tasks have WakeToRun = true)'
    }
    $claude = $all | Where-Object {
        $_.TaskName -match 'claude|cowork|anthropic|dispatch' -or
        $_.TaskPath -match 'claude|cowork|anthropic'
    }
    if ($claude) {
        Write-Host '>> Claude/Cowork-related tasks:'
        $claude | Format-Table TaskPath, TaskName, State -AutoSize | Out-String | Write-Host
    } else {
        Write-Host '(no scheduled tasks match claude|cowork|anthropic|dispatch)'
        Add-Finding "No scheduled task matches claude/cowork/anthropic/dispatch. If the dispatcher is meant to auto-start on logon or boot, confirm it's registered as a service or logon task."
    }
}

Write-Section '10. Claude Cowork footprint (processes & services)'
Invoke-Safe -Label 'footprint' -Block {
    $proc = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match 'claude|cowork|anthropic|dispatch' -or
        ($_.Path -and $_.Path -match 'claude|cowork|anthropic')
    }
    if ($proc) {
        Write-Host '>> Matching processes:'
        $proc | Select-Object Id, ProcessName, StartTime, Path |
            Format-Table -AutoSize | Out-String -Width 200 | Write-Host
    } else {
        Write-Host '(no running processes match claude|cowork|anthropic|dispatch)'
        Add-Finding "No Claude/Cowork process is running. If the PC itself is awake, Dispatch has nothing on the PC to talk to — that alone produces an 'asleep' report."
    }
    $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object {
        $_.Name        -match 'claude|cowork|anthropic|dispatch' -or
        $_.DisplayName -match 'Claude|Cowork|Anthropic|Dispatch'
    }
    if ($svc) {
        Write-Host '>> Matching services:'
        $svc | Format-Table Name, DisplayName, Status, StartType -AutoSize | Out-String | Write-Host
        foreach ($s in $svc) {
            if ($s.Status -ne 'Running') {
                Add-Finding "Service '$($s.Name)' ($($s.DisplayName)) is not Running — status is $($s.Status)."
            }
            if ($s.StartType -notin @('Automatic','AutomaticDelayedStart')) {
                Add-Finding "Service '$($s.Name)' StartType is $($s.StartType). If Dispatch depends on it, set to Automatic."
            }
        }
    } else {
        Write-Host '(no services match)'
    }
}

Write-Section '11. Screen saver & lock'
Invoke-Safe -Label 'screensaver' -Block {
    Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -ErrorAction SilentlyContinue |
        Select-Object ScreenSaveActive, ScreenSaveTimeOut, ScreenSaverIsSecure |
        Format-List | Out-String | Write-Host
}

Write-Section '12. Presence sensing (Win11)'
Invoke-Safe -Label 'presence' -Block {
    $p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\humanPresence'
    if (Test-Path $p) {
        Get-ItemProperty -Path $p | Format-List | Out-String | Write-Host
    } else {
        Write-Host '(no humanPresence consent store — either Win10 or no presence sensor)'
    }
}

Write-Section '13. Summary — likely suspects'
if ($findings.Count -eq 0) {
    Write-Host 'No obvious issues flagged by heuristic checks. Review the sections above manually.'
} else {
    $findings | ForEach-Object { Write-Host $_ }
}

Write-Host ''
Write-Host "Report written to: $reportPath"

Stop-Transcript | Out-Null
