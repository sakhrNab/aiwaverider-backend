const express = require('express');
const router = express.Router();
const priceController = require('../../controllers/agent/priceController');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');

/**
 * @swagger
 * /api/agent-prices/{id}:
 *   get:
 *     summary: Get price by ID
 *     description: Retrieve pricing information by price ID
 *     tags: [Agent Prices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price ID
 *         example: "price-123"
 *     responses:
 *       200:
 *         description: Price retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       404:
 *         description: Price not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', publicCacheMiddleware({ duration: 300 }), priceController.getPriceById);

/**
 * @swagger
 * /api/agent-prices/{id}/history:
 *   get:
 *     summary: Get price history by ID
 *     description: Retrieve price history for a specific price ID
 *     tags: [Agent Prices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price ID
 *         example: "price-123"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of history records to return
 *     responses:
 *       200:
 *         description: Price history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PriceHistory'
 *       404:
 *         description: Price not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id/history', publicCacheMiddleware({ duration: 600 }), priceController.getPriceHistory);

/**
 * @swagger
 * /api/agent-prices/{id}:
 *   post:
 *     summary: Update price
 *     description: Update pricing information (authentication required)
 *     tags: [Agent Prices]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price ID
 *         example: "price-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - price
 *             properties:
 *               price:
 *                 type: number
 *                 description: New price
 *                 example: 9.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               discount:
 *                 type: number
 *                 description: Discount percentage
 *                 example: 10
 *               isFree:
 *                 type: boolean
 *                 description: Whether the agent is free
 *                 example: false
 *     responses:
 *       200:
 *         description: Price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Price not found
 *       500:
 *         description: Internal server error
 */
router.post('/:id', validateFirebaseToken, priceController.updatePrice);

/**
 * @swagger
 * /api/agent-prices/{id}/discount:
 *   patch:
 *     summary: Apply discount
 *     description: Apply a discount to an agent price (authentication required)
 *     tags: [Agent Prices]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price ID
 *         example: "price-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - discount
 *             properties:
 *               discount:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Discount percentage
 *                 example: 15
 *               validUntil:
 *                 type: string
 *                 format: date-time
 *                 description: Discount expiration date
 *                 example: "2024-12-31T23:59:59.000Z"
 *     responses:
 *       200:
 *         description: Discount applied successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Price not found
 *       500:
 *         description: Internal server error
 */
router.patch('/:id/discount', validateFirebaseToken, priceController.applyDiscount);

/**
 * @swagger
 * /api/agent-prices/agent/{agentId}/price:
 *   get:
 *     summary: Get agent price
 *     description: Retrieve pricing information for a specific agent
 *     tags: [Agent Prices]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     responses:
 *       200:
 *         description: Agent price retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Update agent price
 *     description: Update pricing information for a specific agent (authentication required)
 *     tags: [Agent Prices]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - price
 *             properties:
 *               price:
 *                 type: number
 *                 description: New price
 *                 example: 9.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               discount:
 *                 type: number
 *                 description: Discount percentage
 *                 example: 10
 *               isFree:
 *                 type: boolean
 *                 description: Whether the agent is free
 *                 example: false
 *     responses:
 *       200:
 *         description: Agent price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 */
router.get('/agent/:agentId/price', publicCacheMiddleware({ duration: 300 }), priceController.getAgentPrice);
router.post('/agent/:agentId/price', validateFirebaseToken, priceController.updateAgentPrice);

/**
 * @swagger
 * /api/agent-prices/history:
 *   get:
 *     summary: Get all price history
 *     description: Retrieve price history for all agents
 *     tags: [Agent Prices]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of history records per page
 *       - in: query
 *         name: agentId
 *         schema:
 *           type: string
 *         description: Filter by specific agent ID
 *         example: "agent-123"
 *     responses:
 *       200:
 *         description: Price history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginationResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/PriceHistory'
 *       500:
 *         description: Internal server error
 */
router.get('/history', priceController.getPriceHistory);

/**
 * @swagger
 * /api/agent-prices/{agentId}/history:
 *   get:
 *     summary: Get agent price history
 *     description: Retrieve price history for a specific agent
 *     tags: [Agent Prices]
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of history records to return
 *     responses:
 *       200:
 *         description: Agent price history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PriceHistory'
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 */
router.get('/:agentId/history', priceController.getPriceHistory);

/**
 * @swagger
 * /api/agent-prices/migrate:
 *   post:
 *     summary: Migrate price data
 *     description: Migrate and fix price data inconsistencies (authentication required)
 *     tags: [Agent Prices]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dryRun:
 *                 type: boolean
 *                 description: Whether to perform a dry run without making changes
 *                 default: true
 *               agentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Specific agent IDs to migrate (optional)
 *                 example: ["agent-123", "agent-456"]
 *     responses:
 *       200:
 *         description: Price data migration completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Price data migration completed"
 *                 processedCount:
 *                   type: integer
 *                   example: 150
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: []
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/migrate', validateFirebaseToken, priceController.migratePriceData);

module.exports = router; 