const express = require('express');
const router = express.Router();
const chatController = require('../../controllers/chat/chatController');

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
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', chatController.processChat);

module.exports = router; 