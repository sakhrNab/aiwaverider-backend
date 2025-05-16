/**
 * Email API Routes
 * 
 * Routes for email operations
 */

const express = require('express');
const router = express.Router();
const emailController = require('../../controllers/email/emailController');
const { isAdmin, auth } = require('../../middleware/authenticationMiddleware');

// Routes require authentication
router.use(auth);

/**
 * @route   POST /api/email/test
 * @desc    Send a test email
 * @access  Admin
 */
router.post('/test', isAdmin, emailController.sendTestEmail);

/**
 * @route   POST /api/email/welcome
 * @desc    Send a welcome email manually
 * @access  Admin
 */
router.post('/welcome', isAdmin, emailController.sendWelcomeEmail);

/**
 * @route   POST /api/email/update
 * @desc    Send an update email to users with matching preferences
 * @access  Admin
 */
router.post('/update', isAdmin, emailController.sendUpdateEmail);

/**
 * @route   POST /api/email/global
 * @desc    Send a global announcement to all users or those with announcement preferences
 * @access  Admin
 */
router.post('/global', isAdmin, emailController.sendGlobalAnnouncement);

/**
 * @route   POST /api/email/send-custom
 * @desc    Send a custom email to specific recipients
 * @access  Admin
 */
router.post('/send-custom', isAdmin, emailController.sendCustomEmail);

/**
 * @route   POST /api/email/send-agent-update
 * @desc    Send an AI agent update email to specific recipients
 * @access  Admin
 */
router.post('/send-agent-update', isAdmin, emailController.sendAgentUpdateEmail);

/**
 * @route   POST /api/email/send-tool-update
 * @desc    Send an AI tool update email to specific recipients
 * @access  Admin
 */
router.post('/send-tool-update', isAdmin, emailController.sendToolUpdateEmail);

/**
 * @route   GET /api/email/stats
 * @desc    Get email statistics
 * @access  Admin
 */
// router.get('/stats', isAdmin, emailController.getEmailStats);

/**
 * @route   PUT /api/email/preferences/:userId
 * @desc    Update a user's email preferences
 * @access  Private (own user) or Admin
 */
router.put('/preferences/:userId', emailController.updateEmailPreferences);

/**
 * @route   POST /api/email/update/users
 * @desc    Send update notifications to specific users
 * @access  Admin
 */
router.post('/update/users', isAdmin, emailController.sendUpdateToUsers);

/**
 * @route   GET /api/email/templates/:templateType
 * @desc    Get an email template
 * @access  Admin
 */
router.get('/templates/:templateType', isAdmin, emailController.getEmailTemplate);

/**
 * @route   POST /api/email/templates/:templateType
 * @desc    Update an email template
 * @access  Admin
 */
router.post('/templates/:templateType', isAdmin, emailController.updateEmailTemplate);

/**
 * @route   POST /api/email/test-welcome
 * @desc    Send a test welcome email
 * @access  Admin
 */
router.post('/test-welcome', isAdmin, emailController.sendTestWelcomeEmail);

/**
 * @route   POST /api/email/test-update
 * @desc    Send a test update email
 * @access  Admin
 */
router.post('/test-update', isAdmin, emailController.sendTestUpdateEmail);

/**
 * @route   POST /api/email/test-global
 * @desc    Send a test global announcement email
 * @access  Admin
 */
router.post('/test-global', isAdmin, emailController.sendTestGlobalEmail);

/**
 * @route   POST /api/email/test-agent
 * @desc    Send a test agent update email
 * @access  Admin
 */
router.post('/test-agent', isAdmin, emailController.sendTestAgentEmail);

/**
 * @route   POST /api/email/test-tool
 * @desc    Send a test tool update email
 * @access  Admin
 */
router.post('/test-tool', isAdmin, emailController.sendTestToolEmail);

/**
 * @route   POST /api/email/test-custom
 * @desc    Send a test custom email
 * @access  Admin
 */
router.post('/test-custom', isAdmin, emailController.sendTestCustomEmail);

/**
 * @route   POST /api/email/test-agent-update
 * @desc    Send a test agent update email with latest agents
 * @access  Admin
 */
router.post('/test-agent-update', isAdmin, emailController.sendTestAgentUpdateEmail);

module.exports = router; 