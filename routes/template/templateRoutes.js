/**
 * Template Routes - Template Download API
 * 
 * Handles secure template downloads for purchased AI agents
 */

const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/payment/orderController');
const logger = require('../../utils/logger');
const { db } = require('../../config/firebase');

/**
 * Download agent template
 * GET /api/templates/download/:agentId
 */
router.get('/download/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { orderId, token, format = 'json' } = req.query;
    
    if (!orderId || !token) {
      return res.status(400).json({
        error: 'Missing required parameters: orderId and token are required'
      });
    }
    
    logger.info(`Template download requested: ${agentId}`, {
      orderId,
      token: token.substring(0, 8) + '...',
      format
    });
    
    // Verify template access token
    const accessDoc = await db.collection('templateAccess').doc(token).get();
    
    if (!accessDoc.exists) {
      logger.warn(`Invalid template access token: ${token.substring(0, 8)}...`);
      return res.status(403).json({
        error: 'Invalid or expired access token'
      });
    }
    
    const accessData = accessDoc.data();
    
    // Verify token matches request
    if (accessData.orderId !== orderId || accessData.agentId !== agentId) {
      logger.warn(`Token mismatch for template download: ${agentId}`, {
        tokenOrderId: accessData.orderId,
        requestOrderId: orderId,
        tokenAgentId: accessData.agentId,
        requestAgentId: agentId
      });
      return res.status(403).json({
        error: 'Access token does not match request parameters'
      });
    }
    
    // Check if token has expired
    const expiresAt = new Date(accessData.expiresAt);
    if (expiresAt < new Date()) {
      logger.warn(`Expired template access token: ${token.substring(0, 8)}...`);
      return res.status(403).json({
        error: 'Access token has expired'
      });
    }
    
    // Check if token has been revoked
    if (accessData.revoked) {
      logger.warn(`Revoked template access token: ${token.substring(0, 8)}...`);
      return res.status(403).json({
        error: 'Access token has been revoked',
        reason: accessData.revokedReason || 'Unknown'
      });
    }
    
    // Get template content
    try {
      const templateContent = await orderController.getAgentTemplate(agentId);
      
      // Mark token as used (optional, for analytics)
      await db.collection('templateAccess').doc(token).update({
        lastUsed: new Date().toISOString(),
        useCount: (accessData.useCount || 0) + 1
      });
      
      // Get agent details for filename
      let agentName = 'ai-agent';
      try {
        const agentDoc = await db.collection('agents').doc(agentId).get();
        if (agentDoc.exists) {
          const agent = agentDoc.data();
          agentName = (agent.title || agent.name || 'ai-agent')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        }
      } catch (agentError) {
        logger.debug(`Could not fetch agent details for filename: ${agentError.message}`);
      }
      
      logger.info(`Template downloaded successfully: ${agentId}`, {
        orderId,
        agentName,
        format,
        email: accessData.email
      });
      
      // Set appropriate headers based on format
      if (format === 'download' || format === 'file') {
        // Force download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${agentName}-template.json"`);
        return res.send(templateContent);
      } else if (format === 'text' || format === 'txt') {
        // Return as plain text
        res.setHeader('Content-Type', 'text/plain');
        return res.send(templateContent);
      } else {
        // Return as JSON response (default)
        res.setHeader('Content-Type', 'application/json');
        return res.json({
          success: true,
          agentId,
          agentName,
          orderId,
          templateContent: JSON.parse(templateContent),
          downloadedAt: new Date().toISOString(),
          format
        });
      }
    } catch (templateError) {
      logger.error(`Error getting template content for ${agentId}:`, templateError);
      return res.status(500).json({
        error: 'Failed to retrieve template content',
        details: templateError.message
      });
    }
  } catch (error) {
    logger.error(`Error processing template download for ${req.params.agentId}:`, error);
    return res.status(500).json({
      error: 'Template download failed',
      details: error.message
    });
  }
});

/**
 * Get template access info (without downloading)
 * GET /api/templates/access/:token
 */
router.get('/access/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    logger.info(`Template access info requested: ${token.substring(0, 8)}...`);
    
    // Get template access data
    const accessDoc = await db.collection('templateAccess').doc(token).get();
    
    if (!accessDoc.exists) {
      return res.status(404).json({
        error: 'Access token not found'
      });
    }
    
    const accessData = accessDoc.data();
    
    // Check if token has expired
    const isExpired = new Date(accessData.expiresAt) < new Date();
    
    // Get agent details
    let agentDetails = null;
    try {
      const agentDoc = await db.collection('agents').doc(accessData.agentId).get();
      if (agentDoc.exists) {
        const agent = agentDoc.data();
        agentDetails = {
          id: accessData.agentId,
          title: agent.title || agent.name,
          description: agent.description,
          category: agent.category,
          features: agent.features || []
        };
      }
    } catch (agentError) {
      logger.debug(`Could not fetch agent details: ${agentError.message}`);
    }
    
    // Get order details
    let orderDetails = null;
    try {
      const orderDoc = await db.collection('orders').doc(accessData.orderId).get();
      if (orderDoc.exists) {
        const order = orderDoc.data();
        orderDetails = {
          id: order.id,
          status: order.status,
          createdAt: order.createdAt,
          currency: order.currency,
          total: order.total
        };
      }
    } catch (orderError) {
      logger.debug(`Could not fetch order details: ${orderError.message}`);
    }
    
    return res.status(200).json({
      success: true,
      token: token.substring(0, 8) + '...',
      access: {
        orderId: accessData.orderId,
        agentId: accessData.agentId,
        email: accessData.email,
        createdAt: accessData.createdAt,
        expiresAt: accessData.expiresAt,
        isExpired,
        revoked: accessData.revoked || false,
        revokedReason: accessData.revokedReason || null,
        lastUsed: accessData.lastUsed || null,
        useCount: accessData.useCount || 0
      },
      agent: agentDetails,
      order: orderDetails,
      downloadUrl: `/api/templates/download/${accessData.agentId}?orderId=${accessData.orderId}&token=${token}`
    });
  } catch (error) {
    logger.error(`Error getting template access info for ${req.params.token}:`, error);
    return res.status(500).json({
      error: 'Failed to get access info',
      details: error.message
    });
  }
});

