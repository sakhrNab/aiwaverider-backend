const { pool } = require('../../config/database');
const bcrypt = require('bcrypt');
const { sanitizeUser } = require('../../utils/sanitize');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

/**
 * Get all users with pagination, filtering and sorting
 */
exports.getUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt', // Not supported in Auth, but kept for compatibility
      sortDirection = 'desc' // Not supported in Auth, but kept for compatibility
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    // Fetch all users from Firebase Auth (max 1000 per call)
    let allUsers = [];
    let nextPageToken;
    do {
      const result = await admin.auth().listUsers(1000, nextPageToken);
      allUsers = allUsers.concat(result.users);
      nextPageToken = result.pageToken;
    } while (nextPageToken);

    // Filter by search if provided (search by email or displayName)
    let filteredUsers = allUsers;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredUsers = allUsers.filter(user =>
        (user.email && user.email.toLowerCase().includes(searchLower)) ||
        (user.displayName && user.displayName.toLowerCase().includes(searchLower))
      );
    }

    // Pagination
    const totalUsers = filteredUsers.length;
    const paginatedUsers = filteredUsers.slice(offset, offset + limitNum);

    // Join with PostgreSQL for extra profile data
    const uids = paginatedUsers.map(u => u.uid);
    let profileMap = {};
    if (uids.length > 0) {
      const placeholders = uids.map((_, i) => `$${i + 1}`).join(', ');
      const profileResult = await pool.query(
        `SELECT * FROM users WHERE id IN (${placeholders})`,
        uids
      );
      for (const row of profileResult.rows) {
        profileMap[row.id] = row;
      }
    }

    // Format data for frontend
    const users = paginatedUsers.map(user => {
      const profile = profileMap[user.uid];
      return {
        id: user.uid,
        username: profile ? profile.username : (user.displayName || ''),
        email: user.email || '',
        firstName: profile ? profile.first_name : '',
        lastName: profile ? profile.last_name : '',
        photoURL: profile ? (profile.photo_url || '') : (user.photoURL || ''),
        role: profile ? profile.role : (user.customClaims && user.customClaims.role ? user.customClaims.role : 'user'),
        status: profile ? profile.status : (user.disabled ? 'disabled' : 'active'),
        createdAt: profile && profile.created_at ? profile.created_at.toISOString() : (user.metadata && user.metadata.creationTime ? user.metadata.creationTime : null),
        updatedAt: profile && profile.updated_at ? profile.updated_at.toISOString() : (user.metadata && user.metadata.lastSignInTime ? user.metadata.lastSignInTime : null)
      };
    });

    const totalPages = Math.ceil(totalUsers / limitNum);

    return res.json({
      users,
      currentPage: pageNum,
      totalPages,
      total: totalUsers,
      limit: limitNum
    });
  } catch (error) {
    console.error('Error in getUsers:', error);
    return res.status(500).json({ error: 'Failed to retrieve users' });
  }
};

/**
 * Get a single user by ID
 */
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userResult.rows[0];

    // Return user data without sensitive information
    return res.json({
      id: userData.id,
      username: userData.username || userData.display_name,
      email: userData.email,
      firstName: userData.first_name,
      lastName: userData.last_name,
      photoURL: userData.photo_url,
      role: userData.role,
      status: userData.status || 'active',
      createdAt: userData.created_at ? userData.created_at.toISOString() : null,
      updatedAt: userData.updated_at ? userData.updated_at.toISOString() : null
    });
  } catch (error) {
    console.error('Error in getUserById:', error);
    return res.status(500).json({ error: 'Failed to retrieve user' });
  }
};

/**
 * Create a new user
 */
