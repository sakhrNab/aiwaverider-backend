// backend/utils/cache.js - UPDATED WITH PROMPT SUPPORT
const Redis = require('ioredis');
const logger = require('./logger'); // Assuming you have a logger

// Redis client configuration
let redis;
if (process.env.REDIS_URL) {
  // Use connection URL for Upstash Redis or cloud Redis
  redis = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    lazyConnect: true
  });
} else {
  // Fallback to traditional configuration for local development
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    lazyConnect: true
  });
}

// Default TTL configurations
const TTL = {
  SHORT: 300,        // 5 minutes - for search results
  MEDIUM: 1800,      // 30 minutes - for computed data
  LONG: 86400,       // 24 hours - for stable data
  VERY_LONG: 604800  // 7 days - for rarely changing data
};

// Optimized TTL configurations for agents (cost optimization)
const AGENT_TTL = {
  LISTINGS: TTL.LONG,           // 24 hours - agent listings
  DETAILS: TTL.VERY_LONG,       // 7 days - individual agent details
  SEARCH: 3600,                 // 1 hour - search results (unique)
  COUNTS: TTL.LONG,             // 24 hours - category counts
  FEATURED: 3600,               // 1 hour - featured agents (unique)
  ADMIN: TTL.SHORT,             // 5 minutes - admin-specific data
  CATEGORY: TTL.LONG,           // 24 hours - category listings
  RECOMMENDATIONS: 3600         // 1 hour - recommendations (unique)
};

// Optimized TTL configurations for videos (cost optimization)
const VIDEO_TTL = {
  LISTINGS: TTL.LONG,           // 24 hours - video listings
  METADATA: TTL.VERY_LONG,      // 7 days - video metadata (views, likes)
  SEARCH: 3600,                 // 1 hour - search results
  ADMIN: TTL.SHORT,             // 5 minutes - admin-specific data
  INSTAGRAM: TTL.LONG * 4       // 20 minutes - Instagram (longer due to API limits)
};

// NEW: Optimized TTL configurations for prompts
const PROMPT_TTL = {
  LISTINGS: TTL.LONG,           // 24 hours - prompt listings
  DETAILS: TTL.VERY_LONG,       // 7 days - individual prompt details
  SEARCH: 3600,                 // 1 hour - search results
  COUNTS: TTL.LONG,             // 24 hours - category counts
  FEATURED: 3600,               // 1 hour - featured prompts
  ADMIN: TTL.SHORT,             // 5 minutes - admin-specific data
  CATEGORY: TTL.LONG,           // 24 hours - category listings
  LIKES: TTL.MEDIUM,            // 30 minutes - like data (more dynamic)
  USER_LIKES: TTL.MEDIUM        // 30 minutes - user's liked prompts
};

/**
 * Generates a cache key for paginated post listings
 * @param {Object} params - Parameters for generating the cache key
 * @param {string} params.category - Post category (default: 'All')
 * @param {number} params.limit - Number of posts per page
 * @param {string} params.startAfter - Cursor for pagination
 * @returns {string} Cache key
 */
const generatePostsCacheKey = ({ category, limit, startAfter }) => {
  return `posts:${category || 'All'}:${limit}:${startAfter || 'start'}`;
};

/**
 * Generates a cache key for a single post
 * @param {string} postId - The post's unique identifier
 * @returns {string} Cache key
 */
const generatePostCacheKey = (postId) => {
  return `post:${postId}`;
};

/**
 * Generates a cache key for a post's comments
 * @param {string} postId - The post's unique identifier
 * @returns {string} Cache key
 */
const generateCommentsCacheKey = (postId) => {
  return `comments:${postId}`;
};
/**
 * Enhanced cache key generation with consistent naming
 */
const generateCacheKey = (prefix, params = {}) => {
  const keyParts = [prefix];
  
  // Sort parameters for consistent cache keys
  const sortedParams = Object.keys(params)
    .sort()
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map(key => `${key}:${params[key]}`);
  
  if (sortedParams.length > 0) {
    keyParts.push(...sortedParams);
  }
  
  return keyParts.join(':');
};

// ==========================================
// AGENT CACHE KEY GENERATORS (EXISTING)
// ==========================================

