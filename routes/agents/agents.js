// backend/routes/agents.js
const express = require('express');
const router = express.Router();
const agentsController = require('../../controllers/agent/agentsController');
const { validateFirebaseToken, isAdmin } = require('../../middleware/authenticationMiddleware');
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');
const upload = require('../../middleware/upload');
const { db } = require('../../config/firebase');
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const { getCache, setCache, deleteCache, deleteCacheByPattern, generateAgentCacheKey } = require('../../utils/cache');

// Helper function to increment agent download count
async function incrementAgentDownloadCount(agentId) {
  try {
    const agentRef = db.collection('agents').doc(agentId);
    await agentRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1)
    });
    return true;
  } catch (error) {
    console.error(`Error incrementing download count for agent ${agentId}:`, error);
    return false;
  }
}

// Cache durations based on environment
const getDefaultCacheDuration = () => {
  return process.env.NODE_ENV === 'development' ? 30 : 300; // 30 seconds in dev, 5 minutes in production
};

const getFeaturedCacheDuration = () => {
  return process.env.NODE_ENV === 'development' ? 60 : 900; // 1 minute in dev, 15 minutes in production
};

// ==========================================
// CACHE MANAGEMENT ENDPOINTS - NEW
// ==========================================

// Manual cache refresh (admin only) - useful for debugging and maintenance
router.post('/cache/refresh', validateFirebaseToken, isAdmin, agentsController.refreshCache);

// Cache statistics (admin only) - for monitoring
router.get('/cache/stats', validateFirebaseToken, isAdmin, agentsController.getCacheStats);

// Legacy cache busting route (keep for backward compatibility)
router.get('/refresh-cache', validateFirebaseToken, (req, res) => {
  // Clear the cache for the agents routes
  if (req.app.locals.cache) {
    const cacheKeys = Array.from(req.app.locals.cache.keys());
    const agentCacheKeys = cacheKeys.filter(key => key.includes('/api/agents'));
    
    agentCacheKeys.forEach(key => {
      req.app.locals.cache.del(key);
    });
    
    console.log(`Cleared ${agentCacheKeys.length} agent cache entries`);
    return res.status(200).json({ message: `Cleared ${agentCacheKeys.length} agent cache entries` });
  }
  
  return res.status(200).json({ message: 'No cache to clear' });
});

// ==========================================
// PUBLIC ENDPOINTS (CACHED) - UPDATED
// ==========================================

// IMPORTANT: Specific routes must come before dynamic parameter routes
// Main agents endpoint - now uses in-memory cache and searches integrations properly
router.get('/', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getAgents);

// Featured agents
router.get('/featured', publicCacheMiddleware({ duration: getFeaturedCacheDuration() }), agentsController.getFeaturedAgents);

// Latest agents
router.get('/latest', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getLatestAgentsRoute);

// Agent count - NEW
router.get('/count', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getAgentCount);

// Search count endpoint - matches frontend pattern: /api/agents/search/count?q=telegram&category=All
router.get('/search/count', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getSearchResultsCount);

// ==========================================
// HEALTH CHECK ENDPOINT - NEW
// ==========================================

router.get('/health', async (req, res) => {
  try {
    const { isRedisHealthy } = require('../../utils/cache'); // Update path as needed
    const redisHealth = await isRedisHealthy();
    
    // Check if in-memory cache is loaded
    const cacheStats = await agentsController.getCacheStats({ query: {} }, { 
      status: () => ({ json: (data) => data }),
      json: (data) => data 
    });
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      redis: redisHealth ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      inMemoryCache: {
        loaded: cacheStats?.inMemoryCache?.loaded || false,
        agentCount: cacheStats?.inMemoryCache?.agentCount || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==========================================
// SPECIFIC ID FORMAT ROUTES
// ==========================================

// Add a specific route for Firebase document IDs
router.get('/doc/:docId', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), (req, res) => {
  // Set the agentId parameter to the docId and forward to the getAgentById controller
  req.params.id = req.params.docId;
  return agentsController.getAgentById(req, res);
});

// Add a specific route for the 'agent-XX' format IDs
router.get('/agent-:numericId([0-9]+)', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), (req, res) => {
  // Set the agentId parameter and forward to the getAgentById controller
  // This captures 'agent-41' format directly using route parameter
  const agentId = `agent-${req.params.numericId}`;
  console.log(`Special route captured agent-XX format: ${agentId}`);
  req.params.id = agentId;
  return agentsController.getAgentById(req, res);
});

// ==========================================
// AGENT CRUD OPERATIONS - UPDATED
// ==========================================

// Create new agent (admin only)
// Use upload middleware to handle file uploads - set up fields for image, icon, and JSON file
router.post('/', validateFirebaseToken, isAdmin, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), agentsController.createAgent);

// Update agent (admin only) - PATCH
router.patch('/:agentId', validateFirebaseToken, isAdmin, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), agentsController.updateAgent);

