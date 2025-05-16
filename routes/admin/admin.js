/**
 * Admin routes for the AI Waverider platform
 * These routes are protected and only accessible to admin users
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { validateFirebaseToken, isAdmin } = require('../../middleware/authenticationMiddleware');
const { getSettings, updateSettings, resetSettings } = require('../../models/siteSettings');
const { db } = require('../../config/firebase');
const adminController = require('../../controllers/admin/adminController');

// Apply authentication middleware to all admin routes
router.use(validateFirebaseToken);
router.use(isAdmin);

/**
 * GET /api/admin/settings
 * Get site settings (admin only)
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await getSettings(db);
    res.json(settings);
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * PUT /api/admin/settings
 * Update site settings (admin only)
 */
router.put('/settings', async (req, res) => {
  try {
    const updatedSettings = await updateSettings(db, req.body);
    res.json(updatedSettings);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/admin/settings/reset
 * Reset site settings to default values (admin only)
 */
router.post('/settings/reset', async (req, res) => {
  try {
    const defaultSettings = await resetSettings(db);
    res.json(defaultSettings);
  } catch (error) {
    console.error('Error resetting settings:', error);
    res.status(500).json({ error: 'Failed to reset settings' });
  }
});

/**
 * @route   GET /api/admin/status
 * @desc    Check admin API status
 * @access  Admin
 */
router.get('/status', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Admin API is operational',
    user: req.user
  });
});

/**
 * @route   POST /api/admin/update-agent-creators
 * @desc    Update all agent creators with the new structure
 * @access  Admin
 */
router.post('/update-agent-creators', adminController.updateAgentCreators);

/**
 * @route   GET /api/admin/dashboard-stats
 * @desc    Get admin dashboard statistics
 * @access  Admin
 */
router.get('/dashboard-stats', adminController.getDashboardStats);

/**
 * @route   GET /api/admin/tools/update-creators
 * @desc    Serve the admin page for updating agent creators
 * @access  Admin
 */
router.get('/tools/update-creators', async (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'templates', 'admin', 'updateCreators.html');
    const content = await fs.readFile(filePath, 'utf8');
    res.set('Content-Type', 'text/html');
    res.send(content);
  } catch (error) {
    console.error('Error serving admin page:', error);
    res.status(500).send(`
      <html>
        <body>
          <h1>Error</h1>
          <p>Could not load the admin tool page. Please check the server logs.</p>
          <p>Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

// Export the router
module.exports = router; 