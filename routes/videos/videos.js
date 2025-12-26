const express = require('express');
const router = express.Router();
const { addVideo, listVideos, refreshVideoStats, deleteVideo } = require('../../controllers/videoController');
const adminAuth = require('../../middleware/adminAuth');

/**
 * @swagger
 * /api/videos:
 *   get:
 *     summary: List videos with pagination
 *     description: Retrieve a paginated list of videos from various platforms
 *     tags: [Videos]
 *     parameters:
 *       - in: query
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *           enum: [youtube, vimeo, tiktok]
 *         description: Video platform
 *         example: "youtube"
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
 *           default: 10
 *         description: Number of videos per page
 *     responses:
 *       200:
 *         description: Videos retrieved successfully
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
 *                         $ref: '#/components/schemas/Video'
 *       400:
 *         description: Bad request - Missing required parameters
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
router.get('/', listVideos);

/**
 * @route   POST /api/videos
 * @desc    Add a new video (Admin only)
 * @access  Admin
 * @body    { platform, originalUrl, addedBy }
 */
router.post('/', adminAuth, addVideo);

/**
 * @route   PUT /api/videos/:id/refresh
 * @desc    Refresh video stats (Admin only)
 * @access  Admin
 * @params  id (video document ID)
 */
router.put('/:id/refresh', adminAuth, refreshVideoStats);

/**
 * @route   DELETE /api/videos/:id
 * @desc    Delete a video (Admin only)
 * @access  Admin
 */
router.delete('/:id', adminAuth, deleteVideo);

module.exports = router; 