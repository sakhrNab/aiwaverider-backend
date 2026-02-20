const express = require('express');
const router = express.Router();
const { validateFirebaseToken } = require('../../middleware/authenticationMiddleware');
const notificationController = require('../../controllers/notification/notificationController');

// All routes require authentication
router.use(validateFirebaseToken);

// GET  /api/notifications              — paginated list
router.get('/', notificationController.getNotifications);

// GET  /api/notifications/unread-count — unread badge count
router.get('/unread-count', notificationController.getUnreadCount);

// GET  /api/notifications/preferences  — notification prefs
router.get('/preferences', notificationController.getPreferences);

// PUT  /api/notifications/preferences  — update prefs
router.put('/preferences', notificationController.updatePreferences);

// PUT  /api/notifications/read-all     — mark all read
router.put('/read-all', notificationController.markAllAsRead);

// PUT  /api/notifications/:id/read     — mark one read
router.put('/:id/read', notificationController.markAsRead);

// DELETE /api/notifications/:id        — delete one
router.delete('/:id', notificationController.deleteNotification);

// DELETE /api/notifications            — delete all
router.delete('/', notificationController.deleteAllNotifications);

module.exports = router;