// Update agent (admin only) - PUT for compatibility with frontend API calls
router.put('/:agentId', validateFirebaseToken, isAdmin, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), agentsController.updateAgent);

// Delete agent (admin only)
router.delete('/:agentId', validateFirebaseToken, isAdmin, agentsController.deleteAgent);

// ==========================================
// REVIEW ENDPOINTS
// ==========================================
router.post('/:agentId/reviews', validateFirebaseToken, agentsController.addAgentReview_controller);
router.delete('/:agentId/reviews/:reviewId', validateFirebaseToken, agentsController.deleteAgentReview_controller);

// ==========================================
// WISHLIST ENDPOINTS
// ==========================================

// Get user's wishlists
router.get('/wishlists', validateFirebaseToken, agentsController.getWishlists);

// Toggle wishlist
router.post('/wishlists/:agentId', validateFirebaseToken, agentsController.toggleWishlist);

// Get specific wishlist
router.get('/wishlists/:wishlistId', validateFirebaseToken, agentsController.getWishlistById);

// ==========================================
// LIKE/INTERACTION ENDPOINTS
// ==========================================

// Toggle like on an agent
router.post('/:agentId/toggle-like', validateFirebaseToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.uid;
    
    // Check if agent exists
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    const likes = agentData.likes || [];
    const userLikedIndex = likes.indexOf(userId);
    
    let updatedLikes;
    let liked;
    
    if (userLikedIndex >= 0) {
      // User already liked, remove the like
      updatedLikes = likes.filter(id => id !== userId);
      liked = false;
    } else {
      // User hasn't liked, add the like
      updatedLikes = [...likes, userId];
      liked = true;
    }
    
    // Update agent document
    await agentRef.update({
      likes: updatedLikes
    });
    
    // Invalidate user-like-status cache for this user+agent
    try {
      await deleteCache(`agent:${agentId}:user:${userId}:like`);
      await deleteCache(generateAgentCacheKey(agentId));
      await deleteCacheByPattern('agents:results:*');
    } catch (e) {}
    
    res.json({
      success: true,
      liked,
      likesCount: updatedLikes.length
    });
    
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// Check if user has liked an agent (cached per user+agent)
router.get('/:id/user-like-status', validateFirebaseToken, async (req, res) => {
  try {
    const agentId = req.params.id;
    const userId = req.user.uid;
    const cacheKey = `agent:${agentId}:user:${userId}:like`;
    
    // Try cache first
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    // Get the agent document to check if the user is in the likes array
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    const likes = agentData.likes || [];
    const liked = Array.isArray(likes) ? likes.includes(userId) : false;
    const likesCount = Array.isArray(likes) ? likes.length : 0;
    
    const result = { liked, likesCount };
    // Cache with a short TTL via setCache auto TTL selection
    await setCache(cacheKey, result);
    
    return res.json(result);
  } catch (error) {
    console.error('Error fetching user like status:', error);
    return res.status(500).json({ error: 'Failed to fetch like status' });
  }
});

// ==========================================
// DOWNLOAD ENDPOINTS
// ==========================================

// GET /api/agents/:agentId/downloads - Get download count for an agent
router.get('/:agentId/downloads', agentsController.getDownloadCount);

// POST /api/agents/:agentId/downloads - Increment download count
router.post('/:agentId/downloads', validateFirebaseToken, agentsController.incrementDownloadCount);

// Increment download count - works for both authenticated and unauthenticated users
router.post('/:agentId/increment-downloads', async (req, res) => {
  try {
    const { agentId } = req.params;
    
    // Check if agent exists
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Increment download count
    await agentRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1)
    });
    
    res.json({ 
      success: true,
      message: 'Download count incremented successfully'
    });
    
  } catch (error) {
    console.error('Error incrementing download count:', error);
    res.status(500).json({ error: 'Failed to increment download count' });
  }
});

