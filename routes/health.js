const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const logger = require('../utils/logger');
const { getCache, setCache } = require('../utils/cache');

/**
 * Health check endpoint for monitoring
 * GET /api/health
 */
router.get('/', async (req, res) => {
  try {
    // Check Firebase connection
    let firebaseStatus = 'ok';
    try {
      // Attempt to access Firestore
      const snapshot = await db.collection('system').doc('health').get();
      if (!snapshot.exists) {
        // Create health document if it doesn't exist
        await db.collection('system').doc('health').set({
          lastChecked: new Date().toISOString(),
          status: 'ok'
        });
      } else {
        // Update last checked timestamp
        await db.collection('system').doc('health').update({
          lastChecked: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Health check: Firebase connection error', error);
      firebaseStatus = 'error';
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
        firebase: firebaseStatus,
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