/**
 * Generate cache key for agent count
 */
const generateAgentCountCacheKey = (category = null) => {
  if (category && category !== 'All') {
    return `agents:count:category:${category}`;
  }
  return 'agents:count:total';
};

/**
 * Generate cache key for agent category
 */
const generateAgentCategoryCacheKey = (category) => {
  if (!category || category === 'All') {
    return 'agents:category:all';
  }
  return `agents:category:${category}`;
};

/**
 * Generate cache key for search results
 */
const generateAgentSearchCacheKey = (searchQuery, filters = {}) => {
  const parts = ['agents:search'];
  
  if (searchQuery) {
    parts.push(`q:${searchQuery}`);
  }
  
  // Add filter parameters
  if (filters.category && filters.category !== 'All') {
    parts.push(`cat:${filters.category}`);
  }
  if (filters.priceMin) parts.push(`pmin:${filters.priceMin}`);
  if (filters.priceMax) parts.push(`pmax:${filters.priceMax}`);
  if (filters.rating) parts.push(`rating:${filters.rating}`);
  if (filters.tags) parts.push(`tags:${filters.tags}`);
  if (filters.features) parts.push(`features:${filters.features}`);
  
  return parts.join(':');
};

/**
 * Generate cache key for individual agent
 */
const generateAgentCacheKey = (agentId) => {
  return `agent:${agentId}`;
};

// ==========================================
// NEW: PROMPT CACHE KEY GENERATORS
// ==========================================

/**
 * Generate cache key for prompt count
 * @param {string} category - Optional category filter
 * @returns {string} Cache key
 */
const generatePromptCountCacheKey = (category = null) => {
  if (category && category !== 'All') {
    return `prompts:count:category:${category}`;
  }
  return 'prompts:count:total';
};

/**
 * Generate cache key for prompt category
 * @param {string} category - Prompt category
 * @returns {string} Cache key
 */
const generatePromptCategoryCacheKey = (category) => {
  if (!category || category === 'All') {
    return 'prompts:category:all';
  }
  return `prompts:category:${category}`;
};

/**
 * Generate cache key for prompt search results
 * @param {string} searchQuery - Search query
 * @param {Object} filters - Filter parameters
 * @returns {string} Cache key
 */
const generatePromptSearchCacheKey = (searchQuery, filters = {}) => {
  const parts = ['prompts:search'];
  
  if (searchQuery) {
    parts.push(`q:${searchQuery}`);
  }
  
  // Add filter parameters
  if (filters.category && filters.category !== 'All') {
    parts.push(`cat:${filters.category}`);
  }
  if (filters.tags) {
    const tagsString = Array.isArray(filters.tags) ? filters.tags.join(',') : filters.tags;
    parts.push(`tags:${tagsString}`);
  }
  if (filters.featured) parts.push(`featured:${filters.featured}`);
  if (filters.createdBy) parts.push(`creator:${filters.createdBy}`);
  
  return parts.join(':');
};

/**
 * Generate cache key for individual prompt
 * @param {string} promptId - Prompt ID
 * @returns {string} Cache key
 */
const generatePromptCacheKey = (promptId) => {
  return `prompt:${promptId}`;
};

/**
 * Generate cache key for user's liked prompts
 * @param {string} userId - User ID
 * @returns {string} Cache key
 */
const generateUserLikedPromptsCacheKey = (userId) => {
  return `prompts:user:${userId}:liked`;
};

/**
 * Generate cache key for featured prompts
 * @param {number} limit - Number of featured prompts
 * @returns {string} Cache key
 */
const generateFeaturedPromptsCacheKey = (limit = 10) => {
  return `prompts:featured:${limit}`;
};

/**
 * Generate cache key for prompt categories with counts
 * @returns {string} Cache key
 */
const generatePromptCategoriesCountCacheKey = () => {
  return 'prompts:categories:counts';
};

/**
 * Get optimized TTL based on cache key type
 * @param {string} key - Cache key
 * @returns {number} TTL in seconds
 */