exports.createUser = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role, status } = req.body;

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    // Check if email already exists
    const emailResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (emailResult.rows.length > 0) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Check if username already exists
    const usernameResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (usernameResult.rows.length > 0) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create searchable fields
    const searchField = `${username.toLowerCase()} ${email.toLowerCase()} ${firstName ? firstName.toLowerCase() : ''} ${lastName ? lastName.toLowerCase() : ''}`;

    // Generate UUID for id
    const id = uuidv4();

    // Create user in database
    const insertResult = await pool.query(
      `INSERT INTO users (id, username, email, password_hash, first_name, last_name, role, status, search_field, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        id,
        username,
        email.toLowerCase(),
        hashedPassword,
        firstName || '',
        lastName || '',
        role || 'user',
        status || 'active',
        searchField
      ]
    );

    const createdUser = insertResult.rows[0];

    // Return success with user data (excluding password)
    return res.status(201).json({
      id: createdUser.id,
      username: createdUser.username,
      email: createdUser.email,
      firstName: createdUser.first_name || '',
      lastName: createdUser.last_name || '',
      role: createdUser.role || 'user',
      status: createdUser.status || 'active',
      createdAt: createdUser.created_at.toISOString(),
      updatedAt: createdUser.updated_at.toISOString()
    });
  } catch (error) {
    console.error('Error in createUser:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
};

/**
 * Update an existing user
 */
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, password, firstName, lastName, role, status } = req.body;

    // Validate user exists
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = userResult.rows[0];

    // Check if email is being changed and already exists
    if (email && email.toLowerCase() !== existingUser.email) {
      const emailResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (emailResult.rows.length > 0) {
        return res.status(400).json({ error: 'Email is already registered' });
      }
    }

    // Check if username is being changed and already exists
    if (username && username !== existingUser.username) {
      const usernameResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (usernameResult.rows.length > 0) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }

    // Build dynamic update query
    const setClauses = ['updated_at = NOW()'];
    const values = [];
    let paramIndex = 1;

    // Only add fields that are provided
    if (username) {
      setClauses.push(`username = $${paramIndex}`);
      values.push(username);
      paramIndex++;
    }
    if (email) {
      setClauses.push(`email = $${paramIndex}`);
      values.push(email.toLowerCase());
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
    if (role) {
      setClauses.push(`role = $${paramIndex}`);
      values.push(role);
      paramIndex++;
    }
    if (status) {
      setClauses.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    // Update searchable field if any of these fields change
    if (username || email || firstName || lastName) {
      const searchField = `${username || existingUser.username || ''} ${email ? email.toLowerCase() : existingUser.email} ${firstName !== undefined ? firstName.toLowerCase() : (existingUser.first_name ? existingUser.first_name.toLowerCase() : '')} ${lastName !== undefined ? lastName.toLowerCase() : (existingUser.last_name ? existingUser.last_name.toLowerCase() : '')}`.toLowerCase();
      setClauses.push(`search_field = $${paramIndex}`);
      values.push(searchField);
      paramIndex++;
    }

    // Hash password if provided
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      setClauses.push(`password_hash = $${paramIndex}`);
      values.push(hashedPassword);
      paramIndex++;
    }

    // Add userId as the last parameter for WHERE clause
    values.push(userId);

    // Update user in database and return updated row
    const updateQuery = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const updatedResult = await pool.query(updateQuery, values);
    const updatedUser = updatedResult.rows[0];

    // Return updated user data
    return res.json({
      id: updatedUser.id,
      username: updatedUser.username || updatedUser.display_name,
      email: updatedUser.email,
      firstName: updatedUser.first_name || '',
      lastName: updatedUser.last_name || '',
      role: updatedUser.role,
      status: updatedUser.status || 'active',
      createdAt: updatedUser.created_at ? updatedUser.created_at.toISOString() : null,
      updatedAt: updatedUser.updated_at ? updatedUser.updated_at.toISOString() : null
    });
  } catch (error) {
    console.error('Error in updateUser:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
};

/**
 * Delete a user
 */
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate user exists
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if this is the last admin user
    const userData = userResult.rows[0];
    if (userData.role === 'admin') {
      const adminResult = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
      if (parseInt(adminResult.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin user' });
      }
    }

    // Delete user from database
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    return res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error in deleteUser:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
};