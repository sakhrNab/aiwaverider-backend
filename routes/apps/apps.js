// backend/routes/apps/apps.js
const express = require('express');
const router = express.Router();
const appsController = require('../../controllers/app/appsController');
const { validateFirebaseToken, isAdmin } = require('../../middleware/authenticationMiddleware');
const { appFields } = require('../../middleware/upload');

// ==========================================
// CACHE MANAGEMENT (Admin only)
// ==========================================
router.post('/cache/refresh', validateFirebaseToken, isAdmin, appsController.refreshCache);

// ==========================================
// PUBLIC ENDPOINTS
// ==========================================

// Get featured apps (must come before :appId)
router.get('/featured', appsController.getFeaturedApps);

// Get all apps with filtering and pagination
router.get('/', appsController.getApps);

// Get single app by ID or slug
router.get('/:appId', appsController.getAppById);

// Track views
router.post('/:appId/views', appsController.incrementViews);

// Free download tracking
router.post('/:appId/download', appsController.freeDownload);

// ==========================================
// ADMIN ENDPOINTS (Authenticated + Admin)
// Disk storage with 1GB limit for download files
// ==========================================

// Create new app
router.post('/', validateFirebaseToken, isAdmin, appFields, appsController.createApp);

// Update app
router.put('/:appId', validateFirebaseToken, isAdmin, appFields, appsController.updateApp);

// Delete app
router.delete('/:appId', validateFirebaseToken, isAdmin, appsController.deleteApp);

module.exports = router;
