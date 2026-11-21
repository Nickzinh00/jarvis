$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
function Write-Step([string]$Message) { Write-Host ""; Write-Host "==> $Message" -ForegroundColor Cyan }
function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
if ($env:OS -ne "Windows_NT") { throw "Este instalador foi feito para Windows 10/11." }
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($arch -ne "X64" -and $arch -ne "Arm64") { throw "Arquitetura não suportada: $arch." }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host "J.A.R.V.I.S. — instalação guiada para Windows" -ForegroundColor Green
Write-Host "O instalador não solicita nem envia suas senhas ou chaves."
if (-not (Test-Command "node")) {
  Write-Step "Instalando Node.js LTS oficial via winget."
  if (-not (Test-Command "winget")) { throw "Instale Node.js 20+ pelo site https://nodejs.org/ e execute novamente." }
  winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  if (-not (Test-Command "node")) { throw "Node.js instalado. Feche e reabra o PowerShell e execute novamente." }
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { throw "Node.js 20+ é obrigatório. Detectado: $(node --version)" }
if (-not (Test-Command "claude")) {
  Write-Step "Instalando Claude Code."
  npm install --global @anthropic-ai/claude-code
}
if (-not (Test-Command "claude")) { throw "Claude Code não foi localizado. Reinicie o PowerShell e tente novamente." }
Write-Step "Instalando dependências exatas do projeto."
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci falhou. Confira a conexão e tente novamente." }
Write-Step "Executando diagnóstico inicial."
npm run setup
if ($LASTEXITCODE -ne 0) { throw "A verificação inicial falhou." }
Write-Host ""
Write-Host "Instalação concluída." -ForegroundColor Green
Write-Host "PRÓXIMO PASSO: execute claude e conclua o login oficial da sua conta."
Write-Host "Depois, inicie o JARVIS com start-windows.bat."
Write-Host "A proteção padrão contra alterações continua ativa."
