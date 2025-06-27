console.log('Loading agentsController.js');

// Import necessary modules
const { db } = require('../../config/firebase');
const admin = require('firebase-admin');
// const axios = require('axios'); // Uncomment if used
const logger = require('../../utils/logger');
const { getCache, setCache, deleteCache } = require('../../utils/cache');
// const { parseCustomFilters } = require('../utils/queryParser'); // Uncomment if used
// const { restructureAgent } = require('../scripts/update-agent-structure'); // REMOVED/COMMENTED OUT

// Cache keys for consistent cache handling
const CACHE_KEYS = {
  AGENTS: 'agents',
  FEATURED: 'featured_agents',
  AGENT: 'agent_',
  WISHLISTS: 'user_wishlists_',
  WISHLIST: 'wishlist_',
  LATEST: 'latest_agents'
};

// Cache TTL for agents (5 minutes) - Uncomment if used
// const AGENTS_CACHE_TTL = 5 * 60;

// Firebase Storage paths
const STORAGE_PATHS = {
  IMAGES: 'agents/',
  ICONS: 'agent_icons/',
  JSON_FILES: 'agent_templates/',
};

// --- HELPER FUNCTIONS (for parsing and file upload, still useful) ---

/**
 * Parses incoming request data, handling FormData and stringified JSON fields.
 * @param {object} reqBody - The req.body object.
 * @returns {object} The parsed data.
 */
const _parseIncomingData = (reqBody) => {
  let data = { ...reqBody };

  if (data.data && typeof data.data === 'string') {
    try {
      const parsedJsonData = JSON.parse(data.data);
      data = { ...parsedJsonData, ...data };
      delete data.data;
      logger.info('Parsed and merged data from req.body.data field.');
    } catch (e) {
      logger.warn('Failed to parse req.body.data JSON string. Using req.body as is.', e);
    }
  }

  // Attempt to parse fields that are commonly stringified JSON in FormData
  const fieldsToParse = ['priceDetails', 'creator', 'features', 'tags', 'image', 'icon', 'jsonFile', 'imageData', 'iconData', 'jsonFileData'];
  for (const field of fieldsToParse) {
    if (data[field] && typeof data[field] === 'string') {
      try {
        data[field] = JSON.parse(data[field]);
      } catch (e) {
        // Not an error if it's not JSON, could be a simple string like a URL
      }
    }
  }
  // Clean up temp frontend fields that might have been passed in req.body directly
  delete data._imageFile;
  delete data._iconFile;
  // delete data._jsonFile; // req.body.jsonFile is the actual file for multer, not a temp field
  delete data._hasBlobImageUrl;
  delete data._hasBlobIconUrl;
  delete data._hasBlobJsonFileUrl;

  return data;
};

/**
 * Uploads a file to Firebase Storage.
 * @param {Object} file - The file object from Multer.
 * @param {string} pathPrefix - The Firebase Storage path prefix.
 * @param {object} storageBucket - Firebase admin.storage().bucket() instance.
 * @returns {Promise<Object|null>} File metadata object or null.
 */
const _uploadFileToStorage = async (file, pathPrefix, storageBucket) => {
  if (!file) return null;
  logger.info(`Uploading new file: ${file.originalname} to path starting with ${pathPrefix}`);
  try {
    const fileName = `${pathPrefix}${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9_.]/g, '_')}`;
    const fileRef = storageBucket.file(fileName);
    await fileRef.save(file.buffer, { metadata: { contentType: file.mimetype } });
    await fileRef.makePublic();
    const publicUrl = `https://storage.googleapis.com/${storageBucket.name}/${fileName}`;
    logger.info(`File uploaded successfully. URL: ${publicUrl}`);
    return {
      url: publicUrl,
      fileName: fileName,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    };
  } catch (uploadError) {
    logger.error(`Error uploading ${file.originalname} to Firebase Storage:`, uploadError);
    return null;
  }
};

/**
 * Gets file metadata if provided as an object.
 * @param {string|Object} fieldValue - The field value from parsed data.
 * @param {string} fieldName - Name of the field for logging.
 * @returns {Object|null} Parsed file metadata or null.
 */
const _getFileMetadataFromRequest = (fieldValue, fieldName) => {
  if (!fieldValue) return null;
  if (typeof fieldValue === 'object' && fieldValue.url) {
    logger.info(`Using existing file metadata from ${fieldName}: ${fieldValue.url}`);
    return fieldValue;
  }
  logger.warn(`No valid URL found in ${fieldName} metadata object:`, fieldValue);
  return null;
};

// --- START OF YOUR EXISTING FUNCTIONS (Keep them as they are) ---
/**
 * Get all agents with optional filtering
 */
const getAgents = async (req, res) => {
  try {
    const {
      category = 'All',
      filter = 'Hot & Now',
      priceMin,
      priceMax,
      rating,
      tags,
      features,
      search,
      page = 1,
      limit = 20
    } = req.query;

    // Create cache key based on request parameters
    // const cacheKey = `${CACHE_KEYS.AGENTS}:${category}:${filter}:${priceMin || 0}:${priceMax || 'max'}:${rating || 0}:${tags || ''}:${features || ''}:${search || ''}:${page}:${limit}`;
    
    // Build query
    let query = db.collection('agents');
    
    // Apply category filter
    if (category && category !== 'All') {
      query = query.where('category', '==', category);
    }

    // Get documents
    let agentsSnapshot = await query.get();
    let agents = [];

    agentsSnapshot.forEach(doc => {
      agents.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Apply other filters in-memory (since Firestore has limitations with complex queries)
    
    // If the filter is 'Free', only return free agents
    if (filter === 'Free') {
      agents = agents.filter(agent => {
          // Check structured isFree flag first
          if (typeof agent.isFree === 'boolean') {
              return agent.isFree;
          }
          // Fallback to older price checks if isFree is not present
          if (agent.priceDetails && typeof agent.priceDetails.basePrice === 'number') {
              return agent.priceDetails.basePrice === 0;
          }
        if (typeof agent.price === 'number') {
          return agent.price === 0;
        }
        if (typeof agent.price === 'string') {
          const lowerPrice = agent.price.toLowerCase();
          return lowerPrice === 'free' || lowerPrice === '$0' || lowerPrice === '0';
        }
        return false;
      });
    }
    
    // Apply price filter
    if (priceMin !== undefined || priceMax !== undefined) {
      const min = priceMin ? parseFloat(priceMin) : 0;
      const max = priceMax ? parseFloat(priceMax) : Infinity;
      
      agents = agents.filter(agent => {
        let priceToCompare = agent.price; // Fallback
        if (agent.priceDetails && typeof agent.priceDetails.discountedPrice === 'number') {
            priceToCompare = agent.priceDetails.discountedPrice;
        } else if (typeof agent.price === 'string') {
          const numValue = parseFloat(agent.price.replace(/[^0-9.]/g, ''));
          if (!isNaN(numValue)) {
            priceToCompare = numValue;
          }
        } else if (typeof agent.price !== 'number') {
            priceToCompare = Infinity; // Treat non-numeric, non-string prices as non-matching
        }
        return priceToCompare >= min && priceToCompare <= max;
      });
    }

    // Apply rating filter
    if (rating) {
      const minRating = parseFloat(rating);
      agents = agents.filter(agent => {
        const agentRating = agent.rating?.average ? parseFloat(agent.rating.average) : 0;
        return agentRating >= minRating;
      });
    }

    // Apply tag filters
    if (tags) {
      const tagsList = tags.split(',');
      agents = agents.filter(agent => {
        if (agent.category && tagsList.includes(agent.category)) {
          return true;
        }
        if (agent.tags && Array.isArray(agent.tags)) {
          return agent.tags.some(tag => tagsList.includes(tag));
        }
        return false;
      });
    }

    // Apply feature filters
    if (features) {
      const featuresList = features.split(',');
      agents = agents.filter(agent => {
          let matches = false;
          if (featuresList.includes('Free') && agent.isFree === true) {
            matches = true;
          }
          if (!matches && featuresList.includes('Subscription') && agent.isSubscription === true) {
            matches = true;
          }
          if (!matches && agent.features && Array.isArray(agent.features)) {
            if (agent.features.some(feature => featuresList.includes(feature))) {
                matches = true;
            }
          }
          return matches;
      });
    }

    // Apply search filter
    if (search) {
      const searchQuery = search.toLowerCase().trim();
      agents = agents.filter(agent => 
        (agent.name && agent.name.toLowerCase().includes(searchQuery)) ||
        (agent.title && agent.title.toLowerCase().includes(searchQuery)) ||
        (agent.description && agent.description.toLowerCase().includes(searchQuery)) ||
        (agent.creator && agent.creator.name && 
         agent.creator.name.toLowerCase().includes(searchQuery))
      );
    }

    // Apply sorting based on filter type
    if (filter === 'Hot & Now') {
      agents.sort((a, b) => {
        const now = new Date();
        const aDate = a.createdAt ? new Date(a.createdAt) : (a.dateCreated ? new Date(a.dateCreated) : null);
        const bDate = b.createdAt ? new Date(b.createdAt) : (b.dateCreated ? new Date(b.dateCreated) : null);
                     
        if (aDate && bDate) {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const aIsRecent = aDate > weekAgo;
          const bIsRecent = bDate > weekAgo;
          
          if (aIsRecent && !bIsRecent) return -1;
          if (!aIsRecent && bIsRecent) return 1;
          if (aIsRecent && bIsRecent) return bDate.getTime() - aDate.getTime();
        } else if (aDate) { return -1; }
          else if (bDate) { return 1; }
        
        return (b.popularity || 0) - (a.popularity || 0);
      });
    } else if (filter === 'Top Rated') {
      agents.sort((a, b) => {
        const ratingA = a.rating?.average ? parseFloat(a.rating.average) : 0;
        const ratingB = b.rating?.average ? parseFloat(b.rating.average) : 0;
        if (ratingB === ratingA) { // Secondary sort by review count
            return (b.rating?.count || 0) - (a.rating?.count || 0);
        }
        return ratingB - ratingA;
      });
    } else if (filter === 'Newest') {
      agents.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : (a.dateCreated ? new Date(a.dateCreated) : new Date(0));
        const dateB = b.createdAt ? new Date(b.createdAt) : (b.dateCreated ? new Date(b.dateCreated) : new Date(0));
        return dateB.getTime() - dateA.getTime();
      });
    }

    // Apply pagination
    const startIndex = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const paginatedAgents = agents.slice(startIndex, startIndex + parseInt(limit, 10));

    const result = {
      agents: paginatedAgents,
      total: agents.length,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(agents.length / parseInt(limit, 10))
    };

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error fetching agents:', error);
    return res.status(500).json({ error: 'Failed to fetch agents', details: error.message });
  }
};

