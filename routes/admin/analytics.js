/**
 * Analytics routes for the AI Waverider platform
 * These routes are protected and only accessible to admin users
 */

const express = require('express');
const router = express.Router();
const { validateFirebaseToken, isAdmin } = require('../../middleware/authenticationMiddleware');
const analyticsController = require('../../controllers/admin/analyticsController');

// Apply authentication and admin middleware to all analytics routes
router.use(validateFirebaseToken);
router.use(isAdmin);

/**
 * @swagger
 * /api/admin/analytics:
 *   get:
 *     summary: Get comprehensive analytics data
 *     description: Returns all analytics metrics from PostgreSQL (users, agents, orders, revenue, charts)
 *     tags: [Admin Analytics]
 *     security:
 *       - FirebaseAuth: []
 *       - AdminToken: []
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [week, month, year]
 *           default: week
 *         description: Time range for analytics data
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/', analyticsController.getAnalyticsData);

/**
 * @swagger
 * /api/admin/analytics/top-agents:
 *   get:
 *     summary: Get top performing agents
 *     description: Get list of top performing agents by downloads
 *     tags: [Admin Analytics]
 *     security:
 *       - FirebaseAuth: []
 *       - AdminToken: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of top agents to return
 *     responses:
 *       200:
 *         description: Top agents retrieved successfully
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/top-agents', analyticsController.getTopAgents);

module.exports = router;
