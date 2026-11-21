$ErrorActionPreference = "Stop"
$folder = Join-Path $HOME ".jarvis"
$file = Join-Path $folder "provider.json"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

Write-Host ""
Write-Host "J.A.R.V.I.S. - configuração do provedor de IA" -ForegroundColor Cyan
Write-Host "Ollama local não exige assinatura ou chave de API. Provedores em nuvem podem cobrar pelo uso."
Write-Host ""
Write-Host "1 - Ollama local (sem assinatura de IA)"
Write-Host "2 - OpenAI API"
Write-Host "3 - OpenRouter"
Write-Host "4 - Groq"
Write-Host "5 - Together AI"
Write-Host "6 - DeepSeek API"
Write-Host "7 - Outro endpoint compatível com OpenAI"
$choice = Read-Host "Escolha (1-7)"
$providers = @{
  "1" = @{ provider = "ollama"; baseUrl = "http://127.0.0.1:11434/v1"; model = "llama3.1"; key = "ollama" }
  "2" = @{ provider = "openai"; baseUrl = "https://api.openai.com/v1"; model = ""; key = "" }
  "3" = @{ provider = "openrouter"; baseUrl = "https://openrouter.ai/api/v1"; model = ""; key = "" }
  "4" = @{ provider = "groq"; baseUrl = "https://api.groq.com/openai/v1"; model = ""; key = "" }
  "5" = @{ provider = "together"; baseUrl = "https://api.together.xyz/v1"; model = ""; key = "" }
  "6" = @{ provider = "deepseek"; baseUrl = "https://api.deepseek.com/v1"; model = ""; key = "" }
  "7" = @{ provider = "custom"; baseUrl = ""; model = ""; key = "" }
}
if (-not $providers.ContainsKey($choice)) { throw "Opção inválida." }
$item = $providers[$choice]
$baseUrl = $item.baseUrl
if ($choice -eq "7") { $baseUrl = Read-Host "URL base do endpoint (ex.: https://servidor/v1)" }
try { $uri = [Uri]$baseUrl } catch { throw "URL inválida." }
if ($uri.Scheme -notin @("http", "https")) { throw "A URL deve usar HTTP ou HTTPS." }
if ($item.provider -eq "ollama" -and $uri.Host -notin @("127.0.0.1", "localhost", "::1")) { throw "Por segurança, Ollama deve apontar para este computador." }
$model = Read-Host "Nome exato do modelo (Enter para '$($item.model)')"
if ([string]::IsNullOrWhiteSpace($model)) { $model = $item.model }
if ([string]::IsNullOrWhiteSpace($model)) { throw "Informe um modelo existente no provedor escolhido." }
$key = $item.key
if ($item.provider -ne "ollama") {
  $secure = Read-Host "API key (gravada somente neste computador)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ([string]::IsNullOrWhiteSpace($key)) { throw "A chave não pode ficar vazia." }
}
$config = @{ provider = $item.provider; baseUrl = $baseUrl.TrimEnd('/'); model = $model; apiKey = $key }
$json = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $file /inheritance:r /grant:r "$($identity):(F)" | Out-Null
Write-Host ""
Write-Host "Configuração salva. A chave não foi enviada ao ChatGPT." -ForegroundColor Green
Write-Host "Reinicie o JARVIS para aplicar a alteração."
if ($item.provider -eq "ollama") {
  Write-Host "Confira se o Ollama está aberto e se o modelo está instalado."
  Write-Host "Para baixar o modelo: ollama pull $model"
  Write-Host "O download pode ocupar vários GB, conforme o modelo escolhido."
}
