/**
 * Test Authentication Routes
 * 
 * Provides endpoints for testing that bypass normal authentication
 * WARNING: These routes are for testing only and should not be used in production
 */

const express = require('express');
const admin = require('firebase-admin');
const path = require('path');

const router = express.Router();

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  const serviceAccountPath = path.join(__dirname, '../../server/aiwaverider8-privatekey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://your-project.firebaseio.com'
  });
}

/**
 * Test middleware that bypasses Firebase token verification
 * This creates a mock user object for testing
 */
const testAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    
    // Check if it's a test token
    if (token === 'test-admin-token') {
      req.user = {
        uid: 'admin-test-user',
        email: 'admin@test.aiwaverider.com',
        role: 'admin',
        username: 'Admin Test User'
      };
      return next();
    }
    
    if (token === 'test-user-token') {
      req.user = {
        uid: 'test-user',
        email: 'user@test.aiwaverider.com',
        role: 'user',
        username: 'User Test User'
      };
      return next();
    }

    // If not a test token, try normal Firebase verification
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Get user data from Firestore
      const db = admin.firestore();
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found in database' });
      }

      const userData = userDoc.data();
      
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        role: userData.role || 'authenticated',
        username: userData.username
      };
      
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ 
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
  } catch (error) {
    console.error('Test auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

/**
 * Test admin middleware
 */
const testAdminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

/**
 * Clear cache endpoint with test authentication
 * POST /api/test-auth/clear-cache
 */
router.post('/clear-cache', testAuthMiddleware, testAdminMiddleware, async (req, res) => {
  try {
    // Import cache utilities
    const { deleteCacheByPattern } = require('../../utils/cache');
    
    // Clear all agent caches
    await deleteCacheByPattern('agents:*');
    await deleteCacheByPattern('agent:*');
    await deleteCacheByPattern('category:*');
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
      user: req.user
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      details: error.message
    });
  }
});

/**
 * Create agent endpoint with test authentication
 * POST /api/test-auth/agents
 */
router.post('/agents', testAuthMiddleware, testAdminMiddleware, async (req, res) => {
  try {
    // Import agent controller
    const agentsController = require('../../controllers/agent/agentsController');
    
    // Call the create agent function
    await agentsController.createAgent(req, res);
  } catch (error) {
    console.error('Error creating agent:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create agent',
      details: error.message
    });
  }
});

/**
 * Get agents endpoint with test authentication
 * GET /api/test-auth/agents
 */
router.get('/agents', testAuthMiddleware, async (req, res) => {
  try {
    // Import agent controller
    const agentsController = require('../../controllers/agent/agentsController');
    
    // Call the get agents function
    await agentsController.getAgents(req, res);
  } catch (error) {
    console.error('Error getting agents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agents',
      details: error.message
    });
  }
});

/**
 * Health check for test auth
 * GET /api/test-auth/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Test auth service is running',
    endpoints: {
      'POST /api/test-auth/clear-cache': 'Clear cache (admin only)',
      'POST /api/test-auth/agents': 'Create agent (admin only)',
      'GET /api/test-auth/agents': 'Get agents (any authenticated user)'
    },
    testTokens: {
      'test-admin-token': 'Admin access',
      'test-user-token': 'User access'
    }
  });
});

module.exports = router; 