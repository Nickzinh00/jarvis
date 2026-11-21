$ErrorActionPreference = "Stop"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget não está disponível. Instale o Ollama pelo site oficial: https://ollama.com/download/windows"
}
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  winget install --id Ollama.Ollama --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "A instalação do Ollama falhou." }
}
Write-Host "Ollama instalado. Para instalar um modelo local multimodal com ferramentas, execute:" -ForegroundColor Green
Write-Host "  ollama pull qwen3-vl:4b"
Write-Host "O download pode ocupar vários GB. O desempenho depende da memória e da GPU."
