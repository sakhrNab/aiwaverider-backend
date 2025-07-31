console.log('Loading agentsController.js');

// Import necessary modules
const { db } = require('../../config/firebase');
const admin = require('firebase-admin');
// const axios = require('axios'); // Uncomment if used
const logger = require('../../utils/logger');
const { getCache, setCache, deleteCache, deleteCacheByPattern, generateAgentCategoryCacheKey, generateAgentSearchCacheKey, generateAgentCacheKey, generateAgentCountCacheKey } = require('../../utils/cache');
// const { parseCustomFilters } = require('../utils/queryParser'); // Uncomment if used
// const { restructureAgent } = require('../scripts/update-agent-structure'); // REMOVED/COMMENTED OUT

// ==========================================
// IN-MEMORY CACHE FOR ALL AGENTS - NEW ADDITION
// ==========================================
let allAgentsCache = null;
let cacheLastUpdated = null;
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Load all agents from Firebase into memory cache
 * This is the core of our performance optimization
 */
const refreshAgentsCache = async () => {
  try {
    logger.info('🔄 Refreshing agents cache from Firebase...');
    const startTime = Date.now();
    
    // Fetch ALL agents from Firebase in one query (remove isActive filter to get all)
    const snapshot = await db.collection('agents')
      .orderBy('createdAt', 'desc')
      .get();
    
    allAgentsCache = [];
    snapshot.forEach(doc => {
      allAgentsCache.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    cacheLastUpdated = new Date();
    const loadTime = Date.now() - startTime;
    
    logger.info(`✅ Loaded ${allAgentsCache.length} agents into memory cache in ${loadTime}ms`);
    
    // Also cache total count in Redis for API responses
    await setCache('agents:total:count', allAgentsCache.length);
    
    return true;
  } catch (error) {
    logger.error('❌ Error refreshing agents cache:', error);
    return false;
  }
};

/**
 * Ensure cache is loaded and fresh
 */
const ensureCacheLoaded = async () => {
  const needsRefresh = !allAgentsCache || 
                      !cacheLastUpdated || 
                      (new Date() - cacheLastUpdated) > CACHE_REFRESH_INTERVAL;
  
  if (needsRefresh) {
    logger.info('Cache needs refresh, loading from Firebase...');
    await refreshAgentsCache();
  }
  
  return allAgentsCache !== null;
};

/**
 * Smart search function that works on ALL agents in memory
 * Searches: title, description, category, integrations, features, tags
 */
const searchAgents = (agents, searchQuery) => {
  if (!searchQuery || !searchQuery.trim()) {
    logger.info('No search query, returning all agents');
    return agents;
  }
  
  const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);
  logger.info(`🔍 Searching ${agents.length} agents for terms: [${searchTerms.join(', ')}]`);
  
  const results = agents.filter(agent => {
    // ALL search terms must match (AND logic)
    return searchTerms.every(term => {
      const matches = [];
      
      // Search in title
      if (agent.title && agent.title.toLowerCase().includes(term)) {
        matches.push('title');
      }
      
      // Search in description  
      if (agent.description && agent.description.toLowerCase().includes(term)) {
        matches.push('description');
      }
      
      // Search in category
      if (agent.category && agent.category.toLowerCase().includes(term)) {
        matches.push('category');
      }
      
      // 🎯 CRITICAL: Search in integrations array (this was missing!)
      if (agent.workflowMetadata && agent.workflowMetadata.integrations) {
        const hasIntegrationMatch = agent.workflowMetadata.integrations.some(integration => 
          integration.toLowerCase().includes(term)
        );
        if (hasIntegrationMatch) {
          matches.push('integrations');
        }
      }
      
      // Search in features
      if (agent.features && agent.features.some(feature => 
        feature.toLowerCase().includes(term))) {
        matches.push('features');
      }
      
      // Search in tags
      if (agent.tags && agent.tags.some(tag => 
        tag.toLowerCase().includes(term))) {
        matches.push('tags');
      }
      
      // Search in name field
      if (agent.name && agent.name.toLowerCase().includes(term)) {
        matches.push('name');
      }
      
      const hasMatch = matches.length > 0;
      if (hasMatch) {
        logger.info(`✅ Match found for "${term}" in agent ${agent.id} (${matches.join(', ')})`);
      }
      
      return hasMatch;
    });
  });
  
  logger.info(`🎯 Search "${searchQuery}" found ${results.length} matches`);
  return results;
};

/**
 * Filter agents by various criteria
 */
const filterAgents = (agents, filters) => {
  let filtered = [...agents];
  const appliedFilters = [];
  
  // Filter by category
  if (filters.category && filters.category !== 'All') {
    filtered = filtered.filter(agent => agent.category === filters.category);
    appliedFilters.push(`category:${filters.category}`);
  }
  
  // Filter by price range
  if (filters.priceMin !== undefined && filters.priceMin !== null && filters.priceMin !== '') {
    const minPrice = parseFloat(filters.priceMin);
    filtered = filtered.filter(agent => (agent.price || 0) >= minPrice);
    appliedFilters.push(`priceMin:${minPrice}`);
  }
  
  if (filters.priceMax !== undefined && filters.priceMax !== null && filters.priceMax !== '') {
    const maxPrice = parseFloat(filters.priceMax);
    filtered = filtered.filter(agent => (agent.price || 0) <= maxPrice);
    appliedFilters.push(`priceMax:${maxPrice}`);
  }
  
  // Filter by verification status
  if (filters.verified !== undefined) {
    const isVerified = filters.verified === 'true';
    filtered = filtered.filter(agent => agent.isVerified === isVerified);
    appliedFilters.push(`verified:${isVerified}`);
  }
  
  // Filter by featured status
  if (filters.featured !== undefined) {
    const isFeatured = filters.featured === 'true';
    filtered = filtered.filter(agent => agent.isFeatured === isFeatured);
    appliedFilters.push(`featured:${isFeatured}`);
  }
  
  // Filter by complexity
  if (filters.complexity) {
    filtered = filtered.filter(agent => 
      agent.workflowMetadata && 
      agent.workflowMetadata.complexity === filters.complexity
    );
    appliedFilters.push(`complexity:${filters.complexity}`);
  }
  
  if (appliedFilters.length > 0) {
    logger.info(`🔧 Applied filters: ${appliedFilters.join(', ')} | ${filtered.length} results`);
  }
  
  return filtered;
};

/**
 * Generate cache key for search/filter results
 */
const generateResultsCacheKey = (searchQuery, filters, limit, offset) => {
  const parts = ['agents:results'];
  
  if (searchQuery) parts.push(`search:${searchQuery}`);
  if (filters.category && filters.category !== 'All') parts.push(`cat:${filters.category}`);
  if (filters.priceMin) parts.push(`pmin:${filters.priceMin}`);
  if (filters.priceMax) parts.push(`pmax:${filters.priceMax}`);
  if (filters.verified) parts.push(`ver:${filters.verified}`);
  if (filters.featured) parts.push(`feat:${filters.featured}`);
  if (filters.complexity) parts.push(`comp:${filters.complexity}`);
  
  parts.push(`limit:${limit}`);
  parts.push(`offset:${offset}`);
  
  return parts.join(':');
};

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

// --- COMPLETELY REWRITTEN getAgents FUNCTION ---
/**
 * Main getAgents function - completely rewritten for performance and accuracy
 * Now uses in-memory cache for ALL agents and searches integrations properly
 */
const getAgents = async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Parse query parameters - supporting both old and new parameter names
    const {
      searchQuery,
      search, // fallback parameter
      category = 'All',
      priceMin,
      priceMax,
      verified,
      featured,
      complexity,
      limit = 20,
      offset = 0,
      lastVisibleId, // Keep for backward compatibility
      filter // Keep for backward compatibility
    } = req.query;
    
    const finalSearchQuery = searchQuery || search;
    const parsedLimit = parseInt(limit) || 20;
    const parsedOffset = parseInt(offset) || 0;
    
    const filters = {
      category,
      priceMin,
      priceMax,
      verified,
      featured,
      complexity
    };
    
    logger.info(`📊 getAgents called:`, {
      searchQuery: finalSearchQuery,
      filters,
      limit: parsedLimit,
      offset: parsedOffset,
      backwardCompatibility: { lastVisibleId, filter }
    });
    
    // 1. Ensure in-memory cache is loaded (THIS IS THE GAME CHANGER!)
    const cacheLoaded = await ensureCacheLoaded();
    if (!cacheLoaded || !allAgentsCache) {
      throw new Error('Failed to load agents cache');
    }
    
    // 2. Check Redis cache for this specific query
    const cacheKey = generateResultsCacheKey(finalSearchQuery, filters, parsedLimit, parsedOffset);
    const cachedResult = await getCache(cacheKey);
    
    if (cachedResult) {
      const responseTime = Date.now() - startTime;
      logger.info(`⚡ Cache HIT for ${cacheKey} | Response time: ${responseTime}ms`);
      
      return res.status(200).json({
        ...cachedResult,
        responseTime,
        fromCache: true
      });
    }
    
    logger.info(`💾 Cache MISS for ${cacheKey}, processing from memory...`);
    
    // 3. Process data from in-memory cache (THIS IS THE MAGIC!)
    let results = [...allAgentsCache]; // Start with ALL agents
    
    // 4. Apply search if provided
    if (finalSearchQuery) {
      results = searchAgents(results, finalSearchQuery);
    }
    
    // 5. Apply filters
    results = filterAgents(results, filters);
    
    // 6. Sort results (newest first, but could add more sorting options)
    results.sort((a, b) => {
      if (a.createdAt && b.createdAt) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      }
      return 0;
    });
    
    // 7. Calculate pagination
    const totalCount = results.length;
    const hasMore = parsedOffset + parsedLimit < totalCount;
    const paginatedResults = results.slice(parsedOffset, parsedOffset + parsedLimit);
    
    // 8. Prepare response (including backward compatibility fields)
    const response = {
      agents: paginatedResults,
      totalCount,
      currentPage: Math.floor(parsedOffset / parsedLimit) + 1,
      totalPages: Math.ceil(totalCount / parsedLimit),
      hasMore,
      limit: parsedLimit,
      offset: parsedOffset,
      searchQuery: finalSearchQuery || null,
      filters: filters,
      fromCache: false,
      responseTime: Date.now() - startTime,
      // Backward compatibility fields
      lastVisibleId: paginatedResults.length > 0 ? paginatedResults[paginatedResults.length - 1].id : null,
    };
    
    // 9. Cache the result (using optimized TTL)
    await setCache(cacheKey, response);
    
    logger.info(`✅ Query processed successfully:`, {
      totalFound: totalCount,
      returned: paginatedResults.length,
      responseTime: response.responseTime,
      cached: true
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    logger.error('❌ Error in getAgents:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch agents', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// --- ALL OTHER EXISTING FUNCTIONS REMAIN EXACTLY THE SAME ---

const getFeaturedAgents = async (req, res) => { 
  try {
    const { limit = 10 } = req.query;
    
    // Check cache first
    const cacheKey = `${CACHE_KEYS.FEATURED}:${limit}`;
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      logger.info(`Cache hit for featured agents: ${limit}`);
      return res.status(200).json({
        agents: cachedData,
        fromCache: true
      });
    }
    
    // If no cache, fetch from Firebase
    const agentsSnapshot = await db.collection('agents')
      .where('isFeatured', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const agents = [];
    agentsSnapshot.forEach(doc => {
      agents.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Cache using optimized TTL
    await setCache(cacheKey, agents);
    
    return res.status(200).json({
      agents: agents,
      fromCache: false
    });
  } catch (error) {
    logger.error('Error fetching featured agents:', error);
    return res.status(500).json({ error: 'Failed to fetch featured agents' });
  }
};

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
      await setCache(effectiveCacheKey, agentData); // Using optimized TTL
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

const generateMockAgents = (count) => { 
  const categories = ['Technology', 'Business', 'Productivity', 'Creative', 'Education'];
  const agents = [];
  
  for (let i = 0; i < count; i++) {
    agents.push({
      name: `Mock Agent ${i + 1}`,
      title: `AI Assistant ${i + 1}`,
      description: `This is a mock agent for testing purposes - Agent ${i + 1}`,
      category: categories[i % categories.length],
      price: Math.floor(Math.random() * 100),
      creator: {
        name: 'Mock Creator',
        id: 'mock-creator-id'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  
  return agents;
};

const seedAgents = async (req, res) => {
  try {
    const { count = 10 } = req.query;
    const mockAgents = generateMockAgents(parseInt(count));
    
    const batch = db.batch();
    
    mockAgents.forEach(agent => {
      const agentRef = db.collection('agents').doc();
      batch.set(agentRef, agent);
    });
    
    await batch.commit();
    
    // Refresh cache after seeding
    await refreshAgentsCache();
    
    return res.status(200).json({
      success: true,
      message: `Successfully seeded ${count} mock agents`,
      count: parseInt(count)
    });
  } catch (error) {
    logger.error('Error seeding agents:', error);
    return res.status(500).json({ error: 'Failed to seed agents' });
  }
};

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
 * Create a new agent - UPDATED to invalidate in-memory cache
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
    
    // =========================================
    // CACHE INVALIDATION - UPDATED FOR NEW ARCHITECTURE
    // =========================================
    try {
      // 1. Refresh in-memory cache (most important!)
      logger.info('🔄 Refreshing in-memory cache due to new agent creation...');
      await refreshAgentsCache();
      
      // 2. Clear Redis result caches
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      // 3. Clear specific category and count caches
      await deleteCache(generateAgentCategoryCacheKey(finalAgentData.category));
      await deleteCache(generateAgentCountCacheKey());
      logger.info(`Invalidated category cache for: ${finalAgentData.category}`);
      
      logger.info(`✅ Cache invalidation completed for new agent: ${agentRef.id}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in createAgent:', cacheError);
      // Continue execution as cache invalidation failure shouldn't block the response
    }
    
    return res.status(201).json(newAgent);
  } catch (error) {
    logger.error('Error creating agent:', error);
    return res.status(500).json({ error: 'Failed to create agent', details: error.message });
  }
};

/**
 * Update an existing agent - UPDATED to invalidate in-memory cache
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
    
    const finalAgentData = _shapeAgentDataForSave(dataToShape, currentAgentData, req.user);

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
    
    // =========================================
    // CACHE INVALIDATION - UPDATED FOR NEW ARCHITECTURE
    // =========================================
    try {
      // 1. Refresh in-memory cache (most important!)
      logger.info('🔄 Refreshing in-memory cache due to agent update...');
      await refreshAgentsCache();
      
      // 2. Clear Redis result caches
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      // 3. Clear specific individual and category caches
      await deleteCache(generateAgentCacheKey(agentId));
      await deleteCache(generateAgentCategoryCacheKey(currentAgentData.category));
      if (currentAgentData.category !== finalAgentData.category) {
        await deleteCache(generateAgentCategoryCacheKey(finalAgentData.category));
      }
      
      logger.info(`✅ Cache invalidation completed for agent update: ${agentId}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in updateAgent:', cacheError);
      // Continue execution as cache invalidation failure shouldn't block the response
    }
    
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

    // --- CACHE INVALIDATION - UPDATED FOR NEW ARCHITECTURE ---
    try {
      // 1. Refresh in-memory cache (most important!)
      logger.info('🔄 Refreshing in-memory cache due to new review...');
      await refreshAgentsCache();
      
      // 2. Clear Redis result caches
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      // 3. Clear specific caches
      await deleteCache(generateAgentCacheKey(finalAgentIdUsed));
      await deleteCache(generateAgentCategoryCacheKey(agentData.category));
      
      logger.info(`✅ Cache invalidation completed for agent ${finalAgentIdUsed} due to new review`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in addAgentReview:', cacheError);
    }
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

    // --- CACHE INVALIDATION - UPDATED FOR NEW ARCHITECTURE ---
    try {
      // 1. Refresh in-memory cache (most important!)
      logger.info('🔄 Refreshing in-memory cache due to review deletion...');
      await refreshAgentsCache();
      
      // 2. Clear Redis result caches
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      // 3. Clear specific caches
      await deleteCache(generateAgentCacheKey(finalAgentIdUsed));
      await deleteCache(generateAgentCategoryCacheKey(agentData.category));
      
      logger.info(`✅ Cache invalidation completed for agent ${finalAgentIdUsed} due to review deletion`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in deleteAgentReview:', cacheError);
    }
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

/**
 * Delete an agent - UPDATED to invalidate in-memory cache
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
    
    // Get agent data before deletion (needed for cache invalidation)
    const agentData = agentDoc.data();
    const deletedAgentCategory = agentData.category;
    
    // Delete the agent
    await db.collection('agents').doc(sanitizedAgentId).delete();
    
    // Delete associated prices
    const priceQuery = await db.collection('prices').where('agentId', '==', sanitizedAgentId).get();
    const batch = db.batch();
    priceQuery.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    // =========================================
    // CACHE INVALIDATION - UPDATED FOR NEW ARCHITECTURE
    // =========================================
    try {
      // 1. Refresh in-memory cache (most important!)
      logger.info('🔄 Refreshing in-memory cache due to agent deletion...');
      await refreshAgentsCache();
      
      // 2. Clear Redis result caches
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      // 3. Clear specific caches
      await deleteCache(generateAgentCacheKey(sanitizedAgentId));
      await deleteCache(generateAgentCategoryCacheKey(deletedAgentCategory));
      await deleteCache(generateAgentCountCacheKey());
      
      logger.info(`✅ Cache invalidation completed for agent deletion: ${sanitizedAgentId}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in deleteAgent:', cacheError);
      // Continue execution as cache invalidation failure shouldn't block the response
    }
    
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

const combinedUpdate = async (req, res) => { 
  // Your existing implementation stays the same
  return res.status(501).json({ error: 'Not implemented yet' });
};

const createAgentWithPrice = (req, res) => { 
  // Your existing implementation stays the same
  return res.status(501).json({ error: 'Not implemented yet' });
};

const getDownloadCount = async (req, res) => { 
  // Your existing implementation stays the same
  return res.status(501).json({ error: 'Not implemented yet' });
};

const incrementDownloadCount = async (req, res) => { 
  // Your existing implementation stays the same
  return res.status(501).json({ error: 'Not implemented yet' });
};

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

const getLatestAgentsRoute = async (req, res) => { 
  try {
    const { limit = 5 } = req.query;
    const agents = await getLatestAgents(parseInt(limit));
    
    return res.status(200).json({
      success: true,
      agents: agents,
      count: agents.length
    });
  } catch (error) {
    logger.error('Error in getLatestAgentsRoute:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch latest agents',
      details: error.message
    });
  }
};

/**
 * Get total count of agents with Redis caching
 * Follows the same Redis-First architecture as other agent endpoints
 */
const getAgentCount = async (req, res) => {
  try {
    logger.info('getAgentCount called - checking cache first');
    
    // Generate cache key for total agent count
    const cacheKey = generateAgentCountCacheKey();
    logger.info(`Agent count cache key: ${cacheKey}`);
    
    // Redis-First approach: Try to get from cache first
    try {
      const cachedCount = await getCache(cacheKey);
      if (cachedCount !== null) {
        logger.info(`Cache HIT for agent count: ${cachedCount}`);
        return res.status(200).json({
          success: true,
          totalCount: cachedCount,
          fromCache: true
        });
      }
      logger.info('Cache MISS for agent count, fetching from Firebase');
    } catch (cacheError) {
      logger.error('Cache error for agent count:', cacheError);
    }
    
    // Cache miss - fetch from Firebase
    const agentsSnapshot = await db.collection('agents').get();
    const totalCount = agentsSnapshot.size;
    
    logger.info(`Fetched agent count from Firebase: ${totalCount}`);
    
    // Cache the result for 24 hours (86400 seconds) - same TTL as agents
    try {
      await setCache(cacheKey, totalCount);
      logger.info(`Cached agent count: ${totalCount} for 24 hours`);
    } catch (cacheError) {
      logger.error('Error caching agent count:', cacheError);
    }
    
    return res.status(200).json({
      success: true,
      totalCount: totalCount,
      fromCache: false
    });
    
  } catch (error) {
    logger.error('Error in getAgentCount:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch agent count',
      details: error.message
    });
  }
};

/**
 * Get search results count for a specific query - UPDATED to use in-memory cache
 * GET /api/agents/search/count?q=searchQuery&category=All
 */
const getSearchResultsCount = async (req, res) => {
  try {
    const {
      q: searchQuery,
      category = 'All',
      priceMin,
      priceMax,
      verified,
      featured,
      complexity
    } = req.query;

    logger.info(`getSearchResultsCount called with: searchQuery=${searchQuery}, category=${category}`);

    if (!searchQuery || !searchQuery.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required',
        count: 0
      });
    }

    const finalSearchQuery = searchQuery.trim();
    const filters = { category, priceMin, priceMax, verified, featured, complexity };
    
    // Generate cache key for search count
    const countCacheKey = `agents:search:count:${finalSearchQuery}:${JSON.stringify(filters)}`;
    logger.info(`Search count cache key: ${countCacheKey}`);
    
    // Try to get from cache first (Redis-First approach)
    try {
      const cachedCount = await getCache(countCacheKey);
      if (cachedCount !== null) {
        logger.info(`Cache HIT for search count: ${finalSearchQuery} = ${cachedCount}`);
        return res.status(200).json({
          success: true,
          count: cachedCount,
          searchQuery: finalSearchQuery,
          filters: filters,
          fromCache: true
        });
      }
      logger.info(`Cache MISS for search count: ${finalSearchQuery}, processing from memory`);
    } catch (cacheError) {
      logger.error(`Cache error for search count ${finalSearchQuery}:`, cacheError);
    }

    // 1. Ensure in-memory cache is loaded
    const cacheLoaded = await ensureCacheLoaded();
    if (!cacheLoaded || !allAgentsCache) {
      throw new Error('Failed to load agents cache');
    }

    // 2. Process from in-memory cache (same logic as getAgents)
    let results = [...allAgentsCache];
    
    // 3. Apply search
    results = searchAgents(results, finalSearchQuery);
    
    // 4. Apply filters
    results = filterAgents(results, filters);

    const searchResultsCount = results.length;
    logger.info(`Search count result: ${allAgentsCache.length} → ${searchResultsCount} agents for "${finalSearchQuery}"`);

    // Cache the count for 5 minutes (300 seconds) - shorter TTL for search counts
    try {
      await setCache(countCacheKey, searchResultsCount);
      logger.info(`Cached search count: ${searchResultsCount} for "${finalSearchQuery}"`);
    } catch (cacheError) {
      logger.error(`Error caching search count for ${finalSearchQuery}:`, cacheError);
    }

    return res.status(200).json({
      success: true,
      count: searchResultsCount,
      searchQuery: finalSearchQuery,
      filters: filters,
      totalAgents: allAgentsCache.length,
      fromCache: false
    });

  } catch (error) {
    logger.error('Error in getSearchResultsCount:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get search results count',
      details: error.message,
      count: 0
    });
  }
};

/**
 * Manual cache refresh endpoint - for debugging and maintenance
 */
const refreshCache = async (req, res) => {
  try {
    logger.info('🔄 Manual cache refresh requested');
    const success = await refreshAgentsCache();
    
    if (success) {
      // Clear all cached search results since we have fresh data
      await deleteCacheByPattern('agents:results:*');
      logger.info('🧹 Cleared cached search results');
      
      return res.status(200).json({
        success: true,
        message: `Cache refreshed successfully. Loaded ${allAgentsCache?.length || 0} agents`,
        timestamp: new Date().toISOString(),
        agentCount: allAgentsCache?.length || 0
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to refresh cache',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('❌ Error in refreshCache:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Get cache statistics for monitoring
 */
const getCacheStats = async (req, res) => {
  try {
    const stats = {
      inMemoryCache: {
        loaded: allAgentsCache !== null,
        agentCount: allAgentsCache?.length || 0,
        lastUpdated: cacheLastUpdated,
        ageMinutes: cacheLastUpdated ? Math.floor((new Date() - cacheLastUpdated) / 1000 / 60) : null,
        nextRefreshIn: cacheLastUpdated ? Math.floor((CACHE_REFRESH_INTERVAL - (new Date() - cacheLastUpdated)) / 1000 / 60) : null
      },
      system: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        nodeVersion: process.version
      },
      cacheKeys: {
        agentCount: generateAgentCountCacheKey(),
        sampleResultKey: generateResultsCacheKey('gmail', { category: 'All' }, 20, 0)
      }
    };
    
    return res.status(200).json(stats);
  } catch (error) {
    logger.error('❌ Error in getCacheStats:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Initialize cache on server startup
 */
const initializeCache = async () => {
  logger.info('🚀 Initializing agents cache on startup...');
  const success = await refreshAgentsCache();
  if (success) {
    logger.info('✅ Cache initialization completed successfully');
  } else {
    logger.error('❌ Cache initialization failed');
  }
  return success;
};

// Export all functions
logger.info("Before export - function status check:");
const functionsToExport = {
  // Main API functions
  getAgents,
  getFeaturedAgents, 
  getAgentById, 
  
  // Wishlist functions
  toggleWishlist, 
  getWishlists, 
  getWishlistById,
  
  // CRUD operations
  createAgent, 
  updateAgent, 
  deleteAgent,
  
  // Utility functions
  seedAgents, 
  generateMockAgents,
  combinedUpdate, 
  createAgentWithPrice, 
  getDownloadCount, 
  incrementDownloadCount,
  
  // Latest agents
  getLatestAgents, 
  getLatestAgentsRoute,
  
  // Review handlers
  addAgentReview_controller,
  deleteAgentReview_controller,
  
  // Count and search endpoints
  getAgentCount,
  getSearchResultsCount,
  
  // Cache management
  refreshCache,
  getCacheStats,
  initializeCache
};

for (const funcName in functionsToExport) {
  logger.info(`- ${funcName}: ${typeof functionsToExport[funcName] === 'function'}`);
}

module.exports = functionsToExport;