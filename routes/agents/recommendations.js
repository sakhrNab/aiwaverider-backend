const express = require('express');
const router = express.Router();
const { pool } = require('../../config/database');
const admin = require('firebase-admin');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const logger = require('../../utils/logger');

/**
 * @swagger
 * /api/recommendations/test:
 *   get:
 *     summary: Test recommendations endpoint
 *     description: A test endpoint that returns valid recommendations for testing
 *     tags: [Recommendations]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 3
 *         description: Maximum number of recommendations to return
 *     responses:
 *       200:
 *         description: Test recommendations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Agent'
 *                 source:
 *                   type: string
 *                   enum: [test-valid, test-query, test-hardcoded]
 *                   description: Source of the recommendations
 *       500:
 *         description: Internal server error
 */
router.get('/test', async (req, res) => {
  console.log('Test recommendations endpoint hit!');

  try {
    // Get a sample of real agents from the database
    const limit = parseInt(req.query.limit) || 3;

    // Try to fetch agents with reliable IDs first
    const reliableIds = ['chatgpt-prompts', 'resume-template', 'ai-art-generator'];
    const validAgents = [];

    // Check if any of these agents exist
    for (const id of reliableIds) {
      try {
        const { rows } = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
        if (rows.length > 0) {
          validAgents.push({
            id: rows[0].id,
            ...rows[0],
            detailUrl: `/agents/${rows[0].id}`
          });
        }
      } catch (err) {
        console.warn(`Error fetching agent ${id}:`, err.message);
      }
    }

    // If we have enough valid agents, return them
    if (validAgents.length >= limit) {
      console.log(`Returning ${limit} valid test agents`);
      return res.json({
        recommendations: validAgents.slice(0, limit),
        source: 'test-valid'
      });
    }

    // If we don't have enough reliable agents, query for any agents
    const { rows: agentRows } = await pool.query('SELECT * FROM agents LIMIT $1', [limit]);

    if (agentRows.length === 0) {
      console.log('No agents found in database, returning hardcoded test agents');
      // Return hardcoded agents if none found
      return res.json({
        recommendations: [
          {
            id: 'chatgpt-prompts',
            title: 'ChatGPT Prompts to Increase Productivity',
            price: 0,
            isFree: true,
            imageUrl: 'https://picsum.photos/300/200?random=1',
            rating: {
              average: 4.7,
              count: 128
            },
            detailUrl: '/agents/chatgpt-prompts'
          },
          {
            id: 'resume-template',
            title: 'Professional Resume Template',
            price: 9.99,
            imageUrl: 'https://picsum.photos/300/200?random=2',
            rating: {
              average: 4.9,
              count: 87
            },
            detailUrl: '/agents/resume-template'
          },
          {
            id: 'ai-art-generator',
            title: 'AI Art Generator Prompt Pack',
            price: 14.99,
            imageUrl: 'https://picsum.photos/300/200?random=3',
            rating: {
              average: 4.5,
              count: 62
            },
            detailUrl: '/agents/ai-art-generator'
          }
        ].slice(0, limit),
        source: 'test-hardcoded'
      });
    }

    // We found some agents, return them
    const agents = agentRows.map(row => ({
      id: row.id,
      ...row,
      detailUrl: `/agents/${row.id}`
    }));

    console.log(`Returning ${agents.length} test agents from database`);
    return res.json({
      recommendations: agents,
      source: 'test-query'
    });
  } catch (error) {
    console.error('Test recommendations error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

/**
 * @swagger
 * /api/recommendations/diagnostic:
 *   get:
 *     summary: Diagnostic endpoint for recommendations
 *     description: A diagnostic endpoint to check what agents are available in the database
 *     tags: [Recommendations]
 *     responses:
 *       200:
 *         description: Diagnostic information retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.get('/diagnostic', async (req, res) => {
  console.log('Diagnostic endpoint hit!');

  try {
    // Get a sample of agents from the database
    const { rows: agentRows } = await pool.query('SELECT * FROM agents LIMIT 5');

    if (agentRows.length === 0) {
      console.log('No agents found in database!');
      return res.json({
        status: 'warning',
        message: 'No agents found in database',
        collections: []
      });
    }

    // Get all available tables to check structure
    const { rows: tableRows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = tableRows.map(row => row.table_name);

    // Get sample data
    const agents = agentRows.map(row => ({
      id: row.id,
      ...row
    }));

    console.log(`Found ${agents.length} agents for diagnostic`);
    return res.json({
      status: 'success',
      message: `Found ${agents.length} agents`,
      agents,
      collections: tableNames
    });
  } catch (error) {
    console.error('Diagnostic error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

/**
 * @swagger
 * /api/recommendations:
 *   get:
 *     summary: Get personalized recommendations
 *     tags: [Recommendations]
 */
router.get('/', async (req, res) => {
  console.log('Recommendations endpoint hit!', {
    query: req.query,
    headers: req.headers,
    path: req.path,
    method: req.method
  });

  try {
    // Parse query parameters
    const limit = parseInt(req.query.limit) || 3;
    const excludeId = req.query.exclude || null;
    const useHistory = req.query.useHistory !== 'false'; // Default to true

    // FIRST: Verify we have valid agents in the database before proceeding
    const { rows: checkRows } = await pool.query('SELECT id FROM agents LIMIT 1');
    if (checkRows.length === 0) {
      console.warn('No agents found in database - cannot generate recommendations');
      return res.status(404).json({
        error: 'No agents found in database',
        recommendations: []
      });
    }

    // Default userId for anonymous users
    let userId = 'anonymous';
    let isAuthenticated = false;

    // Check for Firebase ID token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        userId = decodedToken.uid;
        isAuthenticated = true;
        logger.info(`Getting recommendations for authenticated user: ${userId}`);
      } catch (error) {
        logger.warn('Invalid auth token for recommendations:', error.message);
        // Continue as anonymous user
      }
    } else {
      logger.info('Getting recommendations for anonymous user');
    }

    console.log('Processing recommendations for user:', userId, 'authenticated:', isAuthenticated);

    // Start building our recommendations
    let recommendations = [];

    if (isAuthenticated && useHistory) {
      // If authenticated and using history, get personalized recommendations
      recommendations = await getPersonalizedRecommendations(userId, limit, excludeId);
    }

    // If we don't have enough recommendations, fill with popular items
    if (recommendations.length < limit) {
      const popularItems = await getPopularAgents(limit - recommendations.length, excludeId);

      // Ensure we don't have duplicates
      const existingIds = new Set(recommendations.map(item => item.id));
      for (const item of popularItems) {
        if (!existingIds.has(item.id)) {
          recommendations.push(item);
          existingIds.add(item.id);
        }
      }
    }

    // Add detailUrl to each recommendation
    recommendations = recommendations.map(item => ({
      ...item,
      detailUrl: `/agents/${item.id}`
    }));

    // Verify all recommendations have valid IDs
    recommendations = recommendations.filter(item => item.id && typeof item.id === 'string');

    // Return the recommendations
    return res.json({
      recommendations,
      source: isAuthenticated && useHistory ? 'personalized' : 'popular'
    });
  } catch (error) {
    logger.error('Error getting recommendations:', error);
    return res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

/**
 * Get personalized recommendations based on user data
 */
async function getPersonalizedRecommendations(userId, limit, excludeId) {
  try {
    console.log(`Getting personalized recommendations for user ${userId}, limit ${limit}`);

    // Get user profile to check interests
    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRows.length === 0) {
      logger.warn(`User profile not found for recommendations: ${userId}`);
      return [];
    }

    const userData = userRows[0];
    console.log('User data retrieved:', {
      userId: userId,
      hasInterests: Boolean(userData.interests && userData.interests.length),
      interestCount: userData.interests ? userData.interests.length : 0
    });

    const userInterests = userData.interests || [];

    // Create scoring object to rank potential recommendations
    const scoredItems = {};

    // 1. Add points for agents matching user interests
    if (userInterests.length > 0) {
      console.log('Finding agents matching user interests:', userInterests);
      let interestAgents;

      try {
        const { rows } = await pool.query(
          'SELECT * FROM agents WHERE categories && $1 LIMIT 20',
          [userInterests]
        );
        interestAgents = rows;
        console.log(`Found ${interestAgents.length} agents matching interests`);
      } catch (error) {
        console.error('Error querying by interests:', error);
        // Fallback: query all agents
        const { rows } = await pool.query('SELECT * FROM agents LIMIT 20');
        interestAgents = rows;
        console.log(`Fallback: retrieved ${interestAgents.length} agents`);
      }

      interestAgents.forEach(agent => {
        if (agent.id !== excludeId) {
          if (!scoredItems[agent.id]) {
            scoredItems[agent.id] = { item: { id: agent.id, ...agent }, score: 0 };
          }
          scoredItems[agent.id].score += 10;

          const agentCategories = agent.categories || [];
          for (const interest of userInterests) {
            if (agentCategories.includes(interest)) {
              scoredItems[agent.id].score += 2;
            }
          }
        }
      });
    } else {
      // No interests - get some recent/popular agents
      console.log('No user interests found, getting recent agents');
      const { rows: recentAgents } = await pool.query(
        'SELECT * FROM agents ORDER BY created_at DESC LIMIT 10'
      );

      console.log(`Found ${recentAgents.length} recent agents`);

      recentAgents.forEach(agent => {
        if (agent.id !== excludeId) {
          if (!scoredItems[agent.id]) {
            scoredItems[agent.id] = { item: { id: agent.id, ...agent }, score: 0 };
          }
          scoredItems[agent.id].score += 5;
        }
      });
    }

    // 2. Add points for agents in user's wishlists
    console.log('Checking user wishlists');
    try {
      const { rows: wishlistRows } = await pool.query(
        'SELECT * FROM wishlists WHERE user_id = $1',
        [userId]
      );

      console.log(`Found ${wishlistRows.length} wishlists for user`);

      const wishlistAgentIds = new Set();
      for (const wishlist of wishlistRows) {
        const items = wishlist.items || [];
        for (const item of items) {
          if (item && item.id) {
            wishlistAgentIds.add(item.id);
          }
        }
      }

      console.log(`Found ${wishlistAgentIds.size} agent IDs in wishlists`);

      if (wishlistAgentIds.size > 0) {
        const wishlistAgentIdsArray = Array.from(wishlistAgentIds);
        const { rows: wishlistAgents } = await pool.query(
          'SELECT * FROM agents WHERE id = ANY($1)',
          [wishlistAgentIdsArray]
        );

        console.log(`Retrieved ${wishlistAgents.length} agents from wishlists`);

        wishlistAgents.forEach(agent => {
          if (agent.id !== excludeId) {
            if (!scoredItems[agent.id]) {
              scoredItems[agent.id] = { item: { id: agent.id, ...agent }, score: 0 };
            }
            scoredItems[agent.id].score += 15;
          }
        });
      }
    } catch (wishlistError) {
      console.error('Error retrieving wishlists:', wishlistError);
    }

    // 3. Add points for recently viewed agents
    console.log('Checking recently viewed agents');
    try {
      const { rows: viewRows } = await pool.query(
        'SELECT agent_id FROM user_activity_views WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 20',
        [userId]
      );

      console.log(`Found ${viewRows.length} recent views`);

      const viewedAgentIds = new Set();
      viewRows.forEach(row => {
        if (row.agent_id && row.agent_id !== excludeId) {
          viewedAgentIds.add(row.agent_id);
        }
      });

      console.log(`Found ${viewedAgentIds.size} unique viewed agent IDs`);

      if (viewedAgentIds.size > 0) {
        const viewedAgentIdsArray = Array.from(viewedAgentIds);
        const { rows: viewedAgents } = await pool.query(
          'SELECT * FROM agents WHERE id = ANY($1)',
          [viewedAgentIdsArray]
        );

        console.log(`Retrieved ${viewedAgents.length} agents from views`);

        viewedAgents.forEach(agent => {
          if (agent.id !== excludeId) {
            if (!scoredItems[agent.id]) {
              scoredItems[agent.id] = { item: { id: agent.id, ...agent }, score: 0 };
            }
            scoredItems[agent.id].score += 5;
          }
        });
      }
    } catch (viewsError) {
      console.error('Error retrieving user views:', viewsError);
    }

    // 4. Add points for previous orders
    console.log('Checking previous orders');
    try {
      const { rows: orderRows } = await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
        [userId]
      );

      console.log(`Found ${orderRows.length} previous orders`);

      // Get creators from previously purchased agents to recommend more from the same creators
      const purchasedCreatorIds = new Set();
      orderRows.forEach(order => {
        const items = order.items || [];
        for (const item of items) {
          if (item.creator && item.creator.id) {
            purchasedCreatorIds.add(item.creator.id);
          }
        }
      });

      console.log(`Found ${purchasedCreatorIds.size} unique creator IDs from purchases`);

      // Note: creator.id querying in jsonb would need different approach
      // For now, skip this optimization in PG migration
    } catch (ordersError) {
      console.error('Error retrieving orders:', ordersError);
    }

    // If we have no scored items at all, get some popular agents as a fallback
    if (Object.keys(scoredItems).length === 0) {
      console.log('No scored items found, falling back to popular agents');
      const popularAgents = await getPopularAgents(limit, excludeId);
      return popularAgents;
    }

    // Sort items by score and return the top ones
    const sortedItems = Object.values(scoredItems)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item }) => item);

    console.log(`Returning ${sortedItems.length} personalized recommendations`);

    return sortedItems;
  } catch (error) {
    logger.error('Error getting personalized recommendations:', error);
    return [];
  }
}

