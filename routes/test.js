const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// Simple GET handler
router.get('/agent-price-test', (req, res) => {
  console.log('Test route for agent price hit');
  return res.status(200).json({
    success: true,
    message: 'Agent price test route working correctly'
  });
});

// Simple POST handler that doesn't depend on any complex functionality
router.post('/create-agent-price', (req, res) => {
  try {
    console.log('Create agent with price test route hit with body:', req.body);
    
    // Just return the data that was sent, don't save anything
    return res.status(200).json({
      success: true,
      message: 'Test route received data successfully',
      receivedData: req.body
    });
  } catch (error) {
    console.error('Error in test route:', error);
    return res.status(500).json({
      success: false,
      message: 'Error in test route',
      error: error.message
    });
  }
});

// Test route
router.get('/', (req, res) => {
    res.json({ message: 'Test route is working!' });
});

// Debug endpoint to test parameter extraction
router.get('/debug-params', (req, res) => {
  const {
    category = 'All',
    searchQuery,
    search,
    lastVisibleId,
    limit = 20,
    filter
  } = req.query;

  const finalSearchQuery = searchQuery || search;

  const response = {
    receivedParams: {
      category,
      searchQuery,
      search,
      lastVisibleId,
      limit,
      filter
    },
    finalSearchQuery,
    finalSearchQueryType: typeof finalSearchQuery,
    queryObject: req.query,
    url: req.url
  };

  console.log('DEBUG PARAMS ENDPOINT:', JSON.stringify(response, null, 2));
  
  return res.status(200).json(response);
});

module.exports = router; 