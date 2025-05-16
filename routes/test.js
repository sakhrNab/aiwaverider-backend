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

module.exports = router; 