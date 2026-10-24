Set-Location $PSScriptRoot
$pGo = Start-Process -FilePath ".\tools\go2rtc\go2rtc.exe" -ArgumentList "-c", "go2rtc.yaml" -PassThru
Start-Sleep -Seconds 2
$pDash = Start-Process -FilePath ".\tools\node\node.exe" -ArgumentList "--env-file=.env", "server.js" -PassThru
Start-Sleep -Seconds 2
$pDet = Start-Process -FilePath ".\detector\venv\Scripts\python.exe" -ArgumentList "detector\detector.py" -PassThru

Write-Host "CCTV Services running: go2rtc (1984), Dashboard (3000), Detector active"

[System.Threading.Thread]::Sleep([System.Threading.Timeout]::Infinite)
