const express = require('express');
const router = express.Router();
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');
const wishlistController = require('../../controllers/agent/wishlistController');

/**
 * @swagger
 * /api/wishlists:
 *   get:
 *     summary: Get all public wishlists
 *     description: Retrieve a list of all public wishlists
 *     tags: [Wishlists]
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
 *           default: 10
 *         description: Number of wishlists per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for wishlist name
 *         example: "favorites"
 *     responses:
 *       200:
 *         description: Public wishlists retrieved successfully
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
 *                         $ref: '#/components/schemas/Wishlist'
 *       500:
 *         description: Internal server error
 */
router.get('/', wishlistController.getWishlists);

/**
 * @swagger
 * /api/wishlists/user:
 *   get:
 *     summary: Get user's wishlists
 *     description: Retrieve all wishlists belonging to the authenticated user
 *     tags: [Wishlists]
 *     security:
 *       - FirebaseAuth: []
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
 *           default: 10
 *         description: Number of wishlists per page
 *     responses:
 *       200:
 *         description: User's wishlists retrieved successfully
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
 *                         $ref: '#/components/schemas/Wishlist'
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/user', validateFirebaseToken, wishlistController.getUserWishlists);

/**
 * @swagger
 * /api/wishlists/{wishlistId}:
 *   get:
 *     summary: Get wishlist by ID
 *     description: Retrieve a specific wishlist by its ID
 *     tags: [Wishlists]
 *     parameters:
 *       - in: path
 *         name: wishlistId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wishlist ID
 *         example: "wishlist-123"
 *     responses:
 *       200:
 *         description: Wishlist retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Wishlist'
 *       404:
 *         description: Wishlist not found
 *       500:
 *         description: Internal server error
 */
router.get('/:wishlistId', wishlistController.getWishlistById);

/**
 * @swagger
 * /api/wishlists:
 *   post:
 *     summary: Create new wishlist
 *     description: Create a new wishlist (authentication required)
 *     tags: [Wishlists]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Wishlist name
 *                 example: "My Favorite Agents"
 *               description:
 *                 type: string
 *                 description: Wishlist description
 *                 example: "A collection of my favorite AI agents"
 *               isPublic:
 *                 type: boolean
 *                 description: Whether the wishlist is public
 *                 default: false
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "favorites,ai,writing"
 *     responses:
 *       201:
 *         description: Wishlist created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Wishlist'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/', validateFirebaseToken, wishlistController.createWishlist);

/**
 * @swagger
 * /api/wishlists/{wishlistId}:
 *   put:
 *     summary: Update wishlist
 *     description: Update an existing wishlist (authentication required)
 *     tags: [Wishlists]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: wishlistId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wishlist ID
 *         example: "wishlist-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Wishlist name
 *                 example: "Updated Wishlist Name"
 *               description:
 *                 type: string
 *                 description: Wishlist description
 *                 example: "Updated description"
 *               isPublic:
 *                 type: boolean
 *                 description: Whether the wishlist is public
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "favorites,ai,writing"
 *     responses:
 *       200:
 *         description: Wishlist updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Wishlist'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Wishlist not found
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete wishlist
 *     description: Delete a wishlist (authentication required)
 *     tags: [Wishlists]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: wishlistId
 *         required: true
 *         schema:
 *           type: string
 *         description: Wishlist ID
 *         example: "wishlist-123"
 *     responses:
 *       200:
 *         description: Wishlist deleted successfully
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
 *                   example: "Wishlist deleted successfully"
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Wishlist not found
 *       500:
 *         description: Internal server error
 */
router.put('/:wishlistId', validateFirebaseToken, wishlistController.updateWishlist);
router.delete('/:wishlistId', validateFirebaseToken, wishlistController.deleteWishlist);

/**
 * @swagger
 * /api/wishlists/toggle:
 *   post:
 *     summary: Toggle agent in wishlist
 *     description: Add or remove an agent from a wishlist (authentication required)
 *     tags: [Wishlists]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agentId
 *               - wishlistId
 *             properties:
 *               agentId:
 *                 type: string
 *                 description: Agent ID to toggle
 *                 example: "agent-123"
 *               wishlistId:
 *                 type: string
 *                 description: Wishlist ID
 *                 example: "wishlist-456"
 *     responses:
 *       200:
 *         description: Agent toggled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 added:
 *                   type: boolean
 *                   description: Whether the agent was added (true) or removed (false)
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Agent added to wishlist"
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent or wishlist not found
 *       500:
 *         description: Internal server error
 */
router.post('/toggle', validateFirebaseToken, wishlistController.toggleWishlistItem);

/**
 * GET /api/wishlists/check/:agentId
 * Check if agent is in user's wishlist
 */
// router.get('/check/:agentId', wishlistController.checkWishlistItem);

module.exports = router; 