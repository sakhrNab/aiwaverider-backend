#!/bin/bash
# Script to deploy AIWaverider backend to Digital Ocean

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Deploying AIWaverider backend to Digital Ocean...${NC}"

# Update system packages
echo -e "${YELLOW}Updating system packages...${NC}"
apt update && apt upgrade -y

# Install Docker and Docker Compose if not already installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $USER
    echo -e "${GREEN}Docker installed successfully${NC}"
else
    echo -e "${GREEN}Docker already installed${NC}"
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/download/v2.18.1/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}Docker Compose installed successfully${NC}"
else
    echo -e "${GREEN}Docker Compose already installed${NC}"
fi

# Configure firewall to allow traffic on port 81 and 443
echo -e "${YELLOW}Configuring firewall...${NC}"
apt install -y ufw
ufw allow 81/tcp
ufw allow 443/tcp
ufw allow ssh
# Only enable if not already enabled to avoid locking yourself out
if ! ufw status | grep -q "Status: active"; then
    echo -e "${YELLOW}Enabling firewall...${NC}"
    ufw --force enable
fi

# Run the deployment script
echo -e "${YELLOW}Running deployment script...${NC}"
bash ./deploy.sh

# Check for SSL certificates
echo -e "${YELLOW}Checking for SSL certificates...${NC}"
if [ ! -d "nginx/certbot/conf/live/api.aiwaverider.com" ]; then
    echo -e "${YELLOW}No SSL certificates found. Will use HTTP only for now.${NC}"
    # Use the HTTP-only configuration
    cp nginx/conf.d/api.http-only.conf nginx/conf.d/api.conf
    docker-compose -f docker-compose.prod.yml restart nginx
    
    echo -e "${YELLOW}To set up SSL certificates later, run:${NC}"
    echo -e "  docker-compose -f docker-compose.prod.yml run --rm certbot"
    echo -e "  cp nginx/conf.d/api.https.conf nginx/conf.d/api.conf"
    echo -e "  docker-compose -f docker-compose.prod.yml restart nginx"
else
    echo -e "${GREEN}SSL certificates found. Using HTTPS configuration.${NC}"
    # Use the HTTPS configuration with redirection
    cp nginx/conf.d/api.https.conf nginx/conf.d/api.conf
    docker-compose -f docker-compose.prod.yml restart nginx
fi

# Set up monitoring
echo -e "${YELLOW}Setting up monitoring...${NC}"
bash ./setup-monitoring.sh

echo -e "${GREEN}Deployment to Digital Ocean completed!${NC}"
echo -e "Your API should now be accessible at:"
echo -e "  HTTP: http://api.aiwaverider.com:81"
echo -e "  HTTPS: https://api.aiwaverider.com (if SSL is configured)"
echo -e ""
echo -e "To verify the API is running correctly, you can use:"
echo -e "  curl http://api.aiwaverider.com:81/api/health"
echo -e ""
echo -e "To check the status of your services:"
echo -e "  docker-compose -f docker-compose.prod.yml ps"
echo -e ""
echo -e "To view logs:"
echo -e "  docker-compose -f docker-compose.prod.yml logs -f" 