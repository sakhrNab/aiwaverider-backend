/**
 * Admin Email Routes
 * 
 * Routes for handling email functionality in the admin panel:
 * - Sending welcome emails
 * - Creating and sending weekly updates
 * - Sending global announcements
 * - Viewing email logs and statistics
 */

const express = require('express');
const router = express.Router();
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const { isAdmin } = require('../../middleware/authenticationMiddleware');
const emailController = require('../../controllers/email/emailController');

/**
 * GET /api/admin/email/campaigns
 * Get list of email campaigns with pagination
 */
// Commenting out until controller method is implemented
// router.get('/campaigns', validateFirebaseToken, isAdmin, emailController.getCampaigns);

/**
 * GET /api/admin/email/campaigns/:campaignId
 * Get details of a specific email campaign
 */
// Commenting out until controller method is implemented
// router.get('/campaigns/:campaignId', validateFirebaseToken, isAdmin, emailController.getCampaignDetails);

/**
 * GET /api/admin/email/stats
 * Get email preference statistics
 */
// router.get('/stats', validateFirebaseToken, isAdmin, emailController.getEmailStats);

/**
 * POST /api/admin/email/welcome/:userId
 * Send a welcome email to a specific user
 */
router.post('/welcome/:userId', validateFirebaseToken, isAdmin, emailController.sendWelcomeEmail);

/**
 * POST /api/admin/email/weekly-update
 * Send a weekly update to all subscribed users
 * 
 * Body:
 * - newAgents: Array of new agents to feature
 * - newTools: Array of new tools to feature
 * - featuredContent: Array of featured content (blog posts, etc.)
 * - weekLabel: (Optional) Custom label for the week
 * - previewEmail: (Optional) If provided, sends only to this email as a preview
 */
// Commenting out until controller method is implemented
// router.post('/weekly-update', validateFirebaseToken, isAdmin, emailController.sendWeeklyUpdate);

/**
 * POST /api/admin/email/announcement
 * Send a global announcement to users
 * 
 * Body:
 * - subject: Announcement subject
 * - message: Announcement message (plain text)
 * - messageHtml: (Optional) HTML version of the message
 * - ctaText: (Optional) Call to action button text
 * - ctaUrl: (Optional) Call to action URL
 * - targetGroups: (Optional) Array of user groups to target (defaults to 'all')
 * - previewEmail: (Optional) If provided, sends only to this email as a preview
 */
// Using sendGlobalAnnouncement instead of sendAnnouncement
router.post('/announcement', validateFirebaseToken, isAdmin, emailController.sendGlobalAnnouncement);

module.exports = router; 