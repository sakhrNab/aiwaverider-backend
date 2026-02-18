const express = require('express');
const router = express.Router();
const admin = require('firebase-admin'); // KEPT for admin.auth() and admin.storage()
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const crypto = require('crypto');
const upload = require('../../middleware/upload');
const { pool } = require('../../config/database');

// TODO: Ensure these JSONB columns exist in the users table (run migration):
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS interests JSONB DEFAULT '[]'::jsonb;
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS favorites JSONB DEFAULT '[]'::jsonb;
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications JSONB DEFAULT '{}'::jsonb;
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"language":"en","theme":"light"}'::jsonb;
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';

/**
 * Helper function to safely convert a value to ISO string.
 * PostgreSQL returns proper Date objects, so this is simplified from the Firestore version.
 */
const toISOString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  try {
    return new Date(value).toISOString();
  } catch (e) {
    console.warn('[Profile API] Failed to convert value to ISO string:', value);
    return null;
  }
};

/**
 * Helper: convert a PostgreSQL users row (snake_case) to camelCase API response.
 */
const formatUserRow = (row) => {
  return {
    uid: row.id,
    email: row.email || '',
    username: row.username || '',
    displayName: row.display_name || '',
    photoURL: row.photo_url || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    role: row.role || 'authenticated',
    phoneNumber: row.phone_number || '',
    interests: row.interests || [],
    notifications: row.notifications || {},
    emailPreferences: row.email_preferences || {},
    onboarding: row.onboarding || { completed: false },
    status: row.status || 'active',
    bio: row.bio || '',
    language: (row.settings && row.settings.language) || 'en',
    theme: (row.settings && row.settings.theme) || 'light',
    subscription: row.subscription || {},
    createdAt: toISOString(row.created_at),
    updatedAt: toISOString(row.updated_at)
  };
};

// GET /api/profile - Get user profile with improved error handling
/**
 * @swagger
 * /api/profile:
 *   get:
 *     summary: Get user profile
 *     description: Retrieve the current user's profile information
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uid:
 *                   type: string
 *                   example: "user-123"
 *                 email:
 *                   type: string
 *                   format: email
 *                   example: "user@example.com"
 *                 username:
 *                   type: string
 *                   example: "john_doe"
 *                 displayName:
 *                   type: string
 *                   example: "John Doe"
 *                 photoURL:
 *                   type: string
 *                   format: uri
 *                   example: "https://example.com/photo.jpg"
 *                 firstName:
 *                   type: string
 *                   example: "John"
 *                 lastName:
 *                   type: string
 *                   example: "Doe"
 *                 role:
 *                   type: string
 *                   example: "authenticated"
 *                 phoneNumber:
 *                   type: string
 *                   example: "+1234567890"
 *                 interests:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["AI", "Tech", "Development"]
 *                 notifications:
 *                   type: object
 *                   properties:
 *                     email:
 *                       type: boolean
 *                     inApp:
 *                       type: boolean
 *                 emailPreferences:
 *                   type: object
 *                   properties:
 *                     weeklyUpdates:
 *                       type: boolean
 *                     announcements:
 *                       type: boolean
 *                     newAgents:
 *                       type: boolean
 *                     newTools:
 *                       type: boolean
 *                     marketingEmails:
 *                       type: boolean
 *                 onboarding:
 *                   type: object
 *                   properties:
 *                     completed:
 *                       type: boolean
 *                     currentStep:
 *                       type: string
 *                     profileComplete:
 *                       type: boolean
 *                     phoneNumberAdded:
 *                       type: boolean
 *                     profileImageAdded:
 *                       type: boolean
 *                 status:
 *                   type: string
 *                   example: "active"
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User profile not found
 *       500:
 *         description: Internal server error
 */
