/**
 * Analytics Controller
 * Handles analytics data for admin dashboard
 */

const { db, admin } = require('../../config/firebase');
const logger = require('../../utils/logger');
const analyticsService = require('../../services/analyticsService');

/**
 * Get detailed analytics data for a specific time range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAnalyticsData = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    console.log(`[ANALYTICS] getAnalyticsData called with timeRange: ${timeRange}`);
    console.log(`[ANALYTICS] Request query params:`, req.query);
    
    // Get analytics from dedicated collection (ultra-fast)
    const analyticsData = await analyticsService.getAnalytics(timeRange);
    
    if (analyticsData) {
      console.log(`[ANALYTICS] Returning analytics data from analytics collection for ${timeRange}`);
      return res.status(200).json({
        success: true,
        data: analyticsData,
        source: 'analytics_collection'
      });
    }
    
    // Fallback if no analytics data
    console.log(`[ANALYTICS] No analytics data found, returning empty data`);
    return res.status(200).json({
      success: true,
      data: {
        sales: { total: 0, data: [], detailed: [] },
        users: { total: 0, new: 0, active: 0, data: [], detailed: [] },
        agents: { total: 0, free: 0, paid: 0, downloads: 0, detailed: [] },
        orders: { total: 0, revenue: 0, detailed: [] },
        visitors: { total: 0, data: [], detailed: [] }
      },
      source: 'empty'
    });
  } catch (error) {
    logger.error(`Error getting analytics data: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get analytics data',
      error: error.message
    });
  }
};

/**
 * Get top performing agents
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getTopAgents = async (req, res) => {
  try {
    const { timeRange = 'week', limit = 10 } = req.query;
    
    console.log(`[ANALYTICS] getTopAgents called with timeRange: ${timeRange}, limit: ${limit}`);
    
    // Get analytics data which includes top agents
    const analyticsData = await analyticsService.getAnalytics(timeRange);
    
    if (analyticsData && analyticsData.topAgents) {
      const topAgents = analyticsData.topAgents.slice(0, parseInt(limit));
      console.log(`[ANALYTICS] Returning ${topAgents.length} top agents from analytics collection`);
      
      return res.status(200).json({
        success: true,
        data: topAgents,
        source: 'analytics_collection'
      });
    }
    
    // Fallback if no top agents data
    return res.status(200).json({
      success: true,
      data: [],
      source: 'empty'
    });
  } catch (error) {
    logger.error(`Error getting top agents: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get top agents',
      error: error.message
    });
  }
};

/**
 * Get visitor analytics data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getVisitorAnalytics = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    const analyticsData = await analyticsService.getAnalytics(timeRange);
    
    if (analyticsData) {
      return res.status(200).json({
        success: true,
        data: analyticsData.visitors,
        source: 'analytics_collection'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: { total: 0, data: [] },
      source: 'empty'
    });
  } catch (error) {
    logger.error(`Error getting visitor analytics: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get visitor analytics',
      error: error.message
    });
  }
};

/**
 * Get revenue analytics data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getRevenueAnalytics = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    const analyticsData = await analyticsService.getAnalytics(timeRange);
    
    if (analyticsData) {
      return res.status(200).json({
        success: true,
        data: analyticsData.sales,
        source: 'analytics_collection'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: { total: 0, data: [] },
      source: 'empty'
    });
  } catch (error) {
    logger.error(`Error getting revenue analytics: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get revenue analytics',
      error: error.message
    });
  }
};

/**
 * Get user analytics data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserAnalytics = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    const analyticsData = await analyticsService.getAnalytics(timeRange);
    
    if (analyticsData) {
      return res.status(200).json({
        success: true,
        data: analyticsData.users,
        source: 'analytics_collection'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: { total: 0, new: 0, active: 0, data: [] },
      source: 'empty'
    });
  } catch (error) {
    logger.error(`Error getting user analytics: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get user analytics',
      error: error.message
    });
  }
};

/**
 * Get download analytics data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDownloadAnalytics = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    const analyticsData = await analyticsService.getAnalytics(timeRange);
    
    if (analyticsData) {
      return res.status(200).json({
        success: true,
        data: {
          total: analyticsData.agents.downloads,
          data: analyticsData.topAgents || []
        },
        source: 'analytics_collection'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: { total: 0, data: [] },
      source: 'empty'
    });
  } catch (error) {
    logger.error(`Error getting download analytics: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get download analytics',
      error: error.message
    });
  }
};

/**
 * Populate analytics from existing data (one-time script)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.populateAnalytics = async (req, res) => {
  try {
    await analyticsService.populateFromExistingData();
    
    return res.status(200).json({
      success: true,
      message: 'Analytics populated successfully from existing data'
    });
  } catch (error) {
    logger.error(`Error populating analytics: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to populate analytics',
      error: error.message
    });
  }
};

/**
 * Get detailed user information for analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDetailedUserInfo = async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    console.log(`[ANALYTICS] getDetailedUserInfo called with timeRange: ${timeRange}`);
    
    // Get detailed user information
    const detailedInfo = await analyticsService.getDetailedUserInfo(timeRange);
    
    return res.status(200).json({
      success: true,
      data: detailedInfo,
      source: 'detailed_user_info'
    });
  } catch (error) {
    logger.error(`Error getting detailed user info: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get detailed user info',
      error: error.message
    });
  }
};

/**
 * Track a page view
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.trackPageView = async (req, res) => {
  try {
    const { page, metadata = {} } = req.body;
    
    if (!page) {
      return res.status(400).json({ error: 'Page path is required' });
    }

    let userId = 'anonymous';
    // Attempt to get userId from auth token if available
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        userId = decodedToken.uid;
      } catch (error) {
        logger.warn('Invalid auth token for tracking view, using anonymous tracking:', error.message);
      }
    }

    // Update analytics
    await analyticsService.onPageVisit(userId, page, metadata.productId);

    return res.status(200).json({ success: true, message: 'View tracked successfully' });
  } catch (error) {
    logger.error('Error tracking view:', error);
    return res.status(500).json({ error: 'Failed to track view' });
  }
};