const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const crypto = require('crypto'); // NEW: require crypto
const upload = require('../../middleware/upload');

// Initialize Firestore
const db = admin.firestore();

/**

 * Helper function to safely convert Firestore Timestamp to ISO string
 * Handles Timestamp objects, strings, numbers, and Date objects
 */
const toISOString = (timestamp) => {
  if (!timestamp) return null;
  
  // If it's a Firestore Timestamp object, use toDate()
  if (timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  
  // If it's already a string (ISO format), return as-is
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  
  // If it's a number (milliseconds), convert to Date
  if (typeof timestamp === 'number') {
    return new Date(timestamp).toISOString();
  }
  
  // If it's a Date object, convert to ISO string
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  
  // Fallback: try to create a Date from the value
  try {
    return new Date(timestamp).toISOString();
  } catch (e) {
    console.warn('[Profile API] Failed to convert timestamp to ISO string:', timestamp);
    return null;
  }
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
    
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      console.warn('[Profile API] User profile not found in database:', req.user.uid);
      
      // Try to get Firebase user info as fallback
      try {
        const firebaseUser = await admin.auth().getUser(req.user.uid);
        console.log('[Profile API] Found Firebase user, creating minimal profile response');
        
        // Return a minimal profile based on Firebase user data
        const minimalProfile = {
          uid: req.user.uid,
          email: firebaseUser.email || req.user.email,
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          photoURL: firebaseUser.photoURL || '',
          firstName: firebaseUser.displayName?.split(' ')[0] || firebaseUser.email?.split('@')[0] || '',
          lastName: firebaseUser.displayName?.split(' ').slice(1).join(' ') || '',
          role: 'authenticated',
          phoneNumber: firebaseUser.phoneNumber || '',
          username: `user_${firebaseUser.email?.split('@')[0]}_${Date.now().toString().slice(-4)}`,
          status: 'active',
          createdAt: firebaseUser.metadata.creationTime || null,
          isMinimalProfile: true // Flag to indicate this is a fallback profile
        };
        
        // Optionally create the user document in Firestore for future requests
        try {
          const userData = {
            ...minimalProfile,
            searchField: `${minimalProfile.username.toLowerCase()} ${minimalProfile.email.toLowerCase()} ${minimalProfile.firstName.toLowerCase()} ${minimalProfile.lastName.toLowerCase()}`.trim(),
            emailPreferences: {
              weeklyUpdates: false,
              announcements: true,
              newAgents: false,
              newTools: false,
              marketingEmails: false
            },
            onboarding: {
              completed: false,
              currentStep: 'welcome',
              profileComplete: false,
              phoneNumberAdded: false,
              profileImageAdded: !!minimalProfile.photoURL
            },
            signupMethod: minimalProfile.photoURL ? 'social' : 'email',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
          
          await db.collection('users').doc(req.user.uid).set(userData);
          console.log('[Profile API] Created missing user document in Firestore');
          
          // Retrieve the created document to get proper Timestamp objects
          const createdDoc = await db.collection('users').doc(req.user.uid).get();
          const createdData = createdDoc.data();
          
          // Return the created profile data with converted timestamps
          return res.json({
            uid: req.user.uid,
            email: createdData.email || userData.email,
            username: createdData.username || userData.username,
            displayName: createdData.displayName || userData.displayName || '',
            photoURL: createdData.photoURL || userData.photoURL || '',
            firstName: createdData.firstName || userData.firstName || '',
            lastName: createdData.lastName || userData.lastName || '',
            role: createdData.role || userData.role || 'authenticated',
            phoneNumber: createdData.phoneNumber || userData.phoneNumber || '',
            interests: createdData.interests || userData.interests || [],
            notifications: createdData.notifications || userData.notifications || {},
            emailPreferences: createdData.emailPreferences || userData.emailPreferences || {},
            onboarding: createdData.onboarding || userData.onboarding || { completed: false },
            status: createdData.status || userData.status || 'active',
            createdAt: toISOString(createdData.createdAt) || new Date().toISOString(),
            updatedAt: toISOString(createdData.updatedAt) || new Date().toISOString()
          });
        } catch (createError) {
          console.error('[Profile API] Error creating user document:', createError);
          // Still return the minimal profile even if creation fails
          return res.json(minimalProfile);
        }
      } catch (firebaseError) {
        console.error('[Profile API] Error fetching Firebase user:', firebaseError);
        return res.status(404).json({ 
          error: 'User profile not found and could not retrieve Firebase user data',
          uid: req.user.uid
        });
      }
    }

    const userData = userDoc.data();
    console.log('[Profile API] Successfully retrieved user profile');
    
    return res.json({
      uid: req.user.uid,
      email: userData.email,
      username: userData.username,
      displayName: userData.displayName || '',
      photoURL: userData.photoURL || '',
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      role: userData.role || 'authenticated',
      phoneNumber: userData.phoneNumber || '',
      interests: userData.interests || [],
      notifications: userData.notifications || {},
      emailPreferences: userData.emailPreferences || {},
      onboarding: userData.onboarding || { completed: false },
      status: userData.status || 'active',
      createdAt: toISOString(userData.createdAt),
      updatedAt: toISOString(userData.updatedAt)
    });
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
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.warn('[Profile API] User profile not found for update, creating new one');
      
      // Create a new user document with the provided data
      try {
        const firebaseUser = await admin.auth().getUser(req.user.uid);
        const newUserData = {
          uid: req.user.uid,
          email: firebaseUser.email || req.user.email,
          username: req.body.username || `user_${firebaseUser.email?.split('@')[0]}_${Date.now().toString().slice(-4)}`,
          firstName: req.body.firstName || firebaseUser.displayName?.split(' ')[0] || '',
          lastName: req.body.lastName || firebaseUser.displayName?.split(' ').slice(1).join(' ') || '',
          displayName: req.body.displayName || firebaseUser.displayName || `${req.body.firstName || ''} ${req.body.lastName || ''}`.trim(),
          photoURL: req.body.photoURL || firebaseUser.photoURL || '',
          phoneNumber: req.body.phoneNumber || firebaseUser.phoneNumber || '',
          role: 'authenticated',
          status: 'active',
          searchField: `${(req.body.username || firebaseUser.email?.split('@')[0] || '').toLowerCase()} ${firebaseUser.email?.toLowerCase() || ''} ${(req.body.firstName || '').toLowerCase()} ${(req.body.lastName || '').toLowerCase()}`.trim(),
          emailPreferences: req.body.emailPreferences || {
            weeklyUpdates: false,
            announcements: true,
            newAgents: false,
            newTools: false,
            marketingEmails: false
          },
          onboarding: req.body.onboarding || {
            completed: false,
            currentStep: 'welcome',
            profileComplete: false,
            phoneNumberAdded: false,
            profileImageAdded: !!(req.body.photoURL || firebaseUser.photoURL)
          },
          signupMethod: (req.body.photoURL || firebaseUser.photoURL) ? 'social' : 'email',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...req.body // Include any additional fields from the request
        };
        
        await userRef.set(newUserData);
        const createdDoc = await userRef.get();
        const createdData = createdDoc.data();
        
        return res.json({
          uid: req.user.uid,
          ...createdData,
          createdAt: toISOString(createdData.createdAt) || new Date().toISOString(),
          updatedAt: toISOString(createdData.updatedAt) || new Date().toISOString()
        });
      } catch (createError) {
        console.error('[Profile API] Error creating user profile:', createError);
        return res.status(500).json({ 
          error: 'Failed to create user profile',
          details: process.env.NODE_ENV === 'development' ? createError.message : undefined
        });
      }
    }

    const updateData = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await userRef.update(updateData);
    
    const updatedDoc = await userRef.get();
    const userData = updatedDoc.data();

    // Safely convert and return profile data
    return res.json({
      uid: req.user.uid,
      email: userData.email || '',
      username: userData.username || '',
      displayName: userData.displayName || '',
      photoURL: userData.photoURL || '',
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      role: userData.role || 'authenticated',
      phoneNumber: userData.phoneNumber || '',
      interests: userData.interests || [],
      notifications: userData.notifications || {},
      emailPreferences: userData.emailPreferences || {},
      onboarding: userData.onboarding || { completed: false },
      status: userData.status || 'active',
      bio: userData.bio || '',
      language: userData.language || 'en',
      theme: userData.theme || 'light',
      createdAt: toISOString(userData.createdAt) || new Date().toISOString(),
      updatedAt: toISOString(userData.updatedAt) || new Date().toISOString()
    });
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
    
    // Get Storage bucket
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
      
      // Update profile, etc...
      await db.collection('users').doc(req.user.uid).update({ photoURL: publicUrl });
      
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

    await db.collection('users').doc(req.user.uid).update({ 
      interests,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

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
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(userDoc.data().notifications || {});
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
    const { notifications } = req.body; // notifications should be an object, e.g., { email: true, inApp: false }
    await db.collection('users').doc(req.user.uid).update({ notifications });
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
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(userDoc.data().subscriptions || []);
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
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(userDoc.data().favorites || []);
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
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const favorites = userDoc.data().favorites || [];
    if (!favorites.includes(favoriteId)) {
      favorites.push(favoriteId);
      await userRef.update({ favorites });
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
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    let favorites = userDoc.data().favorites || [];
    favorites = favorites.filter(id => id !== favoriteId);
    await userRef.update({ favorites });
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
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    return res.json({
      language: userData.language || 'en',
      theme: userData.theme || 'light',
      notifications: userData.notifications || { email: true, inApp: true }
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

    const updates = {
      ...(language && { language }),
      ...(theme && { theme }),
      ...(notifications && { notifications }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(req.user.uid).update(updates);
    return res.json({ 
      success: true,
      settings: updates
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
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
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