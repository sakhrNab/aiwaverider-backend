/**
 * Token Generation API Routes
 * 
 * Provides endpoints to generate Firebase ID tokens for testing
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
 * Create or get test user and generate ID token
 */
async function createTestUserAndGetToken(userId, email, role = 'user') {
  try {
    // Check if user exists
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user
        userRecord = await admin.auth().createUser({
          uid: userId,
          email: email,
          emailVerified: true,
          displayName: `${role} Test User`
        });
        
        // Set custom claims
        await admin.auth().setCustomUserClaims(userRecord.uid, {
          role: role,
          admin: role === 'admin'
        });
        
        console.log(`Created test user: ${email}`);
      } else {
        throw error;
      }
    }

    // Generate custom token
    const customToken = await admin.auth().createCustomToken(userRecord.uid, {
      role: role,
      email: email,
      admin: role === 'admin'
    });

    // Try to exchange custom token for ID token using Firebase Auth REST API
    if (process.env.FIREBASE_WEB_API_KEY) {
      try {
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_WEB_API_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token: customToken,
            returnSecureToken: true
          })
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.error) {
            throw new Error(`Token exchange failed: ${data.error.message}`);
          }

          return data.idToken;
        }
      } catch (error) {
        console.log('Web API key method failed, using fallback:', error.message);
      }
    }

    // Fallback: Return custom token with instructions
    console.log('Using custom token fallback - this may not work with all endpoints');
    return {
      token: customToken,
      type: 'custom',
      note: 'This is a custom token. Some endpoints may require ID tokens.'
    };
  } catch (error) {
    console.error('Error creating test user and getting token:', error);
    throw error;
  }
}

/**
 * Generate admin ID token
 * GET /api/tokens/admin
 */
router.get('/admin', async (req, res) => {
  try {
    const result = await createTestUserAndGetToken(
      'admin-test-user',
      'admin@test.aiwaverider.com',
      'admin'
    );

    if (typeof result === 'string') {
      // ID token
      res.json({
        success: true,
        token: result,
        type: 'admin',
        expiresIn: '1 hour',
        message: 'Admin ID token generated successfully'
      });
    } else {
      // Custom token fallback
      res.json({
        success: true,
        token: result.token,
        type: 'admin',
        tokenType: 'custom',
        expiresIn: '1 hour',
        message: 'Admin custom token generated (ID token exchange failed)',
        note: result.note
      });
    }
  } catch (error) {
    console.error('Error generating admin token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate admin token',
      details: error.message
    });
  }
});

/**
 * Generate user ID token
 * GET /api/tokens/user
 */
router.get('/user', async (req, res) => {
  try {
    const result = await createTestUserAndGetToken(
      'test-user',
      'user@test.aiwaverider.com',
      'user'
    );

    if (typeof result === 'string') {
      // ID token
      res.json({
        success: true,
        token: result,
        type: 'user',
        expiresIn: '1 hour',
        message: 'User ID token generated successfully'
      });
    } else {
      // Custom token fallback
      res.json({
        success: true,
        token: result.token,
        type: 'user',
        tokenType: 'custom',
        expiresIn: '1 hour',
        message: 'User custom token generated (ID token exchange failed)',
        note: result.note
      });
    }
  } catch (error) {
    console.error('Error generating user token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate user token',
      details: error.message
    });
  }
});

/**
 * Generate both admin and user ID tokens
 * GET /api/tokens/both
 */
router.get('/both', async (req, res) => {
  try {
    const adminResult = await createTestUserAndGetToken(
      'admin-test-user',
      'admin@test.aiwaverider.com',
      'admin'
    );

    const userResult = await createTestUserAndGetToken(
      'test-user',
      'user@test.aiwaverider.com',
      'user'
    );

    const adminToken = typeof adminResult === 'string' ? adminResult : adminResult.token;
    const userToken = typeof userResult === 'string' ? userResult : userResult.token;

    res.json({
      success: true,
      tokens: {
        admin: adminToken,
        user: userToken
      },
      expiresIn: '1 hour',
      message: 'Both tokens generated successfully',
      note: typeof adminResult !== 'string' || typeof userResult !== 'string' 
        ? 'Some tokens are custom tokens (ID token exchange failed)'
        : undefined
    });
  } catch (error) {
    console.error('Error generating tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate tokens',
      details: error.message
    });
  }
});

/**
 * Generate ID token with custom claims
 * POST /api/tokens/custom
 */
router.post('/custom', async (req, res) => {
  try {
    const { userId, email, claims } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({
        success: false,
        error: 'userId and email are required'
      });
    }

    const result = await createTestUserAndGetToken(
      userId,
      email,
      claims?.role || 'user'
    );

    if (typeof result === 'string') {
      // ID token
      res.json({
        success: true,
        token: result,
        userId,
        email,
        claims: claims || {},
        expiresIn: '1 hour',
        message: 'Custom ID token generated successfully'
      });
    } else {
      // Custom token fallback
      res.json({
        success: true,
        token: result.token,
        userId,
        email,
        claims: claims || {},
        tokenType: 'custom',
        expiresIn: '1 hour',
        message: 'Custom token generated (ID token exchange failed)',
        note: result.note
      });
    }
  } catch (error) {
    console.error('Error generating custom token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate custom token',
      details: error.message
    });
  }
});

/**
 * Health check for token service
 * GET /api/tokens/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Token service is running',
    endpoints: {
      'GET /api/tokens/admin': 'Generate admin ID token',
      'GET /api/tokens/user': 'Generate user ID token',
      'GET /api/tokens/both': 'Generate both ID tokens',
      'POST /api/tokens/custom': 'Generate custom ID token'
    },
    note: process.env.FIREBASE_WEB_API_KEY 
      ? 'Web API key configured - ID tokens will be generated'
      : 'No web API key - custom tokens will be generated (may not work with all endpoints)'
  });
});

module.exports = router; 