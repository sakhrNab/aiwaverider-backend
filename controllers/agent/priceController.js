/**
 * Price Controller
 * 
 * Handles all operations related to agent pricing, including:
 * - Retrieving price information
 * - Setting and updating prices
 * - Applying discounts
 * - Tracking price history
 */

const { db } = require('../../config/firebase');
const { 
  validatePrice, 
  createPriceHistoryEntry, 
  isDiscountValid,
  calculateFinalPrice 
} = require('../../models/priceModel');

// Collection references
const pricesCollection = db.collection('prices');
const agentsCollection = db.collection('agents');

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
 * Record a price change in price_history collection
 * @param {object} priceData - The price data
 * @param {string} agentId - The agent ID
 * @param {string} userId - The user ID making the change
 * @param {string} changeType - The type of change
 * @returns {Promise<string>} The ID of the new price history record
 */
const recordPriceHistory = async (priceData, agentId, userId = null, changeType = 'manual_price_change') => {
  try {
    const normalizedAgentId = normalizeAgentId(agentId);
    const timestamp = new Date().toISOString();
    
    const historyData = {
      agentId: normalizedAgentId,
      basePrice: priceData.basePrice,
      discountedPrice: priceData.discountedPrice,
      discountPercentage: priceData.discountPercentage,
      currency: priceData.currency,
      isFree: priceData.isFree,
      isSubscription: priceData.isSubscription,
      changedAt: timestamp,
      changedBy: userId || 'system',
      changeType
    };
    
    // Add to the main price_history collection (source of truth for price history)
    const historyRef = await db.collection('price_history').add(historyData);
    console.log(`Price history recorded with ID: ${historyRef.id}`);
    
    return historyRef.id;
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
    const agentDoc = await agentsCollection.doc(id).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Now fetch the price document
    const priceDoc = await pricesCollection.doc(id).get();
    
    // If price doesn't exist, check if agent has legacy price info
    if (!priceDoc.exists) {
      const agentData = agentDoc.data();
      
      // Check for legacy pricing (priceDetails or direct price field)
      if (agentData.priceDetails) {
        // Convert from legacy format to new price model
        const legacyPrice = {
          agentId: id,
          basePrice: agentData.priceDetails.basePrice || 0,
          finalPrice: agentData.priceDetails.discountedPrice || agentData.priceDetails.basePrice || 0,
          currency: agentData.priceDetails.currency || 'USD',
          isFree: agentData.isFree || false,
          isSubscription: agentData.isSubscription || false,
          updatedAt: new Date().toISOString()
        };
        
        return res.status(200).json(legacyPrice);
      } else if (typeof agentData.price !== 'undefined') {
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
          updatedAt: agentData.updatedAt || new Date().toISOString()
        };
        
        return res.status(200).json(legacyPrice);
      }
      
      // No price found at all
      return res.status(404).json({ error: 'Price not found for this agent' });
    }
    
    // Return the price data
    const priceData = {
      id: priceDoc.id,
      ...priceDoc.data()
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
    const agentDoc = await agentsCollection.doc(id).get();
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Check if price already exists
    const priceDoc = await pricesCollection.doc(id).get();
    let existingPrice = null;
    
    if (priceDoc.exists) {
      existingPrice = priceDoc.data();
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
    
    // Save the price
    await pricesCollection.doc(id).set(validPrice, { merge: true });
    
    // Also update some price info on the agent document for backwards compatibility
    await agentsCollection.doc(id).update({
      isFree: validPrice.isFree,
      isSubscription: validPrice.isSubscription,
      priceDetails: {
        basePrice: validPrice.basePrice,
        discountedPrice: validPrice.finalPrice,
        currency: validPrice.currency
      }
    });
    
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
    const priceDoc = await pricesCollection.doc(id).get();
    if (!priceDoc.exists) {
      // If price doesn't exist yet, create it first based on agent data
      const agentDoc = await agentsCollection.doc(id).get();
      if (!agentDoc.exists) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      const agentData = agentDoc.data();
      let basePrice = 0;
      
      if (agentData.priceDetails) {
        basePrice = agentData.priceDetails.basePrice;
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
        isFree: agentData.isFree || false,
        isSubscription: agentData.isSubscription || false
      });
      
      await pricesCollection.doc(id).set(newPrice);
    }
    
    // Get the current price data
    const priceData = priceDoc.exists ? priceDoc.data() : await pricesCollection.doc(id).get().then(doc => doc.data());
    
    // Create the discount object
    const discount = {
      amount: discountData.amount || 0,
      percentage: discountData.percentage || 0,
      validFrom: discountData.validFrom || new Date().toISOString(),
      validUntil: discountData.validUntil || null
    };
    
    // Calculate new final price
    const finalPrice = calculateFinalPrice(priceData.basePrice, discount);
    
    // Add to price history if this is a new discount
    const historyEntry = createPriceHistoryEntry(
      priceData.finalPrice,
      finalPrice,
      priceData.currency,
      discountData.reason || 'Discount applied'
    );
    
    if (!priceData.priceHistory) {
      priceData.priceHistory = [];
    }
    
    priceData.priceHistory.push(historyEntry);
    
    // Update the price document
    await pricesCollection.doc(id).update({
      discount,
      finalPrice,
      priceHistory: priceData.priceHistory,
      updatedAt: new Date().toISOString()
    });
    
    // Update agent document for backwards compatibility
    await agentsCollection.doc(id).update({
      priceDetails: {
        basePrice: priceData.basePrice,
        discountedPrice: finalPrice,
        currency: priceData.currency
      }
    });
    
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
    
    // Get the price document
    const priceDoc = await pricesCollection.doc(id).get();
    
    if (!priceDoc.exists) {
      return res.status(404).json({ error: 'Price not found for this agent' });
    }
    
    const priceData = priceDoc.data();
    
    // Return the price history
    return res.status(200).json({
      agentId: id,
      history: priceData.priceHistory || []
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
    
    // Get the price document from the prices collection
    const priceDoc = await db.collection('prices').doc(agentId).get();
    
    if (!priceDoc.exists) {
      console.log(`No price found for agent: ${agentId}`);
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Return the price data
    const priceData = priceDoc.data();
    
    // Clean up response - don't return the priceHistory array in the price object
    // This should be queried separately if needed
    const { priceHistory, ...cleanPriceData } = priceData;
    
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
  try {
    // Start a Firestore transaction for data consistency
    const result = await db.runTransaction(async (transaction) => {
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
      
      // Reference to the price document
      const priceRef = db.collection('prices').doc(agentId);
      const priceDoc = await transaction.get(priceRef);
      
      // Reference to the agent document
      const agentRef = db.collection('agents').doc(agentId);
      const agentDoc = await transaction.get(agentRef);
      
      if (!agentDoc.exists) {
        throw new Error(`Agent with ID ${agentId} not found`);
      }
      
      // If price document doesn't exist, create it
      if (!priceDoc.exists) {
        transaction.set(priceRef, {
          ...normalizedPrice,
          priceHistory: [] // Empty array for backwards compatibility
        });
      } else {
        // Update the existing price document
        transaction.update(priceRef, {
          ...normalizedPrice,
          // Don't update the priceHistory array in the price document
        });
      }
      
      // Update the price-related fields in the agent document
      transaction.update(agentRef, {
        // Set the priceDetails object
        priceDetails: {
          basePrice: normalizedPrice.basePrice,
          discountedPrice: normalizedPrice.discountedPrice,
          currency: normalizedPrice.currency
        },
        // Also update the direct price fields for backwards compatibility
        basePrice: normalizedPrice.basePrice,
        discountedPrice: normalizedPrice.discountedPrice,
        price: normalizedPrice.discountedPrice, // Legacy field
        isFree: normalizedPrice.isFree,
        isSubscription: normalizedPrice.isSubscription,
        discountPercentage: normalizedPrice.discountPercentage,
        updatedAt: normalizedPrice.updatedAt
      });
      
      // Record the price change in the price_history collection
      const userId = req.user?.uid || null;
      await recordPriceHistory(normalizedPrice, agentId, userId);
      
      return {
        success: true,
        price: normalizedPrice
      };
    });
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('Error updating agent price:', error);
    return res.status(500).json({ error: 'Failed to update agent price', details: error.message });
  }
};

/**
 * Migration script to fix price data inconsistencies
 * This will:
 * 1. Ensure all agents have consistent price data
 * 2. Ensure all prices documents match their agent counterparts
 * 3. Record current prices in price_history collection
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
    const agentsSnapshot = await db.collection('agents').get();
    const results = {
      success: true,
      totalAgents: agentsSnapshot.size,
      updated: 0,
      errors: []
    };
    
    // Process each agent
    for (const agentDoc of agentsSnapshot.docs) {
      try {
        const agentId = agentDoc.id;
        const agentData = agentDoc.data();
        
        // Get existing price data
        const priceRef = db.collection('prices').doc(agentId);
        const priceDoc = await priceRef.get();
        
        // Determine the correct price data
        let priceData = {};
        
        if (priceDoc.exists) {
          // If price document exists, use it as the base
          priceData = priceDoc.data();
        } else if (agentData.priceDetails) {
          // Otherwise use priceDetails from agent
          priceData = {
            basePrice: agentData.priceDetails.basePrice || 0,
            discountedPrice: agentData.priceDetails.discountedPrice || agentData.priceDetails.basePrice || 0,
            currency: agentData.priceDetails.currency || 'USD',
            isFree: agentData.isFree || agentData.priceDetails.basePrice === 0,
            isSubscription: agentData.isSubscription || false
          };
        } else {
          // Fall back to direct price fields on agent
          priceData = {
            basePrice: agentData.basePrice || 0,
            discountedPrice: agentData.discountedPrice || agentData.price || agentData.basePrice || 0,
            currency: 'USD',
            isFree: agentData.isFree || agentData.basePrice === 0 || agentData.price === 0,
            isSubscription: agentData.isSubscription || false
          };
        }
        
        // Create a normalized price object
        const normalizedPrice = createNormalizedPriceObject(priceData, agentId);
        
        // Update the price document
        await priceRef.set({
          ...normalizedPrice,
          priceHistory: [] // Empty array for backwards compatibility
        }, { merge: true });
        
        // Update the agent document
        await db.collection('agents').doc(agentId).update({
          priceDetails: {
            basePrice: normalizedPrice.basePrice,
            discountedPrice: normalizedPrice.discountedPrice,
            currency: normalizedPrice.currency
          },
          basePrice: normalizedPrice.basePrice,
          discountedPrice: normalizedPrice.discountedPrice,
          price: normalizedPrice.discountedPrice, // Legacy field
          isFree: normalizedPrice.isFree,
          isSubscription: normalizedPrice.isSubscription,
          discountPercentage: normalizedPrice.discountPercentage,
          updatedAt: normalizedPrice.updatedAt
        });
        
        // Record in price history
        await recordPriceHistory(normalizedPrice, agentId, 'migration', 'data_migration');
        
        results.updated++;
        console.log(`Migrated price data for agent: ${agentId}`);
        
      } catch (error) {
        console.error(`Error migrating price data for agent ${agentDoc.id}:`, error);
        results.errors.push({
          agentId: agentDoc.id,
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