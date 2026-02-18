/**
 * Admin Controller
 * Handles admin-specific functionality
 */

const { pool } = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Update agent creators to ensure they have username and role fields
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateAgentCreators = async (req, res) => {
  try {
    logger.info('Starting agent creator update process...');

    // Get all agents from the table
    const agentsResult = await pool.query('SELECT id, name, title, creator FROM agents');
    logger.info(`Found ${agentsResult.rows.length} agents to process`);

    let updateCount = 0;
    let skippedCount = 0;
    let updatedAgents = [];

    // Use a transaction for batched writes
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const row of agentsResult.rows) {
        let creator = row.creator;
        let needsUpdate = false;
        let originalCreator = creator ? JSON.stringify(creator) : 'null';

        // Check if creator exists and has the correct structure
        if (!creator) {
          // No creator at all, add a default one
          creator = {
            name: 'AI Waverider Team',
            username: 'AIWaverider',
            role: 'Admin'
          };
          needsUpdate = true;
          logger.info(`Agent ${row.id}: Adding default creator (no creator found)`);
        } else if (typeof creator === 'string') {
          // Creator is a string, convert to object
          const creatorName = creator;
          creator = {
            name: creatorName,
            username: creatorName.replace(/\s+/g, ''),
            role: 'Partner'
          };
          needsUpdate = true;
          logger.info(`Agent ${row.id}: Converting string creator "${creatorName}" to object`);
        } else if (typeof creator === 'object') {
          // Creator is an object, check for missing fields
          if (!creator.username) {
            // Add username based on name or default
            creator.username = creator.name ?
              creator.name.replace(/\s+/g, '') : 'AIWaverider';
            needsUpdate = true;
          }

          if (!creator.role) {
            // Add default role
            creator.role = creator.name &&
              creator.name.includes('Waverider') ? 'Admin' : 'Partner';
            needsUpdate = true;
          }

          if (needsUpdate) {
            logger.info(`Agent ${row.id}: Updating creator properties`);
          }
        }

        if (needsUpdate) {
          await client.query(
            'UPDATE agents SET creator = $1 WHERE id = $2',
            [JSON.stringify(creator), row.id]
          );
          updateCount++;

          // Track updated agents for debugging
          updatedAgents.push({
            id: row.id,
            name: row.name || row.title || 'Unnamed agent',
            originalCreator,
            newCreator: JSON.stringify(creator)
          });
        } else {
          skippedCount++;
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const result = {
      success: true,
      message: 'Agent creators updated successfully',
      stats: {
        total: agentsResult.rows.length,
        updated: updateCount,
        skipped: skippedCount
      },
      updatedAgents: updatedAgents.slice(0, 10) // Only return first 10 for brevity
    };

    logger.info(`Agent creator update completed successfully: ${updateCount} updated, ${skippedCount} skipped`);
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Error updating agent creators: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({
      success: false,
      message: 'Failed to update agent creators',
      error: error.message
    });
  }
};

/**
 * Get admin dashboard stats
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const stats = {
      agents: {
        total: 0,
        free: 0,
        paid: 0
      },
      users: {
        total: 0,
        active: 0
      },
      orders: {
        total: 0,
        revenue: 0
      }
    };

    // Get agent stats
    const agentsResult = await pool.query(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_free = true OR price = 0) AS free,
        COUNT(*) FILTER (WHERE is_free IS NOT TRUE AND (price IS NULL OR price != 0)) AS paid
      FROM agents`
    );
    if (agentsResult.rows.length > 0) {
      stats.agents.total = parseInt(agentsResult.rows[0].total) || 0;
      stats.agents.free = parseInt(agentsResult.rows[0].free) || 0;
      stats.agents.paid = parseInt(agentsResult.rows[0].paid) || 0;
    }

    // Get user stats if users table exists
    try {
      const usersCountResult = await pool.query('SELECT COUNT(*) AS total FROM users');
      stats.users.total = parseInt(usersCountResult.rows[0].total) || 0;

      // Count active users (logged in within last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const activeUsersResult = await pool.query(
        'SELECT COUNT(*) AS active FROM users WHERE last_login_at > $1',
        [thirtyDaysAgo]
      );
      stats.users.active = parseInt(activeUsersResult.rows[0].active) || 0;
    } catch (err) {
      logger.warn('Could not fetch user stats:', err.message);
    }

    // Get order stats if orders table exists
    try {
      const ordersResult = await pool.query(
        'SELECT COUNT(*) AS total, COALESCE(SUM(total), 0) AS revenue FROM orders'
      );
      if (ordersResult.rows.length > 0) {
        stats.orders.total = parseInt(ordersResult.rows[0].total) || 0;
        stats.orders.revenue = parseFloat(parseFloat(ordersResult.rows[0].revenue).toFixed(2));
      }
    } catch (err) {
      logger.warn('Could not fetch order stats:', err.message);
    }

    return res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error(`Error getting admin dashboard stats: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get admin dashboard stats',
      error: error.message
    });
  }
};
