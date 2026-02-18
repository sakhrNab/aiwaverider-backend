/**
 * Price Controller
 *
 * Handles all operations related to agent pricing, including:
 * - Retrieving price information
 * - Setting and updating prices
 * - Applying discounts
 * - Tracking price history
 */

const { pool } = require('../../config/database');
const {
  validatePrice,
  createPriceHistoryEntry,
  isDiscountValid,
  calculateFinalPrice
} = require('../../models/priceModel');

/**
 * Normalize agent ID by removing the 'agent-' prefix when needed
 * @param {string} agentId - The agent ID to normalize
 * @returns {string} Normalized agent ID
 */
const normalizeAgentId = (agentId) => {
  if (!agentId) return null;

  // First, sanitize the ID
  let sanitizedId = agentId.trim();

  // Extract numerical ID if it has the agent- prefix
  if (sanitizedId.startsWith('agent-')) {
    return sanitizedId; // Keep the agent- prefix for document IDs
  }

  // If it's just a number, add the agent- prefix
  if (!isNaN(sanitizedId) && !sanitizedId.startsWith('agent-')) {
    return `agent-${sanitizedId}`;
  }

  return sanitizedId;
};

/**
 * Create a consistent price object from request data
 * @param {object} priceData - Price data from request
 * @param {string} agentId - Agent ID
 * @returns {object} Normalized price object
 */
const createNormalizedPriceObject = (priceData, agentId) => {
  const normalizedAgentId = normalizeAgentId(agentId);
  const timestamp = new Date().toISOString();

  // Ensure basePrice is a number
  const basePrice = typeof priceData.basePrice === 'number'
    ? priceData.basePrice
    : parseFloat(priceData.basePrice) || 0;

  // Calculate or use provided discounted price
  let discountedPrice = basePrice;
  if (typeof priceData.discountedPrice === 'number' || priceData.discountedPrice) {
    discountedPrice = typeof priceData.discountedPrice === 'number'
      ? priceData.discountedPrice
      : parseFloat(priceData.discountedPrice) || basePrice;
  } else if (typeof priceData.finalPrice === 'number' || priceData.finalPrice) {
    discountedPrice = typeof priceData.finalPrice === 'number'
      ? priceData.finalPrice
      : parseFloat(priceData.finalPrice) || basePrice;
  }

  // Calculate discount percentage
  const discountPercentage = basePrice > 0
    ? Math.round(((basePrice - discountedPrice) / basePrice) * 100)
    : 0;

  return {
    agentId: normalizedAgentId,
    basePrice,
    discountedPrice,
    finalPrice: discountedPrice, // For backwards compatibility
    discountPercentage,
    currency: priceData.currency || 'USD',
    isFree: basePrice === 0 || !!priceData.isFree,
    isSubscription: !!priceData.isSubscription,
    createdAt: priceData.createdAt || timestamp,
    updatedAt: timestamp
  };
};

/**
 * Record a price change in price_history (logged only, no table)
 * @param {object} priceData - The price data
 * @param {string} agentId - The agent ID
 * @param {string} userId - The user ID making the change
 * @param {string} changeType - The type of change
 * @returns {Promise<void>}
 */
const recordPriceHistory = async (priceData, agentId, userId = null, changeType = 'manual_price_change') => {
  try {
    const normalizedAgentId = normalizeAgentId(agentId);

    // price_history table is not in PostgreSQL schema; log instead
    console.log(`Price history recorded for agent ${normalizedAgentId}:`, {
      basePrice: priceData.basePrice,
      discountedPrice: priceData.discountedPrice,
      discountPercentage: priceData.discountPercentage,
      currency: priceData.currency,
      isFree: priceData.isFree,
      isSubscription: priceData.isSubscription,
      changedBy: userId || 'system',
      changeType
    });
  } catch (error) {
    console.error('Error recording price history:', error);
    throw error;
  }
};

/**
 * Get the price details for a specific agent
 */
