const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { getCache, setCache } = require('../utils/cache');

/**
 * Health check endpoint for monitoring
 * GET /api/health
 */
router.get('/', async (req, res) => {
  try {
    // Check PostgreSQL connection
    let databaseStatus = 'ok';
    try {
      // Attempt to query PostgreSQL
      await pool.query('SELECT 1');
    } catch (error) {
      logger.error('Health check: PostgreSQL connection error', error);
      databaseStatus = 'error';
    }

    // Check Redis connection
    let redisStatus = 'ok';
    try {
      // Attempt to use Redis
      const healthCheckKey = 'health:check';
      const timestamp = new Date().toISOString();
      await setCache(healthCheckKey, { timestamp }, 60);
      const result = await getCache(healthCheckKey);
      
      if (!result || !result.timestamp) {
        throw new Error('Redis read/write check failed');
      }
    } catch (error) {
      logger.error('Health check: Redis connection error', error);
      redisStatus = 'error';
    }

    // Return health status
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: databaseStatus,
        redis: redisStatus
      }
    });
  } catch (error) {
    logger.error('Health check failed', error);
    return res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router; 