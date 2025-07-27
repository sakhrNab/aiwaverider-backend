// backend/utils/cache.js - ADD THESE MISSING FUNCTIONS
const Redis = require('ioredis');
const logger = require('./logger'); // Assuming you have a logger

// ... existing Redis setup code ...

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
// MISSING CACHE KEY GENERATORS - ADD THESE
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
 * Stores data in Redis cache with TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<boolean>} Success status
 */
const setCache = async (key, data, ttl = TTL.SHORT) => {
  try {
    const start = Date.now();
    const serializedData = JSON.stringify(data);
    
    // Log size for monitoring
    const sizeKB = Math.round(serializedData.length / 1024);
    
    await redis.set(key, serializedData, 'EX', ttl);
    const duration = Date.now() - start;
    
    logger.info(`📤 Cache SET: ${key} (${sizeKB}KB, TTL:${ttl}s, ${duration}ms)`);
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
 * Cache with automatic refresh capability
 * @param {string} key - Cache key
 * @param {Function} fetchFunction - Function to fetch fresh data
 * @param {number} ttl - TTL in seconds
 * @returns {Promise<any>} Cached or fresh data
 */
const cacheWithRefresh = async (key, fetchFunction, ttl = TTL.SHORT) => {
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
  
  // NEW: Missing cache key generators
  generateAgentCountCacheKey,
  generateAgentCategoryCacheKey,
  generateAgentSearchCacheKey,
  generateAgentCacheKey,

  generatePostsCacheKey,

  
  // TTL constants
  TTL,
  
  // Redis instance (for advanced operations if needed)
  redis
};