// Agent Downloads (requires authentication)
router.post('/:id/download', validateFirebaseToken, async (req, res) => {
  const agentId = req.params.id;
  const userId = req.user.uid;
  
  try {
    // Create a JavaScript Date object for the download timestamp
    const jsDate = new Date();
    
    // Get agent data
    const agentDoc = await db.collection('agents').doc(agentId).get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    
    // Get price - for purchasing tracking
    const price = typeof agentData.price === 'object' ? 
      (agentData.price.basePrice || 0) : 
      (agentData.price || 0);
    
    // Update user's downloads array
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const downloads = userData.downloads || [];
      
      // Check if user already has this download recorded
      const existingDownload = downloads.find(d => d.agentId === agentId);
      
      if (!existingDownload) {
        // Add to downloads array - using regular Date instead of serverTimestamp
        await userRef.update({
          downloads: admin.firestore.FieldValue.arrayUnion({
            agentId,
            id: agentId,
            title: agentData.title || 'Unknown Agent',
            imageUrl: agentData.imageUrl || null,
            downloadDate: jsDate, // Use JavaScript Date instead of serverTimestamp
            price: price,
            isFree: price === 0
          })
        });
      }
    }
    
    // Increment agent download count
    await incrementAgentDownloadCount(agentId);
    
    // Return success with download URL
    res.json({
      success: true,
      message: 'Download processed successfully',
      downloadUrl: agentData.jsonFileUrl,
      agent: {
        id: agentId,
        ...agentData,
        downloadDate: new Date() // Also use a regular Date here
      }
    });
  } catch (error) {
    console.error('Error processing download:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing download',
      error: error.message
    });
  }
});

// Free Agent Download (no authentication required but optional)
router.post('/:id/free-download', (req, res, next) => {
  // Check if there's an authorization header - if yes, validate it, if no, continue without auth
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // User is trying to authenticate - validate the token
    console.log('[FREE-DOWNLOAD] Authentication header found, attempting to validate');
    validateFirebaseToken(req, res, (err) => {
      if (err) {
        // Authentication failed, but for free downloads, we'll continue without auth
        console.log('[FREE-DOWNLOAD] Authentication failed, continuing without auth. Error:', err.message || err);
        req.user = null;
      } else {
        console.log('[FREE-DOWNLOAD] Authentication successful for user:', req.user?.uid);
      }
      next();
    });
  } else {
    // No authentication header - continue without auth
    console.log('[FREE-DOWNLOAD] No authentication header, proceeding without auth');
    req.user = null;
    next();
  }
}, async (req, res) => {
  const agentId = req.params.id;
  const userId = req.user?.uid; // Optional - user might not be authenticated
  
  try {
    // Create a JavaScript Date object for the download timestamp
    const jsDate = new Date();
    
    // Get agent data
    const agentDoc = await db.collection('agents').doc(agentId).get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    
    // Verify agent is free
    if (agentData.price !== 0) {
      return res.status(403).json({ success: false, message: 'This agent is not free' });
    }
    
    // Update user's downloads array if authenticated
    if (userId) {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        const downloads = userData.downloads || [];
        
        // Check if user already has this download recorded
        const existingDownload = downloads.find(d => d.agentId === agentId);
        
        if (!existingDownload) {
          // Add to downloads array - using regular Date instead of serverTimestamp
          await userRef.update({
            downloads: admin.firestore.FieldValue.arrayUnion({
              agentId,
              id: agentId,
              title: agentData.title || 'Unknown Agent',
              imageUrl: agentData.imageUrl || null,
              downloadDate: jsDate, // Use JavaScript Date instead of serverTimestamp
              price: 0,
              isFree: true
            })
          });
        }
      }
    }
    
    // Increment agent download count
    await incrementAgentDownloadCount(agentId);
    
    // Return success with download info
    res.json({
      success: true,
      message: 'Free agent download processed successfully',
      downloadUrl: agentData.jsonFileUrl || agentData.downloadUrl || agentData.fileUrl,
      agent: {
        id: agentId,
        ...agentData,
        downloadDate: new Date() // Also use a regular Date here
      }
    });
  } catch (error) {
    console.error('Error processing free download:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing free download',
      error: error.message
    });
  }
});

