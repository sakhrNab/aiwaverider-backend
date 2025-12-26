/**
 * Email Notification Model
 * 
 * Handles email notification data, campaigns, and logs
 */

const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const logger = require('../utils/logger');

// Collection references
const emailCampaignsCollection = db.collection('emailCampaigns');
const emailLogsCollection = db.collection('emailLogs');
const usersCollection = db.collection('users');
const waitlistCollection = db.collection('waitlist');

/**
 * Create a new email campaign
 * @param {Object} campaignData - Campaign data
 * @returns {Promise<string>} - Campaign ID
 */
exports.createCampaign = async (campaignData) => {
  try {
    const campaignRef = db.collection('emailCampaigns').doc();
    
    await campaignRef.set({
      ...campaignData,
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return campaignRef.id;
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
exports.updateCampaign = async (campaignId, updateData) => {
  try {
    // Don't allow updating certain fields directly
    const { sentCount, failedCount, startedAt, completedAt, ...safeUpdateData } = updateData;
    
    await emailCampaignsCollection.doc(campaignId).update({
      ...safeUpdateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
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
exports.markCampaignAsSending = async (campaignId) => {
  try {
    await db.collection('emailCampaigns').doc(campaignId).update({
      status: 'sending',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
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
exports.markCampaignAsCompleted = async (campaignId, sentCount, failedCount, errors = []) => {
  try {
    await db.collection('emailCampaigns').doc(campaignId).update({
      status: 'completed',
      sentCount,
      failedCount,
      errors: errors || [],
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
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
exports.logEmailSend = async (sendData) => {
  try {
    const logRef = db.collection('emailLogs').doc();
    
    await logRef.set({
      ...sendData,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return logRef.id;
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
    
    // Query users collection
    let query = db.collection('users').where('status', '==', 'active');
    
    // No preferences filter if no types specified
    if (emailTypes.length === 0) {
      const usersSnapshot = await query.get();
      
      return usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }
    
    // Complex query for email preferences
    const usersSnapshot = await query.get();
    
    // Filter in memory due to Firestore limitations on nested field queries
    const filteredUsers = usersSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      .filter(user => {
        // Default to true if no preferences specified
        if (!user.emailPreferences) return true;
        
        // Match any of the specified preference types
        return emailTypes.some(type => 
          user.emailPreferences[type] !== false
        );
      });
    
    return filteredUsers;
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
    const usersSnapshot = await db.collection('users').get();
    
    const stats = {
      totalUsers: usersSnapshot.size,
      preferences: {
        weeklyUpdates: 0,
        announcements: 0,
        newAgents: 0,
        newTools: 0,
        marketingEmails: 0
      }
    };
    
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      
      if (user.emailPreferences) {
        Object.keys(stats.preferences).forEach(pref => {
          if (user.emailPreferences[pref] === true) {
            stats.preferences[pref]++;
          }
        });
      }
    });
    
    return stats;
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
    await db.collection('users').doc(userId).update({
      'emailPreferences': preferences,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
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
exports.getEmailTemplate = async (templateType) => {
  try {
    const templateRef = db.collection('emailTemplates').doc(templateType);
    const templateDoc = await templateRef.get();
    
    if (!templateDoc.exists) {
      // Return default template if not found
      return {
        subject: getDefaultSubject(templateType),
        content: getDefaultContent(templateType)
      };
    }
    
    return templateDoc.data();
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
exports.updateEmailTemplate = async (templateType, templateData) => {
  try {
    const templateRef = db.collection('emailTemplates').doc(templateType);
    
    const updatedTemplate = {
      ...templateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await templateRef.set(updatedTemplate, { merge: true });
    
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
exports.addToWaitlist = async (email) => {
  try {
    // Check if email already exists in waitlist
    const existingSnapshot = await waitlistCollection
      .where('email', '==', email.toLowerCase().trim())
      .get();
    
    if (!existingSnapshot.empty) {
      // Email already exists, return existing entry
      const existingDoc = existingSnapshot.docs[0];
      return {
        id: existingDoc.id,
        ...existingDoc.data(),
        alreadyExists: true
      };
    }
    
    // Create new waitlist entry
    const waitlistRef = waitlistCollection.doc();
    const waitlistData = {
      email: email.toLowerCase().trim(),
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await waitlistRef.set(waitlistData);
    
    return {
      id: waitlistRef.id,
      ...waitlistData,
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
exports.getWaitlistEntries = async (options = {}) => {
  try {
    const { limit = 100, status = 'active' } = options;
    
    let query = waitlistCollection
      .where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    
    const snapshot = await query.get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    logger.error(`Error getting waitlist entries: ${error.message}`);
    throw error;
  }
};

/**
 * Get waitlist count
 * @returns {Promise<number>} - Total waitlist count
 */
exports.getWaitlistCount = async () => {
  try {
    const snapshot = await waitlistCollection
      .where('status', '==', 'active')
      .get();
    
    return snapshot.size;
  } catch (error) {
    logger.error(`Error getting waitlist count: ${error.message}`);
    // If query fails, try getting all and filtering (fallback)
    try {
      const allSnapshot = await waitlistCollection.get();
      return allSnapshot.docs.filter(doc => doc.data().status === 'active').length;
    } catch (fallbackError) {
      logger.error(`Error in fallback waitlist count: ${fallbackError.message}`);
      throw error;
    }
  }
};

module.exports = exports; 