const getFeaturedAgents = async (req, res) => { /* ... your existing code ... */ };
/**
 * Get a single agent by ID with Redis caching
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAgentById = async (req, res) => {
  try {
    // Get agentId from either params.id or params.agentId
    const agentIdFromParams = req.params.id || req.params.agentId; // Renamed for clarity
    
    // Parse query parameters
    const skipCache = req.query.skipCache === 'true' || req.query.refresh === 'true';
    // const includeReviews = req.query.includeReviews !== 'false'; // This is no longer needed as reviews are embedded
    
    logger.info(`Attempting to get agent with ID: "${agentIdFromParams}"`, { skipCache });
    
    if (!agentIdFromParams || typeof agentIdFromParams !== 'string') {
      logger.error('Invalid agent ID format:', agentIdFromParams);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid agent ID format',
        error: 'Agent ID must be a valid string' 
      });
    }
    
    let cleanAgentId = agentIdFromParams.trim();
    if (cleanAgentId.includes('/') || cleanAgentId.includes('\\')) {
      logger.info(`Agent ID contains actual path separators, extracting ID portion`);
      const parts = cleanAgentId.split(/[/\\]/);
      cleanAgentId = parts[parts.length - 1];
      logger.info(`Extracted ID from path: ${cleanAgentId}`);
      if (cleanAgentId.includes('/') || cleanAgentId.includes('\\')) {
        logger.error('Agent ID still contains path separators after cleaning:', cleanAgentId);
        return res.status(400).json({ 
          success: false,
          message: 'Invalid agent ID format',
          error: 'Agent ID must be a valid string without path separators' 
        });
      }
    }
    
    let originalIdForLookup = cleanAgentId; // Keep the initially cleaned ID
    let idToUseForDb = cleanAgentId; // This will be the ID we try for DB

    if (idToUseForDb.startsWith('agent-')) {
      const numericPart = idToUseForDb.substring(6);
      if (/^\d+$/.test(numericPart)) {
        idToUseForDb = numericPart; // Prioritize numeric ID if 'agent-' prefix was stripped
        logger.info(`Stripped 'agent-' prefix, using numeric ID for DB: ${idToUseForDb}`);
      }
    }
    
    // The cache key should ideally use the ID that uniquely identifies the agent in the DB.
    // Since we might try `idToUseForDb` (e.g., numeric '41') or `originalIdForLookup` (e.g., 'agent-41'),
    // we need to be careful. For simplicity, let's base the primary cache key on `idToUseForDb` if it was transformed,
    // otherwise `originalIdForLookup`. The invalidation logic will need to handle both possibilities.
    const primaryCacheKeyId = idToUseForDb;
    const cacheKey = `${CACHE_KEYS.AGENT}${primaryCacheKeyId}`; // Simplified cache key
    
    if (!skipCache) {
      try {
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
          logger.info(`Cache hit for agent ${primaryCacheKeyId} using key ${cacheKey}`);
          return res.status(200).json({
            success: true,
            message: 'Agent retrieved from cache',
            data: cachedData,
            fromCache: true
          });
        }
        logger.info(`Cache miss for agent ${primaryCacheKeyId} (key: ${cacheKey}), fetching from database`);
      } catch (cacheError) {
        logger.error(`Redis cache GET error for ${primaryCacheKeyId}:`, cacheError);
      }
    }
    
    let agentDoc = await db.collection('agents').doc(idToUseForDb).get();
    let finalIdUsedForAgent = idToUseForDb;
    
    if (!agentDoc.exists && idToUseForDb !== originalIdForLookup) {
      logger.info(`Agent not found with ID: ${idToUseForDb}, trying original ID: ${originalIdForLookup}`);
      agentDoc = await db.collection('agents').doc(originalIdForLookup).get();
      if (agentDoc.exists) {
        finalIdUsedForAgent = originalIdForLookup;
      }
    }
    
    if (!agentDoc.exists) {
      logger.error(`Agent not found with any potential ID: ${idToUseForDb} or ${originalIdForLookup}`);
      return res.status(404).json({ 
        success: false,
        message: 'Agent not found',
        error: `No agent exists with ID: ${agentIdFromParams}` 
      });
    }
    
    const agentData = {
      id: agentDoc.id, // Use the ID from the document itself (which is `finalIdUsedForAgent`)
      ...agentDoc.data()
    };
    
    // Reviews are already part of agentData.reviews if the field exists.
    // Ensure reviews are sorted and calculate average rating.
    if (agentData.reviews && Array.isArray(agentData.reviews)) {
      agentData.reviews.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)); // Sort by date desc
      if (agentData.reviews.length > 0) {
        const totalRating = agentData.reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
        agentData.averageRating = totalRating / agentData.reviews.length;
        agentData.reviewCount = agentData.reviews.length;
      } else {
        agentData.averageRating = 0;
        agentData.reviewCount = 0;
      }
    } else {
      // If no reviews field, initialize it
      agentData.reviews = [];
      agentData.averageRating = 0;
      agentData.reviewCount = 0;
    }
    
    agentData._fetchTime = Date.now();
    
    // Cache using the ID that successfully fetched the document (`finalIdUsedForAgent`)
    const effectiveCacheKey = `${CACHE_KEYS.AGENT}${finalIdUsedForAgent}`;
    try {
      await setCache(effectiveCacheKey, agentData, 300); // 5 minutes TTL
      logger.info(`Cached agent ${finalIdUsedForAgent} in Redis using key ${effectiveCacheKey}.`);
    } catch (cacheError) {
      logger.error(`Error caching agent ${finalIdUsedForAgent} in Redis:`, cacheError);
    }
    
    res.set({
      'Cache-Control': 'public, max-age=300',
      'ETag': `W/"agent-${finalIdUsedForAgent}-${agentData._fetchTime}"`
    });
    
    return res.status(200).json({
      success: true,
      message: 'Agent retrieved successfully (from DB)',
      data: agentData,
      fromCache: false
    });
    
  } catch (error) {
    logger.error('Error getting agent by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve agent',
      error: error.message,
      details: { code: error.code, path: req.path, params: req.params, query: req.query }
    });
  }
};
/**
 * Toggle agent in user's wishlist (add or remove)
 */
