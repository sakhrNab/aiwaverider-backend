const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const upload = require('../../middleware/upload');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');
const OpenAI = require('openai');
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
 * @route   GET /api/prompts
 * @desc    Get all prompts with search, filtering, and pagination
 * @access  Public
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
 * @route   POST /api/prompts
 * @desc    Create a new prompt
 * @access  Private (Admin only)
 */
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    console.log('Creating prompt with data:', req.body);
    
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    // Extract fields from request body
    const { title, description, link, keyword, category, additionalHTML, videoUrl } = req.body;
    
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
    
    // Extract video URL from iframe if videoUrl is empty but additionalHTML contains an iframe
    let extractedVideoUrl = videoUrl || '';
    if (!extractedVideoUrl && additionalHTML) {
      // Try to extract YouTube Shorts URL
      const shortsMatch = additionalHTML.match(/youtube\.com\/shorts\/([^"\/\s?]+)/i);
      if (shortsMatch && shortsMatch[1]) {
        extractedVideoUrl = `https://www.youtube.com/shorts/${shortsMatch[1]}`;
        console.log('Extracted YouTube Shorts URL:', extractedVideoUrl);
      } else {
        // Try to extract YouTube URL from iframe
        const youtubeMatch = additionalHTML.match(/youtube(?:-nocookie)?\.com\/embed\/([^"&\s?]+)/i);
        if (youtubeMatch && youtubeMatch[1]) {
          extractedVideoUrl = `https://www.youtube.com/watch?v=${youtubeMatch[1]}`;
          console.log('Extracted YouTube URL from iframe:', extractedVideoUrl);
        } else {
          // Try to extract YouTube URL from youtu.be
          const youtuBeMatch = additionalHTML.match(/youtu\.be\/([^"&\s?]+)/i);
          if (youtuBeMatch && youtuBeMatch[1]) {
            extractedVideoUrl = `https://www.youtube.com/watch?v=${youtuBeMatch[1]}`;
            console.log('Extracted YouTube URL from youtu.be:', extractedVideoUrl);
          } else {
            // Try to extract YouTube URL from watch format
            const watchMatch = additionalHTML.match(/youtube\.com\/watch\?v=([^"&\s?]+)/i);
            if (watchMatch && watchMatch[1]) {
              extractedVideoUrl = `https://www.youtube.com/watch?v=${watchMatch[1]}`;
              console.log('Extracted YouTube URL from watch format:', extractedVideoUrl);
            } else {
              // Try to extract Instagram URL
              const instagramMatch = additionalHTML.match(/instagram\.com\/(p|reel|tv)\/([^"\/\s?]+)/i);
              if (instagramMatch && instagramMatch[2]) {
                extractedVideoUrl = `https://www.instagram.com/${instagramMatch[1]}/${instagramMatch[2]}/`;
                console.log('Extracted Instagram URL from iframe:', extractedVideoUrl);
              }
            }
          }
        }
      }
    }
    
    console.log('Extracted fields:');
    console.log('Title:', title);
    console.log('Description:', description);
    console.log('Category:', category);
    console.log('Tags:', tags);
    console.log('Keywords:', keywords);
    console.log('Video URL:', extractedVideoUrl || videoUrl || '(empty)');
    console.log('Image file:', req.file);
    
    // Validate required fields
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: 'Title and description are required fields'
      });
    }
    
    // Ensure link has a default value if empty
    const safeLink = link || '';
    
    // Handle image upload (same logic as AI tools)
    let imageUrl = '';
    if (req.file) {
      console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          console.log('Using Firebase Storage bucket:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          console.log('Firebase Storage URL:', imageUrl);
        } else {
          console.log('Firebase Storage bucket not configured. Using local storage.');
          
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
          imageUrl = `/uploads/${filename}`;
          console.log('Local storage URL:', imageUrl);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        imageUrl = `/uploads/${filename}`;
        console.log('Local storage URL:', imageUrl);
      }
    }
    
    // Prepare the document
    const newPrompt = {
      title,
      description,
      link: safeLink,
      image: imageUrl || '',
      videoUrl: extractedVideoUrl || '', // YouTube or Instagram video URL (extracted from iframe if needed)
      keywords: keywords || [],
      tags: tags || [],
      category: category || '',
      additionalHTML: additionalHTML || '',
      jsonPrompt: '', // JSON prompt field (empty by default, generated on demand)
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
 * @route   PUT /api/prompts/:id
 * @desc    Update a prompt
 * @access  Private (Admin only)
 */
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    const id = req.params.id;
    const { title, description, link, keyword, category, additionalHTML, isFeatured, videoUrl } = req.body;
    
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
    
    // Handle image upload
    let imageUrl = undefined;
    if (req.file) {
      console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          const bucket = storage.bucket(bucketName);
          const fileName = `prompts/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
        } else {
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
          imageUrl = `/uploads/${filename}`;
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        imageUrl = `/uploads/${filename}`;
      }
    }
    
    // Prepare the update data
    const updateData = {
      ...(title && { title }),
      ...(description && { description }),
      ...(link !== undefined && { link }),
      ...(imageUrl && { image: imageUrl }),
      ...(videoUrl !== undefined && { videoUrl }),
      ...(keywords && { keywords }),
      ...(tags && { tags }),
      ...(category && { category }),
      ...(additionalHTML !== undefined && { additionalHTML }),
      ...(req.body.jsonPrompt !== undefined && { jsonPrompt: req.body.jsonPrompt }),
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
 * @route   POST /api/prompts/:id/generate-json
 * @desc    Generate JSON prompt from prompt content using OpenAI
 * @access  Public (can be called by anyone viewing the prompt)
 */
router.post('/:id/generate-json', async (req, res) => {
  const startTime = Date.now();
  const promptId = req.params.id;
  
  // Input validation
  if (!promptId || typeof promptId !== 'string' || promptId.length === 0) {
    logger.warn(`[JSON Generation] ❌ Invalid prompt ID received: ${promptId}`);
    return res.status(400).json({
      success: false,
      error: 'Invalid prompt ID'
    });
  }
  
  try {
    logger.info(`[JSON Generation] 📥 Request received for prompt ID: ${promptId}`);
    
    // Check if prompt exists
    const promptRef = admin.firestore().collection(COLLECTION_NAME).doc(promptId);
    logger.info(`[JSON Generation] 🔍 Checking if prompt exists: ${promptId}`);
    const promptDoc = await promptRef.get();
    
    if (!promptDoc.exists) {
      logger.warn(`[JSON Generation] ❌ Prompt not found: ${promptId}`);
      return res.status(404).json({
        success: false,
        error: 'Prompt not found'
      });
    }
    
    logger.info(`[JSON Generation] ✅ Prompt found: ${promptId}`);
    const promptData = promptDoc.data();
    logger.info(`[JSON Generation] 📋 Prompt title: "${promptData.title || 'N/A'}"`);
    
    // Check Redis cache first for JSON prompt
    const jsonCacheKey = `json-prompt:${promptId}`;
    const cachedJsonPrompt = await getCache(jsonCacheKey);
    
    if (cachedJsonPrompt) {
      logger.info(`[JSON Generation] 💾 JSON prompt found in Redis cache for ${promptId}`);
      return res.status(200).json({
        success: true,
        message: 'JSON prompt retrieved from cache',
        data: {
          jsonPrompt: cachedJsonPrompt,
          cached: true
        }
      });
    }
    
    // Check if jsonPrompt already exists in database
    if (promptData.jsonPrompt && promptData.jsonPrompt.trim() !== '') {
      logger.info(`[JSON Generation] 💾 JSON prompt already exists in database for ${promptId}`);
      logger.info(`[JSON Generation] 📊 JSON prompt length: ${promptData.jsonPrompt.length} characters`);
      
      // Cache it in Redis for future requests (72 hours TTL)
      try {
        await setCache(jsonCacheKey, promptData.jsonPrompt, 259200); // 72 hours = 72 * 60 * 60
        logger.info(`[JSON Generation] 💾 Cached JSON prompt in Redis for ${promptId} (72 hours TTL)`);
      } catch (cacheError) {
        logger.warn(`[JSON Generation] ⚠️ Failed to cache JSON prompt in Redis:`, cacheError);
      }
      
      return res.status(200).json({
        success: true,
        message: 'JSON prompt already exists',
        data: {
          jsonPrompt: promptData.jsonPrompt,
          cached: true
        }
      });
    }
    
    logger.info(`[JSON Generation] 🆕 No existing JSON prompt found, generating new one for ${promptId}`);
    
    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      logger.error(`[JSON Generation] ❌ OpenAI API key not found in environment variables`);
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured'
      });
    }
    
    logger.info(`[JSON Generation] 🔑 OpenAI API key found, initializing client`);
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Better HTML content extraction function
    const extractTextFromHTML = (html) => {
      if (!html) return '';
      // Preserve line breaks and structure
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    // Define JSON schema for validation
    const EXPECTED_SCHEMA = {
      prompt: 'string',
      style: 'string',
      lighting: 'string',
      camera_angle: 'string',
      quality: 'string',
      aspect_ratio: 'string'
    };
    
    // Define enum options for validation
    const STYLE_OPTIONS = ['photorealistic', 'cinematic', 'anime', 'oil painting', 'watercolor', '3D render', 'sketch', 'digital art', 'illustration', 'concept art'];
    const LIGHTING_OPTIONS = ['soft natural light', 'dramatic shadows', 'golden hour', 'studio lighting', 'neon', 'backlit', 'low-key', 'high-key', 'natural daylight', 'sunset', 'sunrise'];
    const CAMERA_ANGLES = ['wide shot', 'close-up', "bird's eye view", 'low angle', 'eye level', 'dutch angle', 'over-the-shoulder', 'medium shot', 'extreme close-up'];
    const QUALITY_OPTIONS = ['high quality', 'ultra detailed', '8k', '4k', 'photographic', 'high detail', 'sharp focus', 'professional'];
    const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
    
    // Constants
    const MAX_PROMPT_LENGTH = 1000;
    const MAX_RETRIES = 3;
    
    // Extract relevant fields for JSON prompt generation
    const promptContent = {
      title: promptData.title || '',
      description: promptData.description || '',
      usageInstructions: promptData.usageInstructions || '',
      additionalHTML: promptData.additionalHTML || ''
    };
    
    logger.info(`[JSON Generation] 📝 Extracted prompt content:`);
    logger.info(`[JSON Generation]   - Title: ${promptContent.title ? 'Present' : 'Missing'} (${promptContent.title?.length || 0} chars)`);
    logger.info(`[JSON Generation]   - Description: ${promptContent.description ? 'Present' : 'Missing'} (${promptContent.description?.length || 0} chars)`);
    logger.info(`[JSON Generation]   - Usage Instructions: ${promptContent.usageInstructions ? 'Present' : 'Missing'} (${promptContent.usageInstructions?.length || 0} chars)`);
    logger.info(`[JSON Generation]   - Additional HTML: ${promptContent.additionalHTML ? 'Present' : 'Missing'} (${promptContent.additionalHTML?.length || 0} chars)`);
    
    // Create a clean text version of the prompt content with better HTML extraction
    const promptText = `
Title: ${promptContent.title}
Description: ${promptContent.description}
Usage Instructions: ${promptContent.usageInstructions}
${promptContent.additionalHTML ? `Additional Content: ${extractTextFromHTML(promptContent.additionalHTML)}` : ''}
`.trim();
    
    logger.info(`[JSON Generation] 📄 Prepared prompt text for OpenAI (${promptText.length} characters)`);
    logger.info(`[JSON Generation] 📋 Prompt text preview (first 200 chars): ${promptText.substring(0, 200)}...`);
    
    // Create improved system message with examples and clear structure
    const systemMessage = {
      role: "system",
      content: `You are an expert at converting image generation prompts into structured JSON format.

Extract the following fields:
- prompt: The main descriptive text for image generation (required) - combine title, description, usage instructions, and additional content into a coherent, detailed prompt
- style: Visual style from options: ${STYLE_OPTIONS.join(', ')} (default: "photorealistic")
- lighting: Lighting setup from options: ${LIGHTING_OPTIONS.join(', ')} (default: "soft natural light")
- camera_angle: Camera perspective from options: ${CAMERA_ANGLES.join(', ')} (default: "eye level")
- quality: Quality descriptors from options: ${QUALITY_OPTIONS.join(', ')} or combination thereof (default: "high quality")
- aspect_ratio: Format from options: ${ASPECT_RATIOS.join(', ')} (default: "16:9")

RULES:
1. Extract explicit information from the prompt first
2. Infer style from descriptive words (e.g., "realistic photo" → "photorealistic", "animated" → "anime")
3. If a field is not mentioned and cannot be reasonably inferred, use the specified default
4. Keep the main prompt descriptive and detailed - combine all provided information (title, description, usage instructions, additional content)
5. Return ONLY valid JSON with all 6 fields

EXAMPLE INPUT:
Title: Cyberpunk Street Scene
Description: A neon-lit alley in a futuristic city with rain-slicked streets
Usage Instructions: Create a wide-angle shot with dramatic lighting
Additional Content: Include holographic advertisements, cybernetic characters, high detail

EXAMPLE OUTPUT:
{
  "prompt": "A neon-lit alley in a futuristic cyberpunk city with rain-slicked streets, holographic advertisements flickering on building walls, cybernetic characters walking through the scene, high detail, atmospheric fog",
  "style": "cinematic",
  "lighting": "neon",
  "camera_angle": "wide shot",
  "quality": "high detail, 8k",
  "aspect_ratio": "16:9"
}`
    };
    
    const userMessage = {
      role: "user",
      content: `Convert this prompt into JSON format:\n\n${promptText}`
    };
    
    logger.info(`[JSON Generation] 📤 Sending to OpenAI:`);
    logger.info(`[JSON Generation]   - System message: ${systemMessage.content.length} characters`);
    logger.info(`[JSON Generation]   - User message: ${userMessage.content.length} characters`);
    
    logger.info(`[JSON Generation] 🤖 Calling OpenAI API (gpt-4o-mini) for prompt ${promptId}`);
    logger.info(`[JSON Generation] 📤 Request parameters: max_tokens=800, temperature=0.1, response_format=json_object`);
    
    // OpenAI API call with retry logic
    let completion;
    let attempt = 0;
    const openaiStartTime = Date.now();
    
    while (attempt < MAX_RETRIES) {
      try {
        logger.info(`[JSON Generation] 🔄 OpenAI API attempt ${attempt + 1}/${MAX_RETRIES}`);
        
        completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [systemMessage, userMessage],
          response_format: { type: "json_object" }, // Force JSON output
          max_tokens: 800, // Increased for complex prompts
          temperature: 0.1 // Lower for more deterministic output
        });
        
        break; // Success, exit retry loop
      } catch (error) {
        attempt++;
        
        // Determine if error is retriable
        const isRetriableError = 
          error.status === 429 || // Rate limit
          error.status >= 500 || // Server errors
          error.code === 'ECONNRESET' || // Connection reset
          error.code === 'ETIMEDOUT' || // Timeout
          error.code === 'ENOTFOUND' || // DNS resolution failed
          error.message?.includes('network') || // Network-related errors
          error.message?.includes('timeout'); // Timeout errors
        
        if (isRetriableError && attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          const errorType = error.status ? `HTTP ${error.status}` : (error.code || 'network error');
          logger.warn(`[JSON Generation] ⚠️ Retriable error (${errorType}), retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Re-throw if not retriable error or max retries reached
          throw error;
        }
      }
    }
    
    const openaiDuration = Date.now() - openaiStartTime;
    logger.info(`[JSON Generation] ✅ OpenAI API call completed in ${openaiDuration}ms (after ${attempt + 1} attempt(s))`);
    logger.info(`[JSON Generation] 📊 OpenAI response: ${completion.choices[0].message.content.length} characters`);
    logger.info(`[JSON Generation] 📊 OpenAI usage: ${completion.usage?.prompt_tokens || 'N/A'} prompt tokens, ${completion.usage?.completion_tokens || 'N/A'} completion tokens`);
    
    const generatedContent = completion.choices[0].message.content.trim();
    
    // Try to parse and validate the JSON
    let jsonPrompt;
    try {
      logger.info(`[JSON Generation] 🔧 Attempting to parse OpenAI response as JSON`);
      
      // Remove markdown code blocks if present
      const cleanedContent = generatedContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      logger.info(`[JSON Generation] 🧹 Cleaned content length: ${cleanedContent.length} characters`);
      
      jsonPrompt = JSON.parse(cleanedContent);
      logger.info(`[JSON Generation] ✅ JSON parsing successful`);
      
      // Validate it's an object
      if (typeof jsonPrompt !== 'object' || Array.isArray(jsonPrompt)) {
        throw new Error('Generated JSON is not an object');
      }
      
      logger.info(`[JSON Generation] ✅ JSON validation passed (is object: ${typeof jsonPrompt === 'object' && !Array.isArray(jsonPrompt)})`);
      logger.info(`[JSON Generation] 📋 JSON keys: ${Object.keys(jsonPrompt).join(', ')}`);
      
      // Validate structure - check for required fields
      const requiredFields = Object.keys(EXPECTED_SCHEMA);
      const missingFields = requiredFields.filter(field => !(field in jsonPrompt));
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }
      
      logger.info(`[JSON Generation] ✅ All required fields present`);
      
      // Type validation
      for (const [field, expectedType] of Object.entries(EXPECTED_SCHEMA)) {
        if (typeof jsonPrompt[field] !== expectedType) {
          throw new Error(`Field '${field}' should be ${expectedType}, got ${typeof jsonPrompt[field]}`);
        }
      }
      
      logger.info(`[JSON Generation] ✅ All field types validated`);
      
      // Optional: Validate enum values (warn but don't fail)
      if (jsonPrompt.style && !STYLE_OPTIONS.includes(jsonPrompt.style)) {
        logger.warn(`[JSON Generation] ⚠️ Unexpected style value: "${jsonPrompt.style}" (not in predefined options)`);
      }
      if (jsonPrompt.lighting && !LIGHTING_OPTIONS.includes(jsonPrompt.lighting)) {
        logger.warn(`[JSON Generation] ⚠️ Unexpected lighting value: "${jsonPrompt.lighting}" (not in predefined options)`);
      }
      if (jsonPrompt.camera_angle && !CAMERA_ANGLES.includes(jsonPrompt.camera_angle)) {
        logger.warn(`[JSON Generation] ⚠️ Unexpected camera_angle value: "${jsonPrompt.camera_angle}" (not in predefined options)`);
      }
      if (jsonPrompt.aspect_ratio && !ASPECT_RATIOS.includes(jsonPrompt.aspect_ratio)) {
        logger.warn(`[JSON Generation] ⚠️ Unexpected aspect_ratio value: "${jsonPrompt.aspect_ratio}" (not in predefined options)`);
      }
      
      // Sanitize JSON - only keep expected fields
      const sanitizedJson = {
        prompt: jsonPrompt.prompt || '',
        style: jsonPrompt.style || 'photorealistic',
        lighting: jsonPrompt.lighting || 'soft natural light',
        camera_angle: jsonPrompt.camera_angle || 'eye level',
        quality: jsonPrompt.quality || 'high quality',
        aspect_ratio: jsonPrompt.aspect_ratio || '16:9'
      };
      
      // Validate and truncate prompt length if needed
      if (sanitizedJson.prompt.length > MAX_PROMPT_LENGTH) {
        logger.warn(`[JSON Generation] ⚠️ Prompt too long (${sanitizedJson.prompt.length} chars), truncating to ${MAX_PROMPT_LENGTH}`);
        sanitizedJson.prompt = sanitizedJson.prompt.substring(0, MAX_PROMPT_LENGTH).trim() + '...';
      }
      
      // Convert back to string for storage
      const jsonPromptString = JSON.stringify(sanitizedJson, null, 2);
      logger.info(`[JSON Generation] 💾 Prepared JSON string for storage (${jsonPromptString.length} characters)`);
      logger.info(`[JSON Generation] ✅ Successfully generated and validated JSON prompt`);
      
      // Use sanitized JSON for further processing
      jsonPrompt = sanitizedJson;
      
      // Save to database
      logger.info(`[JSON Generation] 💾 Saving JSON prompt to Firestore for ${promptId}`);
      const dbStartTime = Date.now();
      
      await promptRef.update({
        jsonPrompt: jsonPromptString,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      const dbDuration = Date.now() - dbStartTime;
      logger.info(`[JSON Generation] ✅ JSON prompt saved to Firestore in ${dbDuration}ms`);
      
      // Cache the generated JSON prompt in Redis (72 hours TTL)
      const jsonCacheKey = `json-prompt:${promptId}`;
      try {
        await setCache(jsonCacheKey, jsonPromptString, 259200); // 72 hours = 72 * 60 * 60
        logger.info(`[JSON Generation] 💾 Cached generated JSON prompt in Redis for ${promptId} (72 hours TTL)`);
      } catch (cacheError) {
        logger.warn(`[JSON Generation] ⚠️ Failed to cache JSON prompt in Redis:`, cacheError);
      }
      
      // Cache invalidation
      try {
        logger.info(`[JSON Generation] 🔄 Starting cache invalidation`);
        const cacheStartTime = Date.now();
        
        await refreshPromptsCache();
        await deleteCache(generatePromptCacheKey(promptId));
        await deleteCacheByPattern('prompts:results:*');
        
        const cacheDuration = Date.now() - cacheStartTime;
        logger.info(`[JSON Generation] ✅ Cache invalidated in ${cacheDuration}ms`);
      } catch (cacheError) {
        logger.error(`[JSON Generation] ❌ Error during cache invalidation:`, cacheError);
      }
      
      const totalDuration = Date.now() - startTime;
      logger.info(`[JSON Generation] ✅ Successfully generated and saved JSON prompt for ${promptId} (total time: ${totalDuration}ms)`);
      
      return res.status(200).json({
        success: true,
        message: 'JSON prompt generated successfully',
        data: {
          jsonPrompt: jsonPromptString,
          cached: false
        }
      });
      
    } catch (parseError) {
      logger.error(`[JSON Generation] ❌ Error parsing or validating OpenAI response for prompt ${promptId}:`, parseError.message);
      logger.error(`[JSON Generation] 📄 Generated content (first 500 chars): ${generatedContent.substring(0, 500)}`);
      logger.error(`[JSON Generation] 📚 Parse error details:`, parseError);
      logger.warn(`[JSON Generation] 🔄 Using fallback JSON structure`);
      
      // Improved fallback: Try to salvage partial information from jsonPrompt if it exists
      const fallbackPrompt = [
        promptContent.title,
        promptContent.description,
        extractTextFromHTML(promptContent.additionalHTML)
      ].filter(Boolean).join(', ').trim() || 'Image generation prompt';
      
      // Truncate if too long
      const finalPrompt = fallbackPrompt.length > MAX_PROMPT_LENGTH 
        ? fallbackPrompt.substring(0, MAX_PROMPT_LENGTH).trim() + '...'
        : fallbackPrompt;
      
      // Fallback: Create a JSON structure with all required fields, salvaging what we can
      const fallbackJson = {
        prompt: finalPrompt,
        style: jsonPrompt?.style || 'photorealistic',
        lighting: jsonPrompt?.lighting || 'soft natural light',
        camera_angle: jsonPrompt?.camera_angle || 'eye level',
        quality: jsonPrompt?.quality || 'high quality',
        aspect_ratio: jsonPrompt?.aspect_ratio || '16:9'
      };
      
      const fallbackJsonString = JSON.stringify(fallbackJson, null, 2);
      logger.info(`[JSON Generation] 📋 Fallback JSON created: ${fallbackJsonString.length} characters`);
      
      // Save fallback to database
      logger.info(`[JSON Generation] 💾 Saving fallback JSON to Firestore`);
      await promptRef.update({
        jsonPrompt: fallbackJsonString,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      logger.info(`[JSON Generation] ✅ Fallback JSON saved to Firestore`);
      
      const totalDuration = Date.now() - startTime;
      logger.warn(`[JSON Generation] ⚠️ JSON generation completed with fallback for ${promptId} (total time: ${totalDuration}ms)`);
      
      return res.status(200).json({
        success: true,
        message: 'JSON prompt generated successfully (with adjustments)',
        data: {
          jsonPrompt: fallbackJsonString,
          cached: false,
          warning: 'Some fields used default values due to incomplete generation'
        }
      });
    }
    
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    logger.error(`[JSON Generation] ❌ Error generating JSON prompt for ${promptId} (duration: ${totalDuration}ms):`, error);
    
    // Handle OpenAI API errors
    if (error.response) {
      logger.error(`[JSON Generation] ❌ OpenAI API error response:`, {
        status: error.response.status,
        statusText: error.response.statusText,
        error: error.response.data?.error || error.response.data
      });
      
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.error?.message || 'OpenAI API error',
        details: error.response.data
      });
    }
    
    logger.error(`[JSON Generation] ❌ Unexpected error: ${error.message}`);
    logger.error(`[JSON Generation] 📚 Error stack:`, error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to generate JSON prompt',
      details: error.message
    });
  }
});

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

// Export the router and initialization function
module.exports = { 
  router, 
  initializePromptsCache,
  refreshPromptsCache
};