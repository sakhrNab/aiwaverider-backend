/**
 * Notification Service
 * 
 * Handles sending notifications through various channels like email, in-app notifications,
 * and potentially SMS or push notifications in the future.
 */

const admin = require('firebase-admin');
const logger = require('../../utils/logger');
const emailService = require('../email/emailService');
const agentsController = require('../../controllers/agent/agentsController');

// Initialize Firestore
const db = admin.firestore();

// Notification Types
const NOTIFICATION_TYPES = {
  ORDER_SUCCESS: 'order_success',
  WELCOME: 'welcome',
  SHIPPING_UPDATE: 'shipping_update',
  PAYMENT_FAILED: 'payment_failed',
  WEEKLY_UPDATE: 'weekly_update',
  NEW_AGENT: 'new_agent',
  NEW_TOOL: 'new_tool',
  GLOBAL_ANNOUNCEMENT: 'global_announcement',
  GENERAL: 'general'
};

// Notification Channels
const CHANNELS = {
  EMAIL: 'email',
  IN_APP: 'in_app',
  BOTH: 'both'
};

/**
 * Send a notification through specified channels
 * @param {Object} options - Notification options
 * @param {string} options.type - Notification type (see NOTIFICATION_TYPES)
 * @param {string} options.channel - Notification channel (email, in_app, both)
 * @param {string} options.userId - User ID (optional for in-app notifications)
 * @param {string} options.email - User's email (required for email notifications)
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {Object} options.data - Additional data specific to notification type
 * @returns {Promise<Object>} - Notification results
 */
const sendNotification = async (options) => {
  const { 
    type = NOTIFICATION_TYPES.GENERAL,
    channel = CHANNELS.BOTH,
    userId,
    email,
    title,
    message,
    data = {}
  } = options;

  logger.info(`Sending ${type} notification via ${channel} to ${userId || email}`);
  
  const results = {
    success: false,
    emailSent: false,
    inAppSent: false,
    errors: []
  };

  // Validate required fields
  if (!title || !message) {
    const error = 'Notification title and message are required';
    logger.error(error);
    results.errors.push(error);
    return results;
  }

  // Send in-app notification if requested
  if ((channel === CHANNELS.IN_APP || channel === CHANNELS.BOTH) && userId) {
    try {
      await sendInAppNotification({
        userId,
        type,
        title,
        message,
        data
      });
      results.inAppSent = true;
    } catch (error) {
      logger.error(`Failed to send in-app notification: ${error.message}`);
      results.errors.push(`In-app error: ${error.message}`);
    }
  }

  // Send email notification if requested
  if ((channel === CHANNELS.EMAIL || channel === CHANNELS.BOTH) && email) {
    try {
      await sendEmailNotification({
        email,
        type,
        title,
        message,
        data
      });
      results.emailSent = true;
    } catch (error) {
      logger.error(`Failed to send email notification: ${error.message}`);
      results.errors.push(`Email error: ${error.message}`);
    }
  }

  // Set overall success based on channel requirements
  if (channel === CHANNELS.BOTH) {
    results.success = results.emailSent && results.inAppSent;
  } else if (channel === CHANNELS.EMAIL) {
    results.success = results.emailSent;
  } else {
    results.success = results.inAppSent;
  }

  return results;
};

/**
 * Send in-app notification to a user
 * @param {Object} options - Notification options
 * @returns {Promise<void>}
 */