const toggleWishlist = async (req, res) => {
  try {
    // Extract agentId and sanitize it
    let agentId = req.params.agentId;
    
    // Check if the ID contains extra path segments
    if (agentId && agentId.includes('/')) {
      agentId = agentId.split('/')[0];
    }
    
    // Check if the ID contains query parameters
    if (agentId && agentId.includes('?')) {
      agentId = agentId.split('?')[0];
    }
    
    // Validate agent ID
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      console.error('Invalid agent ID for wishlist toggle:', agentId);
      return res.status(400).json({ error: 'Invalid agent ID provided' });
    }

    const sanitizedAgentId = agentId.trim();
    const { uid } = req.user; // From auth middleware
    
    // Check if agent exists
    const agentDoc = await db.collection('agents').doc(sanitizedAgentId).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Wishlist ID is a combination of user ID and agent ID
    const wishlistId = `${uid}_${sanitizedAgentId}`;
    const wishlistRef = db.collection('wishlists').doc(wishlistId);
    
    // Check if wishlist item exists
    const wishlistDoc = await wishlistRef.get();
    
    if (wishlistDoc.exists) {
      // If it exists, remove it
      await wishlistRef.delete();
      
      // Decrement wishlist count on agent
      const agentRef = db.collection('agents').doc(sanitizedAgentId);
      await db.runTransaction(async (transaction) => {
        const agentDoc = await transaction.get(agentRef);
        if (agentDoc.exists) {
          const currentCount = agentDoc.data().wishlistCount || 0;
          transaction.update(agentRef, { 
            wishlistCount: Math.max(0, currentCount - 1) 
          });
        }
      });
      
      return res.status(200).json({ 
        message: 'Agent removed from wishlist',
        inWishlist: false
      });
    } else {
      // If it doesn't exist, add it
      await wishlistRef.set({
        userId: uid,
        agentId: sanitizedAgentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Increment wishlist count on agent
      const agentRef = db.collection('agents').doc(sanitizedAgentId);
      await db.runTransaction(async (transaction) => {
        const agentDoc = await transaction.get(agentRef);
        if (agentDoc.exists) {
          const currentCount = agentDoc.data().wishlistCount || 0;
          transaction.update(agentRef, { 
            wishlistCount: currentCount + 1 
          });
        }
      });
      
      return res.status(201).json({ 
        message: 'Agent added to wishlist',
        inWishlist: true
      });
    }
  } catch (error) {
    console.error('Error toggling wishlist:', error);
    return res.status(500).json({ error: 'Failed to update wishlist' });
  }
};
/**
 * Get agent wishlists for the current user
 */
const getWishlists = async (req, res) => {
  try {
    const { uid } = req.user; // From auth middleware
    
    // Query wishlists for this user
    const wishlistsSnapshot = await db.collection('wishlists')
      .where('userId', '==', uid)
      .get();
    
    const agentIds = [];
    wishlistsSnapshot.forEach(doc => {
      agentIds.push(doc.data().agentId);
    });
    
    // If no wishlisted agents, return empty array
    if (agentIds.length === 0) {
      return res.status(200).json({ agents: [] });
    }
    
    // Fetch agent details for each ID
    // Note: Firestore doesn't support direct "where in" with more than 10 items
    const agents = [];
    
    // Process in batches of 10 if there are many agent IDs
    for (let i = 0; i < agentIds.length; i += 10) {
      const batchIds = agentIds.slice(i, i + 10);
      const batchSnapshot = await db.collection('agents')
        .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
        .get();
      
      batchSnapshot.forEach(doc => {
        agents.push({
          id: doc.id,
          ...doc.data()
        });
      });
    }
    
    return res.status(200).json({ agents });
  } catch (error) {
    console.error('Error fetching wishlists:', error);
    return res.status(500).json({ error: 'Failed to fetch wishlists' });
  }
};

/**
 * Get a specific wishlist by ID
 */
const getWishlistById = async (req, res) => {
  try {
    // Extract wishlistId and sanitize it
    let wishlistId = req.params.wishlistId;
    
    // Check if the ID contains extra path segments
    if (wishlistId && wishlistId.includes('/')) {
      wishlistId = wishlistId.split('/')[0];
    }
    
    // Check if the ID contains query parameters
    if (wishlistId && wishlistId.includes('?')) {
      wishlistId = wishlistId.split('?')[0];
    }
    
    // Validate wishlist ID
    if (!wishlistId || typeof wishlistId !== 'string' || wishlistId.trim() === '') {
      console.error('Invalid wishlist ID:', wishlistId);
      return res.status(400).json({ error: 'Invalid wishlist ID provided' });
    }

    const sanitizedWishlistId = wishlistId.trim();
    
    // Fetch the wishlist document
    const wishlistDoc = await db.collection('wishlists').doc(sanitizedWishlistId).get();
    
    if (!wishlistDoc.exists) {
      return res.status(404).json({ error: 'Wishlist not found' });
    }
    
    // Get the wishlist data
    const wishlistData = {
      id: wishlistDoc.id,
      ...wishlistDoc.data()
    };
    
    return res.status(200).json(wishlistData);
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    return res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
};

const generateMockAgents = (count) => { /* ... your existing code ... */ };
const seedAgents = async (req, res) => { /* ... your existing code ... */ };
// --- END OF EXISTING FUNCTIONS ---


/**
 * Internal function to shape agent data before saving.
 * @param {object} agentInput - The raw agent data.
 * @param {object} existingAgentData - For updates, the current agent data from DB.
 * @param {object} reqUser - The authenticated user object.
 * @returns {object} The shaped agent data for Firestore.
 */
const _shapeAgentDataForSave = (agentInput, existingAgentData = {}, reqUser = null) => {
    const now = new Date().toISOString();
    const output = { ...existingAgentData, ...agentInput }; // Prioritize agentInput

    // --- Core Information ---
    output.name = agentInput.name || existingAgentData.name || '';
    output.title = agentInput.title || existingAgentData.title || output.name;
    output.description = agentInput.description || existingAgentData.description || '';
    output.category = agentInput.category || existingAgentData.category || '';
    output.status = agentInput.status || existingAgentData.status || 'active';

    // --- Creator Information ---
    let creatorInput = agentInput.creator;
    if (creatorInput && typeof creatorInput === 'string') {
        try { creatorInput = JSON.parse(creatorInput); } catch (e) { /* ignore */ }
    }
    if (creatorInput && typeof creatorInput === 'object') {
        output.creator = {
            id: creatorInput.id || existingAgentData.creator?.id || reqUser?.uid || null,
            name: creatorInput.name || existingAgentData.creator?.name || reqUser?.displayName || 'Anonymous',
            imageUrl: creatorInput.imageUrl !== undefined ? creatorInput.imageUrl : (existingAgentData.creator?.imageUrl || null),
            email: creatorInput.email || existingAgentData.creator?.email || reqUser?.email || null,
            username: creatorInput.username || existingAgentData.creator?.username || reqUser?.username || null,
            role: creatorInput.role || existingAgentData.creator?.role || reqUser?.role || 'user',
        };
    } else if (!existingAgentData.creator && reqUser) { // New agent, creator from req.user
        output.creator = {
            id: reqUser.uid,
            name: reqUser.displayName || 'Admin',
            imageUrl: reqUser.photoURL || null,
            email: reqUser.email,
            username: reqUser.username || reqUser.email?.split('@')[0] || `user_${reqUser.uid.substring(0,5)}`,
            role: reqUser.role || 'admin',
        };
    } else if (!existingAgentData.creator) { // New agent, no user, minimal creator
        output.creator = { id: null, name: 'System', role: 'system' };
    }
    // If creatorInput was just a string name
    else if (typeof creatorInput === 'string' && (!output.creator || !output.creator.id)) {
         output.creator = { ...output.creator, name: creatorInput };
    }


    // --- File Metadata: Image ---
    output.image = agentInput.image !== undefined ? agentInput.image : existingAgentData.image; // object
    output.imageUrl = agentInput.imageUrl !== undefined ? agentInput.imageUrl : existingAgentData.imageUrl; // string
    if (output.image && typeof output.image === 'object' && output.image.url) {
        output.imageUrl = output.image.url; // Sync URL
    } else if (output.imageUrl && (!output.image || !output.image.url)) {
        // If URL exists but object doesn't, create minimal object
        if (output.imageUrl) {
            output.image = { url: output.imageUrl, fileName: '', originalName: '', contentType: '', size: 0 };
        } else { // Both imageUrl and image.url are falsy
            output.image = null; // Clear object if URL is cleared
        }
    } else if (agentInput.hasOwnProperty('imageUrl') && !agentInput.imageUrl) { // Explicitly clearing
        output.image = null;
        output.imageUrl = null;
    }


    // --- File Metadata: Icon ---
    output.icon = agentInput.icon !== undefined ? agentInput.icon : existingAgentData.icon;
    output.iconUrl = agentInput.iconUrl !== undefined ? agentInput.iconUrl : existingAgentData.iconUrl;
    if (output.icon && typeof output.icon === 'object' && output.icon.url) {
        output.iconUrl = output.icon.url;
    } else if (output.iconUrl && (!output.icon || !output.icon.url)) {
        if (output.iconUrl) {
            output.icon = { url: output.iconUrl, fileName: '', originalName: (output.iconUrl.startsWith('data:') ? 'inline_svg.svg' : ''), contentType: (output.iconUrl.startsWith('data:') ? output.iconUrl.substring(output.iconUrl.indexOf(':') + 1, output.iconUrl.indexOf(';')) : ''), size: 0 };
        } else {
            output.icon = null;
        }
    } else if (agentInput.hasOwnProperty('iconUrl') && !agentInput.iconUrl) {
        output.icon = null;
        output.iconUrl = null;
    }


    // --- File Metadata: JSON File (Template) ---
    output.jsonFile = agentInput.jsonFile !== undefined ? agentInput.jsonFile : existingAgentData.jsonFile;
    output.downloadUrl = agentInput.downloadUrl !== undefined ? agentInput.downloadUrl : existingAgentData.downloadUrl;
    output.fileUrl = agentInput.fileUrl !== undefined ? agentInput.fileUrl : existingAgentData.fileUrl;

    if (output.jsonFile && typeof output.jsonFile === 'object' && output.jsonFile.url) {
        output.downloadUrl = output.jsonFile.url;
        if (agentInput.fileUrl === undefined) output.fileUrl = output.jsonFile.url; // Only sync if fileUrl wasn't explicitly different
    } else if (output.downloadUrl && (!output.jsonFile || !output.jsonFile.url)) {
        if (output.downloadUrl) {
            output.jsonFile = { url: output.downloadUrl, fileName: '', originalName: '', contentType: 'application/json', size: 0 };
            if (agentInput.fileUrl === undefined) output.fileUrl = output.downloadUrl;
        } else {
            output.jsonFile = null;
        }
    } else if (output.fileUrl && (!output.jsonFile || !output.jsonFile.url) && (agentInput.downloadUrl === undefined)) {
        // If only fileUrl is provided and downloadUrl is not, sync them
        output.downloadUrl = output.fileUrl;
         if (output.fileUrl) {
            output.jsonFile = { url: output.fileUrl, fileName: '', originalName: '', contentType: 'application/json', size: 0 };
    } else {
            output.jsonFile = null;
        }
    }
     if ((agentInput.hasOwnProperty('downloadUrl') && !agentInput.downloadUrl) &&
        (agentInput.hasOwnProperty('fileUrl') && !agentInput.fileUrl)) { // Explicitly clearing both URLs
        output.jsonFile = null;
        output.downloadUrl = null;
        output.fileUrl = null;
    }


    // --- Pricing Information ---
    let priceDetailsInput = agentInput.priceDetails;
    if (priceDetailsInput && typeof priceDetailsInput === 'string') {
        try { priceDetailsInput = JSON.parse(priceDetailsInput); } catch (e) { priceDetailsInput = {}; }
    }
    const existingPriceDetails = existingAgentData.priceDetails || {};

    const basePrice = parseFloat(priceDetailsInput?.basePrice ?? agentInput.basePrice ?? existingPriceDetails.basePrice) || 0;
    let discountedPrice = parseFloat(priceDetailsInput?.discountedPrice ?? agentInput.discountedPrice ?? existingPriceDetails.discountedPrice);
    if (isNaN(discountedPrice)) discountedPrice = basePrice;

    output.priceDetails = {
        basePrice: basePrice,
        discountedPrice: discountedPrice,
        currency: priceDetailsInput?.currency ?? agentInput.currency ?? existingPriceDetails.currency ?? 'USD',
        isSubscription: typeof (priceDetailsInput?.isSubscription ?? agentInput.isSubscription ?? existingPriceDetails.isSubscription) === 'boolean'
            ? (priceDetailsInput?.isSubscription ?? agentInput.isSubscription ?? existingPriceDetails.isSubscription)
            : false,
        isFree: basePrice === 0, // Always derived
    };
    output.priceDetails.discountPercentage = output.priceDetails.basePrice > 0 && output.priceDetails.discountedPrice < output.priceDetails.basePrice
        ? Math.round(((output.priceDetails.basePrice - output.priceDetails.discountedPrice) / output.priceDetails.basePrice) * 100)
        : 0;

    // Top-level convenience price fields
    output.price = output.priceDetails.discountedPrice;
    output.isFree = output.priceDetails.isFree;

    // --- Features, Tags, and Flags ---
    const parseArrayField = (fieldValue, existingValue) => {
        if (Array.isArray(fieldValue)) return fieldValue;
        if (typeof fieldValue === 'string' && fieldValue.length > 0) return fieldValue.split(',').map(f => f.trim());
        return Array.isArray(existingValue) ? existingValue : [];
    };
    output.features = parseArrayField(agentInput.features, existingAgentData.features);
    output.tags = parseArrayField(agentInput.tags, existingAgentData.tags);

    const parseBooleanField = (fieldValue, existingValue, defaultValue = false) => {
        if (fieldValue === undefined) return existingValue !== undefined ? existingValue : defaultValue;
        if (typeof fieldValue === 'boolean') return fieldValue;
        if (typeof fieldValue === 'string') return fieldValue.toLowerCase() === 'true';
        return defaultValue;
    };
    output.isFeatured = parseBooleanField(agentInput.isFeatured, existingAgentData.isFeatured, false);
    output.isVerified = parseBooleanField(agentInput.isVerified, existingAgentData.isVerified, false);
    output.isPopular = parseBooleanField(agentInput.isPopular, existingAgentData.isPopular, false);
    output.isTrending = parseBooleanField(agentInput.isTrending, existingAgentData.isTrending, false);
    output.isSubscription = parseBooleanField(agentInput.isSubscription, existingAgentData.isSubscription, false); // Keep top-level for query convenience

    // --- Other metadata ---
    output.likes = Array.isArray(agentInput.likes) ? agentInput.likes : (existingAgentData.likes || []);
    output.downloadCount = parseInt(agentInput.downloadCount ?? existingAgentData.downloadCount, 10) || 0;
    output.viewCount = parseInt(agentInput.viewCount ?? existingAgentData.viewCount, 10) || 0;
    output.popularity = parseInt(agentInput.popularity ?? existingAgentData.popularity, 10) || 0;
    output.version = agentInput.version || existingAgentData.version || '1.0.0';

    // --- Timestamps ---
    output.createdAt = existingAgentData.createdAt || now; // Preserve on update, set on create
    output.updatedAt = now; // Always set to now

    // --- Clean up ---
    // Remove temporary frontend fields or old redundant fields if they were merged from `currentAgent`
    delete output._imageFile;
    delete output._iconFile;
    delete output._jsonFile;
    delete output.imageData; // these were temp holders in req.body from _parseIncomingData
    delete output.iconData;
    delete output.jsonFileData;
    delete output.data; // if 'data' field was used in FormData
    // Remove old top-level price fields if they exist, as priceDetails is the S.O.T.
    delete output.basePrice;
    delete output.discountedPrice;
    delete output.currency;
    delete output.discountPercentage;


    // Ensure specific fields that should be objects are not accidentally null from input
    if (output.priceDetails === null) output.priceDetails = { basePrice:0, discountedPrice:0, currency:'USD', isFree:true, isSubscription:false, discountPercentage:0};
    if (output.creator === null && reqUser) output.creator = {id: reqUser.uid, name: reqUser.displayName || 'Admin', role: 'admin'};
    else if (output.creator === null) output.creator = {id: null, name: 'System', role: 'system'};

    return output;
};


/**
 * Create a new agent
 */
const createAgent = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can create agents' });
    }
    logger.info('Create Agent: Request body received:', req.body);
    logger.info('Create Agent: Files received:', req.files || req.file || 'No files');

    let incomingParsedData = _parseIncomingData(req.body); // This handles the 'data' field and basic parsing

    const files = req.files || {};
    const storageBucket = admin.storage().bucket();

    // Upload files if present
    const newImageInfo = await _uploadFileToStorage(files.image?.[0], STORAGE_PATHS.IMAGES, storageBucket);
    const newIconInfo = await _uploadFileToStorage(files.icon?.[0], STORAGE_PATHS.ICONS, storageBucket);
    const newJsonFileInfo = await _uploadFileToStorage(files.jsonFile?.[0], STORAGE_PATHS.JSON_FILES, storageBucket);

    // Prepare data for shaping: Start with parsed data from request
    let dataToShape = { ...incomingParsedData };

    // If new files were uploaded, their info takes precedence for the metadata objects
    if (newImageInfo) {
      dataToShape.image = newImageInfo; // object
      dataToShape.imageUrl = newImageInfo.url; // string
    } else if (dataToShape.imageData) { // If imageData object was sent (e.g. from FormData)
        dataToShape.image = _getFileMetadataFromRequest(dataToShape.imageData, 'imageData');
        if (dataToShape.image) dataToShape.imageUrl = dataToShape.image.url;
    } // If only imageUrl (string) was sent, _shapeAgentDataForSave will handle it

    if (newIconInfo) {
      dataToShape.icon = newIconInfo;
      dataToShape.iconUrl = newIconInfo.url;
    } else if (dataToShape.iconData) {
        dataToShape.icon = _getFileMetadataFromRequest(dataToShape.iconData, 'iconData');
        if (dataToShape.icon) dataToShape.iconUrl = dataToShape.icon.url;
    } // If only iconUrl (string/dataURI) was sent, _shapeAgentDataForSave will handle it

    if (newJsonFileInfo) {
      dataToShape.jsonFile = newJsonFileInfo;
      dataToShape.downloadUrl = newJsonFileInfo.url;
      dataToShape.fileUrl = newJsonFileInfo.url; // Usually an alias
    } else if (dataToShape.jsonFileData) {
        dataToShape.jsonFile = _getFileMetadataFromRequest(dataToShape.jsonFileData, 'jsonFileData');
        if (dataToShape.jsonFile) {
            dataToShape.downloadUrl = dataToShape.jsonFile.url;
            dataToShape.fileUrl = dataToShape.jsonFile.url;
        }
    } // If only downloadUrl/fileUrl (strings) were sent, _shapeAgentDataForSave will handle them

    // Shape the final data
    const finalAgentData = _shapeAgentDataForSave(dataToShape, {}, req.user);

    if (!finalAgentData.name || !finalAgentData.category) {
      logger.warn('Create Agent: Missing name or category after shaping.', { name: finalAgentData.name, category: finalAgentData.category });
      return res.status(400).json({ error: 'Name and category are required' });
    }
    
    logger.info('Creating agent with final shaped data:', {
      name: finalAgentData.name,
      category: finalAgentData.category,
        imageProvided: !!finalAgentData.imageUrl,
        iconProvided: !!finalAgentData.iconUrl,
        jsonFileProvided: !!finalAgentData.downloadUrl,
    });

    const agentRef = await db.collection('agents').add(finalAgentData);
    const newAgent = { id: agentRef.id, ...finalAgentData }; // Return the data as it was saved
    
    return res.status(201).json(newAgent);
  } catch (error) {
    logger.error('Error creating agent:', error);
    return res.status(500).json({ error: 'Failed to create agent', details: error.message });
  }
};

