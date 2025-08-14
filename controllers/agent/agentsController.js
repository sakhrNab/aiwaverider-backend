console.log('Loading agentsController.js');

// Import necessary modules
const { db } = require('../../config/firebase');
const admin = require('firebase-admin');
const logger = require('../../utils/logger');
const { getCache, setCache, deleteCache, deleteCacheByPattern, generateAgentCategoryCacheKey, generateAgentSearchCacheKey, generateAgentCacheKey, generateAgentCountCacheKey } = require('../../utils/cache');
const { incrementCounter } = require('../../utils/cache');

// ==========================================
// IN-MEMORY CACHE FOR ALL AGENTS
// ==========================================
let allAgentsCache = null;
let cacheLastUpdated = null;
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Load all agents from Firebase into memory cache
 */
const refreshAgentsCache = async () => {
  try {
    logger.info('🔄 Refreshing agents cache from Firebase...');
    const startTime = Date.now();
    
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
 * UPDATED: Smart search function that works on ALL agents in memory
 * Now searches: title, description, category, categories, businessValue, integrations, features, tags
 */
const searchAgents = (agents, searchQuery) => {
  if (!searchQuery || !searchQuery.trim()) {
    logger.info('No search query, returning all agents');
    return agents;
  }
  
  const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);
  logger.info(`🔍 Searching ${agents.length} agents for terms: [${searchTerms.join(', ')}]`);
  
  const results = agents.filter(agent => {
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
      
      // Search in old category field (for backward compatibility)
      if (agent.category && agent.category.toLowerCase().includes(term)) {
        matches.push('category');
      }
      
      // 🆕 Search in new categories array
      if (agent.categories && Array.isArray(agent.categories)) {
        const hasCategoryMatch = agent.categories.some(category => 
          category.toLowerCase().includes(term)
        );
        if (hasCategoryMatch) {
          matches.push('categories');
        }
      }
      
      // 🆕 Search in businessValue field
      if (agent.businessValue && agent.businessValue.toLowerCase().includes(term)) {
        matches.push('businessValue');
      }
      
      // Search in integrations array
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

      // 🆕 Search in deliverables descriptions
      if (agent.deliverables && Array.isArray(agent.deliverables)) {
        const hasDeliverableMatch = agent.deliverables.some(deliverable => 
          (deliverable.description && deliverable.description.toLowerCase().includes(term)) ||
          (deliverable.fileName && deliverable.fileName.toLowerCase().includes(term))
        );
        if (hasDeliverableMatch) {
          matches.push('deliverables');
        }
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
 * UPDATED: Filter agents by various criteria - now supports both category and categories
 */
const filterAgents = (agents, filters) => {
  let filtered = [...agents];
  const appliedFilters = [];
  
  // UPDATED: Filter by category - support both old category field and new categories array
  if (filters.category && filters.category !== 'All') {
    filtered = filtered.filter(agent => {
      // Check old single category field
      if (agent.category === filters.category) {
        return true;
      }
      // Check new categories array
      if (agent.categories && Array.isArray(agent.categories)) {
        return agent.categories.includes(filters.category);
      }
      return false;
    });
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

  // 🆕 Filter by paddleCompliant
  // if (filters.paddleCompliant !== undefined) {
  //   const isPaddleCompliant = filters.paddleCompliant === 'true';
  //   filtered = filtered.filter(agent => agent.paddleCompliant === isPaddleCompliant);
  //   appliedFilters.push(`paddleCompliant:${isPaddleCompliant}`);
  // }
  
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
  // if (filters.paddleCompliant) parts.push(`paddle:${filters.paddleCompliant}`);
  
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

// Firebase Storage paths
const STORAGE_PATHS = {
  IMAGES: 'agents/',
  ICONS: 'agent_icons/',
  JSON_FILES: 'agent_templates/',
};

// --- HELPER FUNCTIONS ---

/**
 * UPDATED: Parses incoming request data, handling new fields
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

  // UPDATED: Include new fields in parsing
  const fieldsToParse = [
    'priceDetails', 'creator', 'features', 'tags', 'image', 'icon', 'jsonFile', 
    'imageData', 'iconData', 'jsonFileData', 'categories', 'deliverables'
  ];
  
  for (const field of fieldsToParse) {
    if (data[field] && typeof data[field] === 'string') {
      try {
        data[field] = JSON.parse(data[field]);
      } catch (e) {
        // Not an error if it's not JSON, could be a simple string
      }
    }
  }
  
  // Clean up temp frontend fields
  delete data._imageFile;
  delete data._iconFile;
  delete data._hasBlobImageUrl;
  delete data._hasBlobIconUrl;
  delete data._hasBlobJsonFileUrl;

  return data;
};

/**
 * Uploads a file to Firebase Storage
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
 * Gets file metadata if provided as an object
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

// --- MAIN getAgents FUNCTION ---
/**
 * Main getAgents function - uses in-memory cache with Redis result caching
 */
const getAgents = async (req, res) => {
  try {
    const startTime = Date.now();
    
    const {
      searchQuery,
      search,
      category = 'All',
      priceMin,
      priceMax,
      verified,
      featured,
      complexity,
      // paddleCompliant, // 🆕 New filter
      limit = 20,
      offset = 0,
      lastVisibleId,
      filter
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
       //paddleCompliant 🆕 Include new filter
    };
    
    logger.info(`📊 getAgents called:`, {
      searchQuery: finalSearchQuery,
      filters,
      limit: parsedLimit,
      offset: parsedOffset
    });
    
    // 1. Ensure in-memory cache is loaded
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
    
    // 3. Process data from in-memory cache
    let results = [...allAgentsCache];
    
    // 4. Apply search if provided
    if (finalSearchQuery) {
      results = searchAgents(results, finalSearchQuery);
    }
    
    // 5. Apply filters
    results = filterAgents(results, filters);
    
    // 6. Sort results (newest first)
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
    
    // 8. Prepare response
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
      lastVisibleId: paginatedResults.length > 0 ? paginatedResults[paginatedResults.length - 1].id : null,
    };
    
    // 9. Cache the result
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

// --- OTHER EXISTING FUNCTIONS (unchanged) ---

const getFeaturedAgents = async (req, res) => { 
  try {
    const { limit = 10 } = req.query;
    
    const cacheKey = `${CACHE_KEYS.FEATURED}:${limit}`;
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      logger.info(`Cache hit for featured agents: ${limit}`);
      return res.status(200).json({
        agents: cachedData,
        fromCache: true
      });
    }
    
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

const getAgentById = async (req, res) => {
  try {
    const agentIdFromParams = req.params.id || req.params.agentId;
    const skipCache = req.query.skipCache === 'true' || req.query.refresh === 'true';
    const includeUser = req.query.includeUser === 'true';
    
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
      logger.info(`Agent ID contains path separators, extracting ID portion`);
      const parts = cleanAgentId.split(/[/\\]/);
      cleanAgentId = parts[parts.length - 1];
      logger.info(`Extracted ID from path: ${cleanAgentId}`);
    }
    
    let originalIdForLookup = cleanAgentId;
    let idToUseForDb = cleanAgentId;

    if (idToUseForDb.startsWith('agent-')) {
      const numericPart = idToUseForDb.substring(6);
      if (/^\d+$/.test(numericPart)) {
        idToUseForDb = numericPart;
        logger.info(`Stripped 'agent-' prefix, using numeric ID for DB: ${idToUseForDb}`);
      }
    }
    
    const primaryCacheKeyId = idToUseForDb;
    const cacheKey = generateAgentCacheKey(primaryCacheKeyId);
    
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
        logger.info(`Cache miss for agent ${primaryCacheKeyId}, fetching from database`);
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
      id: agentDoc.id,
      ...agentDoc.data()
    };

    // Determine entitlement (do not block response if this fails)
    let entitled = false;
    try {
      if (req.user && req.user.uid) {
        const ent = await getUserEntitlements(req.user.uid);
        const agentKey = agentDoc.id;
        entitled = ent.isAdmin || ent.isSubscriber || ent.purchases.includes(agentKey) || ent.downloads.includes(agentKey);
      }
    } catch (entErr) {
      logger.warn(`Failed to compute entitlements for user on agent ${agentDoc.id}: ${entErr.message}`);
    }

    // Sanitize deliverables and template URLs for paid products before caching/returning
    const isPaid = agentData.isFree === false || (typeof agentData.price === 'number' ? agentData.price > 0 : false) || agentData.pricingTier === 'premium';
    const sanitizedAgentData = { ...agentData };

    if (isPaid) {
      // Never expose direct download URLs for paid agents in public API
      if (sanitizedAgentData.jsonFile && typeof sanitizedAgentData.jsonFile === 'object') {
        sanitizedAgentData.jsonFile = { ...sanitizedAgentData.jsonFile };
        delete sanitizedAgentData.jsonFile.url;
      }
      if (Array.isArray(sanitizedAgentData.deliverables)) {
        sanitizedAgentData.deliverables = sanitizedAgentData.deliverables.map(d => {
          const copy = { ...d };
          delete copy.downloadUrl;
          return copy;
        });
      }
      sanitizedAgentData.downloadProtected = true;
    } else {
      sanitizedAgentData.downloadProtected = false;
    }

    // Expose entitlement on the agent object for frontend consumption
    sanitizedAgentData.entitled = !!entitled;

    // Compute user-specific like status on the fly (not cached in Redis)
    let userLike = null;
    if (includeUser && req.user && req.user.uid) {
      try {
        const likes = Array.isArray(agentData.likes) ? agentData.likes : [];
        const liked = likes.includes(req.user.uid);
        userLike = { liked, likesCount: Array.isArray(agentData.likes) ? agentData.likes.length : (agentData.likesCount || 0) };
      } catch (e) {
        userLike = { liked: false, likesCount: Array.isArray(agentData.likes) ? agentData.likes.length : 0 };
      }
    }

    // Handle reviews
    if (sanitizedAgentData.reviews && Array.isArray(sanitizedAgentData.reviews)) {
      sanitizedAgentData.reviews.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (sanitizedAgentData.reviews.length > 0) {
        const totalRating = sanitizedAgentData.reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
        sanitizedAgentData.averageRating = totalRating / sanitizedAgentData.reviews.length;
        sanitizedAgentData.reviewCount = sanitizedAgentData.reviews.length;
      } else {
        sanitizedAgentData.averageRating = 0;
        sanitizedAgentData.reviewCount = 0;
      }
    } else {
      sanitizedAgentData.reviews = [];
      sanitizedAgentData.averageRating = 0;
      sanitizedAgentData.reviewCount = 0;
    }

    sanitizedAgentData._fetchTime = Date.now();

    const effectiveCacheKey = generateAgentCacheKey(finalIdUsedForAgent);
    try {
      await setCache(effectiveCacheKey, sanitizedAgentData);
      logger.info(`Cached agent ${finalIdUsedForAgent} in Redis using key ${effectiveCacheKey}.`);
    } catch (cacheError) {
      logger.error(`Error caching agent ${finalIdUsedForAgent} in Redis:`, cacheError);
    }

    res.set({
      'Cache-Control': 'public, max-age=300',
      'ETag': `W/"agent-${finalIdUsedForAgent}-${sanitizedAgentData._fetchTime}"`
    });

    return res.status(200).json({
      success: true,
      message: 'Agent retrieved successfully (from DB)',
      data: sanitizedAgentData,
      userLike,
      entitled,
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

// --- CRUD OPERATIONS ---

/**
 * UPDATED: Internal function to shape agent data before saving
 * Now handles new fields: categories, businessValue, deliverables, paddleCompliant, lastTransformed
 */
const _shapeAgentDataForSave = (agentInput, existingAgentData = {}, reqUser = null) => {
    const now = new Date().toISOString();
    const output = { ...existingAgentData, ...agentInput };

    // --- Core Information ---
    output.name = agentInput.name || existingAgentData.name || '';
    output.title = agentInput.title || existingAgentData.title || output.name;
    output.description = agentInput.description || existingAgentData.description || '';
    
    // 🆕 UPDATED: Category/Categories Handling
    if (agentInput.categories && Array.isArray(agentInput.categories)) {
        output.categories = agentInput.categories;
        // Use the first category as the legacy category field for backward compatibility
        output.category = agentInput.categories[0] || existingAgentData.category || '';
    } else if (agentInput.category) {
        output.category = agentInput.category;
        // If only single category provided, create categories array from it
        output.categories = existingAgentData.categories || [agentInput.category];
    } else {
        output.category = existingAgentData.category || '';
        output.categories = existingAgentData.categories || (existingAgentData.category ? [existingAgentData.category] : []);
    }
    
    output.status = agentInput.status || existingAgentData.status || 'active';

    // 🆕 NEW FIELDS
    
    // Business Value
    output.businessValue = agentInput.businessValue || existingAgentData.businessValue || '';
    
    // Deliverables array
    if (agentInput.deliverables && Array.isArray(agentInput.deliverables)) {
        output.deliverables = agentInput.deliverables;
    } else {
        output.deliverables = existingAgentData.deliverables || [];
    }
    
    // Paddle Compliance
    output.paddleCompliant = typeof agentInput.paddleCompliant === 'boolean' 
        ? agentInput.paddleCompliant 
        : (existingAgentData.paddleCompliant || false);
    
    // Last Transformed timestamp
    if (agentInput.lastTransformed) {
        output.lastTransformed = agentInput.lastTransformed;
    } else if (!existingAgentData.lastTransformed && reqUser?.role === 'admin') {
        output.lastTransformed = admin.firestore.FieldValue.serverTimestamp();
    } else {
        output.lastTransformed = existingAgentData.lastTransformed || null;
    }

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
    } else if (!existingAgentData.creator && reqUser) {
        output.creator = {
            id: reqUser.uid,
            name: reqUser.displayName || 'Admin',
            imageUrl: reqUser.photoURL || null,
            email: reqUser.email,
            username: reqUser.username || reqUser.email?.split('@')[0] || `user_${reqUser.uid.substring(0,5)}`,
            role: reqUser.role || 'admin',
        };
    } else if (!existingAgentData.creator) {
        output.creator = { id: null, name: 'System', role: 'system' };
    }

    // --- File Metadata: Image ---
    output.image = agentInput.image !== undefined ? agentInput.image : existingAgentData.image;
    output.imageUrl = agentInput.imageUrl !== undefined ? agentInput.imageUrl : existingAgentData.imageUrl;
    if (output.image && typeof output.image === 'object' && output.image.url) {
        output.imageUrl = output.image.url;
    } else if (output.imageUrl && (!output.image || !output.image.url)) {
        if (output.imageUrl) {
            output.image = { url: output.imageUrl, fileName: '', originalName: '', contentType: '', size: 0 };
        } else {
            output.image = null;
        }
    } else if (agentInput.hasOwnProperty('imageUrl') && !agentInput.imageUrl) {
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
            output.icon = { url: output.iconUrl, fileName: '', originalName: '', contentType: '', size: 0 };
        } else {
            output.icon = null;
        }
    } else if (agentInput.hasOwnProperty('iconUrl') && !agentInput.iconUrl) {
        output.icon = null;
        output.iconUrl = null;
    }

    // --- File Metadata: JSON File ---
    output.jsonFile = agentInput.jsonFile !== undefined ? agentInput.jsonFile : existingAgentData.jsonFile;
    output.downloadUrl = agentInput.downloadUrl !== undefined ? agentInput.downloadUrl : existingAgentData.downloadUrl;
    output.fileUrl = agentInput.fileUrl !== undefined ? agentInput.fileUrl : existingAgentData.fileUrl;

    if (output.jsonFile && typeof output.jsonFile === 'object' && output.jsonFile.url) {
        output.downloadUrl = output.jsonFile.url;
        if (agentInput.fileUrl === undefined) output.fileUrl = output.jsonFile.url;
    } else if (output.downloadUrl && (!output.jsonFile || !output.jsonFile.url)) {
        if (output.downloadUrl) {
            output.jsonFile = { url: output.downloadUrl, fileName: '', originalName: '', contentType: 'application/json', size: 0 };
            if (agentInput.fileUrl === undefined) output.fileUrl = output.downloadUrl;
        } else {
            output.jsonFile = null;
        }
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
        isFree: basePrice === 0,
    };
    output.priceDetails.discountPercentage = output.priceDetails.basePrice > 0 && output.priceDetails.discountedPrice < output.priceDetails.basePrice
        ? Math.round(((output.priceDetails.basePrice - output.priceDetails.discountedPrice) / output.priceDetails.basePrice) * 100)
        : 0;

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
    output.isSubscription = parseBooleanField(agentInput.isSubscription, existingAgentData.isSubscription, false);

    // --- Other metadata ---
    output.likes = Array.isArray(agentInput.likes) ? agentInput.likes : (existingAgentData.likes || []);
    output.downloadCount = parseInt(agentInput.downloadCount ?? existingAgentData.downloadCount, 10) || 0;
    output.viewCount = parseInt(agentInput.viewCount ?? existingAgentData.viewCount, 10) || 0;
    output.popularity = parseInt(agentInput.popularity ?? existingAgentData.popularity, 10) || 0;
    output.version = agentInput.version || existingAgentData.version || '1.0.0';

    // --- Timestamps ---
    output.createdAt = existingAgentData.createdAt || now;
    output.updatedAt = now;

    // --- Clean up ---
    delete output._imageFile;
    delete output._iconFile;
    delete output._jsonFile;
    delete output.imageData;
    delete output.iconData;
    delete output.jsonFileData;
    delete output.data;
    delete output.basePrice;
    delete output.discountedPrice;
    delete output.currency;
    delete output.discountPercentage;

    // Ensure required objects
    if (output.priceDetails === null) output.priceDetails = { basePrice:0, discountedPrice:0, currency:'USD', isFree:true, isSubscription:false, discountPercentage:0};
    if (output.creator === null && reqUser) output.creator = {id: reqUser.uid, name: reqUser.displayName || 'Admin', role: 'admin'};
    else if (output.creator === null) output.creator = {id: null, name: 'System', role: 'system'};

    return output;
};

/**
 * UPDATED: Create a new agent - handles new fields and cache invalidation
 */
const createAgent = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can create agents' });
    }
    logger.info('Create Agent: Request body received:', req.body);
    logger.info('Create Agent: Files received:', req.files || req.file || 'No files');

    let incomingParsedData = _parseIncomingData(req.body);

    const files = req.files || {};
    const storageBucket = admin.storage().bucket();

    // Upload files if present
    const newImageInfo = await _uploadFileToStorage(files.image?.[0], STORAGE_PATHS.IMAGES, storageBucket);
    const newIconInfo = await _uploadFileToStorage(files.icon?.[0], STORAGE_PATHS.ICONS, storageBucket);
    const newJsonFileInfo = await _uploadFileToStorage(files.jsonFile?.[0], STORAGE_PATHS.JSON_FILES, storageBucket);

    // Prepare data for shaping
    let dataToShape = { ...incomingParsedData };

    if (newImageInfo) {
      dataToShape.image = newImageInfo;
      dataToShape.imageUrl = newImageInfo.url;
    } else if (dataToShape.imageData) {
        dataToShape.image = _getFileMetadataFromRequest(dataToShape.imageData, 'imageData');
        if (dataToShape.image) dataToShape.imageUrl = dataToShape.image.url;
    }

    if (newIconInfo) {
      dataToShape.icon = newIconInfo;
      dataToShape.iconUrl = newIconInfo.url;
    } else if (dataToShape.iconData) {
        dataToShape.icon = _getFileMetadataFromRequest(dataToShape.iconData, 'iconData');
        if (dataToShape.icon) dataToShape.iconUrl = dataToShape.icon.url;
    }

    if (newJsonFileInfo) {
      dataToShape.jsonFile = newJsonFileInfo;
      dataToShape.downloadUrl = newJsonFileInfo.url;
      dataToShape.fileUrl = newJsonFileInfo.url;
    } else if (dataToShape.jsonFileData) {
        dataToShape.jsonFile = _getFileMetadataFromRequest(dataToShape.jsonFileData, 'jsonFileData');
        if (dataToShape.jsonFile) {
            dataToShape.downloadUrl = dataToShape.jsonFile.url;
            dataToShape.fileUrl = dataToShape.jsonFile.url;
        }
    }

    // Shape the final data
    const finalAgentData = _shapeAgentDataForSave(dataToShape, {}, req.user);

    if (!finalAgentData.name || (!finalAgentData.category && !finalAgentData.categories?.length)) {
      logger.warn('Create Agent: Missing name or category after shaping.', { 
        name: finalAgentData.name, 
        category: finalAgentData.category,
        categories: finalAgentData.categories
      });
      return res.status(400).json({ error: 'Name and category are required' });
    }
    
    logger.info('Creating agent with final shaped data:', {
      name: finalAgentData.name,
      category: finalAgentData.category,
      categories: finalAgentData.categories,
      businessValue: !!finalAgentData.businessValue,
      deliverables: finalAgentData.deliverables?.length || 0,
      paddleCompliant: finalAgentData.paddleCompliant,
        imageProvided: !!finalAgentData.imageUrl,
        iconProvided: !!finalAgentData.iconUrl,
        jsonFileProvided: !!finalAgentData.downloadUrl,
    });

    const agentRef = await db.collection('agents').add(finalAgentData);
    const newAgent = { id: agentRef.id, ...finalAgentData };
    
    // 🆕 UPDATED: Cache invalidation for both old and new category formats
    try {
      logger.info('🔄 Refreshing in-memory cache due to new agent creation...');
      await refreshAgentsCache();
      
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      // Clear category caches for both old and new formats
      if (finalAgentData.category) {
      await deleteCache(generateAgentCategoryCacheKey(finalAgentData.category));
      }
      if (finalAgentData.categories && Array.isArray(finalAgentData.categories)) {
        for (const category of finalAgentData.categories) {
          await deleteCache(generateAgentCategoryCacheKey(category));
        }
      }
      await deleteCache(generateAgentCountCacheKey());
      
      logger.info(`✅ Cache invalidation completed for new agent: ${agentRef.id}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in createAgent:', cacheError);
    }
    
    return res.status(201).json(newAgent);
  } catch (error) {
    logger.error('Error creating agent:', error);
    return res.status(500).json({ error: 'Failed to create agent', details: error.message });
  }
};

/**
 * UPDATED: Update an existing agent - handles new fields and cache invalidation
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

    // Prepare data for shaping
    let dataToShape = { ...currentAgentData, ...incomingParsedData };

    // Handle file updates
    if (newImageInfo) {
      dataToShape.image = newImageInfo;
      dataToShape.imageUrl = newImageInfo.url;
    } else if (incomingParsedData.imageData) {
        dataToShape.image = _getFileMetadataFromRequest(incomingParsedData.imageData, 'imageData');
        if (dataToShape.image) dataToShape.imageUrl = dataToShape.image.url;
    } else if (incomingParsedData.hasOwnProperty('imageUrl')) {
        dataToShape.imageUrl = incomingParsedData.imageUrl;
        if (!incomingParsedData.imageUrl && incomingParsedData.hasOwnProperty('image')) {
            dataToShape.image = incomingParsedData.image;
        } else if (!incomingParsedData.imageUrl) {
            dataToShape.image = null;
        }
    } else if (incomingParsedData.hasOwnProperty('image')) {
        dataToShape.image = incomingParsedData.image;
        if (dataToShape.image && dataToShape.image.url) dataToShape.imageUrl = dataToShape.image.url;
        else if (!dataToShape.image || Object.keys(dataToShape.image).length === 0) dataToShape.imageUrl = null;
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
    } else {
        if (incomingParsedData.hasOwnProperty('downloadUrl')) dataToShape.downloadUrl = incomingParsedData.downloadUrl;
        if (incomingParsedData.hasOwnProperty('fileUrl')) dataToShape.fileUrl = incomingParsedData.fileUrl;
        if (incomingParsedData.hasOwnProperty('jsonFile')) dataToShape.jsonFile = incomingParsedData.jsonFile;

        if (dataToShape.jsonFile && dataToShape.jsonFile.url) {
            if (!incomingParsedData.hasOwnProperty('downloadUrl')) dataToShape.downloadUrl = dataToShape.jsonFile.url;
            if (!incomingParsedData.hasOwnProperty('fileUrl')) dataToShape.fileUrl = dataToShape.jsonFile.url;
        } else if (!dataToShape.jsonFile || Object.keys(dataToShape.jsonFile || {}).length === 0) {
            if (!incomingParsedData.hasOwnProperty('downloadUrl')) dataToShape.downloadUrl = null;
            if (!incomingParsedData.hasOwnProperty('fileUrl')) dataToShape.fileUrl = null;
        }
    }
    
    const finalAgentData = _shapeAgentDataForSave(dataToShape, currentAgentData, req.user);

    if (!finalAgentData.name || (!finalAgentData.category && !finalAgentData.categories?.length)) {
      logger.warn('Update Agent: Missing name or category after shaping.', { 
        name: finalAgentData.name, 
        category: finalAgentData.category,
        categories: finalAgentData.categories
      });
      return res.status(400).json({ error: 'Name and category are required for update.' });
    }

    logger.info('Final shaped agent data for Firestore update:', {
      id: agentId,
      name: finalAgentData.name,
      category: finalAgentData.category,
      categories: finalAgentData.categories,
      businessValue: !!finalAgentData.businessValue,
      deliverables: finalAgentData.deliverables?.length || 0,
      paddleCompliant: finalAgentData.paddleCompliant,
      imageUpdated: finalAgentData.imageUrl !== currentAgentData.imageUrl,
      iconUpdated: finalAgentData.iconUrl !== currentAgentData.iconUrl,
      jsonFileUpdated: finalAgentData.downloadUrl !== currentAgentData.downloadUrl,
    });

    await agentRef.update(finalAgentData);
    const updatedAgentDoc = await agentRef.get();
    const updatedAgent = { id: agentId, ...updatedAgentDoc.data() };
    
    // 🆕 UPDATED: Cache invalidation for both old and new category formats
    try {
      logger.info('🔄 Refreshing in-memory cache due to agent update...');
      await refreshAgentsCache();
      
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      await deleteCache(generateAgentCacheKey(agentId));
      
      // Clear old categories
      if (currentAgentData.category) {
      await deleteCache(generateAgentCategoryCacheKey(currentAgentData.category));
      }
      if (currentAgentData.categories && Array.isArray(currentAgentData.categories)) {
        for (const category of currentAgentData.categories) {
          await deleteCache(generateAgentCategoryCacheKey(category));
        }
      }
      
      // Clear new categories
      if (finalAgentData.category && finalAgentData.category !== currentAgentData.category) {
        await deleteCache(generateAgentCategoryCacheKey(finalAgentData.category));
      }
      if (finalAgentData.categories && Array.isArray(finalAgentData.categories)) {
        for (const category of finalAgentData.categories) {
          await deleteCache(generateAgentCategoryCacheKey(category));
        }
      }
      
      logger.info(`✅ Cache invalidation completed for agent update: ${agentId}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in updateAgent:', cacheError);
    }
    
    return res.status(200).json(updatedAgent);

  } catch (error) {
    logger.error('Error updating agent:', error);
    if (error.code) logger.error('Firebase Error Code:', error.code);
    return res.status(500).json({ error: 'Failed to update agent', details: error.message });
  }
};

// Helper functions and other methods remain the same...
// (toggleWishlist, getWishlists, getWishlistById, generateMockAgents, seedAgents, etc.)

const toggleWishlist = async (req, res) => {
  try {
    let agentId = req.params.agentId;
    
    if (agentId && agentId.includes('/')) {
      agentId = agentId.split('/')[0];
    }
    
    if (agentId && agentId.includes('?')) {
      agentId = agentId.split('?')[0];
    }
    
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      console.error('Invalid agent ID for wishlist toggle:', agentId);
      return res.status(400).json({ error: 'Invalid agent ID provided' });
    }

    const sanitizedAgentId = agentId.trim();
    const { uid } = req.user;
    
    const agentDoc = await db.collection('agents').doc(sanitizedAgentId).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const wishlistId = `${uid}_${sanitizedAgentId}`;
    const wishlistRef = db.collection('wishlists').doc(wishlistId);
    
    const wishlistDoc = await wishlistRef.get();
    
    if (wishlistDoc.exists) {
      await wishlistRef.delete();
      
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
      await wishlistRef.set({
        userId: uid,
        agentId: sanitizedAgentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
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

const getWishlists = async (req, res) => {
  try {
    const { uid } = req.user;
    
    const wishlistsSnapshot = await db.collection('wishlists')
      .where('userId', '==', uid)
      .get();
    
    const agentIds = [];
    wishlistsSnapshot.forEach(doc => {
      agentIds.push(doc.data().agentId);
    });
    
    if (agentIds.length === 0) {
      return res.status(200).json({ agents: [] });
    }
    
    const agents = [];
    
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

const getWishlistById = async (req, res) => {
  try {
    let wishlistId = req.params.wishlistId;
    
    if (wishlistId && wishlistId.includes('/')) {
      wishlistId = wishlistId.split('/')[0];
    }
    
    if (wishlistId && wishlistId.includes('?')) {
      wishlistId = wishlistId.split('?')[0];
    }
    
    if (!wishlistId || typeof wishlistId !== 'string' || wishlistId.trim() === '') {
      console.error('Invalid wishlist ID:', wishlistId);
      return res.status(400).json({ error: 'Invalid wishlist ID provided' });
    }

    const sanitizedWishlistId = wishlistId.trim();
    
    const wishlistDoc = await db.collection('wishlists').doc(sanitizedWishlistId).get();
    
    if (!wishlistDoc.exists) {
      return res.status(404).json({ error: 'Wishlist not found' });
    }
    
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
      categories: [categories[i % categories.length], 'AI'], // 🆕 NEW
      price: Math.floor(Math.random() * 100),
      businessValue: `Increases productivity by ${20 + Math.floor(Math.random() * 60)}% through automated workflows.`, // 🆕 NEW
      deliverables: [ // 🆕 NEW
        {
          fileName: `mock-agent-${i + 1}.json`,
          description: `Complete automation workflow for Mock Agent ${i + 1}`,
          downloadUrl: `https://example.com/mock-agent-${i + 1}.json`,
          size: 15000 + Math.floor(Math.random() * 30000),
          contentType: 'application/json'
        }
      ],
      paddleCompliant: true, // 🆕 NEW
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

// Add other required functions...
const deleteAgent = async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only administrators can delete agents' });
    }

    let agentId = req.params.agentId || req.params.id;
    
    if (agentId && agentId.includes('/')) {
      agentId = agentId.split('/')[0];
    }
    
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      console.error('Invalid agent ID for deletion:', agentId);
      return res.status(400).json({ error: 'Invalid agent ID provided' });
    }

    const sanitizedAgentId = agentId.trim();
    console.log('Processing agent deletion for ID:', sanitizedAgentId);
    
    const agentDoc = await db.collection('agents').doc(sanitizedAgentId).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    
    await db.collection('agents').doc(sanitizedAgentId).delete();
    
    const priceQuery = await db.collection('prices').where('agentId', '==', sanitizedAgentId).get();
    const batch = db.batch();
    priceQuery.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    // 🆕 UPDATED: Cache invalidation for both old and new category formats
    try {
      logger.info('🔄 Refreshing in-memory cache due to agent deletion...');
      await refreshAgentsCache();
      
      await deleteCacheByPattern('agents:results:*');
      logger.info('Invalidated all Redis result caches');
      
      await deleteCache(generateAgentCacheKey(sanitizedAgentId));
      if (agentData.category) {
        await deleteCache(generateAgentCategoryCacheKey(agentData.category));
      }
      if (agentData.categories && Array.isArray(agentData.categories)) {
        for (const category of agentData.categories) {
          await deleteCache(generateAgentCategoryCacheKey(category));
        }
      }
      await deleteCache(generateAgentCountCacheKey());
      
      logger.info(`✅ Cache invalidation completed for agent deletion: ${sanitizedAgentId}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in deleteAgent:', cacheError);
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

// Add review functions, count functions, cache management functions etc...
// (These would be similar to the existing ones but with updated cache invalidation)

const getAgentCount = async (req, res) => {
  try {
    logger.info('getAgentCount called - checking cache first');
    
    const cacheKey = generateAgentCountCacheKey();
    logger.info(`Agent count cache key: ${cacheKey}`);
    
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
    
    const agentsSnapshot = await db.collection('agents').get();
    const totalCount = agentsSnapshot.size;
    
    logger.info(`Fetched agent count from Firebase: ${totalCount}`);
    
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

const getSearchResultsCount = async (req, res) => {
  try {
    const {
      q: searchQuery,
      category = 'All',
      priceMin,
      priceMax,
      verified,
      featured,
      complexity,
      paddleCompliant // 🆕 NEW
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
    const filters = { category, priceMin, priceMax, verified, featured, complexity, paddleCompliant };
    
    const countCacheKey = `agents:search:count:${finalSearchQuery}:${JSON.stringify(filters)}`;
    logger.info(`Search count cache key: ${countCacheKey}`);
    
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

    const cacheLoaded = await ensureCacheLoaded();
    if (!cacheLoaded || !allAgentsCache) {
      throw new Error('Failed to load agents cache');
    }

    let results = [...allAgentsCache];
    
    results = searchAgents(results, finalSearchQuery);
    results = filterAgents(results, filters);

    const searchResultsCount = results.length;
    logger.info(`Search count result: ${allAgentsCache.length} → ${searchResultsCount} agents for "${finalSearchQuery}"`);

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

const refreshCache = async (req, res) => {
  try {
    logger.info('🔄 Manual cache refresh requested');
    const success = await refreshAgentsCache();
    
    if (success) {
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

// Add placeholder functions for compatibility
const combinedUpdate = async (req, res) => { 
  return res.status(501).json({ error: 'Not implemented yet' });
};

const createAgentWithPrice = (req, res) => { 
  return res.status(501).json({ error: 'Not implemented yet' });
};

const getDownloadCount = async (req, res) => { 
  return res.status(501).json({ error: 'Not implemented yet' });
};

const incrementDownloadCount = async (req, res) => { 
  return res.status(501).json({ error: 'Not implemented yet' });
};

const getLatestAgents = async (limit = 5) => {
  return [];
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
 * Get user entitlements (admin, purchases, downloads) with Redis caching
 */
const getUserEntitlements = async (userId) => {
  const cacheKey = `user:${userId}:entitlements`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;
  const userDoc = await db.collection('users').doc(userId).get();
  const data = userDoc.exists ? userDoc.data() : {};
  const nowTs = Date.now();
  const subscription = data.subscription || {};
  const currentPeriodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).getTime()
    : 0;
  const entitlements = {
    isAdmin: data.role === 'admin' || data.roles?.includes?.('admin') === true,
    purchases: Array.isArray(data.purchases) ? data.purchases.map(p => p.agentId || p.productId).filter(Boolean) : [],
    downloads: Array.isArray(data.downloads) ? data.downloads.map(d => d.agentId || d.id).filter(Boolean) : [],
    isSubscriber: (subscription.status === 'active' || subscription.status === 'trialing') && currentPeriodEnd > nowTs,
    planId: subscription.planId || null,
    currentPeriodEnd
  };
  await setCache(cacheKey, entitlements, 1800); // 30 min TTL
  return entitlements;
};

/**
 * Determine if a user can review an agent (server-side, authoritative)
 */
const canUserReviewAgent = async (userId, agentId) => {
  const ent = await getUserEntitlements(userId);
  if (ent.isAdmin) return { canReview: true, reason: 'Admin user' };
  if (ent.purchases.includes(agentId)) return { canReview: true, reason: 'Verified purchase' };
  if (ent.downloads.includes(agentId)) return { canReview: true, reason: 'Downloaded agent' };
  // Fallback: check downloads collection
  const dlSnap = await db.collection('agent_downloads')
    .where('agentId', '==', agentId)
    .where('userId', '==', userId)
    .limit(1)
    .get();
  if (!dlSnap.empty) return { canReview: true, reason: 'Downloaded agent' };
  return { canReview: false, reason: 'You must purchase or download this agent before reviewing' };
};

/**
 * Secure review submission with server-side eligibility enforcement
 */
const addAgentReview_controller = async (req, res) => {
  try {
    const userId = req.user?.uid;
    const agentId = req.params.agentId;
    const { content, rating } = req.body || {};

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!agentId) return res.status(400).json({ success: false, error: 'Missing agentId' });
    if (!content || typeof content !== 'string' || content.trim().length < 3)
      return res.status(400).json({ success: false, error: 'Review content is too short' });
    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5)
      return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });

    // Simple rate limit: 5 reviews per 10 minutes per user
    const hits = await incrementCounter(`ratelimit:reviews:${userId}`, 600);
    if (hits > 5) {
      return res.status(429).json({ success: false, error: 'Too many review attempts. Please try again later.' });
    }

    // Eligibility check
    const eligibility = await canUserReviewAgent(userId, agentId);
    if (!eligibility.canReview) {
      return res.status(403).json({ success: false, error: eligibility.reason });
    }

    // Fetch agent doc
    let agentRef = db.collection('agents').doc(agentId);
    let agentSnap = await agentRef.get();
    if (!agentSnap.exists) {
      // Fallback: lookup by 'id' field
      const byId = await db.collection('agents').where('id', '==', agentId).limit(1).get();
      if (!byId.empty) {
        agentRef = byId.docs[0].ref;
        agentSnap = byId.docs[0];
      } else {
        // Fallback: lookup by 'slug'
        const bySlug = await db.collection('agents').where('slug', '==', agentId).limit(1).get();
        if (!bySlug.empty) {
          agentRef = bySlug.docs[0].ref;
          agentSnap = bySlug.docs[0];
        }
      }
    }
    if (!agentSnap.exists) return res.status(404).json({ success: false, error: 'Agent not found' });
    const agentData = agentSnap.data();
    const canonicalAgentId = agentData.id || agentSnap.id;

    // Prevent duplicate per user
    const existing = Array.isArray(agentData.reviews) ? agentData.reviews.find(r => r.userId === userId) : null;
    if (existing) return res.status(409).json({ success: false, error: 'You have already reviewed this agent' });

    const reviewId = `${userId}_${Date.now()}`;
    const review = {
      id: reviewId,
      userId,
      userName: req.user?.name || req.user?.email?.split('@')[0] || 'User',
      rating: numericRating,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      verificationStatus: eligibility.reason === 'Verified purchase' ? 'verified_purchase'
        : eligibility.reason === 'Downloaded agent' ? 'verified_download'
        : eligibility.reason === 'Admin user' ? 'admin' : 'unverified'
    };

    // Update Firestore: append review, update aggregates
    const reviews = Array.isArray(agentData.reviews) ? [...agentData.reviews, review] : [review];
    const newCount = reviews.length;
    const sumRatings = reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
    const averageRating = Number((sumRatings / newCount).toFixed(2));

    await agentRef.update({
      reviews,
      reviewCount: newCount,
      averageRating
    });

    // Invalidate cache for this agent
    try {
      const agentCacheKey = generateAgentCacheKey(canonicalAgentId);
      await deleteCache(agentCacheKey);
      await deleteCacheByPattern('agents:results:*');
      // Refresh in-memory cache since reviews changed
      await refreshAgentsCache();
    } catch (e) {
      logger.warn('Failed to invalidate agent cache after review add:', e);
    }

    return res.status(200).json({ success: true, reviewId, review, averageRating, reviewCount: newCount });
  } catch (error) {
    logger.error('Error in addAgentReview_controller:', error);
    return res.status(500).json({ success: false, error: 'Failed to add review' });
  }
};

/**
 * Secure delete review (admin or review owner)
 */
const deleteAgentReview_controller = async (req, res) => {
  try {
    const userId = req.user?.uid;
    const agentId = req.params.agentId;
    const reviewId = req.params.reviewId;

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!agentId || !reviewId) return res.status(400).json({ success: false, error: 'Missing agentId or reviewId' });

    // Resolve agent document by docId/id/slug
    let agentRef = db.collection('agents').doc(agentId);
    let agentSnap = await agentRef.get();
    if (!agentSnap.exists) {
      const byId = await db.collection('agents').where('id', '==', agentId).limit(1).get();
      if (!byId.empty) {
        agentRef = byId.docs[0].ref;
        agentSnap = byId.docs[0];
      } else {
        const bySlug = await db.collection('agents').where('slug', '==', agentId).limit(1).get();
        if (!bySlug.empty) {
          agentRef = bySlug.docs[0].ref;
          agentSnap = bySlug.docs[0];
        }
      }
    }
    if (!agentSnap.exists) return res.status(404).json({ success: false, error: 'Agent not found' });

    const agentData = agentSnap.data();
    const canonicalAgentId = agentData.id || agentSnap.id;
    const reviews = Array.isArray(agentData.reviews) ? agentData.reviews : [];

    const target = reviews.find(r => (r.id === reviewId) || (r._id === reviewId));
    if (!target) return res.status(404).json({ success: false, error: 'Review not found' });

    const ent = await getUserEntitlements(userId);
    const isAdminUser = ent.isAdmin;
    const isOwner = target.userId === userId;
    if (!isAdminUser && !isOwner) {
      return res.status(403).json({ success: false, error: 'Not allowed to delete this review' });
    }

    const remaining = reviews.filter(r => (r.id !== reviewId) && (r._id !== reviewId));
    const newCount = remaining.length;
    const sumRatings = remaining.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
    const averageRating = newCount > 0 ? Number((sumRatings / newCount).toFixed(2)) : 0;

    await agentRef.update({
      reviews: remaining,
      reviewCount: newCount,
      averageRating
    });

    try {
      const cacheKey = generateAgentCacheKey(canonicalAgentId);
      await deleteCache(cacheKey);
      await deleteCacheByPattern('agents:results:*');
      await refreshAgentsCache();
    } catch (e) {
      logger.warn('Failed to invalidate agent cache after review delete:', e);
    }

    return res.status(200).json({ success: true, reviewId, reviewCount: newCount, averageRating });
  } catch (error) {
    logger.error('Error in deleteAgentReview_controller:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete review' });
  }
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
  
  // Count and search endpoints
  getAgentCount,
  getSearchResultsCount,
  searchAgents,
  
  // Cache management
  refreshCache,
  getCacheStats,
  initializeCache,

  // Reviews
  addAgentReview_controller,
  deleteAgentReview_controller
};

for (const funcName in functionsToExport) {
  logger.info(`- ${funcName}: ${typeof functionsToExport[funcName] === 'function'}`);
}

module.exports = functionsToExport;