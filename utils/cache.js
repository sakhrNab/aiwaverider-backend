const Redis = require('ioredis');
const { promisify } = require('util');

// Redis client configuration
// Support for both Upstash Redis URL and traditional configuration
let redis;
if (process.env.REDIS_URL) {
  // Use connection URL for Upstash Redis
  redis = new Redis(process.env.REDIS_URL);
} else {
  // Fallback to traditional configuration for local development
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });
}

// Default TTL (5 minutes)
const DEFAULT_TTL = 300;

/**
 * Cache Key Strategy Documentation
 * 
 * Our cache keys follow a hierarchical pattern to enable efficient cache management:
 * 
 * 1. Posts Cache Keys:
 *    - Format: posts:{category}:{limit}:{startAfter}
 *    - Example: posts:Technology:10:abc123
 *    - Used for: Paginated post listings, filtered by category
 * 
 * 2. Single Post Cache Keys:
 *    - Format: post:{postId}
 *    - Example: post:xyz789
 *    - Used for: Individual post details
 * 
 * 3. Comments Cache Keys:
 *    - Format: comments:{postId}
 *    - Example: comments:xyz789
 *    - Used for: Comments associated with a specific post
 * 
 * 4. Batch Comments Cache Keys:
 *    - Format: batchComments_{sortedPostIds}
 *    - Example: batchComments_post1_post2_post3
 *    - Used for: Batch comment fetching for multiple posts
 * 
 * 5. User Profile Cache Keys:
 *    - Format: profile:{userId}
 *    - Example: profile:user123
 *    - Used for: User profile data
 * 
 * Cache Invalidation Strategy:
 * - Post updates: Invalidate both the specific post cache and any category listings
 * - Comment updates: Invalidate the post's comments cache and any batch caches
 * - Profile updates: Invalidate only the specific user's profile cache
 */

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
 * Generates a cache key for a user's profile
 * @param {string} userId - The user's unique identifier
 * @returns {string} Cache key
 */
const generateProfileCacheKey = (userId) => {
  return `profile:${userId}`;
};

/**
 * Retrieves data from cache
 * @param {string} key - Cache key
 * @returns {Promise<any>} Cached data or null if not found
 */
const getCache = async (key) => {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
};

/**
 * Stores data in cache with optional TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in seconds (optional)
 * @returns {Promise<boolean>} Success status
 */
const setCache = async (key, data, ttl = DEFAULT_TTL) => {
  try {
    await redis.set(key, JSON.stringify(data), 'EX', ttl);
    return true;
  } catch (error) {
    console.error('Cache set error:', error);
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
    await redis.del(key);
    return true;
  } catch (error) {
    console.error('Cache delete error:', error);
    return false;
  }
};

/**
 * Deletes multiple cache entries matching a pattern
 * @param {string} pattern - Pattern to match cache keys
 * @returns {Promise<boolean>} Success status
 */
const deleteCacheByPattern = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
    return true;
  } catch (error) {
    console.error('Cache pattern delete error:', error);
    return false;
  }
};

// Error handling for Redis connection
redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('Connected to Redis successfully');
});

module.exports = {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
  generatePostsCacheKey,
  generatePostCacheKey,
  generateCommentsCacheKey,
  generateProfileCacheKey,
  DEFAULT_TTL
}; 