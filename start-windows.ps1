$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js não encontrado. Execute install-windows.ps1." }
if (-not (Test-Path (Join-Path $root "node_modules"))) { throw "Dependências ausentes. Execute install-windows.ps1." }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw "Claude Code não encontrado. Execute install-windows.ps1." }
$env:JARVIS_BRIDGE_HOST = "127.0.0.1"
$env:PORT = "5173"
Write-Host "Iniciando JARVIS. Mantenha esta janela aberta; Ctrl+C encerra." -ForegroundColor Cyan
$browser = $null
foreach ($candidate in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe")) {
  if (Test-Path $candidate) { $browser = $candidate; break }
}
$job = Start-Job -ScriptBlock { param($dir) Set-Location $dir; npm start } -ArgumentList $root
try {
  $deadline = (Get-Date).AddSeconds(90)
  $opened = $false
  while ((Get-Date) -lt $deadline -and $job.State -eq "Running") {
    Receive-Job $job | ForEach-Object { Write-Host $_ }
    if (-not $opened) {
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -TimeoutSec 2 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
          if ($browser) { Start-Process -FilePath $browser -ArgumentList "http://localhost:5173" } else { Start-Process "http://localhost:5173" }
          $opened = $true
          Write-Host "JARVIS disponível no navegador." -ForegroundColor Green
        }
      } catch {}
    }
    Start-Sleep -Seconds 1
  }
  if ($job.State -ne "Running") { Receive-Job $job | ForEach-Object { Write-Host $_ }; throw "JARVIS encerrou inesperadamente." }
  while ($job.State -eq "Running") { Receive-Job $job | ForEach-Object { Write-Host $_ }; Start-Sleep -Milliseconds 500 }
} finally {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}