const sendInAppNotification = async (options) => {
  const { userId, type, title, message, data } = options;
  
  try {
    // Create notification document
    const notificationData = {
      userId,
      type,
      title,
      message,
      data,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Add to notifications collection
    await db.collection('notifications').add(notificationData);
    
    // Increment user's unread notification count
    const userRef = db.collection('users').doc(userId);
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        const currentCount = userData.unreadNotifications || 0;
        
        transaction.update(userRef, {
          unreadNotifications: currentCount + 1,
          lastNotificationAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });
    
    logger.info(`In-app notification sent to user: ${userId}`);
  } catch (error) {
    logger.error(`Error sending in-app notification: ${error.message}`);
    throw error;
  }
};

/**
 * Send email notification
 * @param {Object} options - Notification options
 * @returns {Promise<void>}
 */
const sendEmailNotification = async (options) => {
  const { email, type, title, message, data } = options;
  
  try {
    // Determine which email template to use based on notification type
    switch (type) {
      case NOTIFICATION_TYPES.ORDER_SUCCESS:
        await sendOrderSuccessEmail(email, data);
        break;
      case NOTIFICATION_TYPES.WELCOME:
        await sendWelcomeEmail(email, data);
        break;
      case NOTIFICATION_TYPES.WEEKLY_UPDATE:
        await sendWeeklyUpdateEmail(email, data);
        break;
      case NOTIFICATION_TYPES.GLOBAL_ANNOUNCEMENT:
        await sendAnnouncementEmail(email, title, message, data);
        break;
      case NOTIFICATION_TYPES.NEW_AGENT:
      case NOTIFICATION_TYPES.NEW_TOOL:
        await sendContentNotificationEmail(email, type, title, message, data);
        break;
      default:
        // For general notifications, use a simple email format
        await emailService.sendTestEmail(email);
    
    logger.info(`Email notification sent to: ${email}`);
    }
  } catch (error) {
    logger.error(`Error sending email notification: ${error.message}`);
    throw error;
  }
};

/**
 * Send order success email notification
 * @param {string} email - Recipient email
 * @param {Object} data - Order data
 * @returns {Promise<void>}
 */
const sendOrderSuccessEmail = async (email, data) => {
  const { orderId, items, agent, orderTotal, userName } = data;
  
  try {
    // If there's an agent in the data, use the agent purchase email template
    if (agent) {
      await emailService.sendAgentPurchaseEmail({
        email: email,
        firstName: userName || 'Valued Customer',
        agentName: agent.title || 'AI Agent',
        agentDescription: agent.description || 'Your new AI agent',
        price: orderTotal || 0,
        currency: data.currency || 'USD',
        receiptUrl: data.receiptUrl || ''
      });
      return;
    }
    
    // For non-agent purchases, use the appropriate emailService method when implemented
    // For now, fall back to a basic email
    await emailService.sendTestEmail(email);
    
    logger.info(`Order success email sent to: ${email}`);
  } catch (error) {
    logger.error(`Error sending order success email: ${error.message}`);
    throw error;
  }
};

/**
 * Send welcome email to a new user
 * @param {string} email - Recipient email
 * @param {Object} data - User data
 * @returns {Promise<void>}
 */
const sendWelcomeEmail = async (email, data) => {
  try {
    const { firstName, lastName, userId } = data;
    
    await emailService.sendWelcomeEmail({
      email,
      userId,
      firstName,
      lastName
    });
    
    logger.info(`Welcome email sent to: ${email}`);
  } catch (error) {
    logger.error(`Error sending welcome email: ${error.message}`);
    throw error;
  }
};

/**
 * Send weekly update email
 * @param {string} email - Recipient email
 * @param {Object} data - Update data
 * @returns {Promise<void>}
 */
const sendWeeklyUpdateEmail = async (email, data) => {
  try {
    const { firstName, lastName } = data;
    
    await emailService.sendUpdateEmail({
      email,
      firstName,
      lastName,
      title: "Weekly Update",
      content: data.content || "Here's what's new this week",
      updateType: 'weekly'
    });
    
    logger.info(`Weekly update email sent to: ${email}`);
  } catch (error) {
    logger.error(`Error sending weekly update email: ${error.message}`);
    throw error;
  }
};

/**
 * Send announcement email
 * @param {string} email - Recipient email
 * @param {string} subject - Email subject
 * @param {string} message - Message content
 * @param {Object} data - Additional data
 * @returns {Promise<void>}
 */
const sendAnnouncementEmail = async (email, subject, message, data) => {
  try {
    const { firstName, lastName } = data || {};
    
    await emailService.sendGlobalEmail({
      email,
      firstName,
      lastName,
      title: subject,
      content: message
    });
    
    logger.info(`Announcement email sent to: ${email}`);
  } catch (error) {
    logger.error(`Error sending announcement email: ${error.message}`);
    throw error;
  }
};

/**
 * Send notification about new content (agent or tool)
 * @param {string} email - Recipient email
 * @param {string} type - Content type (new_agent, new_tool)
 * @param {string} title - Email subject
 * @param {string} message - Message content
 * @param {Object} data - Additional data
 * @returns {Promise<void>}
 */
const sendContentNotificationEmail = async (email, type, title, message, data) => {
  try {
    const { firstName, lastName } = data || {};
    
    // For agent notifications, use our new template with latest agents
    if (type === NOTIFICATION_TYPES.NEW_AGENT) {
      // Get the latest 5 agents - try multiple methods
      let latestAgents = [];
      
      try {
        // First method: direct database query
        latestAgents = await agentsController.getLatestAgents(5);
        console.log(`First attempt to get agents found: ${latestAgents.length} agents`);
      } catch (err) {
        console.error('Error getting agents with first method:', err);
      }
      
      // If no agents yet, try again with different approach
      if (!latestAgents || latestAgents.length === 0) {
        try {
          // Second method: use the controller more directly and get any 5 agents
          const agentsResult = await db.collection('agents').limit(5).get();
          
          // Format agents
          latestAgents = [];
          agentsResult.forEach(doc => {
            const agentData = doc.data();
            latestAgents.push({
              id: doc.id,
              url: `${process.env.FRONTEND_URL || 'https://aiwaverider.com'}/agents/${doc.id}`,
              name: agentData.name || agentData.title || 'AI Agent',
              imageUrl: agentData.imageUrl || agentData.image || 'https://via.placeholder.com/300x200?text=AI+Agent',
              description: agentData.description || 'An AI agent to help with your tasks',
              price: agentData.price || 0,
              creator: {
                name: agentData.creator?.name || 'AI Waverider',
                ...agentData.creator
              },
              rating: {
                average: agentData.rating?.average || 4.5,
                count: agentData.rating?.count || 0
              },
              ...agentData
            });
          });
          
          console.log(`Second attempt to get agents found: ${latestAgents.length} agents`);
        } catch (err) {
          console.error('Error getting agents with second method:', err);
        }
      }
      
      console.log(`Sending agent notification email with ${latestAgents.length} agents`);
      if (latestAgents.length > 0) {
        console.log(`First agent: ${latestAgents[0].name}, Price: ${latestAgents[0].price}`);
      } else {
        console.log('No agents found for email notification');
      }
      
      // Don't include the bullet points in the message
      let cleanMessage = message;
      if (message && message.includes('Agent 1:')) {
        // This removes any lines containing "Agent 1:" or "Agent 2:" etc.
        cleanMessage = message.split('\n')
          .filter(line => !line.includes('Agent 1:') && !line.includes('Agent 2:') && !line.includes('Agent 3:'))
          .join('\n');
        
        console.log('Removed static agent descriptions from message');
      }
      
      // Send using the new agent update template
      await emailService.sendAgentUpdateEmail({
        email,
        name: firstName ? `${firstName}` : 'Waverider',
        title: title || 'New AI Agents Available',
        content: cleanMessage, // Use content directly for the template
        latestAgents
      });
      
      logger.info(`Agent notification email sent to: ${email} with ${latestAgents.length} latest agents`);
    } else {
      // For other notification types, use the standard update template
      const updateType = type === NOTIFICATION_TYPES.NEW_TOOL ? 'new_tools' : 'notification';
      
      await emailService.sendUpdateEmail({
        email,
        firstName,
        lastName,
        title,
        content: message,
        updateType
      });
      
      logger.info(`Content notification email (${type}) sent to: ${email}`);
    }
  } catch (error) {
    logger.error(`Error sending content notification email: ${error.message}`);
    throw error;
  }
};

/**
 * Send an order success notification (both email and in-app)
 * @param {Object} options - Order data
 * @returns {Promise<Object>} - Notification results
 */
const sendOrderSuccessNotification = async (options) => {
  const { orderId, email, userId, items, orderTotal, agent } = options;
  
  try {
    // Get user's name if available
    let userName = 'Valued Customer';
    if (userId) {
      try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          userName = userData.firstName || userData.displayName || userData.username || 'Valued Customer';
        }
      } catch (userError) {
        logger.warn(`Could not get user data for notification: ${userError.message}`);
      }
    }
    
    // Prepare notification data
    const title = 'Order Confirmed';
  const message = `Your order #${orderId} has been successfully processed.`;
    const data = {
      orderId,
      items,
      agent,
      orderTotal,
      userName,
      type: 'order',
      orderDate: new Date().toISOString()
    };
    
    // Send notifications
    const result = await sendNotification({
      type: NOTIFICATION_TYPES.ORDER_SUCCESS,
      channel: CHANNELS.BOTH,
      userId,
      email,
      title,
      message,
      data
    });
    
    return result;
  } catch (error) {
    logger.error(`Error sending order success notification: ${error.message}`);
    return {
      success: false,
      emailSent: false,
      inAppSent: false,
      errors: [error.message]
    };
  }
};