/**
 * Get popular agents to use as fallback recommendations
 */
async function getPopularAgents(limit, excludeId) {
  try {
    console.log(`Getting popular agents, limit: ${limit}`);

    let agents = [];

    // Try popularity, then rating, then most recent
    const queries = [
      { sql: 'SELECT * FROM agents ORDER BY popularity DESC NULLS LAST LIMIT $1', label: 'popularity' },
      { sql: 'SELECT * FROM agents ORDER BY average_rating DESC NULLS LAST LIMIT $1', label: 'rating' },
      { sql: 'SELECT * FROM agents ORDER BY created_at DESC NULLS LAST LIMIT $1', label: 'recent' },
      { sql: 'SELECT * FROM agents LIMIT $1', label: 'any' }
    ];

    for (const q of queries) {
      try {
        const { rows } = await pool.query(q.sql, [limit * 2]);
        if (rows.length > 0) {
          console.log(`Found ${rows.length} agents via ${q.label}`);
          agents = rows
            .map(row => ({ id: row.id, ...row, detailUrl: `/agents/${row.id}` }))
            .filter(agent => agent.id !== excludeId);
          break;
        }
      } catch (err) {
        // Column may not exist, try next query
        console.log(`Query by ${q.label} failed, trying next...`);
      }
    }

    if (agents.length === 0) {
      console.log('No agents found in database, creating emergency default agents');
      return [
        {
          id: 'chatgpt-prompts',
          title: 'ChatGPT Prompts to Increase Productivity',
          price: 0,
          isFree: true,
          imageUrl: 'https://picsum.photos/300/200?random=1',
          rating: { average: 4.7, count: 128 },
          detailUrl: '/agents/chatgpt-prompts'
        },
        {
          id: 'resume-template',
          title: 'Professional Resume Template',
          price: 9.99,
          imageUrl: 'https://picsum.photos/300/200?random=2',
          rating: { average: 4.9, count: 87 },
          detailUrl: '/agents/resume-template'
        },
        {
          id: 'ai-art-generator',
          title: 'AI Art Generator Prompt Pack',
          price: 14.99,
          imageUrl: 'https://picsum.photos/300/200?random=3',
          rating: { average: 4.5, count: 62 },
          detailUrl: '/agents/ai-art-generator'
        }
      ].filter(agent => agent.id !== excludeId).slice(0, limit);
    }

    const result = agents.slice(0, limit);
    console.log(`Returning ${result.length} popular agents`);
    return result;
  } catch (error) {
    logger.error('Error getting popular agents:', error);
    return [];
  }
}

