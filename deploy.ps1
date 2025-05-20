# PowerShell deployment script for Windows

Write-Host "Starting AIWaverider Backend deployment..." -ForegroundColor Green

# Check for docker and docker-compose
try {
    docker --version | Out-Null
}
catch {
    Write-Host "Error: Docker is not installed." -ForegroundColor Red
    exit 1
}

try {
    docker-compose --version | Out-Null
}
catch {
    Write-Host "Error: Docker Compose is not installed." -ForegroundColor Red
    exit 1
}

# Ensure directories exist
Write-Host "Creating required directories..." -ForegroundColor Yellow
mkdir -Force nginx\conf.d | Out-Null
mkdir -Force nginx\ssl | Out-Null
mkdir -Force nginx\certbot\conf | Out-Null
mkdir -Force nginx\certbot\www | Out-Null

# Check for existing certificates - if not, start with a temporary config
if (-Not (Test-Path "nginx\certbot\conf\live\api.aiwaverider.com")) {
    Write-Host "No SSL certificates found. Will run initial setup to obtain certificates." -ForegroundColor Yellow
    
    # Create a temporary config that doesn't require SSL certificates
    @"
server {
    listen 80;
    server_name api.aiwaverider.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
    }
}
"@ | Out-File -FilePath nginx\conf.d\api.temp.conf -Encoding utf8
    
    # Start nginx and backend
    Write-Host "Starting nginx and backend services..." -ForegroundColor Yellow
    docker-compose -f docker-compose.prod.yml up -d nginx backend
    
    # Get the certificates
    Write-Host "Obtaining SSL certificates..." -ForegroundColor Yellow
    docker-compose -f docker-compose.prod.yml run --rm certbot
    
    # Remove temporary config and restart with SSL config
    Remove-Item nginx\conf.d\api.temp.conf
    docker-compose -f docker-compose.prod.yml restart nginx
}
else {
    Write-Host "SSL certificates found. Starting services with existing configuration." -ForegroundColor Green
    docker-compose -f docker-compose.prod.yml up -d
}

Write-Host "Deployment completed!" -ForegroundColor Green
Write-Host "Your API should now be accessible at http://api.aiwaverider.com:81 or https://api.aiwaverider.com" -ForegroundColor Green
Write-Host ""
Write-Host "To check the status of your services:" -ForegroundColor Cyan
Write-Host "  docker-compose -f docker-compose.prod.yml ps"
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Cyan
Write-Host "  docker-compose -f docker-compose.prod.yml logs -f"
Write-Host ""
Write-Host "Remember to set up a scheduled task to renew certificates regularly" -ForegroundColor Yellow 