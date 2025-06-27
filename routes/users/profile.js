const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const crypto = require('crypto'); // NEW: require crypto
const upload = require('../../middleware/upload');

// Initialize Firestore
const db = admin.firestore();

// GET /api/profile - Get user profile
router.get('/', validateFirebaseToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const userData = userDoc.data();
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
      createdAt: userData.createdAt || null
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    return res.status(500).json({ 
      error: 'Failed to fetch profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// PUT /api/profile - Update user profile
router.put('/', validateFirebaseToken, async (req, res) => {
  try {
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const updateData = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await userRef.update(updateData);
    
    const updatedDoc = await userRef.get();
    const userData = updatedDoc.data();

    return res.json({
      uid: req.user.uid,
      ...userData,
      updatedAt: userData.updatedAt ? userData.updatedAt.toDate().toISOString() : null
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.status(500).json({ 
      error: 'Failed to update profile',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Updated upload-avatar endpoint
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

// PUT /api/profile/interests - Update topics of interest.
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

// GET /api/profile/notifications - Get current notification settings.
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

// PUT /api/profile/notifications - Update notification settings.
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

// GET /api/profile/subscriptions - Get user's subscriptions.
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

// GET /api/profile/favorites - Get the list of bookmarked articles.
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

// POST /api/profile/favorites - Add an article to favorites.
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

// DELETE /api/profile/favorites/:id - Remove an article from favorites.
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

// GET /api/profile/settings - Get user settings
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

// PUT /api/profile/settings - Update user settings
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

// GET /api/profile/community - Get community links and info
router.get('/community', validateFirebaseToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      discordLink: process.env.DISCORD_INVITE_LINK || 'https://discord.com/channels/1377544516579491891/1377544516579491894',
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