const getOptimizedTTL = (key) => {
  // Prompt-specific TTLs (NEW)
  if (key.startsWith('prompts:category:')) {
    return PROMPT_TTL.CATEGORY; // 24 hours
  }
  if (key.startsWith('prompts:search:')) {
    return PROMPT_TTL.SEARCH; // 1 hour
  }
  if (key.startsWith('prompts:count:')) {
    return PROMPT_TTL.COUNTS; // 24 hours
  }
  if (key.startsWith('prompts:featured:')) {
    return PROMPT_TTL.FEATURED; // 1 hour
  }
  if (key.startsWith('prompts:user:') && key.includes(':liked')) {
    return PROMPT_TTL.USER_LIKES; // 30 minutes
  }
  if (key.startsWith('prompts:categories:counts')) {
    return PROMPT_TTL.CATEGORY; // 24 hours
  }
  if (key.startsWith('prompt:')) {
    return PROMPT_TTL.DETAILS; // 7 days
  }
  if (key.startsWith('prompts:admin:')) {
    return PROMPT_TTL.ADMIN; // 5 minutes (admin data)
  }
  if (key.startsWith('prompts:results:')) {
    return PROMPT_TTL.SEARCH; // 1 hour (search results)
  }
  if (key.startsWith('prompts:') && !key.includes(':')) {
    return PROMPT_TTL.LISTINGS; // 24 hours (general prompt listings)
  }

  // Agent-specific TTLs (EXISTING)
  if (key.startsWith('agents:category:')) {
    return AGENT_TTL.CATEGORY; // 24 hours
  }
  if (key.startsWith('agents:search:')) {
    return AGENT_TTL.SEARCH; // 1 hour
  }
  if (key.startsWith('agents:count:')) {
    return AGENT_TTL.COUNTS; // 24 hours
  }
  if (key.startsWith('agents:featured:')) {
    return AGENT_TTL.FEATURED; // 1 hour
  }
  if (key.startsWith('agents:recommendations:')) {
    return AGENT_TTL.RECOMMENDATIONS; // 1 hour
  }
  if (key.startsWith('agent:')) {
    return AGENT_TTL.DETAILS; // 7 days
  }
  if (key.startsWith('agents:admin:')) {
    return AGENT_TTL.ADMIN; // 5 minutes (admin data)
  }
  if (key.startsWith('agents:results:')) {
    return AGENT_TTL.SEARCH; // 1 hour (search results)
  }
  if (key.startsWith('agents:') && !key.includes(':')) {
    return AGENT_TTL.LISTINGS; // 24 hours (general agent listings)
  }
  
  // Video-specific TTLs (EXISTING)
  if (key.startsWith('video_list:')) {
    return VIDEO_TTL.LISTINGS; // 24 hours
  }
  if (key.startsWith('video_meta:')) {
    if (key.includes(':instagram:')) {
      return VIDEO_TTL.INSTAGRAM; // 20 minutes (Instagram API limits)
    }
    return VIDEO_TTL.METADATA; // 7 days (YouTube/TikTok metadata)
  }
  if (key.startsWith('video_search:')) {
    return VIDEO_TTL.SEARCH; // 1 hour
  }
  if (key.startsWith('video_admin:')) {
    return VIDEO_TTL.ADMIN; // 5 minutes (admin data)
  }
  
  // Default to original TTL for non-agent/video/prompt data
  return TTL.SHORT;
};

/**
 * Get TTL type description for logging
 * @param {number} ttl - TTL in seconds
 * @returns {string} TTL type description
 */
const getTTLType = (ttl) => {
  // Prompt-specific TTLs (NEW)
  if (ttl === PROMPT_TTL.SEARCH || ttl === PROMPT_TTL.FEATURED) return '1-HOUR';
  if (ttl === PROMPT_TTL.LIKES || ttl === PROMPT_TTL.USER_LIKES) return '30-MINUTES';
  
  // Agent-specific TTLs (EXISTING)
  if (ttl === AGENT_TTL.SEARCH || ttl === AGENT_TTL.FEATURED || ttl === AGENT_TTL.RECOMMENDATIONS) return '1-HOUR';
  
  // Video-specific TTLs (EXISTING)
  if (ttl === VIDEO_TTL.SEARCH) return '1-HOUR';
  if (ttl === VIDEO_TTL.INSTAGRAM) return '20-MINUTES';
  
  // General TTLs (including agent/video/prompt TTLs that reference them)
  if (ttl === TTL.SHORT) return '5-MINUTES';
  if (ttl === TTL.MEDIUM) return '30-MINUTES';
  if (ttl === TTL.LONG) return '24-HOURS';
  if (ttl === TTL.VERY_LONG) return '7-DAYS';
  
  return `${ttl}s`;
};

