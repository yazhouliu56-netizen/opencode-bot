param(
    [Parameter(Mandatory)]
    [string]$Token
)

$env:TELEGRAM_BOT_TOKEN = $Token

Write-Host "=== Telegram Bot 启动 ===" -ForegroundColor Cyan
Write-Host "Token: $($Token.Substring(0, 10))..." -ForegroundColor Green
Write-Host "去 Telegram 发消息开始使用" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Yellow

node D:\dev\telegram-bot\bot.js