// OPTIONS handler for CORS preflight requests
router.options('/:id/download', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  res.status(200).end();
});

// Download file proxy endpoint (no authentication required)
router.get('/:id/download', async (req, res) => {
  try {
    // Set CORS headers immediately for mobile compatibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    
    const fileUrl = req.query.url;
    const agentId = req.params.id;
    const userAgent = req.headers['user-agent'] || '';
    const isMobileRequest = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    
    console.log(`[DOWNLOAD PROXY] Request received for agent ${agentId}, URL: ${fileUrl}`);
    console.log(`[DOWNLOAD PROXY] User-Agent: ${userAgent}`);
    console.log(`[DOWNLOAD PROXY] Is mobile request: ${isMobileRequest}`);
    
    if (!fileUrl) {
      console.log('[DOWNLOAD PROXY] Missing URL parameter');
      return res.status(400).json({ success: false, message: 'File URL is required' });
    }
    
    // Validate that this is a Google Storage URL for security
    if (!fileUrl.includes('storage.googleapis.com') && !fileUrl.includes('firebasestorage.app')) {
      console.log('[DOWNLOAD PROXY] Invalid URL - not a Google Storage URL');
      return res.status(400).json({ success: false, message: 'Invalid file URL' });
    }
    
    // Log the request details to help debug
    console.log(`[DOWNLOAD PROXY] Proxying download for agent ${agentId}, file: ${fileUrl}`);
    
    // Use axios to download the file
    const axios = require('axios');
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'stream',
      timeout: 30000 // 30 second timeout
    });
    
    console.log(`[DOWNLOAD PROXY] File fetched successfully, status: ${response.status}`);
    console.log(`[DOWNLOAD PROXY] Response headers:`, response.headers);
    
    // Get the filename from the URL
    const urlParts = fileUrl.split('/');
    let filename = urlParts[urlParts.length - 1];
    
    // Clean up filename (remove query parameters)
    if (filename.includes('?')) {
      filename = filename.split('?')[0];
    }
    
    // Ensure filename has proper extension
    if (!filename.includes('.')) {
      filename = `${agentId}.json`;
    }
    
    // Set headers to force download with mobile browser compatibility
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Additional headers for mobile download support
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // If content type is in the response, use it
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    } else {
      // Default to application/json for JSON files
      if (filename.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json');
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
    }
    
    console.log(`[DOWNLOAD PROXY] Sending file to client: ${filename}`);
    
    // Pipe the file stream to the response
    response.data.pipe(res);
    
    console.log(`[DOWNLOAD PROXY] File download completed successfully for ${filename}`);
  } catch (error) {
    console.error('[DOWNLOAD PROXY] Error proxying file download:', error);
    
    // Return a more helpful error response
    res.status(500).json({ 
      success: false, 
      message: 'Error downloading file',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==========================================
// REVIEW ELIGIBILITY ENDPOINTS
// ==========================================

// Remove deprecated can-review endpoint (eligibility handled client-side and enforced on submission)

// ==========================================
// UTILITY/ADMIN ENDPOINTS
// ==========================================

// Run the database update script programmatically
router.post('/update-collections', validateFirebaseToken, isAdmin, async (req, res) => {
  try {
    // Import the update script functions
    const { initializeCollections } = require('../../scripts/updateAgentsCollection');
    
    // Run the initialization
    await initializeCollections();
    
    res.json({ success: true, message: 'Agent collections updated successfully' });
  } catch (error) {
    console.error('Error running update script:', error);
    res.status(500).json({ error: 'Failed to update collections' });
  }
});

// Development endpoint - only available in development environment
if (process.env.NODE_ENV === 'development') {
  router.post('/seed', agentsController.seedAgents);
}

// ==========================================
// DYNAMIC AGENT ID ROUTE - MUST BE LAST
// ==========================================

// IMPORTANT: This dynamic route must come LAST to avoid catching specific routes like /count
router.get('/:agentId', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getAgentById);

module.exports = router;