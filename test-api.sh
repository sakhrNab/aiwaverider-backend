#!/bin/bash
# Shell script to test the API reachability

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Testing API reachability...${NC}"

# Test local API access (HTTP)
echo -e "\n${CYAN}Testing local API (HTTP - localhost:81):${NC}"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:81/api/health)
if [ "$RESPONSE" == "200" ]; then
    echo -e "Status: ${RESPONSE} - ${GREEN}✅ Success${NC}"
    echo -e "${GRAY}Response:${NC} $(curl -s http://localhost:81/api/health)"
else
    echo -e "Status: ${RESPONSE} - ${RED}❌ Failed${NC}"
fi

# Test local API access (HTTPS)
echo -e "\n${CYAN}Testing local API (HTTPS - localhost):${NC}"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -k https://localhost/api/health)
if [ "$RESPONSE" == "200" ]; then
    echo -e "Status: ${RESPONSE} - ${GREEN}✅ Success${NC}"
    echo -e "${GRAY}Response:${NC} $(curl -s -k https://localhost/api/health)"
else
    echo -e "Status: ${RESPONSE} - ${RED}❌ Failed${NC}"
fi

# Test if api.aiwaverider.com is resolvable
echo -e "\n${CYAN}Checking if api.aiwaverider.com is resolvable:${NC}"
if host api.aiwaverider.com > /dev/null 2>&1; then
    IP=$(host api.aiwaverider.com | awk '/has address/ {print $4}')
    echo -e "${GREEN}✅ api.aiwaverider.com resolves to: ${IP}${NC}"
    
    # Try to connect to the actual domain (HTTP)
    echo -e "\n${CYAN}Testing api.aiwaverider.com:81 (HTTP):${NC}"
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://api.aiwaverider.com:81/api/health)
    if [ "$RESPONSE" == "200" ]; then
        echo -e "Status: ${RESPONSE} - ${GREEN}✅ Success${NC}"
        echo -e "${GRAY}Response:${NC} $(curl -s http://api.aiwaverider.com:81/api/health)"
    else
        echo -e "Status: ${RESPONSE} - ${RED}❌ Failed${NC}"
    fi
    
    # Try to connect to the actual domain (HTTPS)
    echo -e "\n${CYAN}Testing api.aiwaverider.com (HTTPS):${NC}"
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -k --connect-timeout 5 https://api.aiwaverider.com/api/health)
    if [ "$RESPONSE" == "200" ]; then
        echo -e "Status: ${RESPONSE} - ${GREEN}✅ Success${NC}"
        echo -e "${GRAY}Response:${NC} $(curl -s -k https://api.aiwaverider.com/api/health)"
    else
        echo -e "Status: ${RESPONSE} - ${RED}❌ Failed${NC}"
        
        # If connecting to the domain fails, suggest a modification to the hosts file
        echo -e "\n${YELLOW}Suggestion:${NC}"
        echo -e "${YELLOW}To test api.aiwaverider.com locally, you can add this entry to your hosts file:${NC}"
        echo -e "${CYAN}127.0.0.1 api.aiwaverider.com${NC}"
        echo -e "${YELLOW}The hosts file is located at: /etc/hosts${NC}"
    fi
else
    echo -e "${RED}❌ Could not resolve api.aiwaverider.com${NC}"
    
    echo -e "\n${YELLOW}Suggestion:${NC}"
    echo -e "${YELLOW}To test api.aiwaverider.com locally, you can add this entry to your hosts file:${NC}"
    echo -e "${CYAN}127.0.0.1 api.aiwaverider.com${NC}"
    echo -e "${YELLOW}The hosts file is located at: /etc/hosts${NC}"
fi

# Check if Docker containers are running
echo -e "\n${CYAN}Checking Docker containers:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E 'nginx_prod|backend_prod|redis_prod' 