const express = require('express');
const router = express.Router();
const userController = require('../../controllers/user/userController');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;

// Apply authentication middleware to all routes
router.use(validateFirebaseToken);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users with pagination
 *     description: Retrieve a paginated list of all users in the system
 *     tags: [Users]
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
 *         description: Number of users per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for user name or email
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [user, admin, moderator]
 *         description: Filter by user role
 *     responses:
 *       200:
 *         description: Users retrieved successfully
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
 *                     $ref: '#/components/schemas/User'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       403:
 *         description: Forbidden - Insufficient permissions
 *       500:
 *         description: Internal server error
 */
router.get('/', userController.getUsers);

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Get user by ID
 *     description: Retrieve a specific user by their ID
 *     tags: [Users]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *         example: "user-123"
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/:userId', userController.getUserById);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create new user
 *     description: Create a new user in the system
 *     tags: [Users]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - displayName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *                 example: "user@example.com"
 *               displayName:
 *                 type: string
 *                 description: User display name
 *                 example: "John Doe"
 *               role:
 *                 type: string
 *                 enum: [user, admin, moderator]
 *                 default: user
 *                 description: User role
 *               photoURL:
 *                 type: string
 *                 format: uri
 *                 description: User profile photo URL
 *                 example: "https://example.com/photo.jpg"
 *               preferences:
 *                 type: object
 *                 description: User preferences
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       409:
 *         description: Conflict - User already exists
 *       500:
 *         description: Internal server error
 */
router.post('/', userController.createUser);

/**
 * @swagger
 * /api/users/{userId}:
 *   put:
 *     summary: Update user
 *     description: Update an existing user's information
 *     tags: [Users]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *         example: "user-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 description: User display name
 *                 example: "John Doe Updated"
 *               role:
 *                 type: string
 *                 enum: [user, admin, moderator]
 *                 description: User role
 *               photoURL:
 *                 type: string
 *                 format: uri
 *                 description: User profile photo URL
 *                 example: "https://example.com/photo.jpg"
 *               preferences:
 *                 type: object
 *                 description: User preferences
 *               isActive:
 *                 type: boolean
 *                 description: Whether user account is active
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.put('/:userId', userController.updateUser);

/**
 * @swagger
 * /api/users/{userId}:
 *   delete:
 *     summary: Delete user
 *     description: Delete a user from the system
 *     tags: [Users]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *         example: "user-123"
 *     responses:
 *       200:
 *         description: User deleted successfully
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
 *                   example: "User deleted successfully"
 *       401:
 *         description: Unauthorized - Invalid or missing Firebase token
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:userId', userController.deleteUser);

module.exports = router; 