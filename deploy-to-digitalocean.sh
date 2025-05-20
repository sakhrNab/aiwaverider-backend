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

# Configure firewall to allow traffic on port 81
echo -e "${YELLOW}Configuring firewall...${NC}"
apt install -y ufw
ufw allow 81/tcp
ufw allow ssh
# Only enable if not already enabled to avoid locking yourself out
if ! ufw status | grep -q "Status: active"; then
    echo -e "${YELLOW}Enabling firewall...${NC}"
    ufw --force enable
fi

# Run the deployment script
echo -e "${YELLOW}Running deployment script...${NC}"
bash ./deploy.sh

# Use HTTP-only configuration since port 443 is already in use
echo -e "${YELLOW}Setting up HTTP-only configuration (port 443 is already in use)...${NC}"
cp nginx/conf.d/api.http-only.conf nginx/conf.d/api.conf
docker-compose -f docker-compose.prod.yml restart nginx || true

# Set up monitoring
echo -e "${YELLOW}Setting up monitoring...${NC}"
bash ./setup-monitoring.sh

echo -e "${GREEN}Deployment to Digital Ocean completed!${NC}"
echo -e "Your API should now be accessible at:"
echo -e "  HTTP: http://api.aiwaverider.com:81"
echo -e ""
echo -e "Note: HTTPS (port 443) configuration was not set up because the port is already in use by another service."
echo -e "If you want to use HTTPS, you'll need to:"
echo -e "  1. Configure your existing web server to proxy requests to port 81"
echo -e "  2. Set up SSL certificates for api.aiwaverider.com in your existing web server"
echo -e ""
echo -e "To verify the API is running correctly, you can use:"
echo -e "  curl http://api.aiwaverider.com:81/api/health"
echo -e ""
echo -e "To check the status of your services:"
echo -e "  docker-compose -f docker-compose.prod.yml ps"
echo -e ""
echo -e "To view logs:"
echo -e "  docker-compose -f docker-compose.prod.yml logs -f" 