/**
 * Update an existing agent
 */
const updateAgent = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can update agents' });
    }

    const agentId = req.params.id || req.params.agentId;
    if (!agentId) { return res.status(400).json({ error: 'Agent ID is required' }); }
    logger.info(`Attempting to update agent with ID: ${agentId}`);

    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    if (!agentDoc.exists) { return res.status(404).json({ error: `Agent with ID ${agentId} not found` }); }
    
    const currentAgentData = agentDoc.data();
    logger.info('Current agent data retrieved for ID:', agentId);

    logger.info('Update Agent: Raw request body:', req.body);
    logger.info('Update Agent: Files received:', req.files || req.file || 'No files');
    
    let incomingParsedData = _parseIncomingData(req.body);

    const files = req.files || {};
    const storageBucket = admin.storage().bucket();

    const newImageInfo = await _uploadFileToStorage(files.image?.[0], STORAGE_PATHS.IMAGES, storageBucket);
    const newIconInfo = await _uploadFileToStorage(files.icon?.[0], STORAGE_PATHS.ICONS, storageBucket);
    const newJsonFileInfo = await _uploadFileToStorage(files.jsonFile?.[0], STORAGE_PATHS.JSON_FILES, storageBucket);

    // Prepare data for shaping: Start with current data, overlay with incoming parsed data
    let dataToShape = { ...currentAgentData, ...incomingParsedData };

    // Apply new file info or existing metadata from request, prioritizing new files
    if (newImageInfo) {
      dataToShape.image = newImageInfo;
      dataToShape.imageUrl = newImageInfo.url;
    } else if (incomingParsedData.imageData) {
        dataToShape.image = _getFileMetadataFromRequest(incomingParsedData.imageData, 'imageData');
        if (dataToShape.image) dataToShape.imageUrl = dataToShape.image.url;
    } else if (incomingParsedData.hasOwnProperty('imageUrl')) { // if imageUrl is explicitly in payload
        dataToShape.imageUrl = incomingParsedData.imageUrl;
        if (!incomingParsedData.imageUrl && incomingParsedData.hasOwnProperty('image')) { // clearing URL, also respect image object if sent
            dataToShape.image = incomingParsedData.image; // could be {} or null
        } else if (!incomingParsedData.imageUrl) {
            dataToShape.image = null; // clear object too
        }
    } else if (incomingParsedData.hasOwnProperty('image')) { // only image object in payload
        dataToShape.image = incomingParsedData.image;
        if (dataToShape.image && dataToShape.image.url) dataToShape.imageUrl = dataToShape.image.url;
        else if (!dataToShape.image || Object.keys(dataToShape.image).length === 0) dataToShape.imageUrl = null; // clear URL if image obj is null/empty
    }


    if (newIconInfo) {
      dataToShape.icon = newIconInfo;
      dataToShape.iconUrl = newIconInfo.url;
    } else if (incomingParsedData.iconData) {
        dataToShape.icon = _getFileMetadataFromRequest(incomingParsedData.iconData, 'iconData');
        if (dataToShape.icon) dataToShape.iconUrl = dataToShape.icon.url;
    } else if (incomingParsedData.hasOwnProperty('iconUrl')) {
        dataToShape.iconUrl = incomingParsedData.iconUrl;
         if (!incomingParsedData.iconUrl && incomingParsedData.hasOwnProperty('icon')) {
            dataToShape.icon = incomingParsedData.icon;
        } else if (!incomingParsedData.iconUrl) {
            dataToShape.icon = null;
        }
    } else if (incomingParsedData.hasOwnProperty('icon')) {
        dataToShape.icon = incomingParsedData.icon;
        if (dataToShape.icon && dataToShape.icon.url) dataToShape.iconUrl = dataToShape.icon.url;
        else if (!dataToShape.icon || Object.keys(dataToShape.icon).length === 0) dataToShape.iconUrl = null;
    }


    if (newJsonFileInfo) {
      dataToShape.jsonFile = newJsonFileInfo;
      dataToShape.downloadUrl = newJsonFileInfo.url;
      dataToShape.fileUrl = newJsonFileInfo.url;
    } else if (incomingParsedData.jsonFileData) {
        dataToShape.jsonFile = _getFileMetadataFromRequest(incomingParsedData.jsonFileData, 'jsonFileData');
        if (dataToShape.jsonFile) {
             dataToShape.downloadUrl = dataToShape.jsonFile.url;
             dataToShape.fileUrl = dataToShape.jsonFile.url;
        }
    } else { // Handle explicit URL changes or jsonFile object changes
        if (incomingParsedData.hasOwnProperty('downloadUrl')) dataToShape.downloadUrl = incomingParsedData.downloadUrl;
        if (incomingParsedData.hasOwnProperty('fileUrl')) dataToShape.fileUrl = incomingParsedData.fileUrl;
        if (incomingParsedData.hasOwnProperty('jsonFile')) dataToShape.jsonFile = incomingParsedData.jsonFile; // could be obj or null

        // If jsonFile object is provided, its URL should take precedence if other URLs are not explicitly set
        if (dataToShape.jsonFile && dataToShape.jsonFile.url) {
            if (!incomingParsedData.hasOwnProperty('downloadUrl')) dataToShape.downloadUrl = dataToShape.jsonFile.url;
            if (!incomingParsedData.hasOwnProperty('fileUrl')) dataToShape.fileUrl = dataToShape.jsonFile.url;
        } else if (!dataToShape.jsonFile || Object.keys(dataToShape.jsonFile || {}).length === 0) {
            // If jsonFile is cleared, and URLs were not in payload, clear them too
            if (!incomingParsedData.hasOwnProperty('downloadUrl')) dataToShape.downloadUrl = null;
            if (!incomingParsedData.hasOwnProperty('fileUrl')) dataToShape.fileUrl = null;
        }
    }
    
    const finalAgentData = _shapeAgentDataForSave(dataToShape, currentAgentData, req.user); // Pass currentAgentData for context

    if (!finalAgentData.name || !finalAgentData.category) {
      logger.warn('Update Agent: Missing name or category after shaping.', { name: finalAgentData.name, category: finalAgentData.category });
      return res.status(400).json({ error: 'Name and category are required for update.' });
    }

    logger.info('Final shaped agent data for Firestore update:', {
      id: agentId,
      name: finalAgentData.name,
      imageUpdated: finalAgentData.imageUrl !== currentAgentData.imageUrl,
      iconUpdated: finalAgentData.iconUrl !== currentAgentData.iconUrl,
      jsonFileUpdated: finalAgentData.downloadUrl !== currentAgentData.downloadUrl,
    });

    await agentRef.update(finalAgentData);
    const updatedAgentDoc = await agentRef.get(); // Fetch again to get the truly persisted state
    const updatedAgent = { id: agentId, ...updatedAgentDoc.data() };
    
    return res.status(200).json(updatedAgent);

  } catch (error) {
    logger.error('Error updating agent:', error);
    if (error.code) logger.error('Firebase Error Code:', error.code);
    return res.status(500).json({ error: 'Failed to update agent', details: error.message });
  }
};

