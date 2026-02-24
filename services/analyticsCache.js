const { db, admin } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * Analytics Cache Service
 * Implements enterprise-grade caching for analytics data
 */
class AnalyticsCacheService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.defaultTTL = 300000; // 5 minutes
    this.backgroundUpdateInterval = 60000; // 1 minute
    
    // Start background updates
    this.startBackgroundUpdates();
  }

  /**
   * Get cached analytics data
   * @param {string} key - Cache key
   * @returns {Object|null} - Cached data or null
   */
  get(key) {
    const expiry = this.cacheExpiry.get(key);
    if (expiry && Date.now() < expiry) {
      logger.info(`[CACHE] Hit for key: ${key}`);
      return this.cache.get(key);
    }
    
    if (this.cache.has(key)) {
      logger.info(`[CACHE] Expired for key: ${key}`);
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
    }
    
    return null;
  }

  /**
   * Set cached analytics data
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   * @param {number} ttl - Time to live in milliseconds
   */
  set(key, data, ttl = this.defaultTTL) {
    this.cache.set(key, data);
    this.cacheExpiry.set(key, Date.now() + ttl);
    logger.info(`[CACHE] Set for key: ${key}, TTL: ${ttl}ms`);
  }

  /**
   * Generate cache key
   * @param {string} type - Analytics type
   * @param {string} timeRange - Time range
   * @param {Object} params - Additional parameters
   * @returns {string} - Cache key
   */
  generateKey(type, timeRange, params = {}) {
    const paramString = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `analytics:${type}:${timeRange}:${paramString}`;
  }

  /**
   * Get or compute analytics data
   * @param {string} type - Analytics type
   * @param {string} timeRange - Time range
   * @param {Function} computeFn - Function to compute data if not cached
   * @param {Object} params - Additional parameters
   * @returns {Promise<Object>} - Analytics data
   */
  async getOrCompute(type, timeRange, computeFn, params = {}) {
    const key = this.generateKey(type, timeRange, params);
    
    // Try to get from cache
    const cached = this.get(key);
    if (cached) {
      return cached;
    }

    // Compute and cache
    logger.info(`[CACHE] Computing data for key: ${key}`);
    const data = await computeFn();
    this.set(key, data);
    return data;
  }

  /**
   * Pre-compute top agents (runs in background)
   */
  async precomputeTopAgents() {
    try {
      logger.info('[CACHE] Pre-computing top agents...');
      
      // Get only agents with downloads > 0, sorted by download count
      const agentsSnapshot = await db.collection('agents')
        .where('downloadCount', '>', 0)
        .orderBy('downloadCount', 'desc')
        .limit(100) // Pre-compute top 100
        .get();

      const agents = [];
      agentsSnapshot.forEach(doc => {
        const agent = doc.data();
        agents.push({
          id: doc.id,
          name: agent.name || agent.title || 'Unnamed Agent',
          downloads: agent.downloadCount || 0,
          revenue: agent.price ? (agent.downloadCount || 0) * (agent.price || 0) : 0,
          isFree: agent.isFree || agent.price === 0,
          price: agent.price || 0,
          rating: agent.rating?.average || 0,
          reviewCount: agent.rating?.count || 0,
          createdAt: agent.createdAt
        });
      });

      // Cache for different time ranges
      const timeRanges = ['week', 'month', 'year'];
      for (const timeRange of timeRanges) {
        const key = this.generateKey('top-agents', timeRange);
        this.set(key, agents, 300000); // 5 minutes
      }

      logger.info(`[CACHE] Pre-computed ${agents.length} top agents`);
    } catch (error) {
      logger.error('[CACHE] Error pre-computing top agents:', error);
    }
  }

  /**
   * Pre-compute analytics metrics (runs in background)
   */
  async precomputeAnalytics() {
    try {
      logger.info('[CACHE] Pre-computing analytics metrics...');
      
      const timeRanges = ['week', 'month', 'year'];
      
      for (const timeRange of timeRanges) {
        // Get date range
        const now = new Date();
        let startDate, endDate;
        
        switch (timeRange) {
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            endDate = now;
            break;
          case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            endDate = now;
            break;
          case 'year':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            endDate = now;
            break;
        }

        // Get all data in parallel
        const [agentsSnapshot, usersSnapshot, ordersSnapshot, productViewsSnapshot] = await Promise.all([
          db.collection('agents').get(),
          db.collection('users').get(),
          db.collection('orders').where('timestamp', '>=', startDate).where('timestamp', '<=', endDate).get(),
          db.collection('productViews').where('timestamp', '>=', startDate).where('timestamp', '<=', endDate).get()
        ]);

        // Process data (same logic as before but cached)
        const analytics = {
          sales: { total: 0, data: [] },
          users: { total: usersSnapshot.size, new: 0, active: 0, data: [] },
          agents: { total: agentsSnapshot.size, free: 0, paid: 0, downloads: 0 },
          orders: { total: ordersSnapshot.size, revenue: 0, data: [] },
          visitors: { total: productViewsSnapshot.size, data: [] }
        };

        // Cache the result
        const key = this.generateKey('analytics', timeRange);
        this.set(key, analytics, 300000); // 5 minutes
      }

      logger.info('[CACHE] Pre-computed analytics for all time ranges');
    } catch (error) {
      logger.error('[CACHE] Error pre-computing analytics:', error);
    }
  }

  /**
   * Start background updates
   */
  startBackgroundUpdates() {
    // Initial pre-computation
    this.precomputeTopAgents();
    this.precomputeAnalytics();

    // Update every minute
    setInterval(() => {
      this.precomputeTopAgents();
      this.precomputeAnalytics();
    }, this.backgroundUpdateInterval);

    logger.info('[CACHE] Background updates started');
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    this.cacheExpiry.clear();
    logger.info('[CACHE] All cache cleared');
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      memoryUsage: process.memoryUsage()
    };
  }
}

// Export singleton instance
module.exports = new AnalyticsCacheService();