/**
 * Send welcome notification to a new user
 * @param {Object} userData - User data from registration
 * @returns {Promise<Object>} - Notification results
 */
const sendWelcomeNotification = async (userData) => {
  try {
    const { uid, email, displayName, firstName, lastName } = userData;
    
    // Prepare user's name
    const userName = firstName || displayName || email.split('@')[0];
    
    // Prepare notification
    const title = 'Welcome to AI Waverider!';
    const message = `We're excited to have you join our community, ${userName}!`;
    const notificationData = {
      userId: uid,
      name: userName,
      firstName: firstName || '',
      email
    };
    
    // Send notifications
    const result = await sendNotification({
      type: NOTIFICATION_TYPES.WELCOME,
      channel: CHANNELS.BOTH,
      userId: uid,
      email,
      title,
      message,
      data: notificationData
    });
    
    return result;
  } catch (error) {
    logger.error(`Error sending welcome notification: ${error.message}`);
    return {
      success: false,
      emailSent: false,
      inAppSent: false,
      errors: [error.message]
    };
  }
};

/**
 * Send a weekly update to all subscribed users
 * @param {Object} updateData - Data for the weekly update
 * @returns {Promise<Object>} - Results summary
 */
const sendWeeklyUpdate = async (updateData) => {
  try {
    const { newAgents, newTools, featuredContent, weekLabel } = updateData;
    
    // Check if there's anything to send
    if ((!newAgents || newAgents.length === 0) && 
        (!newTools || newTools.length === 0) && 
        (!featuredContent || featuredContent.length === 0)) {
      logger.warn('No content for weekly update email');
      return {
        success: false,
        sent: 0,
        errors: ['No content for weekly update']
      };
    }
    
    // Get all users who have subscribed to weekly updates
    const usersSnapshot = await db.collection('users')
      .where('emailPreferences.weeklyUpdates', '==', true)
      .where('status', '==', 'active')
      .get();
    
    if (usersSnapshot.empty) {
      logger.info('No users subscribed to weekly updates');
      return {
        success: true,
        sent: 0,
        errors: []
      };
    }
    
    const results = {
      success: true,
      sent: 0,
      failed: 0,
      errors: []
    };
    
    // Send emails to all subscribed users
    const emailPromises = [];
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      
      if (!user.email) {
        results.errors.push(`User ${doc.id} has no email address`);
        return;
      }
      
      // Prepare user data
      const userData = {
        name: user.firstName || user.displayName || user.username || user.email.split('@')[0],
        newAgents,
        newTools,
        featuredContent,
        weekLabel
      };
      
      // Queue email
      const emailPromise = sendNotification({
        type: NOTIFICATION_TYPES.WEEKLY_UPDATE,
        channel: CHANNELS.EMAIL, // Weekly updates are typically email-only
        email: user.email,
        userId: doc.id,
        title: `AI Waverider Weekly: ${weekLabel || 'Latest Updates'}`,
        message: 'Here are this week\'s updates from AI Waverider',
        data: userData
      }).then(notificationResult => {
        if (notificationResult.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(`Failed to send to ${user.email}: ${notificationResult.errors.join(', ')}`);
        }
      }).catch(error => {
        results.failed++;
        results.errors.push(`Error sending to ${user.email}: ${error.message}`);
      });
      
      emailPromises.push(emailPromise);
    });
    
    // Wait for all emails to be sent
    await Promise.all(emailPromises);
    
    // Log results
    logger.info(`Weekly update email sent to ${results.sent} users, failed for ${results.failed} users`);
    if (results.errors.length > 0) {
      logger.error(`Weekly update errors: ${results.errors.slice(0, 5).join('; ')}${results.errors.length > 5 ? ` and ${results.errors.length - 5} more` : ''}`);
    }
    
    return results;
  } catch (error) {
    logger.error(`Error sending weekly update: ${error.message}`);
    return {
      success: false,
      sent: 0,
      failed: 0,
      errors: [error.message]
    };
  }
};

