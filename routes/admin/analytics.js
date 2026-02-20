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

// Debug logging
console.log('Analytics routes loaded successfully');

/**
 * @swagger
 * /api/admin/analytics:
 *   get:
 *     summary: Get detailed analytics data
 *     description: Get comprehensive analytics data for a specific time range
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Analytics data object
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/', analyticsController.getAnalyticsData);

/**
 * @swagger
 * /api/admin/analytics/visitors:
 *   get:
 *     summary: Get visitor analytics
 *     description: Get detailed visitor analytics data
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
 *         description: Time range for visitor analytics
 *     responses:
 *       200:
 *         description: Visitor analytics retrieved successfully
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/visitors', analyticsController.getVisitorAnalytics);

/**
 * @swagger
 * /api/admin/analytics/revenue:
 *   get:
 *     summary: Get revenue analytics
 *     description: Get detailed revenue analytics data
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
 *         description: Time range for revenue analytics
 *     responses:
 *       200:
 *         description: Revenue analytics retrieved successfully
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/revenue', analyticsController.getRevenueAnalytics);

/**
 * @swagger
 * /api/admin/analytics/users:
 *   get:
 *     summary: Get user analytics
 *     description: Get detailed user analytics data
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
 *         description: Time range for user analytics
 *     responses:
 *       200:
 *         description: User analytics retrieved successfully
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/users', analyticsController.getUserAnalytics);

/**
 * @swagger
 * /api/admin/analytics/downloads:
 *   get:
 *     summary: Get download analytics
 *     description: Get detailed download analytics data
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
 *         description: Time range for download analytics
 *     responses:
 *       200:
 *         description: Download analytics retrieved successfully
 *       401:
 *         description: Unauthorized - Admin access required
 *       500:
 *         description: Internal server error
 */
router.get('/downloads', analyticsController.getDownloadAnalytics);

/**
 * @swagger
 * /api/admin/analytics/top-agents:
 *   get:
 *     summary: Get top performing agents
 *     description: Get list of top performing agents by downloads/revenue
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
 *         description: Time range for top agents
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

/**
 * @route GET /api/admin/analytics/detailed-users
 * @desc Get detailed user information for analytics
 * @access Admin
 */
router.get('/detailed-users', analyticsController.getDetailedUserInfo);

/**
 * @route POST /api/admin/analytics/populate
 * @desc Populate analytics from existing data (one-time script)
 * @access Admin
 */
router.post('/populate', analyticsController.populateAnalytics);

module.exports = router;
