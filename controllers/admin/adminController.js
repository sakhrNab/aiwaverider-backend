/**
 * Admin Controller
 * Handles admin-specific functionality
 */

const { db } = require('../../config/firebase');
const logger = require('../../utils/logger');

/**
 * Update agent creators to ensure they have username and role fields
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateAgentCreators = async (req, res) => {
  try {
    logger.info('Starting agent creator update process...');
    
    // Get all agents from the collection
    const agentsSnapshot = await db.collection('agents').get();
    logger.info(`Found ${agentsSnapshot.size} agents to process`);
    
    let updateCount = 0;
    let skippedCount = 0;
    let updatedAgents = [];
    
    // Process each agent with batched writes
    const batchSize = 450; // Firestore batch limit is 500, leave some margin
    let batches = [db.batch()];
    let currentBatchCount = 0;
    let batchIndex = 0;
    
    for (const doc of agentsSnapshot.docs) {
      const agent = doc.data();
      let needsUpdate = false;
      let originalCreator = agent.creator ? JSON.stringify(agent.creator) : 'null';
      
      // Check if creator exists and has the correct structure
      if (!agent.creator) {
        // No creator at all, add a default one
        agent.creator = {
          name: 'AI Waverider Team',
          username: 'AIWaverider',
          role: 'Admin'
        };
        needsUpdate = true;
        logger.info(`Agent ${doc.id}: Adding default creator (no creator found)`);
      } else if (typeof agent.creator === 'string') {
        // Creator is a string, convert to object
        const creatorName = agent.creator;
        agent.creator = {
          name: creatorName,
          username: creatorName.replace(/\s+/g, ''),
          role: 'Partner'
        };
        needsUpdate = true;
        logger.info(`Agent ${doc.id}: Converting string creator "${creatorName}" to object`);
      } else if (typeof agent.creator === 'object') {
        // Creator is an object, check for missing fields
        if (!agent.creator.username) {
          // Add username based on name or default
          agent.creator.username = agent.creator.name ? 
            agent.creator.name.replace(/\s+/g, '') : 'AIWaverider';
          needsUpdate = true;
        }
        
        if (!agent.creator.role) {
          // Add default role
          agent.creator.role = agent.creator.name && 
            agent.creator.name.includes('Waverider') ? 'Admin' : 'Partner';
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          logger.info(`Agent ${doc.id}: Updating creator properties`);
        }
      }
      
      if (needsUpdate) {
        // Check if we need to create a new batch
        if (currentBatchCount >= batchSize) {
          batchIndex++;
          batches.push(db.batch());
          currentBatchCount = 0;
        }
        
        // Update the document in the current batch
        batches[batchIndex].update(doc.ref, { creator: agent.creator });
        currentBatchCount++;
        updateCount++;
        
        // Track updated agents for debugging
        updatedAgents.push({
          id: doc.id,
          name: agent.name || agent.title || 'Unnamed agent',
          originalCreator,
          newCreator: JSON.stringify(agent.creator)
        });
      } else {
        skippedCount++;
      }
    }
    
    // Commit all batches
    if (updateCount > 0) {
      logger.info(`Committing ${batches.length} batches with ${updateCount} updates...`);
      
      // Track progress for large batches
      for (let i = 0; i <= batchIndex; i++) {
        logger.info(`Committing batch ${i + 1} of ${batchIndex + 1}...`);
        await batches[i].commit();
        logger.info(`Batch ${i + 1} committed successfully`);
      }
    } else {
      logger.info('No updates needed, skipping batch commits');
    }
    
    const result = {
      success: true,
      message: 'Agent creators updated successfully',
      stats: {
        total: agentsSnapshot.size,
        updated: updateCount,
        skipped: skippedCount,
        batches: batchIndex + 1
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
    const agentsSnapshot = await db.collection('agents').get();
    stats.agents.total = agentsSnapshot.size;
    
    agentsSnapshot.forEach(doc => {
      const agent = doc.data();
      if (agent.isFree || agent.price === 0) {
        stats.agents.free++;
      } else {
        stats.agents.paid++;
      }
    });
    
    // Get user stats if users collection exists
    try {
      const usersSnapshot = await db.collection('users').get();
      stats.users.total = usersSnapshot.size;
      
      // Count active users (logged in within last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (user.lastLoginAt && new Date(user.lastLoginAt) > thirtyDaysAgo) {
          stats.users.active++;
        }
      });
    } catch (err) {
      logger.warn('Could not fetch user stats:', err.message);
    }
    
    // Get order stats if orders collection exists
    try {
      const ordersSnapshot = await db.collection('orders').get();
      stats.orders.total = ordersSnapshot.size;
      
      ordersSnapshot.forEach(doc => {
        const order = doc.data();
        if (order.amount) {
          stats.orders.revenue += parseFloat(order.amount) || 0;
        }
      });
      
      // Format revenue to 2 decimal places
      stats.orders.revenue = parseFloat(stats.orders.revenue.toFixed(2));
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