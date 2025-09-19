const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth/authController');
const passport = require('passport');
const jwt = require('jsonwebtoken');

// Authentication routes

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Register a new user
 *     description: Create a new user account with Firebase authentication
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - uid
 *               - email
 *             properties:
 *               uid:
 *                 type: string
 *                 description: Firebase user UID
 *                 example: "firebase-user-id-123"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *                 example: "user@example.com"
 *               username:
 *                 type: string
 *                 description: Username
 *                 example: "johndoe"
 *               firstName:
 *                 type: string
 *                 description: User's first name
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 description: User's last name
 *                 example: "Doe"
 *               displayName:
 *                 type: string
 *                 description: Display name
 *                 example: "John Doe"
 *               photoURL:
 *                 type: string
 *                 description: Profile photo URL
 *                 example: "https://example.com/profile.jpg"
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number
 *                 example: "+1234567890"
 *     responses:
 *       200:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User registered successfully"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Firebase user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/signup', authController.signup);

/**
 * @swagger
 * /api/auth/session:
 *   post:
 *     summary: Create user session
 *     description: Create a new session with Firebase token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Firebase ID token
 *                 example: "firebase-id-token-here"
 *     responses:
 *       200:
 *         description: Session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 token:
 *                   type: string
 *                   description: JWT token
 *       401:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/session', authController.createSession);

// Add alias for frontend compatibility: POST /api/auth/create-session
router.post('/create-session', authController.createSession);

/**
 * @swagger
 * /api/auth/signout:
 *   post:
 *     summary: Sign out user
 *     description: Sign out the current user and clear session
 *     tags: [Authentication]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: User signed out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User signed out successfully"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/signout', authController.signout);

/**
 * @swagger
 * /api/auth/verify-user:
 *   post:
 *     summary: Verify user token
 *     description: Verify the current user's authentication token
 *     tags: [Authentication]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/verify-user', authController.verifyUser);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh authentication token
 *     description: Refresh the user's authentication token
 *     tags: [Authentication]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: New JWT token
 *       401:
 *         description: Invalid refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/refresh', authController.refreshToken);

// OAuth routes
router.get('/google/signin', passport.authenticate('google', { 
  scope: ['profile', 'email'],
  state: 'signin',
  prompt: 'select_account'
}));

router.get('/google/signup', passport.authenticate('google', { 
  scope: ['profile', 'email'],
  state: 'signup',
  prompt: 'select_account'
}));

// OAuth callback
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) {
      return res.redirect(`${process.env.FRONTEND_URL}/sign-in?error=true&message=${encodeURIComponent(err.message)}`);
    }

    if (!user) {
      // Handle specific error types
      if (info && info.errorType === 'EXISTING_ACCOUNT') {
        return res.redirect(`${process.env.FRONTEND_URL}/sign-in?error=exists&message=${encodeURIComponent(info.message)}`);
      }
      if (info && info.errorType === 'NO_ACCOUNT') {
        return res.redirect(`${process.env.FRONTEND_URL}/sign-up?error=noaccount&message=${encodeURIComponent(info.message)}`);
      }
      return res.redirect(`${process.env.FRONTEND_URL}/sign-in?error=true`);
    }

    try {
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const refreshToken = jwt.sign(
        { id: user.id },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
    } catch (error) {
      console.error('Token creation error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=true&message=${encodeURIComponent('Authentication failed')}`);
    }
  })(req, res, next);
});

module.exports = router; 