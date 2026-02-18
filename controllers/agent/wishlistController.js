const { pool } = require('../../config/database');

// Modify this line to handle the case where sanitize might not be available
let sanitizeObject;
try {
  // Try to load the sanitize utility
  const sanitizeUtils = require('../../utils/sanitize');
  sanitizeObject = sanitizeUtils.sanitizeObject;
} catch (err) {
  // If sanitize utility isn't available, create a simple passthrough function
  console.log('Sanitize utility not available, using fallback');
  sanitizeObject = (obj) => obj;
}

/**
 * Get all wishlists (public view)
 * In the PostgreSQL flat model, wishlists are simple (user_id, agent_id) pairs.
 * This returns recent wishlist entries joined with agent data.
 */
exports.getWishlists = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit, 10);

    // In the flat PostgreSQL model, return recent wishlist entries with agent info
    const result = await pool.query(
      `SELECT w.id, w.user_id, w.agent_id, w.created_at,
              a.name AS agent_name, a.title AS agent_title, a.image_url AS agent_image_url
       FROM wishlists w
       JOIN agents a ON w.agent_id = a.id
       ORDER BY w.created_at DESC
       LIMIT $1`,
      [limitNum]
    );

    if (result.rows.length === 0) {
      return res.json({ wishlists: [] });
    }

    const wishlists = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      agentId: row.agent_id,
      agentName: row.agent_title || row.agent_name || 'Unnamed Agent',
      agentImageUrl: row.agent_image_url || null,
      createdAt: row.created_at
    }));

    return res.json({ wishlists });
  } catch (error) {
    console.error('Error getting wishlists:', error);
    return res.status(500).json({ error: 'Failed to retrieve wishlists', message: error.message });
  }
};

/**
 * Get user's wishlists
 * Returns all wishlist entries for the authenticated user with agent details.
 */
exports.getUserWishlists = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;

    // Get all wishlist entries for the user
    const result = await pool.query(
      `SELECT w.id, w.user_id, w.agent_id, w.created_at,
              a.name AS agent_name, a.title AS agent_title, a.description AS agent_description,
              a.image_url AS agent_image_url, a.price, a.creator
       FROM wishlists w
       JOIN agents a ON w.agent_id = a.id
       WHERE w.user_id = $1
       ORDER BY w.created_at DESC`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ wishlists: [] });
    }

    const wishlists = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      agentId: row.agent_id,
      agentName: row.agent_title || row.agent_name || 'Unnamed Agent',
      agentDescription: row.agent_description || '',
      agentImageUrl: row.agent_image_url || null,
      price: row.price,
      creator: row.creator || { name: 'Unknown Creator' },
      createdAt: row.created_at
    }));

    return res.json({ wishlists });
  } catch (error) {
    console.error('Error getting user wishlists:', error);
    return res.status(500).json({ error: 'Failed to retrieve user wishlists' });
  }
};

/**
 * Get wishlist entry by ID
 * In the flat model, each wishlist entry is a single (user_id, agent_id) pair.
 */
exports.getWishlistById = async (req, res) => {
  try {
    const { wishlistId } = req.params;

    // Get wishlist entry with agent details
    const result = await pool.query(
      `SELECT w.id, w.user_id, w.agent_id, w.created_at,
              a.name AS agent_name, a.title AS agent_title, a.description AS agent_description,
              a.image_url AS agent_image_url, a.price, a.creator, a.rating
       FROM wishlists w
       JOIN agents a ON w.agent_id = a.id
       WHERE w.id = $1`,
      [wishlistId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist entry not found' });
    }

    const row = result.rows[0];

    // Check if the entry belongs to the user (if authenticated)
    if (req.user && req.user.uid !== row.user_id) {
      return res.status(403).json({ error: 'You do not have permission to view this wishlist entry' });
    }

    const wishlist = {
      id: row.id,
      userId: row.user_id,
      agentId: row.agent_id,
      agentName: row.agent_title || row.agent_name || 'Unnamed Agent',
      agentDescription: row.agent_description || '',
      agentImageUrl: row.agent_image_url || null,
      price: row.price,
      creator: row.creator || { name: 'Unknown Creator' },
      rating: row.rating,
      createdAt: row.created_at
    };

    return res.json({ wishlist });
  } catch (error) {
    console.error('Error getting wishlist:', error);
    return res.status(500).json({ error: 'Failed to retrieve wishlist' });
  }
};

/**
 * Create a new wishlist entry
 * In the PostgreSQL flat model, this adds a (user_id, agent_id) pair.
 */
exports.createWishlist = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;

    const { agentId } = req.body;

    // Validate required fields
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Check if agent exists
    const agentResult = await pool.query('SELECT id FROM agents WHERE id = $1', [agentId]);
    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Create wishlist entry with composite ID
    const wishlistId = `${userId}_${agentId}`;

    const result = await pool.query(
      `INSERT INTO wishlists (id, user_id, agent_id, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, agent_id) DO NOTHING
       RETURNING *`,
      [wishlistId, userId, agentId]
    );

    if (result.rows.length === 0) {
      // Already exists
      return res.status(200).json({
        message: 'Agent is already in wishlist',
        id: wishlistId,
        userId,
        agentId
      });
    }

    // Update agent wishlist count
    await pool.query(
      'UPDATE agents SET wishlist_count = wishlist_count + 1 WHERE id = $1',
      [agentId]
    );

    const row = result.rows[0];
    return res.status(201).json({
      id: row.id,
      userId: row.user_id,
      agentId: row.agent_id,
      createdAt: row.created_at
    });
  } catch (error) {
    console.error('Error creating wishlist:', error);
    return res.status(500).json({ error: 'Failed to create wishlist' });
  }
};