/**
 * Retrieves data from Redis cache with error handling
 * @param {string} key - Cache key
 * @returns {Promise<any>} Cached data or null if not found
 */
const getCache = async (key) => {
  try {
    const start = Date.now();
    const data = await redis.get(key);
    const duration = Date.now() - start;
    
    if (data) {
      logger.info(`📥 Cache HIT: ${key} (${duration}ms)`);
      return JSON.parse(data);
    } else {
      logger.info(`📭 Cache MISS: ${key} (${duration}ms)`);
      return null;
    }
  } catch (error) {
    logger.error(`❌ Cache GET error for key ${key}:`, error);
    return null; // Graceful degradation
  }
};

/**
 * Stores data in Redis cache with optimized TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in seconds (optional, auto-detected for agents/prompts)
 * @returns {Promise<boolean>} Success status
 */
const setCache = async (key, data, ttl = null) => {
  try {
    const start = Date.now();
    const serializedData = JSON.stringify(data);
    
    // Use optimized TTL if not specified
    const finalTTL = ttl || getOptimizedTTL(key);
    
    // Log size for monitoring
    const sizeKB = Math.round(serializedData.length / 1024);
    
    await redis.set(key, serializedData, 'EX', finalTTL);
    const duration = Date.now() - start;
    
    // Enhanced logging with TTL type
    const ttlType = getTTLType(finalTTL);
    logger.info(`📤 Cache SET: ${key} (${sizeKB}KB, TTL:${finalTTL}s [${ttlType}], ${duration}ms)`);
    return true;
  } catch (error) {
    logger.error(`❌ Cache SET error for key ${key}:`, error);
    return false;
  }
};

/**
 * Deletes a specific cache entry
 * @param {string} key - Cache key to delete
 * @returns {Promise<boolean>} Success status
 */
const deleteCache = async (key) => {
  try {
    const result = await redis.del(key);
    logger.info(`🗑️ Cache DELETE: ${key} (deleted: ${result})`);
    return result > 0;
  } catch (error) {
    logger.error(`❌ Cache DELETE error for key ${key}:`, error);
    return false;
  }
};

/**
 * Deletes multiple cache entries matching a pattern
 * @param {string} pattern - Pattern to match cache keys (use with caution)
 * @returns {Promise<number>} Number of keys deleted
 */
const deleteCacheByPattern = async (pattern) => {
  try {
    const start = Date.now();
    const keys = await redis.keys(pattern);
    
    if (keys.length === 0) {
      logger.info(`🔍 Cache PATTERN DELETE: No keys found for pattern ${pattern}`);
      return 0;
    }
    
    const result = await redis.del(keys);
    const duration = Date.now() - start;
    
    logger.info(`🧹 Cache PATTERN DELETE: ${pattern} - deleted ${result} keys in ${duration}ms`);
    return result;
  } catch (error) {
    logger.error(`❌ Cache PATTERN DELETE error for pattern ${pattern}:`, error);
    return 0;
  }
};

/**
 * Gets cache statistics and info
 * @returns {Promise<Object>} Cache statistics
 */
const getCacheInfo = async () => {
  try {
    const info = await redis.info('memory');
    const keyspace = await redis.info('keyspace');
    
    return {
      memory: info,
      keyspace: keyspace,
      connected: redis.status === 'ready'
    };
  } catch (error) {
    logger.error('❌ Error getting cache info:', error);
    return { connected: false, error: error.message };
  }
};

/**
 * Check if Redis is connected and healthy
 * @returns {Promise<boolean>} Connection status
 */
const isRedisHealthy = async () => {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    logger.error('❌ Redis health check failed:', error);
    return false;
  }
};

/**
 * Health check ping to keep Redis connection alive
 * Runs every 2 minutes to prevent connection timeouts
 */
