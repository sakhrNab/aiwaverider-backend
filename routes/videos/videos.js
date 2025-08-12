const express = require('express');
const router = express.Router();
const { addVideo, listVideos, refreshVideoStats, deleteVideo } = require('../../controllers/videoController');
const adminAuth = require('../../middleware/adminAuth');

/**
 * @route   GET /api/videos
 * @desc    List videos with pagination
 * @access  Public
 * @params  platform (required), page (optional, default 1)
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