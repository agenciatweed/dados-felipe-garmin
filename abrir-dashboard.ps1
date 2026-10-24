param([switch]$SemNavegador)

$dashboardPort = 8791
$dashboardUrl = "http://127.0.0.1:$dashboardPort"
$dashboardReady = $false
try {
    $dashboardCatalog = Invoke-RestMethod "$dashboardUrl/api/catalog" -TimeoutSec 2
    $dashboardReady = $dashboardCatalog.local_mode -eq $true
} catch { }
if (-not $dashboardReady) {
    $dashboardPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    $dashboardServer = Join-Path $PSScriptRoot 'dashboard\server.py'
    $dashboardProcess = Start-Process -FilePath $dashboardPython -ArgumentList @('"' + $dashboardServer + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    for ($dashboardAttempt = 0; $dashboardAttempt -lt 20; $dashboardAttempt++) {
        Start-Sleep -Milliseconds 300
        try {
            $dashboardCatalog = Invoke-RestMethod "$dashboardUrl/api/catalog" -TimeoutSec 2
            if ($dashboardCatalog.local_mode -eq $true) { $dashboardReady = $true; break }
        } catch { }
        if ($dashboardProcess.HasExited) { break }
    }
}
if ($dashboardReady) {
    if (-not $SemNavegador) { Start-Process $dashboardUrl }
    Write-Output "Dashboard disponível em $dashboardUrl"
} else {
    Write-Error 'Não foi possível iniciar o dashboard. Rode iniciar-dashboard.ps1 para ver o diagnóstico.'
    exit 1
}
