/**
 * Price Model for AI Agents
 * 
 * This model defines the schema for the price data structure used in the application.
 * It provides validation functions and helps maintain consistency in the pricing data.
 */

/**
 * Validates a price object before saving to the database
 * @param {Object} priceData - The price data to validate
 * @returns {Object} - Validated and formatted price data
 */
const validatePrice = (priceData) => {
  // Required fields
  if (!priceData.agentId) {
    throw new Error('Price must have an associated agentId');
  }

  // Set default values if not provided
  const price = {
    agentId: priceData.agentId,
    basePrice: priceData.basePrice || 0,
    currency: priceData.currency || 'USD',
    isFree: priceData.basePrice === 0 || priceData.isFree === true,
    isSubscription: priceData.isSubscription || false,
    updatedAt: new Date().toISOString()
  };

  // Handle discount
  if (priceData.discount) {
    price.discount = {
      amount: priceData.discount.amount || 0,
      percentage: priceData.discount.percentage || 0,
      validFrom: priceData.discount.validFrom || new Date().toISOString(),
      validUntil: priceData.discount.validUntil || null
    };
    
    // Calculate final price with discount
    if (price.discount.amount > 0) {
      price.finalPrice = Math.max(0, price.basePrice - price.discount.amount);
    } else if (price.discount.percentage > 0) {
      price.finalPrice = price.basePrice * (1 - (price.discount.percentage / 100));
    }
  } else {
    price.finalPrice = price.basePrice;
  }

  // Handle pricing tiers
  if (priceData.pricingTiers && Array.isArray(priceData.pricingTiers)) {
    price.pricingTiers = priceData.pricingTiers;
  }

  // Initialize or preserve price history
  if (priceData.priceHistory && Array.isArray(priceData.priceHistory)) {
    price.priceHistory = priceData.priceHistory;
  } else {
    price.priceHistory = [];
  }

  return price;
};

/**
 * Creates a new price history entry for price changes
 * @param {number} oldPrice - Previous price value
 * @param {number} newPrice - New price value
 * @param {string} currency - Currency code (e.g., USD)
 * @param {string} reason - Reason for the price change
 * @returns {Object} - Price history entry
 */
const createPriceHistoryEntry = (oldPrice, newPrice, currency, reason) => {
  return {
    price: oldPrice,
    currency: currency,
    timestamp: new Date().toISOString(),
    reason: reason || 'Price update'
  };
};

/**
 * Checks if a discount is valid based on the current date
 * @param {Object} discount - Discount object with validFrom and validUntil
 * @returns {boolean} - Whether the discount is currently valid
 */
const isDiscountValid = (discount) => {
  if (!discount) return false;
  
  const now = new Date();
  const validFrom = discount.validFrom ? new Date(discount.validFrom) : null;
  const validUntil = discount.validUntil ? new Date(discount.validUntil) : null;
  
  // Check if within valid date range
  if (validFrom && validFrom > now) return false;
  if (validUntil && validUntil < now) return false;
  
  // Ensure there's either an amount or percentage
  return (discount.amount > 0 || discount.percentage > 0);
};

/**
 * Calculates the final price based on base price and discount
 * @param {number} basePrice - The base price
 * @param {Object} discount - Discount object
 * @returns {number} - The final calculated price
 */
const calculateFinalPrice = (basePrice, discount) => {
  if (!isDiscountValid(discount)) {
    return basePrice;
  }
  
  if (discount.amount > 0) {
    return Math.max(0, basePrice - discount.amount);
  } else if (discount.percentage > 0) {
    return basePrice * (1 - (discount.percentage / 100));
  }
  
  return basePrice;
};

module.exports = {
  validatePrice,
  createPriceHistoryEntry,
  isDiscountValid,
  calculateFinalPrice
}; 