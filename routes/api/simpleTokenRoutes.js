/**
 * Simple Token Generation Routes
 * 
 * Provides simple endpoints to generate working tokens for testing
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
 * Generate a simple admin token that works with the middleware
 * GET /api/simple-tokens/admin
 */
router.get('/admin', async (req, res) => {
  try {
    const db = admin.firestore();
    
    // Create or get admin user in Firestore
    const adminUserRef = db.collection('users').doc('admin-test-user');
    const adminUserDoc = await adminUserRef.get();
    
    if (!adminUserDoc.exists) {
      // Create admin user in Firestore
      await adminUserRef.set({
        email: 'admin@test.aiwaverider.com',
        username: 'Admin Test User',
        role: 'admin',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Create Firebase Auth user
      await admin.auth().createUser({
        uid: 'admin-test-user',
        email: 'admin@test.aiwaverider.com',
        emailVerified: true,
        displayName: 'Admin Test User'
      });
      
      // Set custom claims
      await admin.auth().setCustomUserClaims('admin-test-user', {
        role: 'admin',
        admin: true
      });
    }

    // Generate custom token
    const customToken = await admin.auth().createCustomToken('admin-test-user', {
      role: 'admin',
      email: 'admin@test.aiwaverider.com',
      admin: true
    });

    res.json({
      success: true,
      token: customToken,
      type: 'admin',
      expiresIn: '1 hour',
      message: 'Admin token generated successfully',
      note: 'This is a custom token. Use with /api/test-auth/ endpoints for best compatibility.'
    });
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
 * Generate a simple user token
 * GET /api/simple-tokens/user
 */
router.get('/user', async (req, res) => {
  try {
    const db = admin.firestore();
    
    // Create or get user in Firestore
    const userRef = db.collection('users').doc('test-user');
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      // Create user in Firestore
      await userRef.set({
        email: 'user@test.aiwaverider.com',
        username: 'User Test User',
        role: 'user',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Create Firebase Auth user
      await admin.auth().createUser({
        uid: 'test-user',
        email: 'user@test.aiwaverider.com',
        emailVerified: true,
        displayName: 'User Test User'
      });
      
      // Set custom claims
      await admin.auth().setCustomUserClaims('test-user', {
        role: 'user',
        admin: false
      });
    }

    // Generate custom token
    const customToken = await admin.auth().createCustomToken('test-user', {
      role: 'user',
      email: 'user@test.aiwaverider.com',
      admin: false
    });

    res.json({
      success: true,
      token: customToken,
      type: 'user',
      expiresIn: '1 hour',
      message: 'User token generated successfully',
      note: 'This is a custom token. Use with /api/test-auth/ endpoints for best compatibility.'
    });
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
 * Health check
 * GET /api/simple-tokens/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Simple token service is running',
    endpoints: {
      'GET /api/simple-tokens/admin': 'Generate admin token',
      'GET /api/simple-tokens/user': 'Generate user token'
    },
    recommendedUsage: {
      'For admin endpoints': 'Use with /api/test-auth/ routes',
      'For user endpoints': 'Use with /api/test-auth/ routes',
      'Test tokens': 'test-admin-token, test-user-token'
    }
  });
});

module.exports = router; 