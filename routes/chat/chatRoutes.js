const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const chatController = require('../../controllers/chat/chatController');
const { getRateLimits, defaultSettings } = require('../../models/siteSettings');

// Dynamic rate limiter for OpenAI-backed chat — reads config from admin settings
const chatLimiter = rateLimit({
  windowMs: defaultSettings.rateLimits.chatOpenAI.windowMinutes * 60 * 1000,
  max: async () => {
    try {
      const limits = await getRateLimits();
      return limits.chatOpenAI?.maxRequests || defaultSettings.rateLimits.chatOpenAI.maxRequests;
    } catch {
      return defaultSettings.rateLimits.chatOpenAI.maxRequests;
    }
  },
  message: { success: false, error: 'Too many chat requests. Please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: Process chat message
 *     description: Process chat messages with OpenAI integration
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: User's chat message
 *                 example: "Hello, how can you help me today?"
 *               conversationId:
 *                 type: string
 *                 description: Optional conversation ID for context
 *                 example: "conv-123"
 *               userId:
 *                 type: string
 *                 description: Optional user ID for personalization
 *                 example: "user-123"
 *     responses:
 *       200:
 *         description: Chat message processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 response:
 *                   type: string
 *                   description: AI response message
 *                   example: "Hello! I'm here to help you with any questions you might have."
 *                 conversationId:
 *                   type: string
 *                   description: Conversation ID
 *                   example: "conv-123"
 *       400:
 *         description: Bad request - Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many requests - Rate limited
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', chatLimiter, chatController.processChat);

module.exports = router; 