/**
 * Update a wishlist
 * Not applicable in the flat PostgreSQL model (wishlists are simple user_id/agent_id pairs).
 */
exports.updateWishlist = async (req, res) => {
  return res.status(501).json({
    error: 'Not implemented. Wishlists in the current model are simple user-agent pairs and cannot be updated.'
  });
};

/**
 * Delete a wishlist entry
 */
exports.deleteWishlist = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;

    const { wishlistId } = req.params;

    // Get wishlist entry to check ownership and get agent_id
    const wishlistResult = await pool.query(
      'SELECT * FROM wishlists WHERE id = $1',
      [wishlistId]
    );

    if (wishlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Wishlist entry not found' });
    }

    const wishlistData = wishlistResult.rows[0];

    // Check if user owns the wishlist entry
    if (wishlistData.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this wishlist entry' });
    }

    // Delete the wishlist entry
    await pool.query('DELETE FROM wishlists WHERE id = $1 AND user_id = $2', [wishlistId, userId]);

    // Decrement agent wishlist count
    await pool.query(
      'UPDATE agents SET wishlist_count = GREATEST(wishlist_count - 1, 0) WHERE id = $1',
      [wishlistData.agent_id]
    );

    return res.json({ message: 'Wishlist entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting wishlist:', error);
    return res.status(500).json({ error: 'Failed to delete wishlist' });
  }
};

/**
 * Toggle agent in wishlist
 * Adds the agent if not in the user's wishlist, removes it if already present.
 */
exports.toggleWishlistItem = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;

    const { agentId } = req.body;

    // Validate required fields
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Check if agent exists
    const agentResult = await pool.query('SELECT id FROM agents WHERE id = $1', [agentId]);
    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Check if agent is already in the user's wishlist
    const existingResult = await pool.query(
      'SELECT id FROM wishlists WHERE user_id = $1 AND agent_id = $2',
      [userId, agentId]
    );

    if (existingResult.rows.length === 0) {
      // Add agent to wishlist
      const wishlistId = `${userId}_${agentId}`;
      await pool.query(
        `INSERT INTO wishlists (id, user_id, agent_id, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, agent_id) DO NOTHING`,
        [wishlistId, userId, agentId]
      );

      // Increment wishlist count on agent
      await pool.query(
        'UPDATE agents SET wishlist_count = wishlist_count + 1 WHERE id = $1',
        [agentId]
      );

      return res.json({
        added: true,
        message: 'Agent added to wishlist'
      });
    } else {
      // Remove agent from wishlist
      await pool.query(
        'DELETE FROM wishlists WHERE user_id = $1 AND agent_id = $2',
        [userId, agentId]
      );

      // Decrement wishlist count on agent
      await pool.query(
        'UPDATE agents SET wishlist_count = GREATEST(wishlist_count - 1, 0) WHERE id = $1',
        [agentId]
      );

      return res.json({
        added: false,
        message: 'Agent removed from wishlist'
      });
    }
  } catch (error) {
    console.error('Error toggling wishlist item:', error);
    return res.status(500).json({ error: 'Failed to toggle wishlist item' });
  }
};

/**
 * Check if agent is in user's wishlist
 */
exports.checkWishlistItem = async (req, res) => {
  try {
    // If not authenticated, return false
    if (!req.user) {
      return res.json({ isWishlisted: false });
    }

    const userId = req.user.uid;
    const { agentId } = req.params;

    // Validate required fields
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Check if agent is in the user's wishlist
    const result = await pool.query(
      'SELECT 1 FROM wishlists WHERE user_id = $1 AND agent_id = $2',
      [userId, agentId]
    );

    return res.json({
      isWishlisted: result.rows.length > 0
    });
  } catch (error) {
    console.error('Error checking wishlist item:', error);
    return res.status(500).json({ error: 'Failed to check wishlist item' });
  }
};