/**
 * Template Routes - Template Download API
 *
 * Handles secure template downloads for purchased AI agents
 */

const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/payment/orderController');
const logger = require('../../utils/logger');
const { pool } = require('../../config/database');
const { validateFirebaseToken } = require('../../middleware/authenticationMiddleware');

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
    const { rows: accessRows } = await pool.query('SELECT * FROM template_access WHERE id = $1', [token]);

    if (accessRows.length === 0) {
      logger.warn(`Invalid template access token: ${token.substring(0, 8)}...`);
      return res.status(403).json({
        error: 'Invalid or expired access token'
      });
    }

    const accessData = accessRows[0];

    // Verify token matches request
    if (accessData.order_id !== orderId || accessData.agent_id !== agentId) {
      logger.warn(`Token mismatch for template download: ${agentId}`, {
        tokenOrderId: accessData.order_id,
        requestOrderId: orderId,
        tokenAgentId: accessData.agent_id,
        requestAgentId: agentId
      });
      return res.status(403).json({
        error: 'Access token does not match request parameters'
      });
    }

    // Check if token has expired
    const expiresAt = new Date(accessData.expires_at);
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
        reason: accessData.revoked_reason || 'Unknown'
      });
    }

    // Get template content
    try {
      const templateContent = await orderController.getAgentTemplate(agentId);

      // Mark token as used
      await pool.query(
        'UPDATE template_access SET used = true WHERE id = $1',
        [token]
      );

      // Get agent details for filename
      let agentName = 'ai-agent';
      try {
        const { rows: agentRows } = await pool.query('SELECT * FROM agents WHERE id = $1', [agentId]);
        if (agentRows.length > 0) {
          const agent = agentRows[0];
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
    const { rows: accessRows } = await pool.query('SELECT * FROM template_access WHERE id = $1', [token]);

    if (accessRows.length === 0) {
      return res.status(404).json({
        error: 'Access token not found'
      });
    }

    const accessData = accessRows[0];

    // Check if token has expired
    const isExpired = new Date(accessData.expires_at) < new Date();

    // Get agent details
    let agentDetails = null;
    try {
      const { rows: agentRows } = await pool.query('SELECT * FROM agents WHERE id = $1', [accessData.agent_id]);
      if (agentRows.length > 0) {
        const agent = agentRows[0];
        agentDetails = {
          id: accessData.agent_id,
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
      const { rows: orderRows } = await pool.query('SELECT * FROM orders WHERE id = $1', [accessData.order_id]);
      if (orderRows.length > 0) {
        const order = orderRows[0];
        orderDetails = {
          id: order.id,
          status: order.status,
          createdAt: order.created_at,
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
        orderId: accessData.order_id,
        agentId: accessData.agent_id,
        email: accessData.email,
        createdAt: accessData.created_at,
        expiresAt: accessData.expires_at,
        isExpired,
        revoked: accessData.revoked || false,
        revokedReason: accessData.revoked_reason || null,
        used: accessData.used || false
      },
      agent: agentDetails,
      order: orderDetails,
      downloadUrl: `/api/templates/download/${accessData.agent_id}?orderId=${accessData.order_id}&token=${token}`
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
    const { rows: orderRows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);

    if (orderRows.length === 0) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }

    const order = orderRows[0];

    // Basic access control - require email or userId to match order
    if (email && order.user_email !== email) {
      return res.status(403).json({
        error: 'Email does not match order'
      });
    }

    if (userId && order.user_id !== userId) {
      return res.status(403).json({
        error: 'User ID does not match order'
      });
    }

    // Get template access tokens for this order
    const { rows: accessRows } = await pool.query(
      'SELECT * FROM template_access WHERE order_id = $1',
      [orderId]
    );

    const templates = [];

    for (const accessRow of accessRows) {
      // Skip revoked tokens
      if (accessRow.revoked) {
        continue;
      }

      // Get agent details
      try {
        const { rows: agentRows } = await pool.query('SELECT * FROM agents WHERE id = $1', [accessRow.agent_id]);
        let agentDetails = { id: accessRow.agent_id, title: 'Unknown Agent' };

        if (agentRows.length > 0) {
          const agent = agentRows[0];
          agentDetails = {
            id: accessRow.agent_id,
            title: agent.title || agent.name,
            description: agent.description,
            category: agent.category,
            image: agent.image || null
          };
        }

        templates.push({
          ...agentDetails,
          accessToken: accessRow.id,
          createdAt: accessRow.created_at,
          expiresAt: accessRow.expires_at,
          isExpired: new Date(accessRow.expires_at) < new Date(),
          used: accessRow.used || false,
          downloadUrl: `/api/templates/download/${accessRow.agent_id}?orderId=${orderId}&token=${accessRow.id}`
        });
      } catch (agentError) {
        logger.error(`Error getting agent details for ${accessRow.agent_id}:`, agentError);
      }
    }

    return res.status(200).json({
      success: true,
      orderId,
      orderStatus: order.status,
      orderDate: order.created_at,
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
    await pool.query(
      'UPDATE template_access SET revoked = true, revoked_at = NOW(), revoked_reason = $1 WHERE id = $2',
      [reason || 'admin_revocation', token]
    );

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
 * Create template access token for entitled users (subscriber or purchaser)
 */
router.post('/access', validateFirebaseToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const email = req.user?.email || null;
    const { agentId } = req.body || {};

    if (!agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' });
    }

    // Load user and entitlement
    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const userData = userRows.length > 0 ? userRows[0] : {};
    const subscription = userData.subscription || {};
    const nowTs = Date.now();
    const currentPeriodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : 0;
    const isSubscriber = (subscription.status === 'active' || subscription.status === 'trialing') && currentPeriodEnd > nowTs;

    // Purchases fallback
    const purchases = Array.isArray(userData.purchases) ? userData.purchases.map(p => p.agentId || p.productId) : [];
    const isPurchased = purchases.includes(agentId);

    if (!isSubscriber && !isPurchased) {
      return res.status(403).json({ success: false, error: 'Not entitled to download this agent' });
    }

    // Create access token record
    const { v4: uuidv4 } = require('uuid');
    const token = uuidv4();
    const orderId = `SUBSCR_${userId}_${Date.now()}`;

    await pool.query(
      `INSERT INTO template_access (id, order_id, agent_id, user_id, email, created_at, expires_at, used)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, false)`,
      [
        token,
        orderId,
        agentId,
        userId,
        email,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      ]
    );

    const downloadUrl = `/api/templates/download/${agentId}?orderId=${orderId}&token=${token}`;
    return res.status(200).json({ success: true, token, orderId, downloadUrl });
  } catch (error) {
    logger.error('Error creating template access token:', error);
    return res.status(500).json({ success: false, error: 'Failed to create access token' });
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

    // Build dynamic query
    let queryText = 'SELECT * FROM template_access WHERE created_at >= $1';
    const queryParams = [startDate.toISOString()];

    if (agentId) {
      queryParams.push(agentId);
      queryText += ` AND agent_id = $${queryParams.length}`;
    }

    const { rows: accessRows } = await pool.query(queryText, queryParams);

    // Calculate statistics
    const stats = {
      totalAccesses: 0,
      totalDownloads: 0,
      uniqueUsers: new Set(),
      agentBreakdown: {},
      revokedCount: 0,
      expiredCount: 0
    };

    accessRows.forEach(access => {
      stats.totalAccesses++;

      if (access.used) {
        stats.totalDownloads++;
      }

      if (access.email) {
        stats.uniqueUsers.add(access.email);
      }

      if (!stats.agentBreakdown[access.agent_id]) {
        stats.agentBreakdown[access.agent_id] = {
          count: 0,
          downloads: 0
        };
      }

      stats.agentBreakdown[access.agent_id].count++;
      if (access.used) {
        stats.agentBreakdown[access.agent_id].downloads++;
      }

      if (access.revoked) {
        stats.revokedCount++;
      }

      if (new Date(access.expires_at) < now) {
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
