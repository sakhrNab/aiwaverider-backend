/**
 * Redis Cache Refresh Script
 * 
 * This script periodically refreshes Redis cache to ensure data is always fresh.
 * Should be run via cron job every 6-12 hours.
 */

const admin = require('firebase-admin');
const { getCache, setCache, generateAgentCategoryCacheKey, generateAgentCountCacheKey } = require('../utils/cache');
const logger = require('../utils/logger');

// Initialize Firebase if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Refresh all category caches
 */
const refreshCategoryCaches = async () => {
  try {
    logger.info('Starting category cache refresh...');
    
    // Get all unique categories
    const categoriesSnapshot = await db.collection('agents').get();
    const categories = new Set();
    
    categoriesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.category) {
        categories.add(data.category);
      }
    });
    
    logger.info(`Found ${categories.size} categories to refresh`);
    
    // Refresh each category cache
    for (const category of categories) {
      try {
        const cacheKey = generateAgentCategoryCacheKey(category);
        
        // Fetch fresh data from Firebase
        const query = db.collection('agents').where('category', '==', category);
        const agentsSnapshot = await query.get();
        
        const agents = [];
        agentsSnapshot.forEach(doc => {
          agents.push({
            id: doc.id,
            ...doc.data()
          });
        });
        
        // Update cache with fresh data
        await setCache(cacheKey, agents, 86400); // 24 hours
        logger.info(`Refreshed cache for category "${category}" with ${agents.length} agents`);
        
      } catch (error) {
        logger.error(`Error refreshing cache for category "${category}":`, error);
      }
    }
    
    logger.info('Category cache refresh completed');
    
  } catch (error) {
    logger.error('Error in category cache refresh:', error);
  }
};

/**
 * Refresh total count cache
 */
const refreshCountCache = async () => {
  try {
    logger.info('Refreshing total count cache...');
    
    const totalSnapshot = await db.collection('agents').get();
    const totalCount = totalSnapshot.size;
    
    const countCacheKey = generateAgentCountCacheKey();
    await setCache(countCacheKey, totalCount, 86400);
    
    logger.info(`Refreshed total count cache: ${totalCount} agents`);
    
  } catch (error) {
    logger.error('Error refreshing count cache:', error);
  }
};

/**
 * Clear old search caches (optional - to prevent memory bloat)
 */
const clearOldSearchCaches = async () => {
  try {
    logger.info('Clearing old search caches...');
    
    // This would require Redis pattern matching
    // For now, we'll let them expire naturally
    logger.info('Search caches will expire naturally (24 hours)');
    
  } catch (error) {
    logger.error('Error clearing old search caches:', error);
  }
};

/**
 * Main refresh function
 */
const refreshAllCaches = async () => {
  const startTime = Date.now();
  logger.info('Starting Redis cache refresh...');
  
  try {
    // Refresh category caches
    await refreshCategoryCaches();
    
    // Refresh count cache
    await refreshCountCache();
    
    // Optional: Clear old search caches
    await clearOldSearchCaches();
    
    const duration = Date.now() - startTime;
    logger.info(`Redis cache refresh completed in ${duration}ms`);
    
  } catch (error) {
    logger.error('Error in cache refresh:', error);
  }
};

// Run if called directly
if (require.main === module) {
  refreshAllCaches()
    .then(() => {
      logger.info('Cache refresh script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Cache refresh script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  refreshAllCaches,
  refreshCategoryCaches,
  refreshCountCache
}; 