/**
 * List templates for an order
 * GET /api/templates/order/:orderId
 */
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { email, userId } = req.query;
    
    logger.info(`Template list requested for order: ${orderId}`);
    
    // Get order details first
    const orderDoc = await db.collection('orders').doc(orderId).get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }
    
    const order = orderDoc.data();
    
    // Basic access control - require email or userId to match order
    if (email && order.userEmail !== email) {
      return res.status(403).json({
        error: 'Email does not match order'
      });
    }
    
    if (userId && order.userId !== userId) {
      return res.status(403).json({
        error: 'User ID does not match order'
      });
    }
    
    // Get template access tokens for this order
    const accessSnapshot = await db.collection('templateAccess')
      .where('orderId', '==', orderId)
      .get();
    
    const templates = [];
    
    for (const accessDoc of accessSnapshot.docs) {
      const accessData = accessDoc.data();
      
      // Skip revoked tokens
      if (accessData.revoked) {
        continue;
      }
      
      // Get agent details
      try {
        const agentDoc = await db.collection('agents').doc(accessData.agentId).get();
        let agentDetails = { id: accessData.agentId, title: 'Unknown Agent' };
        
        if (agentDoc.exists) {
          const agent = agentDoc.data();
          agentDetails = {
            id: accessData.agentId,
            title: agent.title || agent.name,
            description: agent.description,
            category: agent.category,
            image: agent.image || null
          };
        }
        
        templates.push({
          ...agentDetails,
          accessToken: accessDoc.id,
          createdAt: accessData.createdAt,
          expiresAt: accessData.expiresAt,
          isExpired: new Date(accessData.expiresAt) < new Date(),
          lastUsed: accessData.lastUsed || null,
          useCount: accessData.useCount || 0,
          downloadUrl: `/api/templates/download/${accessData.agentId}?orderId=${orderId}&token=${accessDoc.id}`
        });
      } catch (agentError) {
        logger.error(`Error getting agent details for ${accessData.agentId}:`, agentError);
      }
    }
    
    return res.status(200).json({
      success: true,
      orderId,
      orderStatus: order.status,
      orderDate: order.createdAt,
      templates,
      templateCount: templates.length
    });
  } catch (error) {
    logger.error(`Error getting templates for order ${req.params.orderId}:`, error);
    return res.status(500).json({
      error: 'Failed to get order templates',
      details: error.message
    });
  }
});

/**
 * Revoke template access (admin only)
 * POST /api/templates/revoke/:token
 */
router.post('/revoke/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { reason, adminKey } = req.body;
    
    // Basic admin authentication
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    logger.info(`Admin revocation requested for template access: ${token.substring(0, 8)}...`);
    
    // Update template access token
    await db.collection('templateAccess').doc(token).update({
      revoked: true,
      revokedAt: new Date().toISOString(),
      revokedBy: 'admin',
      revokedReason: reason || 'admin_revocation'
    });
    
    return res.status(200).json({
      success: true,
      token: token.substring(0, 8) + '...',
      message: 'Template access revoked successfully'
    });
  } catch (error) {
    logger.error(`Error revoking template access for ${req.params.token}:`, error);
    return res.status(500).json({
      error: 'Failed to revoke template access',
      details: error.message
    });
  }
});

/**
 * Get template download statistics
 * GET /api/templates/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { period = 'month', agentId } = req.query;
    
    logger.info(`Template stats requested: period=${period}, agentId=${agentId || 'all'}`);
    
    // Calculate date range
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    
    // Build query
    let query = db.collection('templateAccess')
      .where('createdAt', '>=', startDate.toISOString());
    
    if (agentId) {
      query = query.where('agentId', '==', agentId);
    }
    
    const accessSnapshot = await query.get();
    
    // Calculate statistics
    const stats = {
      totalAccesses: 0,
      totalDownloads: 0,
      uniqueUsers: new Set(),
      agentBreakdown: {},
      revokedCount: 0,
      expiredCount: 0
    };
    
    accessSnapshot.forEach(doc => {
      const access = doc.data();
      stats.totalAccesses++;
      
      if (access.useCount > 0) {
        stats.totalDownloads += access.useCount;
      }
      
      if (access.email) {
        stats.uniqueUsers.add(access.email);
      }
      
      if (!stats.agentBreakdown[access.agentId]) {
        stats.agentBreakdown[access.agentId] = {
          count: 0,
          downloads: 0
        };
      }
      
      stats.agentBreakdown[access.agentId].count++;
      stats.agentBreakdown[access.agentId].downloads += access.useCount || 0;
      
      if (access.revoked) {
        stats.revokedCount++;
      }
      
      if (new Date(access.expiresAt) < now) {
        stats.expiredCount++;
      }
    });
    
    // Convert Set to count
    stats.uniqueUsers = stats.uniqueUsers.size;
    
    return res.status(200).json({
      success: true,
      period,
      agentId: agentId || 'all',
      dateRange: {
        start: startDate.toISOString(),
        end: now.toISOString()
      },
      stats
    });
  } catch (error) {
    logger.error('Error getting template statistics:', error);
    return res.status(500).json({
      error: 'Failed to get template statistics',
      details: error.message
    });
  }
});

module.exports = router;