let healthCheckInterval = null;

const startHealthCheck = () => {
  // Clear any existing interval
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  // Start health check every 2 minutes (120000ms)
  healthCheckInterval = setInterval(async () => {
    try {
      await redis.ping();
      logger.info('💓 Redis health check passed');
    } catch (error) {
      logger.warn('⚠️ Redis health check failed, attempting reconnection...');
      try {
        await redis.connect();
        logger.info('✅ Redis reconnected successfully');
      } catch (reconnectError) {
        logger.error('❌ Redis reconnection failed:', reconnectError);
      }
    }
  }, 120000); // 2 minutes
  
  logger.info('🔄 Redis health check started (every 2 minutes)');
};

const stopHealthCheck = () => {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    logger.info('🛑 Redis health check stopped');
  }
};

/**
 * Increment a counter in Redis (useful for rate limiting, stats)
 * @param {string} key - Counter key
 * @param {number} ttl - TTL for the counter
 * @returns {Promise<number>} New counter value
 */
const incrementCounter = async (key, ttl = TTL.MEDIUM) => {
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttl);
    const results = await pipeline.exec();
    
    return results[0][1]; // Return the incremented value
  } catch (error) {
    logger.error(`❌ Counter increment error for key ${key}:`, error);
    return 0;
  }
};

/**
 * Cache with automatic refresh capability and optimized TTL
 * @param {string} key - Cache key
 * @param {Function} fetchFunction - Function to fetch fresh data
 * @param {number} ttl - TTL in seconds (optional, auto-detected for agents/prompts)
 * @returns {Promise<any>} Cached or fresh data
 */
const cacheWithRefresh = async (key, fetchFunction, ttl = null) => {
  try {
    // Try to get from cache first
    let data = await getCache(key);
    
    if (data !== null) {
      return data;
    }
    
    // Cache miss - fetch fresh data
    logger.info(`🔄 Cache refresh triggered for key: ${key}`);
    data = await fetchFunction();
    
    if (data !== null && data !== undefined) {
      await setCache(key, data, ttl);
    }
    
    return data;
  } catch (error) {
    logger.error(`❌ Cache with refresh error for key ${key}:`, error);
    throw error;
  }
};

// Error handling for Redis connection
redis.on('error', (error) => {
  logger.error('❌ Redis connection error:', error);
});

redis.on('connect', () => {
  logger.info('🔌 Connected to Redis successfully');
  
  // If Redis is already ready, start health check immediately
  if (redis.status === 'ready') {
    startHealthCheck();
  }
});

redis.on('ready', () => {
  logger.info('✅ Redis is ready for operations');
  
  // Start health check ping to keep connection alive
  startHealthCheck();
});

redis.on('close', () => {
  logger.warn('⚠️ Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.info('🔄 Reconnecting to Redis...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🛑 Gracefully closing Redis connection...');
  stopHealthCheck();
  await redis.quit();
  process.exit(0);
});

module.exports = {
  // Core cache operations
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
  
  // Utility functions
  generateCacheKey,
  getCacheInfo,
  isRedisHealthy,
  incrementCounter,
  cacheWithRefresh,
  
  // Health check functions
  startHealthCheck,
  stopHealthCheck,
  
  // TTL optimization functions
  getOptimizedTTL,
  getTTLType,
  
  // Agent cache key generators (EXISTING)
  generateAgentCountCacheKey,
  generateAgentCategoryCacheKey,
  generateAgentSearchCacheKey,
  generateAgentCacheKey,
  
  // Prompt cache key generators (NEW)
  generatePromptCountCacheKey,
  generatePromptCategoryCacheKey,
  generatePromptSearchCacheKey,
  generatePromptCacheKey,
  generateUserLikedPromptsCacheKey,
  generateFeaturedPromptsCacheKey,
  generatePromptCategoriesCountCacheKey,
  
  // Post cache key generators (EXISTING)
  generatePostsCacheKey,
  generatePostCacheKey,
  generateCommentsCacheKey,
  // TTL constants
  TTL,
  AGENT_TTL,
  VIDEO_TTL,
  PROMPT_TTL, // NEW
  
  // Redis instance (for advanced operations if needed)
  redis
};