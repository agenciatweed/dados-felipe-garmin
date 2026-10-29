$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'Garmin Dashboard.lnk'
$scriptPath = Join-Path $PSScriptRoot 'abrir-dashboard.ps1'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -File "' + $scriptPath + '" -SemNavegador'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Inicia somente o servidor local Garmin ao entrar no Windows.'
$shortcut.Save()
Write-Output "Inicialização automática instalada: $shortcutPath"
