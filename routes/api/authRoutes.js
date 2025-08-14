const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth/authController');
const passport = require('passport');
const jwt = require('jsonwebtoken');

// Authentication routes

// POST /api/auth/signup - Handle signup
router.post('/signup', authController.signup);

// POST /api/auth/session - Create session with Firebase token
router.post('/session', authController.createSession);

// Add alias for frontend compatibility: POST /api/auth/create-session
router.post('/create-session', authController.createSession);

// POST /api/auth/signout - Sign out user
router.post('/signout', authController.signout);

// POST /api/auth/verify-user - Verify user token
router.post('/verify-user', authController.verifyUser);

// POST /api/auth/refresh - Refresh token
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