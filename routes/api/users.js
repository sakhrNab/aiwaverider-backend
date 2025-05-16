const express = require('express');
const router = express.Router();
const userController = require('../../controllers/user/userController');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;

// Apply authentication middleware to all routes
router.use(validateFirebaseToken);

// GET /api/users - Get all users with pagination
router.get('/', userController.getUsers);

// GET /api/users/:userId - Get a single user by ID
router.get('/:userId', userController.getUserById);

// POST /api/users - Create a new user
router.post('/', userController.createUser);

// PUT /api/users/:userId - Update a user
router.put('/:userId', userController.updateUser);

// DELETE /api/users/:userId - Delete a user
router.delete('/:userId', userController.deleteUser);

module.exports = router; 