// Helper to resolve agent ID for cache and DB ops (consistent with getAgentById)
// You might want to make this a shared utility if used in many places.
const _resolveAgentIdInternal = (rawAgentId) => {
  let cleanId = rawAgentId.trim();
  if (cleanId.includes('/') || cleanId.includes('\\')) {
    const parts = cleanId.split(/[/\\]/);
    cleanId = parts[parts.length - 1];
  }
  
  let idToUse = cleanId;
  let originalId = cleanId; // Store the version before stripping 'agent-'

  if (idToUse.startsWith('agent-')) {
    const numericPart = idToUse.substring(6);
    if (/^\d+$/.test(numericPart)) {
      idToUse = numericPart;
    }
  }
  return { primaryId: idToUse, originalId: originalId }; // Return both for robust lookup/invalidation
};


/**
 * Add a review to an agent's embedded reviews array
 * POST /api/agents/:agentId/reviews
 */
const addAgentReview_controller = async (req, res) => {
  const { agentId: agentIdFromParams } = req.params;
  const { uid, displayName, email } = req.user; // from auth middleware
  const { content, rating, verificationStatus } = req.body;

  if (!content || rating === undefined) {
    return res.status(400).json({ success: false, message: 'Content and rating are required.' });
  }
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5.' });
  }

  const { primaryId: resolvedAgentId, originalId: originalAgentId } = _resolveAgentIdInternal(agentIdFromParams);

  try {
    const agentRef = db.collection('agents').doc(resolvedAgentId);
    let agentDoc = await agentRef.get();
    let finalAgentIdUsed = resolvedAgentId;

    // If not found with primary resolved ID, try original (e.g., if DB stores 'agent-41' and resolved is '41')
    if (!agentDoc.exists && resolvedAgentId !== originalAgentId) {
        const originalAgentRef = db.collection('agents').doc(originalAgentId);
        const originalAgentDoc = await originalAgentRef.get();
        if (originalAgentDoc.exists) {
            agentDoc = originalAgentDoc;
            finalAgentIdUsed = originalAgentId; // This was the ID that worked
        }
    }

    if (!agentDoc.exists) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const agentData = agentDoc.data();
    const currentReviews = agentData.reviews || [];

    // Check if user has already reviewed (optional, based on your rules)
    // const existingReview = currentReviews.find(r => r.userId === uid);
    // if (existingReview) {
    //   return res.status(403).json({ success: false, message: 'You have already reviewed this agent.' });
    // }

    const newReview = {
      id: db.collection('agents').doc().id, // Generate a unique ID for the review
      userId: uid,
      userName: displayName || email.split('@')[0],
      content: content,
      rating: Number(rating),
      verificationStatus: verificationStatus || 'unverified',
      createdAt: new Date().toISOString(), // Use ISO string for consistency
      updatedAt: new Date().toISOString(),
    };

    const updatedReviews = [...currentReviews, newReview];
    updatedReviews.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); // Keep sorted

    // Calculate new average rating and review count
    const newReviewCount = updatedReviews.length;
    const newTotalRating = updatedReviews.reduce((sum, r) => sum + r.rating, 0);
    const newAverageRating = newReviewCount > 0 ? newTotalRating / newReviewCount : 0;

    await db.collection('agents').doc(finalAgentIdUsed).update({
      reviews: updatedReviews,
      averageRating: newAverageRating,
      reviewCount: newReviewCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() // Update agent's updatedAt
    });

    // --- CACHE INVALIDATION ---
    // Invalidate cache for both potential ID forms
    const cacheKey1 = `${CACHE_KEYS.AGENT}${resolvedAgentId}`;
    const cacheKey2 = `${CACHE_KEYS.AGENT}${originalAgentId}`;
    await deleteCache(cacheKey1);
    if (resolvedAgentId !== originalAgentId) {
        await deleteCache(cacheKey2);
    }
    logger.info(`Invalidated Redis cache for agent ${finalAgentIdUsed} (keys: ${cacheKey1}, ${cacheKey2}) due to new review.`);
    // --- END CACHE INVALIDATION ---

    return res.status(201).json({
      success: true,
      message: 'Review added successfully',
      review: newReview, // Return the added review
      agentId: finalAgentIdUsed
    });

  } catch (error) {
    logger.error(`Error adding review for agent ${agentIdFromParams}:`, error);
    return res.status(500).json({ success: false, message: 'Failed to add review', error: error.message });
  }
};

