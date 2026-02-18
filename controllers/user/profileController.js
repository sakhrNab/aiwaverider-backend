const { pool } = require('../../config/database');
const { sanitizeUser } = require('../../utils/sanitize');
const { getCache, setCache, generateProfileCacheKey } = require('../../utils/cache');

/**
 * Map a database row (snake_case) to a camelCase user object
 */
function mapRowToUser(row) {
  return {
    id: row.id,
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
  };
}

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

    // If not in cache, get from database
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const profileData = sanitizeUser(mapRowToUser(userResult.rows[0]));

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

    // If not in cache, get from database
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const profileData = sanitizeUser(mapRowToUser(userResult.rows[0]));

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
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const existingUser = userResult.rows[0];

    // Build dynamic update query
    const setClauses = ['updated_at = NOW()'];
    const values = [];
    let paramIndex = 1;

    // Only include fields that are provided
    if (username) {
      // Check if username already exists (excluding current user)
      const usernameResult = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, userId]
      );

      if (usernameResult.rows.length > 0) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }

      setClauses.push(`username = $${paramIndex}`);
      values.push(username);
      paramIndex++;
    }

    if (firstName !== undefined) {
      setClauses.push(`first_name = $${paramIndex}`);
      values.push(firstName);
      paramIndex++;
    }
    if (lastName !== undefined) {
      setClauses.push(`last_name = $${paramIndex}`);
      values.push(lastName);
      paramIndex++;
    }
    if (displayName !== undefined) {
      setClauses.push(`display_name = $${paramIndex}`);
      values.push(displayName);
      paramIndex++;
    }

    // Update searchable field if relevant fields changed
    if (username || firstName || lastName || displayName) {
      const searchField = `${username || existingUser.username || ''} ${firstName || existingUser.first_name || ''} ${lastName || existingUser.last_name || ''} ${displayName || existingUser.display_name || ''}`.toLowerCase();
      setClauses.push(`search_field = $${paramIndex}`);
      values.push(searchField);
      paramIndex++;
    }

    // Add userId as the last parameter for WHERE clause
    values.push(userId);

    // Update the user and return updated row
    const updateQuery = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const updatedResult = await pool.query(updateQuery, values);

    // Return the updated profile
    const profileData = sanitizeUser(mapRowToUser(updatedResult.rows[0]));

    // Update cache
    const cacheKey = generateProfileCacheKey(userId);
    await setCache(cacheKey, profileData);

    return res.json(profileData);
  } catch (err) {
    console.error('Error in updateProfile:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};