const { db } = require('../../config/firebase');
const { sanitizeUser } = require('../../utils/sanitize');
const { getCache, setCache, generateProfileCacheKey } = require('../../utils/cache');

// Collection reference
const usersCollection = db.collection('users');

/**
 * Get a user's profile
 */
exports.getProfile = async (req, res) => {
  try {
    // Get user ID from the authenticated request
    const userId = req.user.uid;
    
    // Try to get from cache first
    const cacheKey = generateProfileCacheKey(userId);
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) {
      return res.json(cachedProfile);
    }

    // If not in cache, get from Firestore
    const userDoc = await usersCollection.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const profileData = sanitizeUser({
      id: userId,
      ...userDoc.data()
    });
    
    // Cache the profile
    await setCache(cacheKey, profileData);

    return res.json(profileData);
  } catch (err) {
    console.error('Error in getProfile:', err);
    return res.status(500).json({ error: 'Failed to retrieve profile' });
  }
};

/**
 * Get a user profile by ID
 */
exports.getProfileById = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Try to get from cache first
    const cacheKey = generateProfileCacheKey(userId);
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) {
      return res.json(cachedProfile);
    }

    // If not in cache, get from Firestore
    const userDoc = await usersCollection.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const profileData = sanitizeUser({
      id: userId,
      ...userDoc.data()
    });
    
    // Cache the profile
    await setCache(cacheKey, profileData);

    return res.json(profileData);
  } catch (err) {
    console.error('Error in getProfileById:', err);
    return res.status(500).json({ error: 'Failed to retrieve profile' });
  }
};

/**
 * Update the current user's profile
 */
exports.updateProfile = async (req, res) => {
  try {
    // Get user ID from the authenticated request
    const userId = req.user.uid;
    
    // Get update data from request body
    const { username, firstName, lastName, displayName } = req.body;
    
    // Check if the user exists
    const userDoc = await usersCollection.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };
    
    // Only include fields that are provided
    if (username) {
      // Check if username already exists
      const usernameQuery = await usersCollection
        .where('username', '==', username)
        .where('uid', '!=', userId)
        .get();
      
      if (!usernameQuery.empty) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      
      updateData.username = username;
    }
    
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (displayName !== undefined) updateData.displayName = displayName;
    
    // Update searchable field if relevant fields changed
    if (username || firstName || lastName || displayName) {
      const userData = userDoc.data();
      updateData.searchField = `${username || userData.username || ''} ${firstName || userData.firstName || ''} ${lastName || userData.lastName || ''} ${displayName || userData.displayName || ''}`.toLowerCase();
    }
    
    // Update the user
    await usersCollection.doc(userId).update(updateData);
    
    // Get the updated user data
    const updatedUserDoc = await usersCollection.doc(userId).get();
    
    // Return the updated profile
    const profileData = sanitizeUser({
      id: userId,
      ...updatedUserDoc.data()
    });
    
    // Update cache
    const cacheKey = generateProfileCacheKey(userId);
    await setCache(cacheKey, profileData);
    
    return res.json(profileData);
  } catch (err) {
    console.error('Error in updateProfile:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}; 