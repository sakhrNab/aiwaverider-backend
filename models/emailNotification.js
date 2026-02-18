/**
 * Email Notification Model
 *
 * Handles email notification data, campaigns, and logs
 *
 * Migrated from Firestore to PostgreSQL.
 * Functions that query the `users` table use pool.query() directly.
 * Functions that depended on non-existent tables (emailCampaigns, emailLogs,
 * emailTemplates, waitlist) are stubbed with logging until those tables are created.
 */

const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Create a new email campaign
 * @param {Object} campaignData - Campaign data
 * @returns {Promise<string>} - Campaign ID
 */
// TODO: Create email_campaigns table to persist this data
exports.createCampaign = async (campaignData) => {
  try {
    const campaignId = uuidv4();
    const now = new Date().toISOString();

    logger.info(`[STUB] createCampaign: id=${campaignId}, data=${JSON.stringify({
      ...campaignData,
      status: 'created',
      createdAt: now,
      updatedAt: now
    })}`);

    return campaignId;
  } catch (error) {
    logger.error(`Error creating email campaign: ${error.message}`);
    throw error;
  }
};

/**
 * Update an email campaign
 * @param {string} campaignId - Campaign ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<void>}
 */
// TODO: Create email_campaigns table to persist this data
exports.updateCampaign = async (campaignId, updateData) => {
  try {
    // Don't allow updating certain fields directly
    const { sentCount, failedCount, startedAt, completedAt, ...safeUpdateData } = updateData;
    const now = new Date().toISOString();

    logger.info(`[STUB] updateCampaign: id=${campaignId}, data=${JSON.stringify({
      ...safeUpdateData,
      updatedAt: now
    })}`);
  } catch (error) {
    logger.error(`Error updating email campaign: ${error.message}`);
    throw error;
  }
};

/**
 * Mark campaign as sending
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<void>}
 */
// TODO: Create email_campaigns table to persist this data
exports.markCampaignAsSending = async (campaignId) => {
  try {
    const now = new Date().toISOString();

    logger.info(`[STUB] markCampaignAsSending: id=${campaignId}, status=sending, startedAt=${now}`);
  } catch (error) {
    logger.error(`Error marking campaign as sending: ${error.message}`);
    throw error;
  }
};

/**
 * Mark campaign as completed
 * @param {string} campaignId - Campaign ID
 * @param {number} sentCount - Number of emails sent
 * @param {number} failedCount - Number of emails failed
 * @param {Array} errors - Errors encountered
 * @returns {Promise<void>}
 */
// TODO: Create email_campaigns table to persist this data
exports.markCampaignAsCompleted = async (campaignId, sentCount, failedCount, errors = []) => {
  try {
    const now = new Date().toISOString();

    logger.info(`[STUB] markCampaignAsCompleted: id=${campaignId}, sentCount=${sentCount}, failedCount=${failedCount}, errors=${JSON.stringify(errors || [])}, completedAt=${now}`);
  } catch (error) {
    logger.error(`Error marking campaign as completed: ${error.message}`);
    throw error;
  }
};

/**
 * Log an email send event
 * @param {Object} sendData - Send data
 * @returns {Promise<string>} - Log entry ID
 */
// TODO: Create email_logs table to persist this data
exports.logEmailSend = async (sendData) => {
  try {
    const logId = uuidv4();
    const now = new Date().toISOString();

    logger.info(`[STUB] logEmailSend: id=${logId}, data=${JSON.stringify({
      ...sendData,
      timestamp: now
    })}`);

    return logId;
  } catch (error) {
    logger.error(`Error logging email send: ${error.message}`);
    throw error;
  }
};

/**
 * Get users by email preferences
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} - Filtered users
 */
exports.getUsersByPreferences = async (options = {}) => {
  try {
    const { emailTypes = [] } = options;

    if (emailTypes.length === 0) {
      // No preference filter -- return all active users
      const { rows } = await pool.query(
        `SELECT id, email, status, email_preferences, first_name, last_name, display_name, username
         FROM users
         WHERE status = 'active'`
      );

      return rows.map(row => ({
        id: row.id,
        email: row.email,
        status: row.status,
        emailPreferences: row.email_preferences,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        username: row.username
      }));
    }

    // Build a JSONB filter: match users where at least one of the requested
    // preference types is NOT explicitly set to false.
    // We use: email_preferences IS NULL (default = opted-in)
    //      OR email_preferences->>type IS NULL (key absent = opted-in)
    //      OR email_preferences->>type != 'false'
    const conditions = emailTypes.map((_, i) => {
      const param = `$${i + 1}`;
      return `(email_preferences IS NULL OR email_preferences->>` + param + ` IS NULL OR email_preferences->>` + param + ` != 'false')`;
    });

    const whereClause = conditions.join(' OR ');
    const queryText = `
      SELECT id, email, status, email_preferences, first_name, last_name, display_name, username
      FROM users
      WHERE status = 'active'
        AND (${whereClause})
    `;

    const { rows } = await pool.query(queryText, emailTypes);

    return rows.map(row => ({
      id: row.id,
      email: row.email,
      status: row.status,
      emailPreferences: row.email_preferences,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      username: row.username
    }));
  } catch (error) {
    logger.error(`Error getting users by preferences: ${error.message}`);
    throw error;
  }
};

/**
 * Get email preference statistics
 * @returns {Promise<Object>} - Email preference stats
 */
