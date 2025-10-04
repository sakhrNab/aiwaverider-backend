const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const upload = require('../../middleware/upload');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');
const { 
  getCache, 
  setCache, 
  deleteCache, 
  deleteCacheByPattern,
  generatePromptCacheKey,
  generatePromptCategoryCacheKey,
  generatePromptCountCacheKey,
  generatePromptSearchCacheKey 
} = require('../../utils/cache');

// Collection reference - Prompts only
const COLLECTION_NAME = 'prompts';

// ==========================================
// IN-MEMORY CACHE FOR ALL PROMPTS
// ==========================================
let allPromptsCache = null;
let cacheLastUpdated = null;
const CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Prompt specific categories
 */
const PROMPT_CATEGORIES = [
  'AI Prompts',
  'ChatGPT Prompts',
  'AI Art Generator', 
  'Coding Assistant',
  'Business Plan',
  'Creative Writing',
  'Marketing',
  'Productivity',
  'Education',
  'Content Creation'
];

/**
 * Load all prompts from Firebase into memory cache
 */
const refreshPromptsCache = async () => {
  try {
    logger.info('🔄 Refreshing prompts cache from Firebase...');
    const startTime = Date.now();
    
    // Fetch ALL prompts from Firebase
    const snapshot = await admin.firestore().collection(COLLECTION_NAME)
      .orderBy('createdAt', 'desc')
      .get();
    
    allPromptsCache = [];
    snapshot.forEach(doc => {
      allPromptsCache.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    cacheLastUpdated = new Date();
    const loadTime = Date.now() - startTime;
    
    logger.info(`✅ Loaded ${allPromptsCache.length} prompts into memory cache in ${loadTime}ms`);
    
    // Also cache total count in Redis
    await setCache('prompts:total:count', allPromptsCache.length);
    
    return true;
  } catch (error) {
    logger.error('❌ Error refreshing prompts cache:', error);
    return false;
  }
};

/**
 * Ensure cache is loaded and fresh
 */
const ensureCacheLoaded = async () => {
  const needsRefresh = !allPromptsCache || 
                      !cacheLastUpdated || 
                      (new Date() - cacheLastUpdated) > CACHE_REFRESH_INTERVAL;
  
  if (needsRefresh) {
    logger.info('Prompts cache needs refresh, loading from Firebase...');
    await refreshPromptsCache();
  }
  
  return allPromptsCache !== null;
};

/**
 * Smart search function for prompts
 */
const searchPrompts = (prompts, searchQuery) => {
  if (!searchQuery || !searchQuery.trim()) {
    logger.info('No search query, returning all prompts');
    return prompts;
  }
  
  const searchTerms = searchQuery.toLowerCase().trim().split(/\s+/);
  logger.info(`🔍 Searching ${prompts.length} prompts for terms: [${searchTerms.join(', ')}]`);
  
  const results = prompts.filter(prompt => {
    return searchTerms.every(term => {
      const matches = [];
      
      // Search in title
      if (prompt.title && prompt.title.toLowerCase().includes(term)) {
        matches.push('title');
      }
      
      // Search in description
      if (prompt.description && prompt.description.toLowerCase().includes(term)) {
        matches.push('description');
      }
      
      // Search in category
      if (prompt.category && prompt.category.toLowerCase().includes(term)) {
        matches.push('category');
      }
      
      // Search in keywords
      if (prompt.keywords && prompt.keywords.some(keyword => 
        keyword.toLowerCase().includes(term))) {
        matches.push('keywords');
      }
      
      // Search in tags
      if (prompt.tags && prompt.tags.some(tag => 
        tag.toLowerCase().includes(term))) {
        matches.push('tags');
      }
      
      // Search in additionalHTML
      if (prompt.additionalHTML && prompt.additionalHTML.toLowerCase().includes(term)) {
        matches.push('content');
      }
      
      const hasMatch = matches.length > 0;
      if (hasMatch) {
        logger.info(`✅ Match found for "${term}" in prompt ${prompt.id} (${matches.join(', ')})`);
      }
      
      return hasMatch;
    });
  });
  
  logger.info(`🎯 Search "${searchQuery}" found ${results.length} matches`);
  return results;
};

/**
 * Filter prompts by various criteria
 */
const filterPrompts = (prompts, filters) => {
  let filtered = [...prompts];
  const appliedFilters = [];
  
  // Filter by category
  if (filters.category && filters.category !== 'All') {
    filtered = filtered.filter(prompt => prompt.category === filters.category);
    appliedFilters.push(`category:${filters.category}`);
  }
  
  // Filter by tags
  if (filters.tags) {
    const tagsArray = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
    filtered = filtered.filter(prompt => 
      prompt.tags && tagsArray.some(tag => prompt.tags.includes(tag))
    );
    appliedFilters.push(`tags:${filters.tags}`);
  }
  
  // Filter by featured status
  if (filters.featured !== undefined) {
    const isFeatured = filters.featured === 'true';
    filtered = filtered.filter(prompt => prompt.isFeatured === isFeatured);
    appliedFilters.push(`featured:${isFeatured}`);
  }
  
  // Filter by creator
  if (filters.createdBy) {
    filtered = filtered.filter(prompt => prompt.createdBy === filters.createdBy);
    appliedFilters.push(`createdBy:${filters.createdBy}`);
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
  const parts = ['prompts:results'];
  
  if (searchQuery) parts.push(`search:${searchQuery}`);
  if (filters.category && filters.category !== 'All') parts.push(`cat:${filters.category}`);
  if (filters.tags) parts.push(`tags:${filters.tags}`);
  if (filters.featured) parts.push(`feat:${filters.featured}`);
  if (filters.createdBy) parts.push(`creator:${filters.createdBy}`);
  
  parts.push(`limit:${limit}`);
  parts.push(`offset:${offset}`);
  
  return parts.join(':');
};

/**
 * @swagger
 * /api/prompts:
 *   get:
 *     summary: Get all prompts
 *     description: Get all prompts with search, filtering, and pagination
 *     tags: [Prompts]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for prompt title and description
 *         example: "AI writing"
 *       - in: query
 *         name: searchQuery
 *         schema:
 *           type: string
 *         description: Alternative search parameter
 *         example: "productivity"
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           default: "All"
 *         description: Filter by prompt category
 *         example: "AI Prompts"
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Filter by tags (comma-separated)
 *         example: "writing,productivity"
 *       - in: query
 *         name: featured
 *         schema:
 *           type: boolean
 *         description: Filter for featured prompts only
 *       - in: query
 *         name: createdBy
 *         schema:
 *           type: string
 *         description: Filter by creator user ID
 *         example: "user123"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of prompts per page
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of prompts to skip
 *     responses:
 *       200:
 *         description: Prompts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prompt'
 *                 total:
 *                   type: integer
 *                   description: Total number of prompts matching the criteria
 *                 limit:
 *                   type: integer
 *                   description: Number of prompts per page
 *                 offset:
 *                   type: integer
 *                   description: Number of prompts skipped
 *                 responseTime:
 *                   type: integer
 *                   description: Response time in milliseconds
 *                 fromCache:
 *                   type: boolean
 *                   description: Whether the response came from cache
 *       500:
 *         description: Internal server error
 */
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Parse query parameters
    const {
      searchQuery,
      search,
      category = 'All',
      tags,
      featured,
      createdBy,
      limit = 20,
      offset = 0
    } = req.query;
    
    const finalSearchQuery = searchQuery || search;
    const parsedLimit = parseInt(limit) || 20;
    const parsedOffset = parseInt(offset) || 0;
    
    const filters = {
      category,
      tags,
      featured,
      createdBy
    };
    
    logger.info(`📊 getPrompts called:`, {
      searchQuery: finalSearchQuery,
      filters,
      limit: parsedLimit,
      offset: parsedOffset
    });
    
    // 1. Ensure in-memory cache is loaded
    const cacheLoaded = await ensureCacheLoaded();
    if (!cacheLoaded || !allPromptsCache) {
      throw new Error('Failed to load prompts cache');
    }
    
    // 2. Check Redis cache for this specific query
    const cacheKey = generateResultsCacheKey(finalSearchQuery, filters, parsedLimit, parsedOffset);
    const cachedResult = await getCache(cacheKey);
    
    if (cachedResult) {
      const responseTime = Date.now() - startTime;
      logger.info(`⚡ Cache HIT for ${cacheKey} | Response time: ${responseTime}ms`);
      
      // Set cache headers for browser caching
      res.set({
        'Cache-Control': 'public, max-age=300', // 5 minutes
        'ETag': `W/"prompts-${cacheKey}-${Date.now()}"`
      });
      
      return res.status(200).json({
        ...cachedResult,
        responseTime,
        fromCache: true
      });
    }
    
    logger.info(`💾 Cache MISS for ${cacheKey}, processing from memory...`);
    
    // 3. Process data from in-memory cache
    let results = [...allPromptsCache];
    
    // 4. Apply search if provided
    if (finalSearchQuery) {
      results = searchPrompts(results, finalSearchQuery);
    }
    
    // 5. Apply filters
    results = filterPrompts(results, filters);
    
    // 6. Sort results (newest first)
    results.sort((a, b) => {
      if (a.createdAt && b.createdAt) {
        return new Date(b.createdAt.toDate ? b.createdAt.toDate() : b.createdAt) - 
               new Date(a.createdAt.toDate ? a.createdAt.toDate() : a.createdAt);
      }
      return 0;
    });
    
    // 7. Calculate pagination
    const totalCount = results.length;
    const hasMore = parsedOffset + parsedLimit < totalCount;
    const paginatedResults = results.slice(parsedOffset, parsedOffset + parsedLimit);
    
    // 8. Prepare response
    const response = {
      prompts: paginatedResults,
      totalCount,
      currentPage: Math.floor(parsedOffset / parsedLimit) + 1,
      totalPages: Math.ceil(totalCount / parsedLimit),
      hasMore,
      limit: parsedLimit,
      offset: parsedOffset,
      searchQuery: finalSearchQuery || null,
      filters: filters,
      fromCache: false,
      responseTime: Date.now() - startTime
    };
    
    // 9. Cache the result
    await setCache(cacheKey, response);
    
    logger.info(`✅ Query processed successfully:`, {
      totalFound: totalCount,
      returned: paginatedResults.length,
      responseTime: response.responseTime,
      cached: true
    });
    
    // Set cache headers for browser caching
    res.set({
      'Cache-Control': 'public, max-age=300', // 5 minutes
      'ETag': `W/"prompts-${cacheKey}-${Date.now()}"`
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    logger.error('❌ Error in getPrompts:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch prompts', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/prompts/count:
 *   get:
 *     summary: Get total count of prompts
 *     description: Get the total number of prompts in the system
 *     tags: [Prompts]
 *     responses:
 *       200:
 *         description: Prompt count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 totalCount:
 *                   type: integer
 *                   example: 150
 *                 fromCache:
 *                   type: boolean
 *                   description: Whether the response came from cache
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   GET /api/prompts/count
 * @desc    Get total count of prompts
 * @access  Public
 */
router.get('/count', async (req, res) => {
  try {
    const cacheKey = generatePromptCountCacheKey();
    const cachedCount = await getCache(cacheKey);
    
    if (cachedCount !== null) {
      return res.status(200).json({
        success: true,
        totalCount: cachedCount,
        fromCache: true
      });
    }
    
    // Get count from Firebase
    const snapshot = await admin.firestore().collection(COLLECTION_NAME).get();
    const totalCount = snapshot.size;
    
    // Cache the result
    await setCache(cacheKey, totalCount);
    
    return res.status(200).json({
      success: true,
      totalCount: totalCount,
      fromCache: false
    });
    
  } catch (error) {
    logger.error('Error getting prompt count:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get prompt count',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/prompts/categories:
 *   get:
 *     summary: Get all prompt categories with counts
 *     description: Get all available prompt categories along with the count of prompts in each category
 *     tags: [Prompts]
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         example: "AI Prompts"
 *                       count:
 *                         type: integer
 *                         example: 25
 *                 fromCache:
 *                   type: boolean
 *                   description: Whether the response came from cache
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   GET /api/prompts/categories
 * @desc    Get all prompt categories with counts
 * @access  Public
 */
router.get('/categories', async (req, res) => {
  try {
    const cacheKey = 'prompts:categories:counts';
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      return res.status(200).json({
        success: true,
        data: cachedData,
        fromCache: true
      });
    }
    
    // Ensure cache is loaded
    await ensureCacheLoaded();
    
    // Count prompts by category
    const categoryCounts = {};
    
    allPromptsCache.forEach(prompt => {
      const category = prompt.category || 'Uncategorized';
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });
    
    // Format response
    const categories = Object.entries(categoryCounts).map(([name, count]) => ({
      name,
      count
    }));
    
    // Add "All" category
    const totalCount = allPromptsCache.length;
    categories.unshift({ name: 'All', count: totalCount });
    
    // Cache the result
    await setCache(cacheKey, categories);
    
    return res.status(200).json({
      success: true,
      data: categories,
      fromCache: false
    });
    
  } catch (error) {
    logger.error('Error getting prompt categories:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get prompt categories',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/prompts/featured:
 *   get:
 *     summary: Get featured prompts
 *     description: Get a list of featured prompts, sorted by creation date
 *     tags: [Prompts]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of featured prompts to return
 *     responses:
 *       200:
 *         description: Featured prompts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prompts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prompt'
 *                 fromCache:
 *                   type: boolean
 *                   description: Whether the response came from cache
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   GET /api/prompts/featured
 * @desc    Get featured prompts
 * @access  Public
 */
router.get('/featured', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Check cache first
    const cacheKey = `prompts:featured:${limit}`;
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      logger.info(`Cache hit for featured prompts: ${limit}`);
      return res.status(200).json({
        prompts: cachedData,
        fromCache: true
      });
    }
    
    // Ensure cache is loaded
    await ensureCacheLoaded();
    
    // Filter featured prompts from cache
    const featuredPrompts = allPromptsCache
      .filter(prompt => prompt.isFeatured === true)
      .sort((a, b) => {
        if (a.createdAt && b.createdAt) {
          return new Date(b.createdAt.toDate ? b.createdAt.toDate() : b.createdAt) - 
                 new Date(a.createdAt.toDate ? a.createdAt.toDate() : a.createdAt);
        }
        return 0;
      })
      .slice(0, parseInt(limit));
    
    // Cache the result
    await setCache(cacheKey, featuredPrompts);
    
    return res.status(200).json({
      prompts: featuredPrompts,
      fromCache: false
    });
  } catch (error) {
    logger.error('Error fetching featured prompts:', error);
    return res.status(500).json({ error: 'Failed to fetch featured prompts' });
  }
});

/**
 * @swagger
 * /api/prompts/user/{userId}/liked:
 *   get:
 *     summary: Get prompts liked by a user
 *     description: Get all prompts that have been liked by a specific user
 *     tags: [Prompts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to get liked prompts for
 *         example: "user123"
 *     responses:
 *       200:
 *         description: Liked prompts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prompt'
 *                 count:
 *                   type: integer
 *                   description: Number of liked prompts
 *                 userId:
 *                   type: string
 *                   description: User ID
 *       403:
 *         description: Access denied - users can only view their own liked prompts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   GET /api/prompts/user/:userId/liked
 * @desc    Get prompts liked by a user
 * @access  Private (Authenticated users)
 */
router.get('/user/:userId/liked', auth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const requestingUserId = req.user.uid;
    
    // Users can only see their own liked prompts (unless admin)
    if (userId !== requestingUserId && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only view your own liked prompts.'
      });
    }
    
    // Ensure cache is loaded
    await ensureCacheLoaded();
    
    // Filter prompts liked by the user
    const likedPrompts = allPromptsCache.filter(prompt => 
      prompt.likes && prompt.likes.includes(userId)
    );
    
    return res.status(200).json({
      success: true,
      data: likedPrompts,
      count: likedPrompts.length,
      userId: userId
    });
    
  } catch (error) {
    logger.error(`Error getting liked prompts for user ${req.params.userId}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get liked prompts',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/prompts/cache/refresh:
 *   post:
 *     summary: Manual cache refresh (Admin only)
 *     description: Manually refresh the prompts cache. This endpoint is only available to admin users.
 *     tags: [Prompts]
 *     security:
 *       - FirebaseAuth: []
 *     responses:
 *       200:
 *         description: Cache refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Prompts cache refreshed successfully. Loaded 150 prompts"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 promptCount:
 *                   type: integer
 *                   description: Number of prompts loaded into cache
 *       403:
 *         description: Access denied - Admin privileges required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   POST /api/prompts/cache/refresh
 * @desc    Manual cache refresh (Admin only)
 * @access  Private (Admin only)
 */
router.post('/cache/refresh', auth, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    logger.info('🔄 Manual prompts cache refresh requested');
    const success = await refreshPromptsCache();
    
    if (success) {
      await deleteCacheByPattern('prompts:results:*');
      logger.info('🧹 Cleared cached prompt search results');
      
      return res.status(200).json({
        success: true,
        message: `Prompts cache refreshed successfully. Loaded ${allPromptsCache?.length || 0} prompts`,
        timestamp: new Date().toISOString(),
        promptCount: allPromptsCache?.length || 0
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to refresh prompts cache',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('❌ Error in refresh prompts cache:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/prompts/{id}:
 *   get:
 *     summary: Get a single prompt by ID
 *     description: Retrieve a specific prompt by its unique identifier
 *     tags: [Prompts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier of the prompt
 *         example: "prompt-123"
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Skip cache and fetch fresh data from database
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Force refresh from database (alias for skipCache)
 *     responses:
 *       200:
 *         description: Prompt retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Prompt retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Prompt'
 *                 fromCache:
 *                   type: boolean
 *                   description: Whether the response came from cache
 *       400:
 *         description: Invalid prompt ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Prompt not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   GET /api/prompts/:id
 * @desc    Get a single prompt by ID
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    const skipCache = req.query.skipCache === 'true' || req.query.refresh === 'true';
    
    logger.info(`Attempting to get prompt with ID: "${promptId}"`, { skipCache });
    
    if (!promptId || typeof promptId !== 'string') {
      logger.error('Invalid prompt ID format:', promptId);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid prompt ID format',
        error: 'Prompt ID must be a valid string' 
      });
    }
    
    const cleanPromptId = promptId.trim();
    const cacheKey = generatePromptCacheKey(cleanPromptId);
    
    if (!skipCache) {
      try {
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
          logger.info(`Cache hit for prompt ${cleanPromptId}`);
          return res.status(200).json({
            success: true,
            message: 'Prompt retrieved from cache',
            data: cachedData,
            fromCache: true
          });
        }
        logger.info(`Cache miss for prompt ${cleanPromptId}, fetching from database`);
      } catch (cacheError) {
        logger.error(`Redis cache GET error for ${cleanPromptId}:`, cacheError);
      }
    }
    
    // Fetch from Firebase
    const promptDoc = await admin.firestore().collection(COLLECTION_NAME).doc(cleanPromptId).get();
    
    if (!promptDoc.exists) {
      logger.error(`Prompt not found with ID: ${cleanPromptId}`);
      return res.status(404).json({ 
        success: false,
        message: 'Prompt not found',
        error: `No prompt exists with ID: ${promptId}` 
      });
    }
    
    const promptData = {
      id: promptDoc.id,
      ...promptDoc.data(),
      _fetchTime: Date.now()
    };
    
    // Cache the result
    try {
      await setCache(cacheKey, promptData);
      logger.info(`Cached prompt ${cleanPromptId} in Redis`);
    } catch (cacheError) {
      logger.error(`Error caching prompt ${cleanPromptId} in Redis:`, cacheError);
    }
    
    res.set({
      'Cache-Control': 'public, max-age=300',
      'ETag': `W/"prompt-${cleanPromptId}-${promptData._fetchTime}"`
    });
    
    return res.status(200).json({
      success: true,
      message: 'Prompt retrieved successfully',
      data: promptData,
      fromCache: false
    });
    
  } catch (error) {
    logger.error('Error getting prompt by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve prompt',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/prompts:
 *   post:
 *     summary: Create a new prompt
 *     description: Create a new prompt in the system. This endpoint is only available to admin users.
 *     tags: [Prompts]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *                 description: Title of the prompt
 *                 example: "AI Writing Assistant Prompt"
 *               description:
 *                 type: string
 *                 description: Description of the prompt
 *                 example: "A comprehensive prompt for AI writing assistance"
 *               link:
 *                 type: string
 *                 description: External link related to the prompt
 *                 example: "https://example.com/prompt"
 *               keyword:
 *                 type: string
 *                 description: Comma-separated keywords
 *                 example: "writing,productivity,AI"
 *               category:
 *                 type: string
 *                 description: Category of the prompt
 *                 example: "AI Prompts"
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "writing,assistant,productivity"
 *               additionalHTML:
 *                 type: string
 *                 description: Additional HTML content
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Result/output image file for the prompt
 *               inputImage:
 *                 type: string
 *                 format: binary
 *                 description: Input image for comparison (file upload or base64 data URL)
 *                 example: "input-image.jpg"
 *     responses:
 *       201:
 *         description: Prompt created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Prompt'
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Access denied - Admin privileges required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   POST /api/prompts
 * @desc    Create a new prompt
 * @access  Private (Admin only)
 */
router.post('/', auth, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'inputImage', maxCount: 1 }
]), async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    // Extract fields from request body
    const { title, description, link, keyword, category, additionalHTML } = req.body;
    
    // Handle tags which might be a string, array, or missing
    let tags = [];
    if (req.body.tags) {
      if (Array.isArray(req.body.tags)) {
        tags = req.body.tags;
      } else if (typeof req.body.tags === 'string') {
        if (req.body.tags.includes(',')) {
          tags = req.body.tags.split(',').map(tag => tag.trim());
        } else {
          tags = [req.body.tags];
        }
      }
    }
    
    // Handle keywords which might be a string, array, or missing
    let keywords = [];
    if (keyword) {
      if (Array.isArray(keyword)) {
        keywords = keyword;
      } else if (typeof keyword === 'string') {
        if (keyword.includes(',')) {
          keywords = keyword.split(',').map(kw => kw.trim());
        } else {
          keywords = [keyword];
        }
      }
    }
    
    
    // Validate required fields
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: 'Title and description are required fields'
      });
    }
    
    // Ensure link has a default value if empty
    const safeLink = link || '';
    
    // Handle image upload - support both file uploads and binary data
    let imageUrl = '';
    
    // Check for file upload (multer)
    if (req.files && req.files.image) {
      // console.log('File received via multer:', req.files.image[0].originalname, req.files.image[0].mimetype, req.files.image[0].size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.files.image[0].originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.files.image[0].buffer, {
            metadata: {
              contentType: req.files.image[0].mimetype,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL:', imageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage.');
          
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.files.image[0].buffer);
          imageUrl = `/uploads/${filename}`;
          // console.log('Local storage URL:', imageUrl);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.files.image[0].buffer);
        imageUrl = `/uploads/${filename}`;
        // console.log('Local storage URL:', imageUrl);
      }
    }
    // Check for binary data in request body (from workflows like n8n)
    else if (req.body.image && typeof req.body.image === 'string' && req.body.image.startsWith('data:')) {
      // console.log('✅ Binary data received in request body (data: URL format)');
      
      try {
        // Extract base64 data from data URL
        const base64Data = req.body.image.split(',')[1];
        const mimeType = req.body.image.split(',')[0].split(':')[1].split(';')[0];
        const extension = mimeType.split('/')[1] || 'jpg';
        
        const timestamp = Date.now();
        const filename = `${timestamp}-workflow-image.${extension}`;
        const buffer = Buffer.from(base64Data, 'base64');
        
        // console.log('Processing binary data:', { mimeType, extension, size: buffer.length });
        
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket for binary data:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(buffer, {
            metadata: {
              contentType: mimeType,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL for binary data:', imageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage for binary data.');
          
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), buffer);
          imageUrl = `/uploads/${filename}`;
          // console.log('Local storage URL for binary data:', imageUrl);
        }
      } catch (error) {
        console.error('Error processing binary data:', error);
        // Continue without image if binary data processing fails
      }
    }
    // Check for binary data as Buffer (alternative format)
    else if (req.body.image && Buffer.isBuffer(req.body.image)) {
      // console.log('✅ Buffer data received in request body');
      
      try {
        const timestamp = Date.now();
        const filename = `${timestamp}-workflow-buffer.jpg`;
        
        // console.log('Processing buffer data:', { size: req.body.image.length });
        
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket for buffer data:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.body.image, {
            metadata: {
              contentType: 'image/jpeg',
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL for buffer data:', imageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage for buffer data.');
          
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.body.image);
          imageUrl = `/uploads/${filename}`;
          // console.log('Local storage URL for buffer data:', imageUrl);
        }
      } catch (error) {
        console.error('Error processing buffer data:', error);
        // Continue without image if buffer processing fails
      }
    }
    // Catch-all case for debugging
    else if (req.body.image) {
      // console.log('❌ Image data received but in unrecognized format:');
      // console.log('Type:', typeof req.body.image);
      // console.log('Is Buffer:', Buffer.isBuffer(req.body.image));
      // console.log('Is String:', typeof req.body.image === 'string');
      // console.log('Starts with data:', req.body.image && typeof req.body.image === 'string' && req.body.image.startsWith('data:'));
      // console.log('Value preview:', req.body.image ? String(req.body.image).substring(0, 100) + '...' : 'null/undefined');
    }
    
    // console.log('Final imageUrl value:', imageUrl);
    
    // If no image was processed from req.body.image, try to extract from additionalHTML
    if (!imageUrl && additionalHTML) {
      // console.log('🔍 No image from body, checking additionalHTML for base64 image...');
      const imgRegex = /<img[^>]+src="(data:image\/[^"]+)"/g;
      const match = imgRegex.exec(additionalHTML);
      
      if (match && match[1]) {
        // console.log('✅ Found base64 image in additionalHTML, storing in image field');
        // Only set imageUrl if it's still empty to avoid overwriting processed images
        if (!imageUrl) {
        imageUrl = match[1]; // Store the base64 data URL directly
        }
      }
    }
    
    // Handle input image if provided - support both file uploads and base64 data URLs
    let inputImageUrl = '';
    
    // Check for input image file upload (multer)
    if (req.files && req.files.inputImage) {
      // console.log('Input image file received via multer:', req.files.inputImage.originalname, req.files.inputImage.mimetype, req.files.inputImage.size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-input-${req.files.inputImage.originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket for input image:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/input/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.files.inputImage.buffer, {
            metadata: {
              contentType: req.files.inputImage.mimetype,
            },
          });
          
          await fileRef.makePublic();
          inputImageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL for input image:', inputImageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage for input image.');
          
          const uploadsDir = path.join(__dirname, '../../uploads/input');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.files.inputImage.buffer);
          inputImageUrl = `/uploads/input/${filename}`;
          // console.log('Local storage URL for input image:', inputImageUrl);
        }
      } catch (error) {
        console.error('Error uploading input image:', error);
        
        const uploadsDir = path.join(__dirname, '../../uploads/input');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.files.inputImage.buffer);
        inputImageUrl = `/uploads/input/${filename}`;
        // console.log('Local storage URL for input image:', inputImageUrl);
      }
    }
    // Check for input image base64 data URL
    else if (req.body.inputImage && typeof req.body.inputImage === 'string' && req.body.inputImage.startsWith('data:')) {
      // console.log('Input image base64 data received');
      
      try {
        // Extract base64 data from data URL
        const base64Data = req.body.inputImage.split(',')[1];
        const mimeType = req.body.inputImage.split(',')[0].split(':')[1].split(';')[0];
        const extension = mimeType.split('/')[1] || 'jpg';
        
        const timestamp = Date.now();
        const filename = `${timestamp}-input-image.${extension}`;
        const buffer = Buffer.from(base64Data, 'base64');
        
        
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket for input image:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/input/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(buffer, {
            metadata: {
              contentType: mimeType,
            },
          });
          
          await fileRef.makePublic();
          inputImageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL for input image:', inputImageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage for input image.');
          
          const uploadsDir = path.join(__dirname, '../../uploads/input');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), buffer);
          inputImageUrl = `/uploads/input/${filename}`;
          // console.log('Local storage URL for input image:', inputImageUrl);
        }
      } catch (error) {
        console.error('Error processing input image base64 data:', error);
        // Fallback to storing as base64 if conversion fails
        inputImageUrl = req.body.inputImage;
      }
    }

    // Debug logging to track variable values
    console.log('🔍 DEBUG - Final variable values before document creation:');
    console.log('imageUrl:', imageUrl);
    console.log('inputImageUrl:', inputImageUrl);
    console.log('req.body.image type:', typeof req.body.image);
    console.log('req.body.inputImage type:', typeof req.body.inputImage);
    
    // Prepare the document
    const newPrompt = {
      title,
      description,
      link: safeLink,
      image: imageUrl || '', // Result/output image
      inputImage: inputImageUrl || '', // Input image for comparison
      keywords: keywords || [],
      tags: tags || [],
      category: category || '',
      additionalHTML: additionalHTML || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
      
      // Prompt-specific fields
      likes: [], // Array of user IDs who liked this prompt
      likeCount: 0,
      viewCount: 0,
      downloadCount: 0,
      isFeatured: false,
      isPublic: true,
      type: 'prompt' // Explicitly mark as prompt
    };
    
    // Add the document to prompts collection
    const docRef = await admin.firestore().collection(COLLECTION_NAME).add(newPrompt);
    
    // Get the created document
    const createdDoc = await docRef.get();
    
    // Cache invalidation
    try {
      logger.info('🔄 Refreshing prompts cache due to new prompt creation...');
      await refreshPromptsCache();
      await deleteCacheByPattern('prompts:results:*');
      await deleteCache(generatePromptCategoryCacheKey(category));
      await deleteCache(generatePromptCountCacheKey());
      logger.info(`✅ Cache invalidation completed for new prompt: ${docRef.id}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in createPrompt:', cacheError);
    }
    
    return res.status(201).json({
      success: true,
      data: {
        id: docRef.id,
        ...createdDoc.data()
      }
    });
  } catch (error) {
    console.error('Error creating prompt:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error while creating prompt'
    });
  }
});

/**
 * @swagger
 * /api/prompts/{id}:
 *   put:
 *     summary: Update a prompt
 *     description: Update an existing prompt in the system. This endpoint is only available to admin users.
 *     tags: [Prompts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier of the prompt to update
 *         example: "prompt-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Updated title of the prompt
 *                 example: "Updated AI Writing Assistant Prompt"
 *               description:
 *                 type: string
 *                 description: Updated description of the prompt
 *                 example: "An improved comprehensive prompt for AI writing assistance"
 *               link:
 *                 type: string
 *                 description: Updated external link
 *                 example: "https://example.com/updated-prompt"
 *               keyword:
 *                 type: string
 *                 description: Updated comma-separated keywords
 *                 example: "writing,productivity,AI,updated"
 *               category:
 *                 type: string
 *                 description: Updated category of the prompt
 *                 example: "AI Prompts"
 *               tags:
 *                 type: string
 *                 description: Updated comma-separated tags
 *                 example: "writing,assistant,productivity,updated"
 *               additionalHTML:
 *                 type: string
 *                 description: Updated additional HTML content
 *               isFeatured:
 *                 type: boolean
 *                 description: Whether the prompt should be featured
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Updated result/output image file for the prompt
 *               inputImage:
 *                 type: string
 *                 format: binary
 *                 description: Updated input image for comparison (file upload or base64 data URL)
 *     responses:
 *       200:
 *         description: Prompt updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Prompt'
 *       403:
 *         description: Access denied - Admin privileges required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Prompt not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   PUT /api/prompts/:id
 * @desc    Update a prompt
 * @access  Private (Admin only)
 */
router.put('/:id', auth, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'inputImage', maxCount: 1 }
]), async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    const id = req.params.id;
    const { title, description, link, keyword, category, additionalHTML, isFeatured } = req.body;
    
    // Check if the prompt exists
    const promptRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await promptRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    const currentPromptData = doc.data();
    
    // Handle tags and keywords
    let tags = undefined;
    if (req.body.tags) {
      if (Array.isArray(req.body.tags)) {
        tags = req.body.tags;
      } else if (typeof req.body.tags === 'string') {
        if (req.body.tags.includes(',')) {
          tags = req.body.tags.split(',').map(tag => tag.trim());
        } else {
          tags = [req.body.tags];
        }
      }
    }
    
    let keywords = undefined;
    if (keyword) {
      if (Array.isArray(keyword)) {
        keywords = keyword;
      } else if (typeof keyword === 'string') {
        if (keyword.includes(',')) {
          keywords = keyword.split(',').map(kw => kw.trim());
        } else {
          keywords = [keyword];
        }
      }
    }
    
    // Handle image upload - support both file uploads and binary data
    let imageUrl = undefined;
    
    // Check for file upload (multer)
    if (req.files && req.files.image) {
      // console.log('File received via multer:', req.files.image[0].originalname, req.files.image[0].mimetype, req.files.image[0].size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.files.image[0].originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.files.image[0].buffer, {
            metadata: {
              contentType: req.files.image[0].mimetype,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
        } else {
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.files.image[0].buffer);
          imageUrl = `/uploads/${filename}`;
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.files.image[0].buffer);
        imageUrl = `/uploads/${filename}`;
      }
    }
    // Check for binary data in request body (from workflows like n8n)
    else if (req.body.image && typeof req.body.image === 'string' && req.body.image.startsWith('data:')) {
      // console.log('Binary data received in request body for update');
      
      try {
        // Extract base64 data from data URL
        const base64Data = req.body.image.split(',')[1];
        const mimeType = req.body.image.split(',')[0].split(':')[1].split(';')[0];
        const extension = mimeType.split('/')[1] || 'jpg';
        
        const timestamp = Date.now();
        const filename = `${timestamp}-workflow-image-update.${extension}`;
        const buffer = Buffer.from(base64Data, 'base64');
        
        // console.log('Processing binary data for update:', { mimeType, extension, size: buffer.length });
        
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(buffer, {
            metadata: {
              contentType: mimeType,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
        } else {
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), buffer);
          imageUrl = `/uploads/${filename}`;
        }
      } catch (error) {
        console.error('Error processing binary data for update:', error);
        // Continue without image if binary data processing fails
      }
    }
    // Check for binary data as Buffer (alternative format)
    else if (req.body.image && Buffer.isBuffer(req.body.image)) {
      // console.log('Buffer data received in request body for update');
      
      try {
        const timestamp = Date.now();
        const filename = `${timestamp}-workflow-buffer-update.jpg`;
        
        // console.log('Processing buffer data for update:', { size: req.body.image.length });
        
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.body.image, {
            metadata: {
              contentType: 'image/jpeg',
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
        } else {
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.body.image);
          imageUrl = `/uploads/${filename}`;
        }
      } catch (error) {
        console.error('Error processing buffer data for update:', error);
        // Continue without image if buffer processing fails
      }
    }
    
    // Handle input image if provided - support both file uploads and base64 data URLs
    let inputImageUrl = undefined;
    
    // Check for input image file upload (multer)
    if (req.files && req.files.inputImage) {
      // console.log('Input image file received via multer for update:', req.files.inputImage[0].originalname, req.files.inputImage[0].mimetype, req.files.inputImage[0].size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-input-update-${req.files.inputImage[0].originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket for input image update:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/input/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.files.inputImage[0].buffer, {
            metadata: {
              contentType: req.files.inputImage[0].mimetype,
            },
          });
          
          await fileRef.makePublic();
          inputImageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL for input image update:', inputImageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage for input image update.');
          
          const uploadsDir = path.join(__dirname, '../../uploads/input');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.files.inputImage[0].buffer);
          inputImageUrl = `/uploads/input/${filename}`;
          // console.log('Local storage URL for input image update:', inputImageUrl);
        }
      } catch (error) {
        console.error('Error uploading input image for update:', error);
        
        const uploadsDir = path.join(__dirname, '../../uploads/input');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.files.inputImage[0].buffer);
        inputImageUrl = `/uploads/input/${filename}`;
        // console.log('Local storage URL for input image update:', inputImageUrl);
      }
    }
    // Check for input image base64 data URL
    else if (req.body.inputImage && typeof req.body.inputImage === 'string' && req.body.inputImage.startsWith('data:')) {
      // console.log('Input image base64 data received for update');
      
      try {
        // Extract base64 data from data URL
        const base64Data = req.body.inputImage.split(',')[1];
        const mimeType = req.body.inputImage.split(',')[0].split(':')[1].split(';')[0];
        const extension = mimeType.split('/')[1] || 'jpg';
        
        const timestamp = Date.now();
        const filename = `${timestamp}-input-update.${extension}`;
        const buffer = Buffer.from(base64Data, 'base64');
        
        
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          // console.log('Using Firebase Storage bucket for input image update:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/input/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(buffer, {
            metadata: {
              contentType: mimeType,
            },
          });
          
          await fileRef.makePublic();
          inputImageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          // console.log('Firebase Storage URL for input image update:', inputImageUrl);
        } else {
          // console.log('Firebase Storage bucket not configured. Using local storage for input image update.');
          
          const uploadsDir = path.join(__dirname, '../../uploads/input');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), buffer);
          inputImageUrl = `/uploads/input/${filename}`;
          // console.log('Local storage URL for input image update:', inputImageUrl);
        }
      } catch (error) {
        console.error('Error processing input image base64 data for update:', error);
        // Fallback to storing as base64 if conversion fails
        inputImageUrl = req.body.inputImage;
      }
    }
    
    // Debug logging to track variable values
    console.log('🔍 DEBUG UPDATE - Final variable values before document update:');
    console.log('imageUrl:', imageUrl);
    console.log('inputImageUrl:', inputImageUrl);
    console.log('req.body.image type:', typeof req.body.image);
    console.log('req.body.inputImage type:', typeof req.body.inputImage);
    
    // Prepare the update data
    const updateData = {
      ...(title && { title }),
      ...(description && { description }),
      ...(link !== undefined && { link }),
      ...(imageUrl && { image: imageUrl }),
      ...(inputImageUrl !== undefined && { inputImage: inputImageUrl }),
      ...(keywords && { keywords }),
      ...(tags && { tags }),
      ...(category && { category }),
      ...(additionalHTML !== undefined && { additionalHTML }),
      ...(isFeatured !== undefined && { isFeatured: isFeatured === 'true' || isFeatured === true }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid
    };
    
    // Update the document
    await promptRef.update(updateData);
    
    // Get the updated document
    const updatedDoc = await promptRef.get();
    
    // Cache invalidation
    try {
      logger.info('🔄 Refreshing prompts cache due to prompt update...');
      await refreshPromptsCache();
      await deleteCacheByPattern('prompts:results:*');
      await deleteCache(generatePromptCacheKey(id));
      await deleteCache(generatePromptCategoryCacheKey(currentPromptData.category));
      if (currentPromptData.category !== category) {
        await deleteCache(generatePromptCategoryCacheKey(category));
      }
      logger.info(`✅ Cache invalidation completed for prompt update: ${id}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in updatePrompt:', cacheError);
    }
    
    return res.json({
      success: true,
      data: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error(`Error updating prompt ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Server error while updating prompt'
    });
  }
});

