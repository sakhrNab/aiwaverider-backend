const express = require('express');
const router = express.Router();
const priceController = require('../../controllers/agent/priceController');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');

// Public endpoints (read-only, cached)
router.get('/:id', publicCacheMiddleware({ duration: 300 }), priceController.getPriceById);
router.get('/:id/history', publicCacheMiddleware({ duration: 600 }), priceController.getPriceHistory);

// Protected endpoints (require authentication)
router.post('/:id', validateFirebaseToken, priceController.updatePrice);
router.patch('/:id/discount', validateFirebaseToken, priceController.applyDiscount);

// Agent-specific endpoints (matches frontend requests)
router.get('/agent/:agentId/price', publicCacheMiddleware({ duration: 300 }), priceController.getAgentPrice);
router.post('/agent/:agentId/price', validateFirebaseToken, priceController.updateAgentPrice);

// Get price history for all agents 
router.get('/history', priceController.getPriceHistory);

// Get price history for specific agent
router.get('/:agentId/history', priceController.getPriceHistory);

// Migration route to fix price data inconsistencies
router.post('/migrate', validateFirebaseToken, priceController.migratePriceData);

module.exports = router; 