/**
 * Delete a review from an agent's embedded reviews array
 * DELETE /api/agents/:agentId/reviews/:reviewId
 */
const deleteAgentReview_controller = async (req, res) => {
  const { agentId: agentIdFromParams, reviewId } = req.params;
  const { uid, role } = req.user; // from auth middleware

  if (!reviewId) {
    return res.status(400).json({ success: false, message: 'Review ID is required.' });
  }

  const { primaryId: resolvedAgentId, originalId: originalAgentId } = _resolveAgentIdInternal(agentIdFromParams);

  try {
    const agentRef = db.collection('agents').doc(resolvedAgentId);
    let agentDoc = await agentRef.get();
    let finalAgentIdUsed = resolvedAgentId;

    if (!agentDoc.exists && resolvedAgentId !== originalAgentId) {
        const originalAgentRef = db.collection('agents').doc(originalAgentId);
        const originalAgentDoc = await originalAgentRef.get();
        if (originalAgentDoc.exists) {
            agentDoc = originalAgentDoc;
            finalAgentIdUsed = originalAgentId;
        }
    }

    if (!agentDoc.exists) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const agentData = agentDoc.data();
    const currentReviews = agentData.reviews || [];
    const reviewIndex = currentReviews.findIndex(r => r.id === reviewId);

    if (reviewIndex === -1) {
      return res.status(404).json({ success: false, message: 'Review not found on this agent.' });
    }

    const reviewToDelete = currentReviews[reviewIndex];

    // Authorization: User can delete their own review, or admin can delete any
    if (reviewToDelete.userId !== uid && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You are not authorized to delete this review.' });
    }

    const updatedReviews = currentReviews.filter(r => r.id !== reviewId);
    updatedReviews.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); // Keep sorted

    // Calculate new average rating and review count
    const newReviewCount = updatedReviews.length;
    const newTotalRating = updatedReviews.reduce((sum, r) => sum + r.rating, 0);
    const newAverageRating = newReviewCount > 0 ? newTotalRating / newReviewCount : 0;

    await db.collection('agents').doc(finalAgentIdUsed).update({
      reviews: updatedReviews,
      averageRating: newAverageRating,
      reviewCount: newReviewCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // --- CACHE INVALIDATION ---
    const cacheKey1 = `${CACHE_KEYS.AGENT}${resolvedAgentId}`;
    const cacheKey2 = `${CACHE_KEYS.AGENT}${originalAgentId}`;
    await deleteCache(cacheKey1);
    if (resolvedAgentId !== originalAgentId) {
        await deleteCache(cacheKey2);
    }
    logger.info(`Invalidated Redis cache for agent ${finalAgentIdUsed} (keys: ${cacheKey1}, ${cacheKey2}) due to review deletion.`);
    // --- END CACHE INVALIDATION ---

    return res.status(200).json({ 
        success: true, 
        message: 'Review deleted successfully',
        agentId: finalAgentIdUsed
    });

  } catch (error) {
    logger.error(`Error deleting review ${reviewId} for agent ${agentIdFromParams}:`, error);
    return res.status(500).json({ success: false, message: 'Failed to delete review', error: error.message });
  }
};


// --- YOUR OTHER EXISTING FUNCTIONS (deleteAgent, combinedUpdate, etc. - KEEP AS IS) ---
/**
 * Delete an agent
 */
const deleteAgent = async (req, res) => {
  try {
    // Check if user is an admin
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only administrators can delete agents' });
    }

    // Extract agentId from either req.params.agentId or req.params.id
    let agentId = req.params.agentId || req.params.id;
    
    // Check if the ID contains extra path segments
    if (agentId && agentId.includes('/')) {
      // Extract just the agent ID part
      agentId = agentId.split('/')[0];
    }
    
    // Validate agent ID to prevent Firestore errors
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      console.error('Invalid agent ID for deletion:', agentId);
      return res.status(400).json({ error: 'Invalid agent ID provided' });
    }

    const sanitizedAgentId = agentId.trim();
    console.log('Processing agent deletion for ID:', sanitizedAgentId);
    
    // Check if agent exists
    const agentDoc = await db.collection('agents').doc(sanitizedAgentId).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Delete the agent
    await db.collection('agents').doc(sanitizedAgentId).delete();
    
    // Delete associated prices
    const priceQuery = await db.collection('prices').where('agentId', '==', sanitizedAgentId).get();
    const batch = db.batch();
    priceQuery.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    return res.status(200).json({ 
      success: true, 
      message: 'Agent deleted successfully',
      id: sanitizedAgentId
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return res.status(500).json({ error: 'Failed to delete agent' });
  }
};
const combinedUpdate = async (req, res) => { /* ... your existing code ... */ };
const createAgentWithPrice = (req, res) => { /* ... your existing code ... */ };
const getDownloadCount = async (req, res) => { /* ... your existing code ... */ };
const incrementDownloadCount = async (req, res) => { /* ... your existing code ... */ };
/**
 * Get latest agents for email notifications
 * @param {number} limit - Number of latest agents to return
 * @returns {Array} Array of latest agents
 */
const getLatestAgents = async (limit = 5) => {
  try {
    console.log(`Fetching latest ${limit} agents for email notification`);
    
    // Create cache key for latest agents
    const cacheKey = `${CACHE_KEYS.LATEST}:${limit}`;
    
    // Try to get real agents first
    let agents = [];
    
    // Query agents sorted by createdAt (descending)
    let query = db.collection('agents')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit));
    
    const agentsSnapshot = await query.get();
    
    // Log what we found in the database
    console.log(`Found ${agentsSnapshot.size} agents in the database by createdAt`);

    agentsSnapshot.forEach(doc => {
      const agentData = doc.data();
      
      // Ensure we have all the required fields for the email template
      const formattedAgent = {
        id: doc.id,
        url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents/${doc.id}`,
        name: agentData.name || agentData.title || 'AI Agent',
        imageUrl: agentData.imageUrl || agentData.image || 'https://via.placeholder.com/300x200?text=AI+Agent',
        description: agentData.description || 'An AI agent to help with your tasks',
        price: agentData.price || 0,
        creator: {
          name: agentData.creator?.name || '',
          username: agentData.creator?.username || agentData.creator?.name || 'AIWaverider',
          role: agentData.creator?.role || 'Admin',
          ...agentData.creator
        },
        rating: {
          average: agentData.rating?.average || 4.5,
          count: agentData.rating?.count || 0
        },
        ...agentData
      };
      
      agents.push(formattedAgent);
    });
    
    // If we don't have agents by createdAt, try by dateCreated
    if (agents.length === 0) {
      console.log('No agents found with createdAt, trying dateCreated field');
      
      query = db.collection('agents')
        .orderBy('dateCreated', 'desc')
        .limit(parseInt(limit));
      
      const dateCreatedSnapshot = await query.get();
      console.log(`Found ${dateCreatedSnapshot.size} agents in the database by dateCreated`);
      
      dateCreatedSnapshot.forEach(doc => {
        if (!agents.some(agent => agent.id === doc.id)) {
          const agentData = doc.data();
          
          const formattedAgent = {
            id: doc.id,
            url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents/${doc.id}`,
            name: agentData.name || agentData.title || 'AI Agent',
            imageUrl: agentData.imageUrl || agentData.image || 'https://via.placeholder.com/300x200?text=AI+Agent',
            description: agentData.description || 'An AI agent to help with your tasks',
            price: agentData.price || 0,
            creator: {
              name: agentData.creator?.name || '',
              username: agentData.creator?.username || agentData.creator?.name || 'AIWaverider',
              role: agentData.creator?.role || 'Admin',
              ...agentData.creator
            },
            rating: {
              average: agentData.rating?.average || 4.5,
              count: agentData.rating?.count || 0
            },
            ...agentData
          };
          
          agents.push(formattedAgent);
        }
      });
    }
    
    // If we still don't have agents, try to get featured/bestsellers
    if (agents.length === 0) {
      console.log('No agents found by date, trying featured/bestseller agents');
      
      query = db.collection('agents')
        .where('isBestseller', '==', true)
        .limit(parseInt(limit));
      
      const featuredSnapshot = await query.get();
      console.log(`Found ${featuredSnapshot.size} featured agents in the database`);
      
      featuredSnapshot.forEach(doc => {
        if (!agents.some(agent => agent.id === doc.id)) {
          const agentData = doc.data();
          
          const formattedAgent = {
            id: doc.id,
            url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents/${doc.id}`,
            name: agentData.name || agentData.title || 'AI Agent',
            imageUrl: agentData.imageUrl || agentData.image || 'https://via.placeholder.com/300x200?text=AI+Agent',
            description: agentData.description || 'An AI agent to help with your tasks',
            price: agentData.price || 0,
            creator: {
              name: agentData.creator?.name || '',
              username: agentData.creator?.username || agentData.creator?.name || 'AIWaverider',
              role: agentData.creator?.role || 'Admin',
              ...agentData.creator
            },
            rating: {
              average: agentData.rating?.average || 4.5,
              count: agentData.rating?.count || 0
            },
            ...agentData
          };
          
          agents.push(formattedAgent);
        }
      });
    }
    
    // If still no agents, try to get ANY agents without filtering
    if (agents.length === 0) {
      console.log('Still no agents found, trying to get any agents without filtering');
      
      query = db.collection('agents')
        .limit(parseInt(limit));
      
      const anyAgentsSnapshot = await query.get();
      console.log(`Found ${anyAgentsSnapshot.size} total agents in the database`);
      
      anyAgentsSnapshot.forEach(doc => {
        if (!agents.some(agent => agent.id === doc.id)) {
          const agentData = doc.data();
          
          const formattedAgent = {
            id: doc.id,
            url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents/${doc.id}`,
            name: agentData.name || agentData.title || 'AI Agent',
            imageUrl: agentData.imageUrl || agentData.image || 'https://via.placeholder.com/300x200?text=AI+Agent',
            description: agentData.description || 'An AI agent to help with your tasks',
            price: agentData.price || 0,
            creator: {
              name: agentData.creator?.name || '',
              username: agentData.creator?.username || agentData.creator?.name || 'AIWaverider',
              role: agentData.creator?.role || 'Admin',
              ...agentData.creator
            },
            rating: {
              average: agentData.rating?.average || 4.5,
              count: agentData.rating?.count || 0
            },
            ...agentData
          };
          
          agents.push(formattedAgent);
        }
      });
    }
    
    // If still no real agents from the database, use the sample agents as a last resort
    if (agents.length === 0) {
      console.log('No real agents found in database, using sample agents');
      
      // Create a few sample agents
      const sampleAgents = [
        {
          id: 'sample-agent-1',
          url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents`,
          name: 'Writing Assistant',
          imageUrl: 'https://via.placeholder.com/300x200?text=Writing+Assistant',
          description: 'AI assistant that helps with writing tasks',
          price: 19.99,
          priceDetails: {
            originalPrice: 29.99,
            discountedPrice: 19.99,
            discountPercentage: 33
          },
          creator: { 
            name: 'Colorland Studio',
            username: 'Colorland',
            role: 'Partner'
          },
          rating: { average: 4.8, count: 1578 },
          location: 'Online'
        },
        {
          id: 'sample-agent-2',
          url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents`,
          name: 'CLEAN CAR ONE',
          imageUrl: 'https://via.placeholder.com/300x200?text=Clean+Car',
          description: 'Interior & exterior cleaning service',
          price: 29.90,
          priceDetails: {
            originalPrice: 69.90,
            discountedPrice: 29.90,
            discountPercentage: 57
          },
          promoCode: 'mit Code PROMO. Endet am 23.4',
          creator: { 
            name: 'Berlin Cleaning Services',
            username: 'BerlinBERLIN',
            role: 'Partner'
          },
          rating: { average: 4.5, count: 47 }
        },
        {
          id: 'sample-agent-3',
          url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents`,
          name: 'Laser Hair Removal',
          imageUrl: 'https://via.placeholder.com/300x200?text=Laser+Hair+Removal',
          description: 'Professional laser hair removal',
          price: 39.90,
          priceDetails: {
            originalPrice: 267.00,
            discountedPrice: 39.90,
            discountPercentage: 91
          },
          creator: { 
            name: 'Flawless Medical Beauty Center',
            username: 'FlawlessBeauty',
            role: 'Partner'
          },
          location: 'Berlin',
          rating: { average: 4.6, count: 83 }
        },
        {
          id: 'sample-agent-4',
          url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents`,
          name: 'Full Body Massage',
          imageUrl: 'https://via.placeholder.com/300x200?text=Body+Massage',
          description: '30 or 70 min full body massage',
          price: 27.19,
          priceDetails: {
            originalPrice: 45.90,
            discountedPrice: 27.19,
            discountPercentage: 40
          },
          promoCode: 'mit Code PROMO. Endet am 23.4',
          creator: { 
            name: 'Monique Martin Wellness',
            username: 'MoniqueMartin',
            role: 'Partner'
          },
          location: 'Berlin, BE',
          rating: { average: 5.0, count: 14 }
        },
        {
          id: 'sample-agent-5',
          url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents`,
          name: 'Code Generator Pro',
          imageUrl: 'https://via.placeholder.com/300x200?text=Code+Generator',
          description: 'Generate high-quality code snippets',
          price: 19.99,
          priceDetails: {
            originalPrice: 39.99,
            discountedPrice: 19.99,
            discountPercentage: 50
          },
          creator: { 
            name: 'AI Waverider Team',
            username: 'AIWaverider',
            role: 'Admin'
          },
          expiryDate: '05.05.2023',
          rating: { average: 4.9, count: 156 }
        }
      ];
      
      // Add sample agents up to the requested limit
      agents = sampleAgents.slice(0, limit);
    }
    
    console.log(`Successfully retrieved ${agents.length} latest agents for email`);
    
    // Return the agents, limited to the requested number
    return agents.slice(0, limit);
  } catch (error) {
    console.error('Error fetching latest agents for email:', error);
    console.error(error.stack); // Log the full stack trace for debugging
    return [];
  }
};

const getLatestAgentsRoute = async (req, res) => { /* ... your existing code ... */ };
// --- END OF OTHER EXISTING FUNCTIONS ---


logger.info("Before export - function status check:");
const functionsToExport = {
  getAgents, getFeaturedAgents, getAgentById, toggleWishlist, getWishlists, getWishlistById,
  seedAgents, generateMockAgents, createAgent, updateAgent, deleteAgent,
  combinedUpdate, createAgentWithPrice, getDownloadCount, incrementDownloadCount,
  getLatestAgents, getLatestAgentsRoute,
  // Add the new review handlers
  addAgentReview_controller,
  deleteAgentReview_controller
};
for (const funcName in functionsToExport) {
  logger.info(`- ${funcName}: ${typeof functionsToExport[funcName] === 'function'}`);
}

module.exports = functionsToExport;