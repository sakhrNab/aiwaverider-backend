# Changelog

All notable changes to the aiwaverider-backend project will be documented in this file.

## [Unreleased]

### Changed
- Updated backend service port from 8080 to 5000 to avoid port conflicts in Coolify
  - Changed PORT environment variable to 5000
  - Updated Dockerfile.prod EXPOSE directive to 5000
  - Updated Traefik loadbalancer server port to 5000
  - Updated healthcheck to use port 5000

### Added
- Created `docker-compose.yml` file optimized for Coolify deployment
  - Configured with Traefik labels for automatic reverse proxy integration
  - Added health checks for both backend and Redis services
  - Set up internal networking between services without exposing ports externally
  - Configured Redis with persistence and optimized settings

### Changed
- Updated `Dockerfile.prod` to use Node.js 20 LTS (from Node.js 18)
  - This ensures compatibility with latest Node.js features and security updates
  - Changed exposed port from 4000 to 8080 to match production expectations
- Redis configuration uses latest 7-alpine image for optimal performance and security

### Technical Details
- The docker-compose.yml is designed to work with Coolify's Traefik reverse proxy
- Domain configuration (aiwaverider.com) will be handled in Coolify UI, not hardcoded in the compose file
- All services use internal networking - no ports are exposed to the host, relying on Coolify's proxy
- Health checks ensure service reliability and automatic recovery
