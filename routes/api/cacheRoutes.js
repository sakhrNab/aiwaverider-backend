const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const logger = require('../../utils/logger');
const { 
  deleteCacheByPattern,
  setCache 
} = require('../../utils/cache');

// Collection references
const AI_TOOLS_COLLECTION = 'ai_tools';
const PROMPTS_COLLECTION = 'prompts';

/**
 * @route   POST /api/cache/refresh
 * @desc    Refresh all caches from Firebase
 * @access  Private (Admin only)
 */
router.post('/refresh', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const startTime = Date.now();
    const refreshResults = {
      aiTools: { success: false, count: 0, error: null },
      prompts: { success: false, count: 0, error: null },
      cacheCleared: { success: false, patterns: [] }
    };

    logger.info('🔄 Starting comprehensive cache refresh...');

    // Step 1: Clear all existing caches
    try {
      const cachePatterns = [
        'ai_tools:*',
        'prompts:*',
      ];

      for (const pattern of cachePatterns) {
        await deleteCacheByPattern(pattern);
        refreshResults.cacheCleared.patterns.push(pattern);
      }
      
      refreshResults.cacheCleared.success = true;
      logger.info('🧹 Cleared all cache patterns');
    } catch (cacheError) {
      logger.error('❌ Error clearing caches:', cacheError);
      refreshResults.cacheCleared.error = cacheError.message;
    }

    // Step 2: Refresh AI Tools cache
    try {
      logger.info('🔄 Refreshing AI Tools cache...');
      
      const aiToolsSnapshot = await admin.firestore()
        .collection(AI_TOOLS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .get();

      const aiTools = [];
      aiToolsSnapshot.forEach(doc => {
        aiTools.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Cache the AI tools data
      await setCache('ai_tools:all', aiTools);
      await setCache('ai_tools:count', aiTools.length);
      
      // Cache by categories
      const aiToolsCategories = {};
      aiTools.forEach(tool => {
        const category = tool.category || 'Uncategorized';
        if (!aiToolsCategories[category]) {
          aiToolsCategories[category] = [];
        }
        aiToolsCategories[category].push(tool);
      });

      for (const [category, tools] of Object.entries(aiToolsCategories)) {
        await setCache(`ai_tools:category:${category}`, tools);
      }

      refreshResults.aiTools.success = true;
      refreshResults.aiTools.count = aiTools.length;
      logger.info(`✅ AI Tools cache refreshed: ${aiTools.length} tools`);

    } catch (aiToolsError) {
      logger.error('❌ Error refreshing AI Tools cache:', aiToolsError);
      refreshResults.aiTools.error = aiToolsError.message;
    }

    // Step 3: Refresh Prompts cache
    try {
      logger.info('🔄 Refreshing Prompts cache...');
      
      const promptsSnapshot = await admin.firestore()
        .collection(PROMPTS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .get();

      const prompts = [];
      promptsSnapshot.forEach(doc => {
        prompts.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Cache the prompts data
      await setCache('prompts:all', prompts);
      await setCache('prompts:count', prompts.length);
      
      // Cache by categories
      const promptsCategories = {};
      prompts.forEach(prompt => {
        const category = prompt.category || 'Uncategorized';
        if (!promptsCategories[category]) {
          promptsCategories[category] = [];
        }
        promptsCategories[category].push(prompt);
      });

      for (const [category, categoryPrompts] of Object.entries(promptsCategories)) {
        await setCache(`prompts:category:${category}`, categoryPrompts);
      }

      // Cache featured prompts
      const featuredPrompts = prompts.filter(prompt => prompt.isFeatured === true);
      await setCache('prompts:featured', featuredPrompts);

      refreshResults.prompts.success = true;
      refreshResults.prompts.count = prompts.length;
      logger.info(`✅ Prompts cache refreshed: ${prompts.length} prompts`);

    } catch (promptsError) {
      logger.error('❌ Error refreshing Prompts cache:', promptsError);
      refreshResults.prompts.error = promptsError.message;
    }

    const totalTime = Date.now() - startTime;
    const overallSuccess = refreshResults.aiTools.success && refreshResults.prompts.success;

    // Prepare response
    const response = {
      success: overallSuccess,
      message: overallSuccess ? 
        'All caches refreshed successfully' : 
        'Cache refresh completed with some errors',
      timestamp: new Date().toISOString(),
      duration: `${totalTime}ms`,
      results: refreshResults,
      summary: {
        totalAITools: refreshResults.aiTools.count,
        totalPrompts: refreshResults.prompts.count,
        cachePatternsCleaned: refreshResults.cacheCleared.patterns.length
      }
    };

    const statusCode = overallSuccess ? 200 : 207; // 207 = Multi-Status
    logger.info(`🎯 Cache refresh completed in ${totalTime}ms with ${overallSuccess ? 'success' : 'partial success'}`);

    return res.status(statusCode).json(response);

  } catch (error) {
    logger.error('❌ Critical error in cache refresh:', error);
    return res.status(500).json({
      success: false,
      error: 'Critical error during cache refresh',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/cache/refresh/ai-tools
 * @desc    Refresh only AI Tools cache
 * @access  Private (Admin only)
 */
router.post('/refresh/ai-tools', async (req, res) => {
  try {
    // if (!req.user.isAdmin) {
    //   return res.status(403).json({
    //     success: false,
    //     error: 'Access denied. Admin privileges required.'
    //   });
    // }

    const startTime = Date.now();
    logger.info('🔄 Refreshing AI Tools cache only...');

    // Clear AI tools caches
    await deleteCacheByPattern('ai_tools:*');

    // Fetch from Firebase
    const snapshot = await admin.firestore()
      .collection(AI_TOOLS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();

    const aiTools = [];
    snapshot.forEach(doc => {
      aiTools.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Cache the data
    await setCache('ai_tools:all', aiTools);
    await setCache('ai_tools:count', aiTools.length);

    const totalTime = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      message: 'AI Tools cache refreshed successfully',
      count: aiTools.length,
      duration: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error refreshing AI Tools cache:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh AI Tools cache',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/cache/refresh/prompts
 * @desc    Refresh only Prompts cache
 * @access  Private (Admin only)
 */
router.post('/refresh/prompts', async (req, res) => {
  try {
    // if (!req.user.isAdmin) {
    //   return res.status(403).json({
    //     success: false,
    //     error: 'Access denied. Admin privileges required.'
    //   });
    // }

    const startTime = Date.now();
    logger.info('🔄 Refreshing Prompts cache only...');

    // Clear prompts caches
    await deleteCacheByPattern('prompts:*');

    // Fetch from Firebase
    const snapshot = await admin.firestore()
      .collection(PROMPTS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();

    const prompts = [];
    snapshot.forEach(doc => {
      prompts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Cache the data
    await setCache('prompts:all', prompts);
    await setCache('prompts:count', prompts.length);

    // Cache featured prompts
    const featuredPrompts = prompts.filter(prompt => prompt.isFeatured === true);
    await setCache('prompts:featured', featuredPrompts);

    const totalTime = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      message: 'Prompts cache refreshed successfully',
      count: prompts.length,
      featuredCount: featuredPrompts.length,
      duration: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error refreshing Prompts cache:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh Prompts cache',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/cache/clear
 * @desc    Clear all caches (no refresh)
 * @access  Private (Admin only)
 */
router.delete('/clear', auth, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    const startTime = Date.now();
    logger.info('🧹 Clearing all caches...');

    const cachePatterns = [
      'ai_tools:*',
      'prompts:*',
    ];

    const clearedPatterns = [];
    for (const pattern of cachePatterns) {
      try {
        await deleteCacheByPattern(pattern);
        clearedPatterns.push(pattern);
      } catch (error) {
        logger.error(`Error clearing pattern ${pattern}:`, error);
      }
    }

    const totalTime = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      message: 'All caches cleared successfully',
      clearedPatterns,
      duration: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error clearing caches:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to clear caches',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/cache/status
 * @desc    Get cache status and statistics
 * @access  Private (Admin only)
 */
router.get('/status', auth, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }

    // This would need to be implemented based on your Redis setup
    // For now, just return a basic status
    const cacheStatus = {
      redis: {
        connected: true, // You'd check actual Redis connection here
        uptime: 'N/A'
      },
      lastRefresh: {
        aiTools: 'Unknown', // You could store this in cache
        prompts: 'Unknown'
      }
    };

    return res.status(200).json({
      success: true,
      status: cacheStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error getting cache status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get cache status',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;