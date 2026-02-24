/**
 * Public Analytics routes for tracking
 * These routes are public and used for tracking user behavior
 */

const express = require('express');
const router = express.Router();
const analyticsController = require('../../controllers/admin/analyticsController');

/**
 * @swagger
 * /api/analytics/track-view:
 *   post:
 *     summary: Track a page view
 *     description: Track when a user visits a page for analytics
 *     tags: [Analytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - page
 *             properties:
 *               page:
 *                 type: string
 *                 description: Page name/route being viewed
 *                 example: "/agents"
 *               metadata:
 *                 type: object
 *                 description: Additional metadata about the page view
 *     responses:
 *       200:
 *         description: Page view tracked successfully
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
 *                   example: "Page view tracked successfully"
 *       400:
 *         description: Bad request - Page name is required
 *       500:
 *         description: Internal server error
 */
router.post('/track-view', analyticsController.trackPageView);

module.exports = router;