/**
 * @swagger
 * /api/recommendations/track-view:
 *   post:
 *     summary: Track product view
 *     tags: [Recommendations]
 */
router.post('/track-view', async (req, res) => {
  console.log('Track view endpoint hit!', {
    body: req.body,
    headers: req.headers
  });

  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // For anonymous users, still track but don't require authentication
    let userId = 'anonymous';

    // Check for Firebase ID token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        userId = decodedToken.uid;
        console.log('Authenticated user view:', userId, 'productId:', productId);
      } catch (error) {
        console.log('Invalid auth token for tracking view, using anonymous tracking');
      }
    } else {
      console.log('Anonymous view tracking for productId:', productId);
    }

    // Store the view
    try {
      await pool.query(
        'INSERT INTO product_views (product_id, user_id, timestamp) VALUES ($1, $2, NOW())',
        [productId, userId]
      );

      // If user is authenticated, also add to their activity history
      if (userId !== 'anonymous') {
        await pool.query(
          'INSERT INTO user_activity_views (user_id, agent_id, timestamp) VALUES ($1, $2, NOW())',
          [userId, productId]
        );
      }

      console.log('Successfully tracked view for product:', productId, 'by user:', userId);
      return res.status(200).json({ success: true });
    } catch (dbError) {
      console.error('Database error while tracking view:', dbError);
      return res.status(500).json({ error: 'Database error while tracking view' });
    }
  } catch (error) {
    console.error('Error tracking product view:', error);
    return res.status(500).json({ error: 'Failed to track product view' });
  }
});

/**
 * @swagger
 * /api/recommendations/real-agents:
 *   get:
 *     summary: Get real agents only
 *     tags: [Recommendations]
 */
router.get('/real-agents', async (req, res) => {
  console.log('Real agents endpoint hit!');

  try {
    const limit = parseInt(req.query.limit) || 3;
    const agents = await getPopularAgents(limit * 2, null);

    return res.json({
      recommendations: agents.slice(0, limit),
      source: 'real-agents'
    });
  } catch (error) {
    console.error('Error in real-agents endpoint:', error);
    return res.status(500).json({
      error: 'Failed to get real agents',
      message: error.message
    });
  }
});

module.exports = router;