const getPriceById = async (req, res) => {
  try {
    const { id } = req.params;

    // First, check if the agent exists
    const agentResult = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Now fetch the price record
    const priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [id]);

    // If price doesn't exist, check if agent has legacy price info
    if (priceResult.rows.length === 0) {
      const agentData = agentResult.rows[0];

      // Check for legacy pricing (price_details or direct price field)
      if (agentData.price_details && Object.keys(agentData.price_details).length > 0) {
        // Convert from legacy format to new price model
        const legacyPrice = {
          agentId: id,
          basePrice: agentData.price_details.basePrice || 0,
          finalPrice: agentData.price_details.discountedPrice || agentData.price_details.basePrice || 0,
          currency: agentData.price_details.currency || 'USD',
          isFree: agentData.is_free || false,
          isSubscription: agentData.is_subscription || false,
          updatedAt: new Date().toISOString()
        };

        return res.status(200).json(legacyPrice);
      } else if (typeof agentData.price !== 'undefined' && agentData.price !== null) {
        // Even more legacy format with direct price field
        const price = agentData.price;
        const isFree = price === 0 || price === '0' || price === 'Free';
        const isSubscription = typeof price === 'string' && price.includes('/month');

        // Parse price value if it's a string
        let numericPrice = 0;
        if (typeof price === 'string') {
          const match = price.match(/\$?(\d+(\.\d+)?)/);
          if (match) {
            numericPrice = parseFloat(match[1]);
          }
        } else if (typeof price === 'number') {
          numericPrice = price;
        }

        const legacyPrice = {
          agentId: id,
          basePrice: numericPrice,
          finalPrice: numericPrice,
          currency: 'USD',
          isFree,
          isSubscription,
          updatedAt: agentData.updated_at || new Date().toISOString()
        };

        return res.status(200).json(legacyPrice);
      }

      // No price found at all
      return res.status(404).json({ error: 'Price not found for this agent' });
    }

    // Return the price data
    const row = priceResult.rows[0];
    const priceData = {
      id: row.id,
      agentId: row.agent_id,
      basePrice: parseFloat(row.base_price),
      discountedPrice: parseFloat(row.discounted_price),
      finalPrice: parseFloat(row.final_price),
      discountPercentage: parseFloat(row.discount_percentage),
      currency: row.currency,
      isFree: row.is_free,
      isSubscription: row.is_subscription,
      discount: row.discount,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    // Check if discount is still valid, update finalPrice if needed
    if (priceData.discount && !isDiscountValid(priceData.discount)) {
      priceData.finalPrice = priceData.basePrice;
    }

    return res.status(200).json(priceData);
  } catch (error) {
    console.error('Error getting price:', error);
    return res.status(500).json({ error: 'Failed to get price details' });
  }
};

/**
 * Set or update the price for an agent
 */
const updatePrice = async (req, res) => {
  try {
    const { id } = req.params;
    const priceData = req.body;

    // Check if agent exists
    const agentResult = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Check if price already exists
    const priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [id]);
    let existingPrice = null;

    if (priceResult.rows.length > 0) {
      const row = priceResult.rows[0];
      existingPrice = {
        basePrice: parseFloat(row.base_price),
        discountedPrice: parseFloat(row.discounted_price),
        finalPrice: parseFloat(row.final_price),
        currency: row.currency
      };
    }

    // Prepare the price data with the agent ID
    const newPriceData = {
      ...priceData,
      agentId: id
    };

    // Validate the price data
    const validPrice = validatePrice(newPriceData);

    // If price exists, add to history
    if (existingPrice && existingPrice.basePrice !== validPrice.basePrice) {
      const historyEntry = createPriceHistoryEntry(
        existingPrice.basePrice,
        validPrice.basePrice,
        existingPrice.currency,
        priceData.reason || 'Price update'
      );

      if (!validPrice.priceHistory) {
        validPrice.priceHistory = [];
      }

      validPrice.priceHistory.push(historyEntry);
    }

    // Save the price using INSERT ... ON CONFLICT (upsert)
    await pool.query(
      `INSERT INTO prices (id, agent_id, base_price, discounted_price, final_price, discount_percentage, currency, is_free, is_subscription, discount, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         base_price = EXCLUDED.base_price,
         discounted_price = EXCLUDED.discounted_price,
         final_price = EXCLUDED.final_price,
         discount_percentage = EXCLUDED.discount_percentage,
         currency = EXCLUDED.currency,
         is_free = EXCLUDED.is_free,
         is_subscription = EXCLUDED.is_subscription,
         discount = EXCLUDED.discount,
         updated_at = NOW()`,
      [
        id,
        id,
        validPrice.basePrice || 0,
        validPrice.finalPrice || validPrice.discountedPrice || 0,
        validPrice.finalPrice || 0,
        validPrice.discountPercentage || 0,
        validPrice.currency || 'USD',
        validPrice.isFree || false,
        validPrice.isSubscription || false,
        validPrice.discount ? JSON.stringify(validPrice.discount) : null
      ]
    );

    // Also update some price info on the agent record for backwards compatibility
    await pool.query(
      `UPDATE agents SET is_free = $1, is_subscription = $2, price_details = $3, updated_at = NOW() WHERE id = $4`,
      [
        validPrice.isFree || false,
        validPrice.isSubscription || false,
        JSON.stringify({
          basePrice: validPrice.basePrice,
          discountedPrice: validPrice.finalPrice,
          currency: validPrice.currency
        }),
        id
      ]
    );

    return res.status(200).json({
      message: 'Price updated successfully',
      price: validPrice
    });
  } catch (error) {
    console.error('Error updating price:', error);
    return res.status(500).json({ error: 'Failed to update price' });
  }
};

