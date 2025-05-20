# PowerShell script to renew Let's Encrypt certificates

Write-Host "Starting certificate renewal process..." -ForegroundColor Yellow

# Run certbot renewal
docker-compose -f docker-compose.prod.yml run --rm certbot renew

# Reload nginx configuration to apply new certificates
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload

Write-Host "Certificate renewal process completed!" -ForegroundColor Green 