// backend/controllers/auth/authController.js

const admin = require('firebase-admin');
const { pool } = require('../../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const emailService = require('../../services/email/emailService');
const logger = require('../../utils/logger');

/**
 * Handle user sign up with Firebase
 */
exports.signup = async (req, res) => {
  try {
    const { uid, email, username, firstName, lastName, phoneNumber, displayName, photoURL } = req.body;

    console.log('Signup request received for user:', { uid, email, username });

    // Verify the user exists in Firebase
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().getUser(uid);
      if (!firebaseUser) {
        console.error('Firebase user not found:', uid);
        return res.status(404).json({ error: 'Firebase user not found' });
      }
      console.log('Firebase user verified:', firebaseUser.uid);
    } catch (authError) {
      console.error('Error verifying Firebase user:', authError);
      return res.status(404).json({ error: `Firebase user verification failed: ${authError.message}` });
    }

    // Check if user already exists in database
    let existingUserResult;
    try {
      existingUserResult = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
      if (existingUserResult.rows.length > 0) {
        console.log('User already exists in database:', uid);
        const existingUser = existingUserResult.rows[0];
        const existingUserData = {
          username: existingUser.username,
          firstName: existingUser.first_name,
          lastName: existingUser.last_name,
          email: existingUser.email,
          phoneNumber: existingUser.phone_number,
          role: existingUser.role,
          displayName: existingUser.display_name,
          photoURL: existingUser.photo_url,
          searchField: existingUser.search_field,
          status: existingUser.status,
          emailPreferences: existingUser.email_preferences,
          onboarding: existingUser.onboarding,
          signupMethod: existingUser.signup_method,
          createdAt: existingUser.created_at,
          updatedAt: existingUser.updated_at
        };
        return res.json({
          message: 'Welcome back! Your account already exists.',
          user: {
            uid,
            ...existingUserData
          },
          profile: existingUserData // Include profile data in response
        });
      }
      console.log('User does not exist in database, creating new record');
    } catch (dbError) {
      console.error('Error checking user in database:', dbError);
      return res.status(500).json({ error: `Database error: ${dbError.message}` });
    }

    // Check if username already exists (only if username provided)
    if (username) {
      try {
        const usernameResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (usernameResult.rows.length > 0) {
          console.log('Username already taken:', username);
          return res.status(400).json({ error: 'Username is already taken.' });
        }
        console.log('Username is available:', username);
      } catch (usernameError) {
        console.error('Error checking username:', usernameError);
        return res.status(500).json({ error: `Username check error: ${usernameError.message}` });
      }
    }

    // Check if email already exists in database (separate from Firebase Auth)
    try {
      const emailResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (emailResult.rows.length > 0) {
        console.log('Email already exists in database:', email);
        return res.status(400).json({ error: 'An account with this email already exists in our database.' });
      }
      console.log('Email is available:', email);
    } catch (emailError) {
      console.error('Error checking email existence:', emailError);
      return res.status(500).json({ error: `Email check error: ${emailError.message}` });
    }

    // Generate fallback values for missing fields
    const finalFirstName = firstName || displayName?.split(' ')[0] || email.split('@')[0];
    const finalLastName = lastName || displayName?.split(' ').slice(1).join(' ') || '';
    const finalUsername = username || `user_${email.split('@')[0]}_${Date.now().toString().slice(-4)}`;
    const finalDisplayName = displayName || `${finalFirstName} ${finalLastName}`.trim();

    // Create searchable field for better querying
    const searchField = `${finalUsername.toLowerCase()} ${email.toLowerCase()} ${finalFirstName.toLowerCase()} ${finalLastName.toLowerCase()}`.trim();

    // Set optimized email preferences for better conversion
    const emailPreferences = {
      weeklyUpdates: false, // Default to false to reduce email fatigue
      announcements: true, // Keep important announcements
      newAgents: false, // Default to false, user can enable later
      newTools: false, // Default to false, user can enable later
      marketingEmails: false // Default to false for better user experience
    };

    // Onboarding status for progressive data collection
    const onboarding = {
      completed: false,
      currentStep: 'welcome',
      profileComplete: false,
      phoneNumberAdded: false,
      profileImageAdded: !!photoURL
    };

    // Signup method tracking for analytics
    const signupMethod = photoURL ? 'social' : 'email';

    console.log('Creating user record in database:', uid);

    try {
      // Use a transaction to ensure data consistency
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Double-check user doesn't exist within transaction
        const existingCheck = await client.query('SELECT id FROM users WHERE id = $1', [uid]);
        if (existingCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          throw new Error('User already exists');
        }

        // Create the user record
        await client.query(
          `INSERT INTO users (id, username, first_name, last_name, email, phone_number, role, display_name, photo_url, search_field, status, email_preferences, onboarding, signup_method, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
          [
            uid,
            finalUsername,
            finalFirstName,
            finalLastName,
            email.toLowerCase(),
            phoneNumber || '',
            'authenticated',
            finalDisplayName,
            photoURL || firebaseUser.photoURL || '',
            searchField,
            'active',
            JSON.stringify(emailPreferences),
            JSON.stringify(onboarding),
            signupMethod
          ]
        );

        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      console.log('User record created successfully in database:', uid);
    } catch (createError) {
      console.error('Error creating user record in database:', createError);
      return res.status(500).json({ error: `Failed to create user record: ${createError.message}` });
    }

    // Send welcome email (optimized for conversion)
    try {
      const emailData = {
        uid,
        email,
        firstName: finalFirstName,
        lastName: finalLastName,
        displayName: finalDisplayName,
        signupMethod
      };

      // Use await to properly handle the promise
      const emailResult = await emailService.sendWelcomeEmail(emailData);

      if (emailResult.success) {
        logger.info(`Welcome email sent to new user: ${email} (${emailResult.messageId})`);
      } else {
        logger.warn(`Failed to send welcome email to new user: ${email} - ${emailResult.error}`);
      }
    } catch (emailError) {
      // Don't fail registration if email fails
      logger.error(`Error sending welcome email: ${emailError.message}`);
    }

    // Set session cookie
    try {
      const idToken = await admin.auth().createCustomToken(uid);
      res.cookie('firebaseToken', idToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      console.log('Session cookie set successfully');
    } catch (tokenError) {
      console.error('Error creating custom token:', tokenError);
      // Continue without setting cookie
    }

    console.log('Signup process completed successfully for:', uid);

    // Return success message optimized for user experience
    const successMessage = signupMethod === 'social'
      ? 'Account created successfully with social login!'
      : 'Account created successfully! Welcome to our platform!';

    // IMPORTANT: Include both user and profile data in response
    const responseData = {
      uid,
      username: finalUsername,
      email: email.toLowerCase(),
      firstName: finalFirstName,
      lastName: finalLastName,
      displayName: finalDisplayName,
      role: 'authenticated',
      photoURL: photoURL || firebaseUser.photoURL || '',
      onboarding,
      phoneNumber: phoneNumber || '',
      emailPreferences,
      status: 'active',
      createdAt: new Date().toISOString() // Convert timestamp for JSON response
    };

    return res.json({
      message: successMessage,
      user: responseData,
      profile: responseData // Include profile data for immediate use
    });
  } catch (err) {
    console.error('Error in /api/auth/signup:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Create a session from a Firebase ID token
 */
exports.createSession = async (req, res) => {
  try {
    // Get token from either the request body or Authorization header
    let idToken = req.body.idToken;
    if (!idToken && req.headers.authorization) {
      idToken = req.headers.authorization.split('Bearer ')[1];
    }

    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    // Verify the ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Get user data from database
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in database' });
    }

    const userData = userResult.rows[0];

    // Create a session token
    const sessionToken = jwt.sign(
      {
        uid,
        role: userData.role || 'authenticated',
        email: userData.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set session cookie
    res.cookie('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    return res.json({
      message: 'Session created successfully',
      user: {
        uid,
        username: userData.username,
        email: userData.email,
        role: userData.role || 'authenticated',
        photoURL: userData.photo_url || null,
        displayName: userData.display_name || null,
        firstName: userData.first_name || '',
        lastName: userData.last_name || '',
        phoneNumber: userData.phone_number || '',
        onboarding: userData.onboarding || { completed: false }
      }
    });
  } catch (err) {
    console.error('Error creating session:', err);
    return res.status(500).json({
      error: 'Failed to create session',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Sign out user by clearing cookies
 */
exports.signout = (req, res) => {
  res.clearCookie('firebaseToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });

  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });

  return res.json({ message: 'Signed out successfully' });
};

/**
 * Verify a user's token
 */
exports.verifyUser = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      errorType: 'UNAUTHORIZED',
      error: 'No token provided'
    });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Check if user exists in database
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decodedToken.uid]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        errorType: 'NO_ACCOUNT',
        error: 'No account found. Please sign up first.'
      });
    }

    const row = userResult.rows[0];

    return res.json({
      success: true,
      user: {
        uid: row.id,
        username: row.username,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phoneNumber: row.phone_number,
        role: row.role,
        displayName: row.display_name,
        photoURL: row.photo_url,
        searchField: row.search_field,
        status: row.status,
        emailPreferences: row.email_preferences,
        onboarding: row.onboarding,
        signupMethod: row.signup_method,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    console.error('Error verifying user:', error);
    return res.status(500).json({
      errorType: 'SYSTEM_ERROR',
      error: 'Failed to verify user'
    });
  }
};

/**
 * Refresh access token using refresh token
 */
exports.refreshToken = async (req, res) => {
  try {
    // Get refresh token from cookies, headers, or request body
    let refreshToken = null;

    // Try to get from cookies
    if (req.cookies && req.cookies.refreshToken) {
      refreshToken = req.cookies.refreshToken;
    }

    // If not in cookies, try Authorization header
    if (!refreshToken && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        refreshToken = authHeader.substring(7);
      }
    }

    // If still not found, try request body
    if (!refreshToken && req.body && req.body.refreshToken) {
      refreshToken = req.body.refreshToken;
    }

    if (!refreshToken) {
      return res.status(401).json({
        error: 'No refresh token found',
        user: null
      });
    }

    try {
      const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
      const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [payload.id]);

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          error: 'User not found',
          user: null
        });
      }

      const userData = userResult.rows[0];
      const token = jwt.sign(
        {
          id: userData.id,
          username: userData.username,
          email: userData.email,
          role: userData.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Set new access token cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      return res.json({
        message: 'Token refreshed successfully',
        user: {
          id: userData.id,
          username: userData.username,
          email: userData.email,
          role: userData.role,
        }
      });
    } catch (tokenError) {
      // Clear invalid tokens
      res.clearCookie('token');
      res.clearCookie('refreshToken');
      return res.status(401).json({ error: 'Invalid refresh token', user: null });
    }
  } catch (err) {
    console.error('Error in refreshToken:', err);
    return res.status(401).json({ error: 'Invalid refresh token', user: null });
  }
};