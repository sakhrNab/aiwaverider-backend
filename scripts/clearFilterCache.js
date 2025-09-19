/**
 * Clear Filter Cache Script
 * =========================
 * This script clears all agent-related cache entries to force
 * fresh cache generation with the new filter-aware cache keys.
 */

require('dotenv').config();
const Redis = require('ioredis');

// Redis client configuration
let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
} else {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
  });
}

async function clearFilterCache() {
  try {
    console.log('🔄 Clearing all agent-related cache entries...');
    
    // Define cache patterns to clear
    const cachePatterns = [
      'agents:*',           // All agent cache keys
      'agent:category:*',   // Category cache keys
      'agent:search:*',     // Search cache keys  
      'agent:count:*',      // Count cache keys
      'latest:*'            // Latest agents cache
    ];
    
    let totalCleared = 0;
    
    // Clear each pattern
    for (const pattern of cachePatterns) {
      try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(keys);
          console.log(`✅ Cleared ${keys.length} keys matching pattern: ${pattern}`);
          totalCleared += keys.length;
        } else {
          console.log(`⚪ No keys found for pattern: ${pattern}`);
        }
      } catch (error) {
        console.error(`❌ Error clearing pattern ${pattern}:`, error);
      }
    }
    
    console.log(`\n🎉 Successfully cleared ${totalCleared} cache entries!`);
    console.log('📝 Next API request will generate fresh cache with filter parameters.');
    
    // Close Redis connection
    await redis.quit();
    
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    process.exit(1);
  }
}

// Run the script
clearFilterCache(); 