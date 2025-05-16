const express = require('express');
const router = express.Router();
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');
const wishlistController = require('../../controllers/agent/wishlistController');

/**
 * GET /api/wishlists
 * Get all public wishlists
 */
router.get('/', wishlistController.getWishlists);

/**
 * GET /api/wishlists/user
 * Get user's wishlists (requires authentication)
 */
router.get('/user', validateFirebaseToken, wishlistController.getUserWishlists);

/**
 * GET /api/wishlists/:wishlistId
 * Get wishlist by ID
 */
router.get('/:wishlistId', wishlistController.getWishlistById);

/**
 * POST /api/wishlists
 * Create a new wishlist (requires authentication)
 */
router.post('/', validateFirebaseToken, wishlistController.createWishlist);

/**
 * PUT /api/wishlists/:wishlistId
 * Update a wishlist (requires authentication)
 */
router.put('/:wishlistId', validateFirebaseToken, wishlistController.updateWishlist);

/**
 * DELETE /api/wishlists/:wishlistId
 * Delete a wishlist (requires authentication)
 */
router.delete('/:wishlistId', validateFirebaseToken, wishlistController.deleteWishlist);

/**
 * POST /api/wishlists/toggle
 * Toggle agent in wishlist (requires authentication)
 */
router.post('/toggle', validateFirebaseToken, wishlistController.toggleWishlistItem);

/**
 * GET /api/wishlists/check/:agentId
 * Check if agent is in user's wishlist
 */
// router.get('/check/:agentId', wishlistController.checkWishlistItem);

module.exports = router; 