/**
 * Send a global announcement to users
 * @param {Object} announcementData - Announcement data
 * @returns {Promise<Object>} - Results summary
 */
const sendGlobalAnnouncement = async (announcementData) => {
  try {
    const { 
      subject, 
      message, 
      messageHtml, 
      ctaText, 
      ctaUrl, 
      targetGroups = ['all'],
      sender = 'AI Waverider Team'
    } = announcementData;
    
    // Validate required fields
    if (!subject || (!message && !messageHtml)) {
      throw new Error('Announcement subject and message are required');
    }
    
    let userQuery = db.collection('users').where('status', '==', 'active');
    
    // Apply additional filters based on target groups
    // Exclude 'all' as it doesn't need filtering
    const filterGroups = targetGroups.filter(group => group !== 'all');
    
    if (targetGroups.includes('admin')) {
      // If 'admin' is specifically targeted and not 'all'
      if (!targetGroups.includes('all')) {
        userQuery = userQuery.where('role', '==', 'admin');
      }
    } else if (filterGroups.length > 0) {
      // Handle other user groups as needed
      // This is a simple implementation - extend as needed for your user groups
      // For complex segmentation, you might need multiple queries and combine results
      logger.info(`Targeting user groups: ${filterGroups.join(', ')}`);
    }
    
    // Execute query
    const usersSnapshot = await userQuery.get();
    
    if (usersSnapshot.empty) {
      logger.info('No users match the criteria for this announcement');
      return {
        success: true,
        sent: 0,
        errors: []
      };
    }
    
    const results = {
      success: true,
      sent: 0,
      failed: 0,
      errors: []
    };
    
    // Store the announcement in the database
    const announcementRef = await db.collection('announcements').add({
      subject,
      message,
      messageHtml,
      ctaText,
      ctaUrl,
      targetGroups,
      sender,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentCount: 0,
      failedCount: 0
    });
    
    // Send to all matching users
    const emailPromises = [];
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      
      if (!user.email) {
        results.errors.push(`User ${doc.id} has no email address`);
        return;
      }
      
      // Skip users who have opted out, but only if not sending to admins
      if (!targetGroups.includes('admin') && 
          user.emailPreferences && 
          user.emailPreferences.announcements === false) {
        return;
      }
      
      // Prepare user data
      const userData = {
        name: user.firstName || user.displayName || user.username || user.email.split('@')[0],
        messageHtml: messageHtml || `<p>${message}</p>`,
        messageText: message,
        ctaText,
        ctaUrl
      };
      
      // Queue notification
      const emailPromise = sendNotification({
        type: NOTIFICATION_TYPES.GLOBAL_ANNOUNCEMENT,
        channel: CHANNELS.BOTH,  // Send both email and in-app
        email: user.email,
        userId: doc.id,
        title: subject,
        message: message,
        data: userData
      }).then(notificationResult => {
        if (notificationResult.success) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push(`Failed to send to ${user.email}: ${notificationResult.errors.join(', ')}`);
        }
      }).catch(error => {
        results.failed++;
        results.errors.push(`Error sending to ${user.email}: ${error.message}`);
      });
      
      emailPromises.push(emailPromise);
    });
    
    // Wait for all notifications to be sent
    await Promise.all(emailPromises);
    
    // Update the announcement record with the final counts
    await announcementRef.update({
      sentCount: results.sent,
      failedCount: results.failed,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Log results
    logger.info(`Announcement "${subject}" sent to ${results.sent} users, failed for ${results.failed} users`);
    if (results.errors.length > 0) {
      logger.error(`Announcement errors: ${results.errors.slice(0, 5).join('; ')}${results.errors.length > 5 ? ` and ${results.errors.length - 5} more` : ''}`);
    }
    
    return {
      ...results,
      announcementId: announcementRef.id
    };
  } catch (error) {
    logger.error(`Error sending global announcement: ${error.message}`);
    return {
      success: false,
      sent: 0,
      failed: 0,
      errors: [error.message]
    };
  }
};

module.exports = {
  sendNotification,
  sendOrderSuccessNotification,
  sendWelcomeNotification,
  sendWeeklyUpdate,
  sendGlobalAnnouncement,
  NOTIFICATION_TYPES,
  CHANNELS
}; 