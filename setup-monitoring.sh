#!/bin/bash
# AIWaverider Monitoring Setup Script

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up basic monitoring for AIWaverider...${NC}"

# Create directory for monitoring scripts
mkdir -p ~/monitoring

# Create health check script
cat > ~/monitoring/health-check.sh << 'EOF'
#!/bin/bash

# Configuration
API_URL_HTTP="http://api.aiwaverider.com:81/api/health"
FRONTEND_URL="https://aiwaverider.com"
EMAIL="your-email@example.com"
SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" # Optional

# Check API health via HTTP
API_HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $API_URL_HTTP)
if [ "$API_HTTP_STATUS" != "200" ]; then
    MESSAGE="API HTTP endpoint is down! Status code: $API_HTTP_STATUS"
    echo $MESSAGE
    
    # Send email alert
    echo $MESSAGE | mail -s "ALERT: AIWaverider API HTTP Down" $EMAIL
    
    # Send Slack alert if configured
    if [ -n "$SLACK_WEBHOOK" ] && [ "$SLACK_WEBHOOK" != "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" ]; then
        curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"🔴 $MESSAGE\"}" $SLACK_WEBHOOK
    fi
fi

# Check Frontend health
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $FRONTEND_URL)
if [ "$FRONTEND_STATUS" != "200" ]; then
    MESSAGE="Frontend is down! Status code: $FRONTEND_STATUS"
    echo $MESSAGE
    
    # Send email alert
    echo $MESSAGE | mail -s "ALERT: AIWaverider Frontend Down" $EMAIL
    
    # Send Slack alert if configured
    if [ -n "$SLACK_WEBHOOK" ] && [ "$SLACK_WEBHOOK" != "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" ]; then
        curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"🔴 $MESSAGE\"}" $SLACK_WEBHOOK
    fi
fi

# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    MESSAGE="Disk usage is critically high: ${DISK_USAGE}%"
    echo $MESSAGE
    
    # Send email alert
    echo $MESSAGE | mail -s "ALERT: AIWaverider Disk Space Critical" $EMAIL
    
    # Send Slack alert if configured
    if [ -n "$SLACK_WEBHOOK" ] && [ "$SLACK_WEBHOOK" != "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" ]; then
        curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"⚠️ $MESSAGE\"}" $SLACK_WEBHOOK
    fi
fi

# Check memory usage
MEM_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
if [ "$MEM_USAGE" -gt 90 ]; then
    MESSAGE="Memory usage is critically high: ${MEM_USAGE}%"
    echo $MESSAGE
    
    # Send email alert
    echo $MESSAGE | mail -s "ALERT: AIWaverider Memory Usage Critical" $EMAIL
    
    # Send Slack alert if configured
    if [ -n "$SLACK_WEBHOOK" ] && [ "$SLACK_WEBHOOK" != "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" ]; then
        curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"⚠️ $MESSAGE\"}" $SLACK_WEBHOOK
    fi
fi

# Check Docker containers
STOPPED_CONTAINERS=$(docker ps -a --filter "status=exited" --filter "name=frontend_prod\|backend_prod\|nginx_prod" --format "{{.Names}}")
if [ -n "$STOPPED_CONTAINERS" ]; then
    MESSAGE="Critical containers are stopped: $STOPPED_CONTAINERS"
    echo $MESSAGE
    
    # Send email alert
    echo $MESSAGE | mail -s "ALERT: AIWaverider Containers Down" $EMAIL
    
    # Send Slack alert if configured
    if [ -n "$SLACK_WEBHOOK" ] && [ "$SLACK_WEBHOOK" != "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" ]; then
        curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"🔴 $MESSAGE\"}" $SLACK_WEBHOOK
    fi
    
    # Attempt to restart containers
    for CONTAINER in $STOPPED_CONTAINERS; do
        echo "Attempting to restart $CONTAINER..."
        docker start $CONTAINER
    done
fi
EOF

chmod +x ~/monitoring/health-check.sh

# Install dependencies
echo -e "${YELLOW}Installing monitoring dependencies...${NC}"
sudo apt-get install -y mailutils curl

# Set up cron job to run every 5 minutes
echo -e "${YELLOW}Setting up cron job...${NC}"
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/monitoring/health-check.sh >> ~/monitoring/health-check.log 2>&1") | crontab -

echo -e "${GREEN}Monitoring setup complete!${NC}"
echo -e "Health checks will run every 5 minutes and notify you if there are issues."
echo -e "Please edit ~/monitoring/health-check.sh to update your email and Slack webhook (if desired)."
echo -e "Logs will be saved to ~/monitoring/health-check.log"
echo -e "You can test the monitoring with: ~/monitoring/health-check.sh 