/**
 * Apply a discount to an agent's price
 */
const applyDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const discountData = req.body;

    // Validate discount data
    if (!discountData || (!discountData.amount && !discountData.percentage)) {
      return res.status(400).json({ error: 'Invalid discount data. Must include amount or percentage.' });
    }

    // Ensure the price exists
    let priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [id]);
    if (priceResult.rows.length === 0) {
      // If price doesn't exist yet, create it first based on agent data
      const agentResult = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
      if (agentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const agentData = agentResult.rows[0];
      let basePrice = 0;

      if (agentData.price_details && agentData.price_details.basePrice) {
        basePrice = agentData.price_details.basePrice;
      } else if (typeof agentData.price === 'number') {
        basePrice = agentData.price;
      } else if (typeof agentData.price === 'string') {
        const match = agentData.price.match(/\$?(\d+(\.\d+)?)/);
        if (match) {
          basePrice = parseFloat(match[1]);
        }
      }

      // Create a new price object
      const newPrice = validatePrice({
        agentId: id,
        basePrice,
        currency: 'USD',
        isFree: agentData.is_free || false,
        isSubscription: agentData.is_subscription || false
      });

      await pool.query(
        `INSERT INTO prices (id, agent_id, base_price, discounted_price, final_price, discount_percentage, currency, is_free, is_subscription, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          id, id,
          newPrice.basePrice || 0,
          newPrice.finalPrice || newPrice.discountedPrice || 0,
          newPrice.finalPrice || 0,
          newPrice.discountPercentage || 0,
          newPrice.currency || 'USD',
          newPrice.isFree || false,
          newPrice.isSubscription || false
        ]
      );

      // Re-fetch the price
      priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [id]);
    }

    // Get the current price data
    const row = priceResult.rows[0];
    const priceData = {
      basePrice: parseFloat(row.base_price),
      finalPrice: parseFloat(row.final_price),
      currency: row.currency
    };

    // Create the discount object
    const discount = {
      amount: discountData.amount || 0,
      percentage: discountData.percentage || 0,
      validFrom: discountData.validFrom || new Date().toISOString(),
      validUntil: discountData.validUntil || null
    };

    // Calculate new final price
    const finalPrice = calculateFinalPrice(priceData.basePrice, discount);

    // Update the price record
    await pool.query(
      `UPDATE prices SET discount = $1, final_price = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(discount), finalPrice, id]
    );

    // Update agent record for backwards compatibility
    await pool.query(
      `UPDATE agents SET price_details = $1, updated_at = NOW() WHERE id = $2`,
      [
        JSON.stringify({
          basePrice: priceData.basePrice,
          discountedPrice: finalPrice,
          currency: priceData.currency
        }),
        id
      ]
    );

    return res.status(200).json({
      message: 'Discount applied successfully',
      discount,
      finalPrice
    });
  } catch (error) {
    console.error('Error applying discount:', error);
    return res.status(500).json({ error: 'Failed to apply discount' });
  }
};

/**
 * Get the price history for an agent
 */
const getPriceHistory = async (req, res) => {
  try {
    const { id } = req.params;

    // Get the price record
    const priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [id]);

    if (priceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Price not found for this agent' });
    }

    // price_history table is not in PostgreSQL schema; return empty history
    return res.status(200).json({
      agentId: id,
      history: []
    });
  } catch (error) {
    console.error('Error getting price history:', error);
    return res.status(500).json({ error: 'Failed to get price history' });
  }
};

