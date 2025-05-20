#!/bin/sh

# Exit on error
set -e

echo "Starting AIWaverider Backend deployment..."

# Check for docker and docker-compose
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed."
    exit 1
fi

# Ensure directories exist
mkdir -p nginx/conf.d nginx/ssl nginx/certbot/conf nginx/certbot/www

# Check for existing certificates - if not, start with a temporary config
if [ ! -d "nginx/certbot/conf/live/api.aiwaverider.com" ]; then
    echo "No SSL certificates found. Will run initial setup to obtain certificates."
    
    # Create a temporary config that doesn't require SSL certificates
    cat > nginx/conf.d/api.temp.conf << 'EOF'
server {
    listen 80;
    server_name api.aiwaverider.com;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

    # Start nginx and backend
    docker-compose -f docker-compose.prod.yml up -d nginx backend
    
    # Get the certificates
    docker-compose -f docker-compose.prod.yml run --rm certbot
    
    # Remove temporary config and restart with SSL config
    rm nginx/conf.d/api.temp.conf
    docker-compose -f docker-compose.prod.yml restart nginx
else
    echo "SSL certificates found. Starting services with existing configuration."
    docker-compose -f docker-compose.prod.yml up -d
fi

echo "Deployment completed!"
echo "Your API should now be accessible at http://api.aiwaverider.com:81 or https://api.aiwaverider.com"
echo ""
echo "To check the status of your services:"
echo "  docker-compose -f docker-compose.prod.yml ps"
echo ""
echo "To view logs:"
echo "  docker-compose -f docker-compose.prod.yml logs -f"
echo ""
echo "Remember to set up a cron job to renew certificates:"
echo "  0 12 * * * /path/to/renew-cert.sh >> /var/log/cert-renew.log 2>&1" 