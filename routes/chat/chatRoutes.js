const express = require('express');
const router = express.Router();
const chatController = require('../../controllers/chat/chatController');

/**
 * @route POST /api/chat
 * @desc Process chat messages with OpenAI
 * @access Public
 */
router.post('/', chatController.processChat);

module.exports = router; 