/**
 * Get agent price by ID
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAgentPrice = async (req, res) => {
  try {
    let agentId = req.params.id;
    console.log('Getting price for agent ID:', agentId);

    // Normalize the agent ID
    agentId = normalizeAgentId(agentId);
    if (!agentId) {
      return res.status(400).json({ error: 'Invalid agent ID' });
    }

    // Get the price record from the prices table
    const priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [agentId]);

    if (priceResult.rows.length === 0) {
      console.log(`No price found for agent: ${agentId}`);
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Return the price data
    const row = priceResult.rows[0];
    const cleanPriceData = {
      id: row.id,
      agentId: row.agent_id,
      basePrice: parseFloat(row.base_price),
      discountedPrice: parseFloat(row.discounted_price),
      finalPrice: parseFloat(row.final_price),
      discountPercentage: parseFloat(row.discount_percentage),
      currency: row.currency,
      isFree: row.is_free,
      isSubscription: row.is_subscription,
      discount: row.discount,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    return res.status(200).json(cleanPriceData);

  } catch (error) {
    console.error('Error getting agent price:', error);
    return res.status(500).json({ error: 'Failed to get agent price', details: error.message });
  }
};

/**
 * Update agent price
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateAgentPrice = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get agent ID and normalize it
    let agentId = req.params.id;
    agentId = normalizeAgentId(agentId);

    if (!agentId) {
      throw new Error('Invalid agent ID');
    }

    console.log(`Updating price for agent: ${agentId}`);

    // Validate the request body
    const priceData = req.body;
    if (!priceData) {
      throw new Error('Price data is required');
    }

    // Create a normalized price object
    const normalizedPrice = createNormalizedPriceObject(priceData, agentId);

    // Check that the agent exists
    const agentResult = await client.query('SELECT * FROM agents WHERE id = $1', [agentId]);
    if (agentResult.rows.length === 0) {
      throw new Error(`Agent with ID ${agentId} not found`);
    }

    // Upsert the price record
    await client.query(
      `INSERT INTO prices (id, agent_id, base_price, discounted_price, final_price, discount_percentage, currency, is_free, is_subscription, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         base_price = EXCLUDED.base_price,
         discounted_price = EXCLUDED.discounted_price,
         final_price = EXCLUDED.final_price,
         discount_percentage = EXCLUDED.discount_percentage,
         currency = EXCLUDED.currency,
         is_free = EXCLUDED.is_free,
         is_subscription = EXCLUDED.is_subscription,
         updated_at = NOW()`,
      [
        agentId,
        normalizedPrice.agentId,
        normalizedPrice.basePrice,
        normalizedPrice.discountedPrice,
        normalizedPrice.finalPrice,
        normalizedPrice.discountPercentage,
        normalizedPrice.currency,
        normalizedPrice.isFree,
        normalizedPrice.isSubscription
      ]
    );

    // Update the price-related fields in the agent record
    await client.query(
      `UPDATE agents SET
         price_details = $1,
         price = $2,
         is_free = $3,
         is_subscription = $4,
         updated_at = NOW()
       WHERE id = $5`,
      [
        JSON.stringify({
          basePrice: normalizedPrice.basePrice,
          discountedPrice: normalizedPrice.discountedPrice,
          currency: normalizedPrice.currency
        }),
        normalizedPrice.discountedPrice,
        normalizedPrice.isFree,
        normalizedPrice.isSubscription,
        agentId
      ]
    );

    await client.query('COMMIT');

    // Record the price change (logged, no DB table)
    const userId = req.user?.uid || null;
    await recordPriceHistory(normalizedPrice, agentId, userId);

    return res.status(200).json({
      success: true,
      price: normalizedPrice
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating agent price:', error);
    return res.status(500).json({ error: 'Failed to update agent price', details: error.message });
  } finally {
    client.release();
  }
};

/**
 * Migration script to fix price data inconsistencies
 * This will:
 * 1. Ensure all agents have consistent price data
 * 2. Ensure all prices records match their agent counterparts
 * 3. Log current prices (price_history table not available)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const migratePriceData = async (req, res) => {
  try {
    // Check if user is an admin
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Only administrators can run migrations' });
    }

    console.log('Starting price data migration...');

    // Get all agents
    const agentsResult = await pool.query('SELECT * FROM agents');
    const results = {
      success: true,
      totalAgents: agentsResult.rows.length,
      updated: 0,
      errors: []
    };

    // Process each agent
    for (const agentRow of agentsResult.rows) {
      try {
        const agentId = agentRow.id;

        // Get existing price data
        const priceResult = await pool.query('SELECT * FROM prices WHERE id = $1', [agentId]);

        // Determine the correct price data
        let priceData = {};

        if (priceResult.rows.length > 0) {
          // If price record exists, use it as the base
          const row = priceResult.rows[0];
          priceData = {
            basePrice: parseFloat(row.base_price) || 0,
            discountedPrice: parseFloat(row.discounted_price) || 0,
            currency: row.currency || 'USD',
            isFree: row.is_free,
            isSubscription: row.is_subscription
          };
        } else if (agentRow.price_details && Object.keys(agentRow.price_details).length > 0) {
          // Otherwise use price_details from agent
          priceData = {
            basePrice: agentRow.price_details.basePrice || 0,
            discountedPrice: agentRow.price_details.discountedPrice || agentRow.price_details.basePrice || 0,
            currency: agentRow.price_details.currency || 'USD',
            isFree: agentRow.is_free || agentRow.price_details.basePrice === 0,
            isSubscription: agentRow.is_subscription || false
          };
        } else {
          // Fall back to direct price fields on agent
          const agentPrice = parseFloat(agentRow.price) || 0;
          priceData = {
            basePrice: agentPrice,
            discountedPrice: agentPrice,
            currency: 'USD',
            isFree: agentRow.is_free || agentPrice === 0,
            isSubscription: agentRow.is_subscription || false
          };
        }

        // Create a normalized price object
        const normalizedPrice = createNormalizedPriceObject(priceData, agentId);

        // Upsert the price record
        await pool.query(
          `INSERT INTO prices (id, agent_id, base_price, discounted_price, final_price, discount_percentage, currency, is_free, is_subscription, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             base_price = EXCLUDED.base_price,
             discounted_price = EXCLUDED.discounted_price,
             final_price = EXCLUDED.final_price,
             discount_percentage = EXCLUDED.discount_percentage,
             currency = EXCLUDED.currency,
             is_free = EXCLUDED.is_free,
             is_subscription = EXCLUDED.is_subscription,
             updated_at = NOW()`,
          [
            agentId,
            normalizedPrice.agentId,
            normalizedPrice.basePrice,
            normalizedPrice.discountedPrice,
            normalizedPrice.finalPrice,
            normalizedPrice.discountPercentage,
            normalizedPrice.currency,
            normalizedPrice.isFree,
            normalizedPrice.isSubscription
          ]
        );

        // Update the agent record
        await pool.query(
          `UPDATE agents SET
             price_details = $1,
             price = $2,
             is_free = $3,
             is_subscription = $4,
             updated_at = NOW()
           WHERE id = $5`,
          [
            JSON.stringify({
              basePrice: normalizedPrice.basePrice,
              discountedPrice: normalizedPrice.discountedPrice,
              currency: normalizedPrice.currency
            }),
            normalizedPrice.discountedPrice,
            normalizedPrice.isFree,
            normalizedPrice.isSubscription,
            agentId
          ]
        );

        // Record in price history (logged only)
        await recordPriceHistory(normalizedPrice, agentId, 'migration', 'data_migration');

        results.updated++;
        console.log(`Migrated price data for agent: ${agentId}`);

      } catch (error) {
        console.error(`Error migrating price data for agent ${agentRow.id}:`, error);
        results.errors.push({
          agentId: agentRow.id,
          error: error.message
        });
      }
    }

    console.log('Price data migration completed.');
    return res.status(200).json(results);

  } catch (error) {
    console.error('Error in price data migration:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to migrate price data',
      details: error.message
    });
  }
};

module.exports = {
  getPriceById,
  updatePrice,
  applyDiscount,
  getPriceHistory,
  getAgentPrice,
  updateAgentPrice,
  migratePriceData,
  normalizeAgentId,
  createNormalizedPriceObject,
  recordPriceHistory
};