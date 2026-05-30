# Deploys sql-server.js to Azure App Service (Linux, Node 20)
# and wires it to your Azure SQL via the App Service's Managed Identity.
#
# Run once from PowerShell:  ./deploy-azure.ps1
# Re-run any time to redeploy code changes (re-runs are safe / idempotent).

[CmdletBinding()]
param(
  [string]$SubscriptionId = "",      # leave blank to use current az subscription
  [string]$ResourceGroup  = "rg-tctool",
  [string]$Location       = "eastus2",
  [string]$PlanName       = "asp-tctool",
  [string]$AppName        = "tctool-manager-api",   # MUST be globally unique → change if taken
  [string]$SqlServer      = "eu2-dev-taxcaddy-sqlsrv.database.windows.net",
  [string]$SqlDatabase    = "eu2-dev-Log-sql-db"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Checking az login..." -ForegroundColor Cyan
$null = az account show 2>$null
if ($LASTEXITCODE -ne 0) { az login | Out-Null }
if ($SubscriptionId) { az account set --subscription $SubscriptionId }

Write-Host "==> Resource group: $ResourceGroup ($Location)" -ForegroundColor Cyan
az group create -n $ResourceGroup -l $Location | Out-Null

Write-Host "==> App Service plan: $PlanName (Linux B1)" -ForegroundColor Cyan
az appservice plan create -g $ResourceGroup -n $PlanName --is-linux --sku B1 | Out-Null

Write-Host "==> Web app: $AppName (Node 20 LTS)" -ForegroundColor Cyan
az webapp create -g $ResourceGroup -p $PlanName -n $AppName --runtime "NODE:20-lts" | Out-Null

Write-Host "==> Enabling system-assigned Managed Identity..." -ForegroundColor Cyan
$identity = az webapp identity assign -g $ResourceGroup -n $AppName | ConvertFrom-Json
$principalId = $identity.principalId
Write-Host "    principalId = $principalId  (not required in passthrough mode, kept for future use)"

Write-Host "==> Setting app settings (SQL_SERVER / SQL_DATABASE / SQL_AUTH)..." -ForegroundColor Cyan
az webapp config appsettings set -g $ResourceGroup -n $AppName --settings `
  SQL_SERVER=$SqlServer `
  SQL_DATABASE=$SqlDatabase `
  SQL_AUTH=passthrough `
  AAD_TENANT_ID="e205bfab-7c3a-4369-86f3-030001469257" `
  WEBSITE_NODE_DEFAULT_VERSION="~20" `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true | Out-Null

Write-Host "==> Setting startup command..." -ForegroundColor Cyan
az webapp config set -g $ResourceGroup -n $AppName --startup-file "node sql-server.js" | Out-Null

Write-Host "==> Zipping source..." -ForegroundColor Cyan
$zipPath = Join-Path $PSScriptRoot "deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$include = @(
  "sql-server.js","server.js","package.json","package-lock.json",
  "app-config.js","msal-auth.js","index.html",
  "TCToolConfigManager.html","TCToolConfigmanagerread.html",
  "data"
) | Where-Object { Test-Path (Join-Path $PSScriptRoot $_) }

Push-Location $PSScriptRoot
Compress-Archive -Path $include -DestinationPath $zipPath -Force
Pop-Location

Write-Host "==> Deploying code via zip deploy..." -ForegroundColor Cyan
az webapp deploy -g $ResourceGroup -n $AppName --src-path $zipPath --type zip | Out-Null

$appUrl = "https://$AppName.azurewebsites.net"
Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  Deployed.  API base URL:  $appUrl/api/tools" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT — grant SQL access to EACH user that signs in." -ForegroundColor Yellow
Write-Host "In SSMS (connected as an AAD admin of the database), run for every AAD user:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  CREATE USER [user@yourtenant.onmicrosoft.com] FROM EXTERNAL PROVIDER;"  -ForegroundColor White
Write-Host "  ALTER ROLE db_datareader ADD MEMBER [user@yourtenant.onmicrosoft.com];" -ForegroundColor White
Write-Host "  ALTER ROLE db_datawriter ADD MEMBER [user@yourtenant.onmicrosoft.com];" -ForegroundColor White
Write-Host ""
Write-Host "Then test:  curl $appUrl/api/health" -ForegroundColor Yellow
