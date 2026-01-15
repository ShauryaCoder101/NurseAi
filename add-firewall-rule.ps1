# Add Windows Firewall Rule for Expo (Port 8081)
# Run this script as Administrator

Write-Host "Adding Windows Firewall rule for Expo (Port 8081)..." -ForegroundColor Yellow

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    exit 1
}

# Add firewall rule for Expo Metro Bundler
netsh advfirewall firewall add rule name="Expo Metro Bundler (Port 8081)" dir=in action=allow protocol=TCP localport=8081

# Add firewall rule for Expo Dev Server
netsh advfirewall firewall add rule name="Expo Dev Server (Port 19000)" dir=in action=allow protocol=TCP localport=19000

# Add firewall rule for Expo Dev Server (UDP)
netsh advfirewall firewall add rule name="Expo Dev Server UDP (Port 19000)" dir=in action=allow protocol=UDP localport=19000

Write-Host "✅ Firewall rules added successfully!" -ForegroundColor Green
Write-Host "You can now try connecting with Expo Go again." -ForegroundColor Cyan
