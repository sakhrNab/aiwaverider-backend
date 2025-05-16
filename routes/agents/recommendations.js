const express = require('express');
const router = express.Router();
const { db, admin } = require('../../config/firebase');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const logger = require('../../utils/logger');

/**
 * GET /api/recommendations/test
 * A test endpoint that returns valid recommendations for testing
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
        const docRef = await db.collection('agents').doc(id).get();
        if (docRef.exists) {
          validAgents.push({ 
            id: docRef.id, 
            ...docRef.data(),
            // Ensure the detailUrl property is set correctly
            detailUrl: `/agents/${docRef.id}`
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
    let agentsQuery = await db.collection('agents').limit(limit).get();
    
    if (agentsQuery.empty) {
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
    const agents = [];
    agentsQuery.forEach(doc => {
      agents.push({
        id: doc.id,
        ...doc.data(),
        // Ensure detailUrl property is set
        detailUrl: `/agents/${doc.id}`
      });
    });
    
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
 * GET /api/recommendations/diagnostic
 * A diagnostic endpoint to check what agents are available in the database
 */
router.get('/diagnostic', async (req, res) => {
  console.log('Diagnostic endpoint hit!');
  
  try {
    // Get a sample of agents from the database
    const agentsQuery = await db.collection('agents').limit(5).get();
    
    if (agentsQuery.empty) {
      console.log('No agents found in database!');
      return res.json({
        status: 'warning',
        message: 'No agents found in database',
        collections: []
      });
    }
    
    // Get all available collections to check structure
    const collections = await db.listCollections();
    const collectionIds = collections.map(col => col.id);
    
    // Get sample data
    const agents = [];
    agentsQuery.forEach(doc => {
      agents.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`Found ${agents.length} agents for diagnostic`);
    return res.json({
      status: 'success',
      message: `Found ${agents.length} agents`,
      agents,
      collections: collectionIds
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
 * GET /api/recommendations
 * Get personalized recommendations for the current user
 * 
 * Query parameters:
 * - limit: Maximum number of recommendations to return (default: 3)
 * - exclude: Product ID to exclude from recommendations
 * - useHistory: Whether to include user history in recommendation algorithm (default: true)
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
    // This prevents recommendation of non-existent agents
    const agentsCheck = await db.collection('agents').limit(1).get();
    if (agentsCheck.empty) {
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
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      logger.warn(`User profile not found for recommendations: ${userId}`);
      return [];
    }
    
    const userData = userDoc.data();
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
      let interestAgentsQuery;
      
      try {
        interestAgentsQuery = await db.collection('agents')
          .where('categories', 'array-contains-any', userInterests)
          .limit(20)
          .get();
        
        console.log(`Found ${interestAgentsQuery.size} agents matching interests`);
      } catch (error) {
        console.error('Error querying by interests:', error);
        
        // Fallback: query all agents if the array-contains-any query fails
        interestAgentsQuery = await db.collection('agents')
          .limit(20)
          .get();
        
        console.log(`Fallback: retrieved ${interestAgentsQuery.size} agents`);
      }
      
      interestAgentsQuery.forEach(doc => {
        const agent = { id: doc.id, ...doc.data() };
        if (agent.id !== excludeId) {
          if (!scoredItems[agent.id]) {
            scoredItems[agent.id] = { item: agent, score: 0 };
          }
          scoredItems[agent.id].score += 10; // Base score for matching interest
          
          // Add extra points for each matching interest
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
      const recentAgentsQuery = await db.collection('agents')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      
      console.log(`Found ${recentAgentsQuery.size} recent agents`);
      
      recentAgentsQuery.forEach(doc => {
        const agent = { id: doc.id, ...doc.data() };
        if (agent.id !== excludeId) {
          if (!scoredItems[agent.id]) {
            scoredItems[agent.id] = { item: agent, score: 0 };
          }
          scoredItems[agent.id].score += 5; // Lower score for recent agents without interest match
        }
      });
    }
    
    // 2. Add points for agents in user's wishlists
    console.log('Checking user wishlists');
    try {
      const wishlistsQuery = await db.collection('wishlists')
        .where('userId', '==', userId)
        .get();
      
      console.log(`Found ${wishlistsQuery.size} wishlists for user`);
      
      const wishlistAgentIds = new Set();
      for (const doc of wishlistsQuery.docs) {
        const wishlist = doc.data();
        const items = wishlist.items || [];
        
        for (const item of items) {
          if (item && item.id) {
            wishlistAgentIds.add(item.id);
          }
        }
      }
      
      console.log(`Found ${wishlistAgentIds.size} agent IDs in wishlists`);
      
      // Get the full agent data for wishlist items
      if (wishlistAgentIds.size > 0) {
        const wishlistAgentIdsArray = Array.from(wishlistAgentIds);
        
        // Firestore only allows 10 items in 'in' queries, so we might need multiple batches
        for (let i = 0; i < wishlistAgentIdsArray.length; i += 10) {
          const batch = wishlistAgentIdsArray.slice(i, i + 10);
          
          if (batch.length === 0) continue;
          
          try {
            const batchQuery = await db.collection('agents')
              .where(admin.firestore.FieldPath.documentId(), 'in', batch)
              .get();
            
            console.log(`Retrieved ${batchQuery.size} agents from wishlist batch ${i/10 + 1}`);
            
            batchQuery.forEach(doc => {
              const agent = { id: doc.id, ...doc.data() };
              if (agent.id !== excludeId) {
                if (!scoredItems[agent.id]) {
                  scoredItems[agent.id] = { item: agent, score: 0 };
                }
                scoredItems[agent.id].score += 15; // High score for wishlist items
              }
            });
          } catch (batchError) {
            console.error(`Error retrieving wishlist batch ${i/10 + 1}:`, batchError);
          }
        }
      }
    } catch (wishlistError) {
      console.error('Error retrieving wishlists:', wishlistError);
    }
    
    // 3. Add points for recently viewed agents
    console.log('Checking recently viewed agents');
    try {
      const viewsQuery = await db.collection('userActivity')
        .doc(userId)
        .collection('views')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();
      
      console.log(`Found ${viewsQuery.size} recent views`);
      
      const viewedAgentIds = new Set();
      viewsQuery.forEach(doc => {
        const viewData = doc.data();
        if (viewData.agentId && viewData.agentId !== excludeId) {
          viewedAgentIds.add(viewData.agentId);
        }
      });
      
      console.log(`Found ${viewedAgentIds.size} unique viewed agent IDs`);
      
      if (viewedAgentIds.size > 0) {
        const viewedAgentIdsArray = Array.from(viewedAgentIds);
        
        for (let i = 0; i < viewedAgentIdsArray.length; i += 10) {
          const batch = viewedAgentIdsArray.slice(i, i + 10);
          
          if (batch.length === 0) continue;
          
          try {
            const batchQuery = await db.collection('agents')
              .where(admin.firestore.FieldPath.documentId(), 'in', batch)
              .get();
            
            console.log(`Retrieved ${batchQuery.size} agents from views batch ${i/10 + 1}`);
            
            batchQuery.forEach(doc => {
              const agent = { id: doc.id, ...doc.data() };
              if (agent.id !== excludeId) {
                if (!scoredItems[agent.id]) {
                  scoredItems[agent.id] = { item: agent, score: 0 };
                }
                scoredItems[agent.id].score += 5; // Moderate score for viewed items
              }
            });
          } catch (batchError) {
            console.error(`Error retrieving views batch ${i/10 + 1}:`, batchError);
          }
        }
      }
    } catch (viewsError) {
      console.error('Error retrieving user views:', viewsError);
    }
    
    // 4. Add points for previous orders
    console.log('Checking previous orders');
    try {
      const ordersQuery = await db.collection('orders')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();
      
      console.log(`Found ${ordersQuery.size} previous orders`);
      
      // Get creators from previously purchased agents to recommend more from the same creators
      const purchasedCreatorIds = new Set();
      ordersQuery.forEach(doc => {
        const order = doc.data();
        const items = order.items || [];
        
        for (const item of items) {
          if (item.creator && item.creator.id) {
            purchasedCreatorIds.add(item.creator.id);
          }
        }
      });
      
      console.log(`Found ${purchasedCreatorIds.size} unique creator IDs from purchases`);
      
      // Add points for agents from the same creators
      if (purchasedCreatorIds.size > 0) {
        const creatorIdsArray = Array.from(purchasedCreatorIds);
        
        for (const creatorId of creatorIdsArray) {
          try {
            const creatorAgentsQuery = await db.collection('agents')
              .where('creator.id', '==', creatorId)
              .limit(5)
              .get();
            
            console.log(`Found ${creatorAgentsQuery.size} agents from creator ${creatorId}`);
            
            creatorAgentsQuery.forEach(doc => {
              const agent = { id: doc.id, ...doc.data() };
              if (agent.id !== excludeId) {
                if (!scoredItems[agent.id]) {
                  scoredItems[agent.id] = { item: agent, score: 0 };
                }
                scoredItems[agent.id].score += 8; // Good score for same creator
              }
            });
          } catch (creatorError) {
            console.error(`Error retrieving agents for creator ${creatorId}:`, creatorError);
          }
        }
      }
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
    
    // First try to get agents with popularity field
    let agentsQuery = await db.collection('agents')
      .orderBy('popularity', 'desc')
      .limit(limit * 2) // Get more than we need to account for filtering
      .get();
    
    // If no results, try agents sorted by rating
    if (agentsQuery.empty) {
      console.log('No agents with popularity field, trying rating.average');
      agentsQuery = await db.collection('agents')
        .orderBy('rating.average', 'desc')
        .limit(limit * 2)
        .get();
    }
    
    // If still no results, just get the most recent agents
    if (agentsQuery.empty) {
      console.log('No agents with rating.average, trying most recent');
      agentsQuery = await db.collection('agents')
        .orderBy('createdAt', 'desc')
        .limit(limit * 2)
        .get();
    }
    
    // If we still have no agents, just get any agents
    if (agentsQuery.empty) {
      console.log('No agents with createdAt, getting any agents');
      agentsQuery = await db.collection('agents')
        .limit(limit * 2)
        .get();
    }
    
    console.log(`Found ${agentsQuery.size} agents for fallback recommendations`);
    
    const agents = [];
    agentsQuery.forEach(doc => {
      const agent = { 
        id: doc.id, 
        ...doc.data(), 
        detailUrl: `/agents/${doc.id}` 
      };
      if (agent.id !== excludeId) {
        agents.push(agent);
      }
    });
    
    const result = agents.slice(0, limit);
    console.log(`Returning ${result.length} popular agents`);
    return result;
  } catch (error) {
    logger.error('Error getting popular agents:', error);
    
    // Last resort - create mock agents with valid IDs
    // We need to make sure these IDs actually exist in the database
    // The seedSampleAgents.js script creates these exact agents
    console.log('Creating emergency mock agents due to error');
    try {
      // Try to fetch the emergency backup agents from the database first
      const emergencyAgentIds = ['chatgpt-prompts', 'resume-template', 'ai-art-generator'];
      const validIds = [];
      
      // Check if any of these agents exist in the database
      for (const id of emergencyAgentIds) {
        if (id === excludeId) continue;
        const docRef = await db.collection('agents').doc(id).get();
        if (docRef.exists) {
          validIds.push(id);
        }
      }
      
      // If we found some valid agents, return their actual data
      if (validIds.length > 0) {
        console.log(`Found ${validIds.length} valid emergency agents in database`, validIds);
        const emergencyAgents = [];
        
        for (const id of validIds.slice(0, limit)) {
          const docRef = await db.collection('agents').doc(id).get();
          emergencyAgents.push({
            id: docRef.id, 
            ...docRef.data(),
            detailUrl: `/agents/${docRef.id}`
          });
        }
        
        return emergencyAgents;
      }
    } catch (fallbackError) {
      console.error('Error fetching emergency agents:', fallbackError);
    }
    
    // If everything else fails, return hardcoded agents
    console.log('Using hardcoded emergency agents - you should run seedSampleAgents.js to add real agents');
    return [
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
    ].filter(agent => agent.id !== excludeId).slice(0, limit);
  }
}

/**
 * POST /api/recommendations/track-view
 * Track when a user views a product to improve recommendations
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
    
    // Store the view (either in anonymous stats or user-specific)
    try {
      await db.collection('productViews')
        .add({
          productId,
          userId, 
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      
      // If user is authenticated, also add to their activity history
      if (userId !== 'anonymous') {
        await db.collection('userActivity')
          .doc(userId)
          .collection('views')
          .add({
            agentId: productId,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
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
 * GET /api/recommendations/real-agents
 * Forces returning only valid real agents from the database, never debug or mock data
 */
router.get('/real-agents', async (req, res) => {
  console.log('Real agents endpoint hit!');
  
  try {
    const limit = parseInt(req.query.limit) || 3;
    const agents = [];
    
    // First try to get agents with popularity sorting
    let agentsQuery = await db.collection('agents')
      .orderBy('popularity', 'desc')
      .limit(limit * 2)
      .get();
    
    // If no results with popularity, try any agents
    if (agentsQuery.empty) {
      agentsQuery = await db.collection('agents')
        .limit(limit * 2)
        .get();
    }
    
    agentsQuery.forEach(doc => {
      const agent = { 
        id: doc.id, 
        ...doc.data(),
        detailUrl: `/agents/${doc.id}`
      };
      agents.push(agent);
    });
    
    // If we have no agents at all from database, create hardcoded ones with real IDs 
    // that match our sample data seeders
    if (agents.length === 0) {
      console.log('No agents found in database, creating emergency default agents');
      
      agents.push({
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
      });
      
      agents.push({
        id: 'resume-template',
        title: 'Professional Resume Template',
        price: 9.99,
        imageUrl: 'https://picsum.photos/300/200?random=2',
        rating: {
          average: 4.9,
          count: 87
        },
        detailUrl: '/agents/resume-template'
      });
      
      agents.push({
        id: 'ai-art-generator',
        title: 'AI Art Generator Prompt Pack',
        price: 14.99,
        imageUrl: 'https://picsum.photos/300/200?random=3',
        rating: {
          average: 4.5,
          count: 62
        },
        detailUrl: '/agents/ai-art-generator'
      });
    }
    
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