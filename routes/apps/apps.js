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
// SKOOL LEADS (Admin only) — must come before :appId
// ==========================================
router.get('/skool-leads', validateFirebaseToken, isAdmin, appsController.getSkoolLeads);
router.get('/skool-leads/emails', validateFirebaseToken, isAdmin, appsController.getSkoolLeadEmails);

// ==========================================
// PUBLIC ENDPOINTS
// ==========================================

// Get featured apps (must come before :appId)
router.get('/featured', appsController.getFeaturedApps);

// Get all apps with filtering and pagination
router.get('/', appsController.getApps);

// Get single app by ID or slug
router.get('/:appId', appsController.getAppById);

// Serve download file with clean filename
router.get('/:appId/file', appsController.serveFile);

// Track views
router.post('/:appId/views', appsController.incrementViews);

// Free download tracking
router.post('/:appId/download', appsController.freeDownload);

// Skool member free download (email + access code)
router.post('/:appId/skool-download', appsController.skoolDownload);

// Get download link for purchased apps (auth required)
router.get('/:appId/download-link', validateFirebaseToken, appsController.getDownloadLink);

// ==========================================
// ADMIN ENDPOINTS (Authenticated + Admin)
// Disk storage with 1GB limit for download files
// ==========================================

// Create new app
router.post('/', validateFirebaseToken, isAdmin, appFields, appsController.createApp);

// Update app
router.put('/:appId', validateFirebaseToken, isAdmin, appFields, appsController.updateApp);

// Remove only the download file (keeps the app)
router.delete('/:appId/download-file', validateFirebaseToken, isAdmin, appsController.deleteDownloadFile);

// Delete app
router.delete('/:appId', validateFirebaseToken, isAdmin, appsController.deleteApp);

module.exports = router;