/**
 * @swagger
 * /api/prompts/{id}:
 *   delete:
 *     summary: Delete a prompt
 *     description: Delete an existing prompt from the system. This endpoint is only available to admin users.
 *     tags: [Prompts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier of the prompt to delete
 *         example: "prompt-123"
 *     responses:
 *       200:
 *         description: Prompt deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Prompt prompt-123 has been deleted"
 *       403:
 *         description: Access denied - Admin privileges required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Prompt not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   DELETE /api/prompts/:id
 * @desc    Delete a prompt
 * @access  Private (Admin only)
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    const id = req.params.id;
    
    // Check if the prompt exists
    const promptRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await promptRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    // Get prompt data before deletion (for cache invalidation)
    const promptData = doc.data();
    const deletedPromptCategory = promptData.category;
    
    // Delete the document
    await promptRef.delete();
    
    // Cache invalidation
    try {
      logger.info('🔄 Refreshing prompts cache due to prompt deletion...');
      await refreshPromptsCache();
      await deleteCacheByPattern('prompts:results:*');
      await deleteCache(generatePromptCacheKey(id));
      await deleteCache(generatePromptCategoryCacheKey(deletedPromptCategory));
      await deleteCache(generatePromptCountCacheKey());
      logger.info(`✅ Cache invalidation completed for prompt deletion: ${id}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in deletePrompt:', cacheError);
    }
    
    return res.json({
      success: true,
      message: `Prompt ${id} has been deleted`
    });
  } catch (error) {
    console.error(`Error deleting prompt ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Server error while deleting prompt'
    });
  }
});

/**
 * @swagger
 * /api/prompts/{id}/like:
 *   post:
 *     summary: Toggle like on a prompt
 *     description: Like or unlike a prompt. If the user has already liked the prompt, it will be unliked, and vice versa.
 *     tags: [Prompts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique identifier of the prompt to like/unlike
 *         example: "prompt-123"
 *     responses:
 *       200:
 *         description: Like status toggled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Prompt liked successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     promptId:
 *                       type: string
 *                       example: "prompt-123"
 *                     isLiked:
 *                       type: boolean
 *                       example: true
 *                     likeCount:
 *                       type: integer
 *                       example: 42
 *                     action:
 *                       type: string
 *                       enum: [liked, unliked]
 *                       example: "liked"
 *       400:
 *         description: Bad request - missing required parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Prompt not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @route   POST /api/prompts/:id/like
 * @desc    Toggle like on a prompt
 * @access  Private (Authenticated users)
 */
