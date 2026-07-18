param(
  [int]$Port = 8791
)

$marketRoot = Join-Path $PSScriptRoot "market"
$wrangler = Join-Path $marketRoot "node_modules\wrangler\bin\wrangler.js"

$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
  Write-Error "需要 Node.js 22 或更新版本。请从 https://nodejs.org 安装当前 LTS 后重试。"
  exit 1
}

if (-not (Test-Path -LiteralPath $wrangler)) {
  Write-Host "正在安装演示服务器依赖（只需一次）..."
  & npm --prefix $marketRoot install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Codex Bazaar 演示服务器：http://0.0.0.0:$Port"
Write-Host "首次出现 Windows 防火墙提示时，请允许专用网络。"
Write-Host "演示模式会自动通过商家和商品，并允许模拟付款；不能用于真实交易。"

& node $wrangler dev --ip 0.0.0.0 --port $Port `
  --var "ADMIN_TOKEN:demo-local-only" `
  --var "PAYMENT_SIGNING_SECRET:demo-local-only" `
  --var "ALLOW_MOCK_PAYMENTS:true" `
  --var "ALLOW_DEMO_AUTO_APPROVAL:true"