exports.getEmailPreferenceStats = async () => {
  try {
    const prefKeys = ['weeklyUpdates', 'announcements', 'newAgents', 'newTools', 'marketingEmails'];

    // Build aggregation expressions for each preference key
    const countExpressions = prefKeys.map(key =>
      `COUNT(*) FILTER (WHERE email_preferences->>'${key}' = 'true') AS "${key}"`
    ).join(', ');

    const queryText = `
      SELECT
        COUNT(*) AS total_users,
        ${countExpressions}
      FROM users
    `;

    const { rows } = await pool.query(queryText);
    const row = rows[0];

    const preferences = {};
    for (const key of prefKeys) {
      preferences[key] = parseInt(row[key], 10) || 0;
    }

    return {
      totalUsers: parseInt(row.total_users, 10) || 0,
      preferences
    };
  } catch (error) {
    logger.error(`Error getting email preference stats: ${error.message}`);
    throw error;
  }
};

/**
 * Update a user's email preferences
 * @param {string} userId - User ID
 * @param {Object} preferences - Email preferences
 * @returns {Promise<void>}
 */
exports.updateUserEmailPreferences = async (userId, preferences) => {
  try {
    await pool.query(
      `UPDATE users
       SET email_preferences = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(preferences), userId]
    );
  } catch (error) {
    logger.error(`Error updating email preferences: ${error.message}`);
    throw error;
  }
};

/**
 * Get an email template
 * @param {string} templateType - Template type
 * @returns {Promise<Object>} - Template data
 */
// TODO: Create email_templates table to persist this data
exports.getEmailTemplate = async (templateType) => {
  try {
    // No email_templates table yet -- always return defaults
    logger.info(`[STUB] getEmailTemplate: type=${templateType} -- returning default template`);

    return {
      subject: getDefaultSubject(templateType),
      content: getDefaultContent(templateType)
    };
  } catch (error) {
    logger.error(`Error getting email template: ${error.message}`);
    throw error;
  }
};

/**
 * Update an email template
 * @param {string} templateType - Template type
 * @param {Object} templateData - Template data
 * @returns {Promise<Object>} - Updated template
 */
// TODO: Create email_templates table to persist this data
exports.updateEmailTemplate = async (templateType, templateData) => {
  try {
    const now = new Date().toISOString();

    const updatedTemplate = {
      ...templateData,
      updatedAt: now
    };

    logger.info(`[STUB] updateEmailTemplate: type=${templateType}, data=${JSON.stringify(updatedTemplate)}`);

    return updatedTemplate;
  } catch (error) {
    logger.error(`Error updating email template: ${error.message}`);
    throw error;
  }
};

/**
 * Get default subject for a template type
 * @param {string} templateType - Template type
 * @returns {string} - Default subject
 */
function getDefaultSubject(templateType) {
  switch(templateType) {
    case 'welcome':
      return 'Welcome to AI Waverider!';
    case 'update':
      return 'Weekly AI Waverider Update';
    case 'agent':
      return 'New AI Agents Available - AI Waverider';
    case 'tool':
      return 'New AI Tools Released - AI Waverider';
    case 'global':
      return 'Important Announcement from AI Waverider';
    case 'custom':
      return 'Message from AI Waverider';
    default:
      return 'AI Waverider Notification';
  }
}

/**
 * Get default content for a template type
 * @param {string} templateType - Template type
 * @returns {string} - Default HTML content
 */
function getDefaultContent(templateType) {
  switch(templateType) {
    case 'welcome':
      return '<p>Welcome to AI Waverider! We\'re excited to have you join our community.</p><p>Get started by exploring our AI tools and agents.</p>';
    case 'update':
      return '<p>Here are the latest updates from AI Waverider this week:</p><ul><li>Update item 1</li><li>Update item 2</li></ul>';
    case 'agent':
      return '<p>We\'re excited to announce new AI agents on our platform!</p>';
    case 'tool':
      return '<p>Check out our latest AI tools that have just been released:</p><ul><li><strong>Tool 1</strong>: Description of the first tool</li><li><strong>Tool 2</strong>: Description of the second tool</li></ul>';
    case 'global':
      return '<p>We have an important announcement to share with you...</p>';
    case 'custom':
      return '<p>This is a custom message from AI Waverider.</p>';
    default:
      return '<p>Thank you for being part of the AI Waverider community!</p>';
  }
}

/**
 * Add email to waitlist
 * @param {string} email - Email address
 * @returns {Promise<Object>} - Waitlist entry data
 */
// TODO: Create waitlist table to persist this data
exports.addToWaitlist = async (email) => {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const now = new Date().toISOString();
    const id = uuidv4();

    logger.info(`[STUB] addToWaitlist: id=${id}, email=${normalizedEmail}, status=active, createdAt=${now}`);

    return {
      id,
      email: normalizedEmail,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      alreadyExists: false
    };
  } catch (error) {
    logger.error(`Error adding email to waitlist: ${error.message}`);
    throw error;
  }
};

/**
 * Get all waitlist entries
 * @param {Object} options - Query options (limit, status)
 * @returns {Promise<Array>} - Waitlist entries
 */
// TODO: Create waitlist table to persist this data
exports.getWaitlistEntries = async (options = {}) => {
  try {
    const { limit = 100, status = 'active' } = options;

    logger.info(`[STUB] getWaitlistEntries: limit=${limit}, status=${status} -- returning empty array`);

    return [];
  } catch (error) {
    logger.error(`Error getting waitlist entries: ${error.message}`);
    throw error;
  }
};

/**
 * Get waitlist count
 * @returns {Promise<number>} - Total waitlist count
 */
// TODO: Create waitlist table to persist this data
exports.getWaitlistCount = async () => {
  try {
    logger.info('[STUB] getWaitlistCount -- returning 0');

    return 0;
  } catch (error) {
    logger.error(`Error getting waitlist count: ${error.message}`);
    throw error;
  }
};

module.exports = exports;