router.post('/:id/like', auth, async (req, res) => {
  try {
    const promptId = req.params.id;
    const userId = req.user.uid;
    
    if (!promptId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Prompt ID and user authentication required'
      });
    }
    
    const promptRef = admin.firestore().collection(COLLECTION_NAME).doc(promptId);
    
    // Use transaction to ensure data consistency
    const result = await admin.firestore().runTransaction(async (transaction) => {
      const promptDoc = await transaction.get(promptRef);
      
      if (!promptDoc.exists) {
        throw new Error('Prompt not found');
      }
      
      const promptData = promptDoc.data();
      const currentLikes = promptData.likes || [];
      const currentLikeCount = promptData.likeCount || 0;
      
      let newLikes;
      let newLikeCount;
      let action;
      
      if (currentLikes.includes(userId)) {
        // User already liked, remove like
        newLikes = currentLikes.filter(id => id !== userId);
        newLikeCount = Math.max(0, currentLikeCount - 1);
        action = 'unliked';
      } else {
        // User hasn't liked, add like
        newLikes = [...currentLikes, userId];
        newLikeCount = currentLikeCount + 1;
        action = 'liked';
      }
      
      transaction.update(promptRef, {
        likes: newLikes,
        likeCount: newLikeCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return { action, newLikeCount, isLiked: action === 'liked' };
    });
    
    // Cache invalidation
    try {
      await refreshPromptsCache();
      await deleteCache(generatePromptCacheKey(promptId));
      await deleteCacheByPattern('prompts:results:*');
      logger.info(`✅ Cache invalidated for prompt like: ${promptId}`);
    } catch (cacheError) {
      logger.error('❌ Error during cache invalidation in likePrompt:', cacheError);
    }
    
    return res.status(200).json({
      success: true,
      message: `Prompt ${result.action} successfully`,
      data: {
        promptId,
        isLiked: result.isLiked,
        likeCount: result.newLikeCount,
        action: result.action
      }
    });
    
  } catch (error) {
    logger.error(`Error toggling like for prompt ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to toggle like',
      details: error.message
    });
  }
});
/**
 * Initialize prompts cache on server startup
 */
const initializePromptsCache = async () => {
  logger.info('🚀 Initializing prompts cache on startup...');
  const success = await refreshPromptsCache();
  if (success) {
    logger.info('✅ Prompts cache initialization completed successfully');
  } else {
    logger.error('❌ Prompts cache initialization failed');
  }
  return success;
};

/**
 * @route   POST /api/prompts/:id/view
 * @desc    Increment prompt view count
 * @access  Public
 */
router.post('/:id/view', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    logger.info(`Incrementing view count for prompt: ${promptId}`);
    
    if (!promptId || typeof promptId !== 'string') {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid prompt ID format'
      });
    }
    
    const cleanPromptId = promptId.trim();
    const promptRef = admin.firestore().collection(COLLECTION_NAME).doc(cleanPromptId);
    
    // Use Firestore transaction to safely increment view count
    await admin.firestore().runTransaction(async (transaction) => {
      const promptDoc = await transaction.get(promptRef);
      
      if (!promptDoc.exists) {
        throw new Error('Prompt not found');
      }
      
      const currentData = promptDoc.data();
      const newViewCount = (currentData.viewCount || 0) + 1;
      
      transaction.update(promptRef, {
        viewCount: newViewCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    
    // Invalidate cache for this prompt
    try {
      const cacheKey = generatePromptCacheKey(cleanPromptId);
      await deleteCache(cacheKey);
      logger.info(`Cache invalidated for prompt ${cleanPromptId}`);
    } catch (cacheError) {
      logger.warn(`Failed to invalidate cache for prompt ${cleanPromptId}:`, cacheError);
    }
    
    logger.info(`Successfully incremented view count for prompt ${cleanPromptId}`);
    
    return res.status(200).json({
      success: true,
      message: 'View count incremented successfully'
    });
    
  } catch (error) {
    logger.error('Error incrementing prompt view count:', error);
    
    if (error.message === 'Prompt not found') {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to increment view count'
    });
  }
});

// Export the router and initialization function
module.exports = { 
  router, 
  initializePromptsCache,
  refreshPromptsCache
};
