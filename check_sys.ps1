$drive = Get-PSDrive C
$freeDisk = [math]::Round($drive.Free / 1GB, 1)
$totalDisk = [math]::Round(($drive.Used + $drive.Free) / 1GB, 1)

$os = Get-CimInstance Win32_OperatingSystem
$totalRam = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freeRam = [math]::Round($os.FreePhysicalMemory / 1MB, 1)

$ports = Get-NetTCPConnection -LocalPort 3000, 1984, 8554 -ErrorAction SilentlyContinue

Write-Host "FREE_DISK_GB: $freeDisk"
Write-Host "TOTAL_DISK_GB: $totalDisk"
Write-Host "TOTAL_RAM_GB: $totalRam"
Write-Host "FREE_RAM_GB: $freeRam"

if ($ports) {
    Write-Host "PORTS_IN_USE:"
    $ports | Format-Table LocalPort, State, OwningProcess | Out-String | Write-Host
} else {
    Write-Host "PORTS_STATUS: All ports (3000, 1984, 8554) are free"
}

# Check Node and Python
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    Write-Host "NODE_PATH: $($nodeCmd.Source)"
    Write-Host "NODE_VERSION: $(node -v)"
} else {
    Write-Host "NODE_STATUS: NOT INSTALLED"
}

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pyCmd) {
    Write-Host "PYTHON_PATH: $($pyCmd.Source)"
    try {
        $pyVer = & python --version 2>&1
        Write-Host "PYTHON_VERSION: $pyVer"
    } catch {
        Write-Host "PYTHON_VERSION: Error running python: $_"
    }
} else {
    Write-Host "PYTHON_STATUS: NOT INSTALLED"
}

$pyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($pyLauncher) {
    Write-Host "PY_LAUNCHER: $($pyLauncher.Source)"
} else {
    Write-Host "PY_LAUNCHER: NOT INSTALLED"
}