router.get('/', validateFirebaseToken, async (req, res) => {
  try {
    console.log('[Profile API] Fetching profile for user:', req.user.uid);

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.uid]);

    if (rows.length === 0) {
      console.warn('[Profile API] User profile not found in database:', req.user.uid);

      // Try to get Firebase user info as fallback
      try {
        const firebaseUser = await admin.auth().getUser(req.user.uid);
        console.log('[Profile API] Found Firebase user, creating minimal profile response');

        const firstName = firebaseUser.displayName?.split(' ')[0] || firebaseUser.email?.split('@')[0] || '';
        const lastName = firebaseUser.displayName?.split(' ').slice(1).join(' ') || '';
        const username = `user_${firebaseUser.email?.split('@')[0]}_${Date.now().toString().slice(-4)}`;
        const email = firebaseUser.email || req.user.email;
        const photoURL = firebaseUser.photoURL || '';
        const searchField = `${username.toLowerCase()} ${email.toLowerCase()} ${firstName.toLowerCase()} ${lastName.toLowerCase()}`.trim();
        const displayName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';

        const emailPreferences = {
          weeklyUpdates: false,
          announcements: true,
          newAgents: false,
          newTools: false,
          marketingEmails: false
        };
        const onboarding = {
          completed: false,
          currentStep: 'welcome',
          profileComplete: false,
          phoneNumberAdded: false,
          profileImageAdded: !!photoURL
        };
        const signupMethod = photoURL ? 'social' : 'email';

        // Create the user row in PostgreSQL
        try {
          const insertResult = await pool.query(
            `INSERT INTO users (
              id, email, username, first_name, last_name, display_name,
              phone_number, photo_url, role, status, search_field,
              email_preferences, onboarding, signup_method, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12, $13, $14, NOW(), NOW()
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING *`,
            [
              req.user.uid, email, username, firstName, lastName, displayName,
              firebaseUser.phoneNumber || '', photoURL, 'authenticated', 'active', searchField,
              JSON.stringify(emailPreferences), JSON.stringify(onboarding), signupMethod
            ]
          );

          console.log('[Profile API] Created missing user row in PostgreSQL');

          if (insertResult.rows.length > 0) {
            return res.json(formatUserRow(insertResult.rows[0]));
          }

          // If ON CONFLICT fired (row existed after all), fetch it
          const { rows: refetchRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.uid]);
          if (refetchRows.length > 0) {
            return res.json(formatUserRow(refetchRows[0]));
          }

          // Fallback minimal profile
          return res.json({
            uid: req.user.uid,
            email,
            displayName,
            photoURL,
            firstName,
            lastName,
            role: 'authenticated',
            phoneNumber: firebaseUser.phoneNumber || '',
            username,
            status: 'active',
            createdAt: firebaseUser.metadata.creationTime || null,
            isMinimalProfile: true
          });
        } catch (createError) {
          console.error('[Profile API] Error creating user row:', createError);
          // Still return a minimal profile even if creation fails
          return res.json({
            uid: req.user.uid,
            email,
            displayName,
            photoURL,
            firstName,
            lastName,
            role: 'authenticated',
            phoneNumber: firebaseUser.phoneNumber || '',
            username,
            status: 'active',
            createdAt: firebaseUser.metadata.creationTime || null,
            isMinimalProfile: true
          });
        }
      } catch (firebaseError) {
        console.error('[Profile API] Error fetching Firebase user:', firebaseError);
        return res.status(404).json({
          error: 'User profile not found and could not retrieve Firebase user data',
          uid: req.user.uid
        });
      }
    }

    console.log('[Profile API] Successfully retrieved user profile');
    return res.json(formatUserRow(rows[0]));
  } catch (err) {
    console.error('[Profile API] Error fetching profile:', err);
    return res.status(500).json({
      error: 'Failed to fetch profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/profile:
 *   put:
 *     summary: Update user profile
 *     description: Update the current user's profile information
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username
 *                 example: "john_doe"
 *               firstName:
 *                 type: string
 *                 description: First name
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 description: Last name
 *                 example: "Doe"
 *               displayName:
 *                 type: string
 *                 description: Display name
 *                 example: "John Doe"
 *               photoURL:
 *                 type: string
 *                 format: uri
 *                 description: Profile photo URL
 *                 example: "https://example.com/photo.jpg"
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number
 *                 example: "+1234567890"
 *               emailPreferences:
 *                 type: object
 *                 description: Email preferences
 *                 properties:
 *                   weeklyUpdates:
 *                     type: boolean
 *                   announcements:
 *                     type: boolean
 *                   newAgents:
 *                     type: boolean
 *                   newTools:
 *                     type: boolean
 *                   marketingEmails:
 *                     type: boolean
 *               onboarding:
 *                 type: object
 *                 description: Onboarding status
 *                 properties:
 *                   completed:
 *                     type: boolean
 *                   currentStep:
 *                     type: string
 *                   profileComplete:
 *                     type: boolean
 *                   phoneNumberAdded:
 *                     type: boolean
 *                   profileImageAdded:
 *                     type: boolean
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uid:
 *                   type: string
 *                   example: "user-123"
 *                 email:
 *                   type: string
 *                   format: email
 *                 username:
 *                   type: string
 *                 displayName:
 *                   type: string
 *                 photoURL:
 *                   type: string
 *                   format: uri
 *                 firstName:
 *                   type: string
 *                 lastName:
 *                   type: string
 *                 role:
 *                   type: string
 *                 phoneNumber:
 *                   type: string
 *                 interests:
 *                   type: array
 *                   items:
 *                     type: string
 *                 notifications:
 *                   type: object
 *                 emailPreferences:
 *                   type: object
 *                 onboarding:
 *                   type: object
 *                 status:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       500:
 *         description: Internal server error
 */
router.put('/', validateFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    // Check if user exists
    const { rows: existingRows } = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);

    if (existingRows.length === 0) {
      console.warn('[Profile API] User profile not found for update, creating new one');

      // Create a new user row with provided data
      try {
        const firebaseUser = await admin.auth().getUser(uid);

        const username = req.body.username || `user_${firebaseUser.email?.split('@')[0]}_${Date.now().toString().slice(-4)}`;
        const firstName = req.body.firstName || firebaseUser.displayName?.split(' ')[0] || '';
        const lastName = req.body.lastName || firebaseUser.displayName?.split(' ').slice(1).join(' ') || '';
        const displayName = req.body.displayName || firebaseUser.displayName || `${firstName} ${lastName}`.trim();
        const email = firebaseUser.email || req.user.email;
        const photoURL = req.body.photoURL || firebaseUser.photoURL || '';
        const phoneNumber = req.body.phoneNumber || firebaseUser.phoneNumber || '';
        const searchField = `${username.toLowerCase()} ${email.toLowerCase()} ${firstName.toLowerCase()} ${lastName.toLowerCase()}`.trim();
        const emailPreferences = req.body.emailPreferences || {
          weeklyUpdates: false,
          announcements: true,
          newAgents: false,
          newTools: false,
          marketingEmails: false
        };
        const onboarding = req.body.onboarding || {
          completed: false,
          currentStep: 'welcome',
          profileComplete: false,
          phoneNumberAdded: false,
          profileImageAdded: !!photoURL
        };
        const signupMethod = photoURL ? 'social' : 'email';

        const insertResult = await pool.query(
          `INSERT INTO users (
            id, email, username, first_name, last_name, display_name,
            phone_number, photo_url, role, status, search_field,
            email_preferences, onboarding, signup_method, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, NOW(), NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            display_name = EXCLUDED.display_name,
            phone_number = EXCLUDED.phone_number,
            photo_url = EXCLUDED.photo_url,
            search_field = EXCLUDED.search_field,
            email_preferences = EXCLUDED.email_preferences,
            onboarding = EXCLUDED.onboarding,
            signup_method = EXCLUDED.signup_method,
            updated_at = NOW()
          RETURNING *`,
          [
            uid, email, username, firstName, lastName, displayName,
            phoneNumber, photoURL, 'authenticated', 'active', searchField,
            JSON.stringify(emailPreferences), JSON.stringify(onboarding), signupMethod
          ]
        );

        return res.json(formatUserRow(insertResult.rows[0]));
      } catch (createError) {
        console.error('[Profile API] Error creating user profile:', createError);
        return res.status(500).json({
          error: 'Failed to create user profile',
          details: process.env.NODE_ENV === 'development' ? createError.message : undefined
        });
      }
    }

    // Build dynamic UPDATE for existing user - only update columns that map to known schema columns
    const fieldMap = {
      username: 'username',
      firstName: 'first_name',
      lastName: 'last_name',
      displayName: 'display_name',
      photoURL: 'photo_url',
      phoneNumber: 'phone_number',
      email: 'email',
      role: 'role',
      status: 'status',
      emailPreferences: 'email_preferences',
      onboarding: 'onboarding',
      searchField: 'search_field',
      signupMethod: 'signup_method',
      subscription: 'subscription'
    };

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [apiField, dbColumn] of Object.entries(fieldMap)) {
      if (req.body[apiField] !== undefined) {
        const value = (typeof req.body[apiField] === 'object' && req.body[apiField] !== null)
          ? JSON.stringify(req.body[apiField])
          : req.body[apiField];
        setClauses.push(`${dbColumn} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    // Always set updated_at
    setClauses.push(`updated_at = NOW()`);

    // Regenerate search_field if name/username/email changed
    if (req.body.username || req.body.firstName || req.body.lastName || req.body.email) {
      const current = existingRows[0];
      const username = req.body.username || current.username || '';
      const email = req.body.email || current.email || '';
      const firstName = req.body.firstName || current.first_name || '';
      const lastName = req.body.lastName || current.last_name || '';
      const searchField = `${username.toLowerCase()} ${email.toLowerCase()} ${firstName.toLowerCase()} ${lastName.toLowerCase()}`.trim();
      setClauses.push(`search_field = $${paramIndex}`);
      values.push(searchField);
      paramIndex++;
    }

    // Add uid as the final parameter for the WHERE clause
    values.push(uid);

    const updateQuery = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const { rows: updatedRows } = await pool.query(updateQuery, values);

    return res.json(formatUserRow(updatedRows[0]));
  } catch (err) {
    console.error('[Profile API] Error updating profile:', err);
    return res.status(500).json({
      error: 'Failed to update profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/profile/upload-avatar:
 *   put:
 *     summary: Upload avatar image
 *     description: Upload and update user's profile avatar image
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - avatar
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Avatar image file (JPEG, PNG, GIF)
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 photoURL:
 *                   type: string
 *                   format: uri
 *                   description: Public URL of the uploaded avatar
 *                   example: "https://firebasestorage.googleapis.com/v0/b/bucket/o/avatars/hash-filename.jpg?alt=media"
 *       400:
 *         description: Bad request - No file uploaded or invalid file type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "No file uploaded."
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to upload avatar to storage."
 *                 details:
 *                   type: string
 *                   description: Detailed error message (development only)
 */
router.put('/upload-avatar', validateFirebaseToken, upload.single('avatar'), async (req, res) => {
  try {
    console.log('Upload avatar request received');

    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);

    // Compute md5 hash of file buffer
    const fileHash = crypto.createHash('md5').update(req.file.buffer).digest('hex');

    // Get Storage bucket (Firebase Storage is KEPT)
    const storage = admin.storage();
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

    console.log('Using bucket:', bucketName);

    try {
      const bucket = storage.bucket(bucketName);

      // Create a file reference using the hash as filename
      const fileName = `avatars/${fileHash}-${req.file.originalname}`;
      const fileRef = bucket.file(fileName);

      console.log('File reference created:', fileName);

      // Check if file exists already
      const [exists] = await fileRef.exists();
      console.log('File exists?', exists);

      if (!exists) {
        // Upload file if not exists
        console.log('Uploading file...');
        await fileRef.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
          },
        });

        // Make file public so it can be retrieved via public URL
        console.log('Making file public...');
        await fileRef.makePublic();
      }

      // Get public URL (assumes file is public or token is added)
      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
      console.log('Public URL:', publicUrl);

      // Update photo_url in PostgreSQL
      await pool.query(
        'UPDATE users SET photo_url = $1, updated_at = NOW() WHERE id = $2',
        [publicUrl, req.user.uid]
      );

      console.log('Profile updated successfully with new photoURL');
      return res.json({ photoURL: publicUrl });
    } catch (storageError) {
      console.error('Firebase Storage error:', storageError);
      return res.status(500).json({
        error: 'Failed to upload avatar to storage.',
        details: storageError.message
      });
    }
  } catch (err) {
    console.error('Error in upload-avatar endpoint:', err);
    return res.status(500).json({
      error: 'Failed to upload avatar.',
      details: err.message
    });
  }
});

/**
 * @swagger
 * /api/profile/interests:
 *   put:
 *     summary: Update user interests
 *     description: Update the current user's topics of interest
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - interests
 *             properties:
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [
 *                     "Trends", "Latest Tech", "AI Tools", "Tutorials", "News",
 *                     "Quantum Computing", "AI", "Text to Image", "Image to Video",
 *                     "Text to Video", "Text to Sound", "Text to Song", "Speech to Song",
 *                     "Editing Tools", "VR", "Health", "Finance", "Automation", "VR and AG"
 *                   ]
 *                 description: Array of interest categories
 *                 example: ["AI", "Tech", "Development", "Tutorials"]
 *     responses:
 *       200:
 *         description: Interests updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 interests:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["AI", "Tech", "Development", "Tutorials"]
 *       400:
 *         description: Bad request - Invalid interests format or invalid categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Interests must be an array"
 *                 invalidInterests:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: List of invalid interest categories
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       500:
 *         description: Internal server error
 */
router.put('/interests', validateFirebaseToken, async (req, res) => {
  try {
    const { interests } = req.body;
    // Validate interests format
    if (!Array.isArray(interests)) {
      return res.status(400).json({ error: 'Interests must be an array' });
    }

    // Predefined categories
    const validCategories = [
      // General categories
      'Trends',
      'Latest Tech',
      'AI Tools',
      'Tutorials',
      'News',

      // Specific technology categories
      'Quantum Computing',
      'AI',
      'Text to Image',
      'Image to Video',
      'Text to Video',
      'Text to Sound',
      'Text to Song',
      'Speech to Song',
      'Editing Tools',
      'VR',
      'Health',
      'Finance',
      'Automation',
      'VR and AG'
    ];

    // Validate that all interests are from valid categories
    const invalidInterests = interests.filter(interest => !validCategories.includes(interest));
    if (invalidInterests.length > 0) {
      return res.status(400).json({
        error: 'Invalid interests detected',
        invalidInterests
      });
    }

    // Store interests as JSONB
    // TODO: Ensure 'interests' JSONB column exists in users table
    await pool.query(
      'UPDATE users SET interests = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(interests), req.user.uid]
    );

    return res.json({
      success: true,
      interests
    });
  } catch (err) {
    console.error('Error updating interests:', err);
    return res.status(500).json({ error: 'Failed to update interests' });
  }
});

/**
 * @swagger
 * /api/profile/notifications:
 *   get:
 *     summary: Get notification settings
 *     description: Retrieve the current user's notification preferences
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Notification settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 email:
 *                   type: boolean
 *                   description: Email notifications enabled
 *                   example: true
 *                 inApp:
 *                   type: boolean
 *                   description: In-app notifications enabled
 *                   example: true
 *                 push:
 *                   type: boolean
 *                   description: Push notifications enabled
 *                   example: false
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/notifications', validateFirebaseToken, async (req, res) => {
  try {
    // TODO: Ensure 'notifications' JSONB column exists in users table
    const { rows } = await pool.query('SELECT notifications FROM users WHERE id = $1', [req.user.uid]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0].notifications || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/profile/notifications:
 *   put:
 *     summary: Update notification settings
 *     description: Update the current user's notification preferences
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: boolean
 *                 description: Enable email notifications
 *                 example: true
 *               inApp:
 *                 type: boolean
 *                 description: Enable in-app notifications
 *                 example: true
 *               push:
 *                 type: boolean
 *                 description: Enable push notifications
 *                 example: false
 *     responses:
 *       200:
 *         description: Notification settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 email:
 *                   type: boolean
 *                 inApp:
 *                   type: boolean
 *                 push:
 *                   type: boolean
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       500:
 *         description: Internal server error
 */
router.put('/notifications', validateFirebaseToken, async (req, res) => {
  try {
    const { notifications } = req.body;
    // TODO: Ensure 'notifications' JSONB column exists in users table
    await pool.query(
      'UPDATE users SET notifications = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(notifications), req.user.uid]
    );
    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/profile/subscriptions:
 *   get:
 *     summary: Get user subscriptions
 *     description: Retrieve the current user's active subscriptions
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Subscriptions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     example: "sub-123"
 *                   planId:
 *                     type: string
 *                     example: "premium-monthly"
 *                   status:
 *                     type: string
 *                     enum: [active, cancelled, expired, pending]
 *                     example: "active"
 *                   startDate:
 *                     type: string
 *                     format: date-time
 *                   endDate:
 *                     type: string
 *                     format: date-time
 *                   price:
 *                     type: number
 *                     example: 9.99
 *                   currency:
 *                     type: string
 *                     example: "USD"
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/subscriptions', validateFirebaseToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT subscription FROM users WHERE id = $1', [req.user.uid]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    // The subscription column is JSONB; the old Firestore field was 'subscriptions' (array)
    // Return the subscription data or an empty array for backward compatibility
    const subscription = rows[0].subscription;
    res.json(Array.isArray(subscription) ? subscription : subscription ? [subscription] : []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/profile/favorites:
 *   get:
 *     summary: Get user favorites
 *     description: Retrieve the current user's favorite items (articles, agents, etc.)
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Favorites retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *                 description: Array of favorite item IDs
 *                 example: ["agent-123", "article-456", "tool-789"]
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/favorites', validateFirebaseToken, async (req, res) => {
  try {
    // TODO: Ensure 'favorites' JSONB column exists in users table
    const { rows } = await pool.query('SELECT favorites FROM users WHERE id = $1', [req.user.uid]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0].favorites || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/profile/favorites:
 *   post:
 *     summary: Add item to favorites
 *     description: Add an item (article, agent, tool, etc.) to the user's favorites
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - favoriteId
 *             properties:
 *               favoriteId:
 *                 type: string
 *                 description: ID of the item to add to favorites
 *                 example: "agent-123"
 *     responses:
 *       200:
 *         description: Item added to favorites successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               description: Updated list of favorite item IDs
 *               example: ["agent-123", "article-456", "tool-789"]
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.post('/favorites', validateFirebaseToken, async (req, res) => {
  try {
    const { favoriteId } = req.body;
    // TODO: Ensure 'favorites' JSONB column exists in users table
    const { rows } = await pool.query('SELECT favorites FROM users WHERE id = $1', [req.user.uid]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const favorites = rows[0].favorites || [];
    if (!favorites.includes(favoriteId)) {
      favorites.push(favoriteId);
      await pool.query(
        'UPDATE users SET favorites = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(favorites), req.user.uid]
      );
    }
    res.json(favorites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/profile/favorites/{id}:
 *   delete:
 *     summary: Remove item from favorites
 *     description: Remove an item from the user's favorites list
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the item to remove from favorites
 *         example: "agent-123"
 *     responses:
 *       200:
 *         description: Item removed from favorites successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               description: Updated list of favorite item IDs
 *               example: ["article-456", "tool-789"]
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.delete('/favorites/:id', validateFirebaseToken, async (req, res) => {
  try {
    const favoriteId = req.params.id;
    // TODO: Ensure 'favorites' JSONB column exists in users table
    const { rows } = await pool.query('SELECT favorites FROM users WHERE id = $1', [req.user.uid]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    let favorites = rows[0].favorites || [];
    favorites = favorites.filter(id => id !== favoriteId);
    await pool.query(
      'UPDATE users SET favorites = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(favorites), req.user.uid]
    );
    res.json(favorites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @swagger
 * /api/profile/settings:
 *   get:
 *     summary: Get user settings
 *     description: Retrieve the current user's application settings
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 language:
 *                   type: string
 *                   description: User's preferred language
 *                   example: "en"
 *                 theme:
 *                   type: string
 *                   description: User's preferred theme
 *                   example: "light"
 *                 notifications:
 *                   type: object
 *                   properties:
 *                     email:
 *                       type: boolean
 *                       example: true
 *                     inApp:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/settings', validateFirebaseToken, async (req, res) => {
  try {
    // TODO: Ensure 'settings' JSONB and 'notifications' JSONB columns exist in users table
    const { rows } = await pool.query(
      'SELECT settings, notifications FROM users WHERE id = $1',
      [req.user.uid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const settings = rows[0].settings || {};
    return res.json({
      language: settings.language || 'en',
      theme: settings.theme || 'light',
      notifications: rows[0].notifications || { email: true, inApp: true }
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    return res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * @swagger
 * /api/profile/settings:
 *   put:
 *     summary: Update user settings
 *     description: Update the current user's application settings
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language:
 *                 type: string
 *                 enum: [en, es, fr, de, it, pt, ru, zh, ja, ko]
 *                 description: User's preferred language
 *                 example: "en"
 *               theme:
 *                 type: string
 *                 enum: [light, dark, auto]
 *                 description: User's preferred theme
 *                 example: "light"
 *               notifications:
 *                 type: object
 *                 properties:
 *                   email:
 *                     type: boolean
 *                     description: Enable email notifications
 *                     example: true
 *                   inApp:
 *                     type: boolean
 *                     description: Enable in-app notifications
 *                     example: true
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 settings:
 *                   type: object
 *                   properties:
 *                     language:
 *                       type: string
 *                     theme:
 *                       type: string
 *                     notifications:
 *                       type: object
 *       400:
 *         description: Bad request - Invalid language selection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid language selection"
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       500:
 *         description: Internal server error
 */
router.put('/settings', validateFirebaseToken, async (req, res) => {
  try {
    const { language, theme, notifications } = req.body;

    // Validate language
    const validLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko'];
    if (language && !validLanguages.includes(language)) {
      return res.status(400).json({ error: 'Invalid language selection' });
    }

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    // Build a settings JSONB object from language and theme
    // TODO: Ensure 'settings' JSONB column exists in users table
    if (language || theme) {
      // Merge with existing settings
      const { rows: currentRows } = await pool.query('SELECT settings FROM users WHERE id = $1', [req.user.uid]);
      const currentSettings = (currentRows.length > 0 && currentRows[0].settings) || {};
      const newSettings = {
        ...currentSettings,
        ...(language && { language }),
        ...(theme && { theme })
      };
      setClauses.push(`settings = $${paramIndex}`);
      values.push(JSON.stringify(newSettings));
      paramIndex++;
    }

    // TODO: Ensure 'notifications' JSONB column exists in users table
    if (notifications) {
      setClauses.push(`notifications = $${paramIndex}`);
      values.push(JSON.stringify(notifications));
      paramIndex++;
    }

    // Always update updated_at
    setClauses.push('updated_at = NOW()');

    if (setClauses.length > 1) { // more than just updated_at
      values.push(req.user.uid);
      const updateQuery = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;
      await pool.query(updateQuery, values);
    }

    const responseSettings = {
      ...(language && { language }),
      ...(theme && { theme }),
      ...(notifications && { notifications })
    };

    return res.json({
      success: true,
      settings: responseSettings
    });
  } catch (err) {
    console.error('Error updating settings:', err);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * @swagger
 * /api/profile/community:
 *   get:
 *     summary: Get community information
 *     description: Retrieve community links and benefits information
 *     tags: [Profile]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Community information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 discordLink:
 *                   type: string
 *                   format: uri
 *                   description: Discord community invite link
 *                   example: "https://discord.com/channels/1377544516579491891/1377544516579491894"
 *                 paymentLink:
 *                   type: string
 *                   format: uri
 *                   description: Payment provider link
 *                   example: "https://payment-provider.com/your-payment-link"
 *                 communityBenefits:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: List of community benefits
 *                   example: [
 *                     "Access to exclusive content",
 *                     "Direct interaction with experts",
 *                     "Early access to new features",
 *                     "Premium support"
 *                   ]
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/community', validateFirebaseToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.user.uid]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      discordLink: process.env.DISCORD_INVITE_LINK || 'https://www.skool.com/ai-waverider-community-2071',
      paymentLink: process.env.PAYMENT_LINK || 'https://payment-provider.com/your-payment-link',
      communityBenefits: [
        'Access to exclusive content',
        'Direct interaction with experts',
        'Early access to new features',
        'Premium support'
      ]
    });
  } catch (err) {
    console.error('Error fetching community info:', err);
    return res.status(500).json({ error: 'Failed to fetch community info' });
  }
});

module.exports = router;
