const admin = require('firebase-admin');
const { db } = require('../config/firebase');

/**
 * Admin authentication middleware for video endpoints
 * Uses Firebase token verification and checks admin role
 * Aligns with the existing authentication pattern in the codebase
 */
const adminAuth = async (req, res, next) => {
  try {
    // Get token from X-Admin-Token header (as your frontend sends it)
    const token = req.headers['x-admin-token'];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'X-Admin-Token header required' 
      });
    }

    console.log('Verifying admin token for video endpoint:', token.substring(0, 20) + '...');

    // Verify the Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid token' 
      });
    }

    console.log('Token verified for user:', decodedToken.email);

    // Get user data from Firestore to check admin role
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    
    if (!userDoc.exists) {
      console.log('User not found in database for uid:', decodedToken.uid);
      return res.status(404).json({ 
        error: 'User not found',
        message: 'User not found in database' 
      });
    }

    const userData = userDoc.data();
    const isAdmin = userData.role === 'admin';

    if (!isAdmin) {
      console.log('User is not admin:', decodedToken.email, 'Role:', userData.role);
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'Admin access required' 
      });
    }

    console.log('Admin authentication successful for:', decodedToken.email);

    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: userData.role,
      username: userData.username
    };

    next();

  } catch (error) {
    console.error('Admin token verification failed:', error);
    
    // Provide specific error messages
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Token expired. Please sign in again.' 
      });
    } else if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Invalid token format' 
      });
    } else if (error.code === 'auth/argument-error') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Invalid token provided' 
      });
    } else {
      return res.status(500).json({ 
        error: 'Authentication error',
        message: 'Failed to verify admin token' 
      });
    }
  }
};

module.exports = adminAuth; 