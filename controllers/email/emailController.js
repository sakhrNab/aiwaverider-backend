/**
 * Email Controller
 * 
 * Handles all email-related operations including campaigns, individual emails,
 * and administrative functions
 */

const emailService = require('../../services/email/emailService');
const emailNotificationModel = require('../../models/emailNotification');
const logger = require('../../utils/logger');
const { validateEmail } = require('../../utils/validators');
const { db } = require('../../config/firebase');
const config = require('../../config/email');
const agentsController = require('../agent/agentsController');

/**
 * Send a test email to verify configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestEmail = async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test email
    const result = await emailService.sendTestEmail(email);
    
    // Log the send
    await emailNotificationModel.logEmailSend({
      type: 'test',
      email,
      userId: req.user?.uid || null,
      success: true,
      messageId: result.messageId
    });
    
    res.status(200).json({
      success: true,
      message: 'Test email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test email: ${error.message}`);
    
    // Log the failure
    if (req.body.email) {
      await emailNotificationModel.logEmailSend({
        type: 'test',
        email: req.body.email,
        userId: req.user?.uid || null,
        success: false,
        error: error.message
      }).catch(e => {
        logger.error(`Failed to log email failure: ${e.message}`);
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message
    });
  }
};

/**
 * Send a welcome email to a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendWelcomeEmail = async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    // Validate inputs
    if (!userId || !email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID and valid email address are required' 
      });
    }
    
    // Send welcome email
    const result = await emailService.sendWelcomeEmail({
      userId,
      email,
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || ''
    });
    
    // Log the send
    await emailNotificationModel.logEmailSend({
      type: 'welcome',
      email,
      userId,
      success: true,
      messageId: result.messageId
    });
    
    res.status(200).json({
      success: true,
      message: 'Welcome email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending welcome email: ${error.message}`);
    
    // Log the failure
    if (req.body.email && req.body.userId) {
      await emailNotificationModel.logEmailSend({
        type: 'welcome',
        email: req.body.email,
        userId: req.body.userId,
        success: false,
        error: error.message
      }).catch(e => {
        logger.error(`Failed to log email failure: ${e.message}`);
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to send welcome email',
      error: error.message
    });
  }
};

/**
 * Send an update notification email to users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendUpdateEmail = async (req, res) => {
  try {
    const { title, content, updateType } = req.body;
    
    // Validate inputs
    if (!title || !content || !updateType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title, content, and update type are required' 
      });
    }
    
    // Get users based on email preferences
    let emailType;
    switch (updateType) {
      case 'weekly':
        emailType = 'weeklyUpdates';
        break;
      case 'announcements':
        emailType = 'announcements';
        break;
      case 'new_agents':
        emailType = 'newAgents';
        break;
      case 'new_tools':
        emailType = 'newTools';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid update type'
        });
    }
    
    // Create campaign record
    const campaignId = await emailNotificationModel.createCampaign({
      title,
      content,
      type: updateType,
      createdBy: req.user.uid
    });
    
    // Mark as sending
    await emailNotificationModel.markCampaignAsSending(campaignId);
    
    // Dispatch the email sending task (this would typically be a background job)
    // For simplicity, we're doing it synchronously here
    const users = await emailNotificationModel.getUsersByPreferences({ 
      emailTypes: [emailType] 
    });
    
    if (users.length === 0) {
      await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0);
      
      return res.status(200).json({
        success: true,
        message: 'No recipients found with matching preferences',
        data: { campaignId, recipientCount: 0 }
      });
    }
    
    // Prepare to track success/failure
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    // Send emails to each user
    for (const user of users) {
      try {
        const result = await emailService.sendUpdateEmail({
          userId: user.id,
          email: user.email,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          title,
          content,
          updateType
        });
        
        // Log success
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: true,
          messageId: result.messageId
        });
        
        sentCount++;
      } catch (error) {
        // Log failure
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: false,
          error: error.message
        });
        
        failedCount++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: error.message
        });
        
        logger.error(`Failed to send update email to ${user.email}: ${error.message}`);
      }
    }
    
    // Mark campaign as completed
    await emailNotificationModel.markCampaignAsCompleted(
      campaignId, 
      sentCount, 
      failedCount,
      errors
    );
    
    res.status(200).json({
      success: true,
      message: 'Update email campaign completed',
      data: {
        campaignId,
        recipientCount: users.length,
        sentCount,
        failedCount
      }
    });
  } catch (error) {
    logger.error(`Error sending update emails: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete update email campaign',
      error: error.message
    });
  }
};

/**
 * Send a global announcement to all users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendGlobalAnnouncement = async (req, res) => {
  try {
    const { title, content, sendToAll } = req.body;
    
    // Validate inputs
    if (!title || !content) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and content are required' 
      });
    }
    
    // Create campaign record
    const campaignId = await emailNotificationModel.createCampaign({
      title,
      content,
      type: 'global_announcement',
      sendToAll: !!sendToAll,
      createdBy: req.user.uid
    });
    
    // Mark as sending
    await emailNotificationModel.markCampaignAsSending(campaignId);
    
    // Get users based on preferences (or all if sendToAll is true)
    const users = sendToAll 
      ? await emailNotificationModel.getUsersByPreferences({})
      : await emailNotificationModel.getUsersByPreferences({ 
          emailTypes: ['announcements'] 
        });
    
    if (users.length === 0) {
      await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0);
      
      return res.status(200).json({
        success: true,
        message: 'No recipients found',
        data: { campaignId, recipientCount: 0 }
      });
    }
    
    // Prepare to track success/failure
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    // Send emails to each user
    for (const user of users) {
      try {
        const result = await emailService.sendGlobalEmail({
          userId: user.id,
          email: user.email,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          title,
          content
        });
        
        // Log success
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: 'global_announcement',
          userId: user.id,
          email: user.email,
          success: true,
          messageId: result.messageId
        });
        
        sentCount++;
      } catch (error) {
        // Log failure
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: 'global_announcement',
          userId: user.id,
          email: user.email,
          success: false,
          error: error.message
        });
        
        failedCount++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: error.message
        });
        
        logger.error(`Failed to send global announcement to ${user.email}: ${error.message}`);
      }
    }
    
    // Mark campaign as completed
    await emailNotificationModel.markCampaignAsCompleted(
      campaignId, 
      sentCount, 
      failedCount,
      errors
    );
    
    res.status(200).json({
      success: true,
      message: 'Global announcement campaign completed',
      data: {
        campaignId,
        recipientCount: users.length,
        sentCount,
        failedCount
      }
    });
  } catch (error) {
    logger.error(`Error sending global announcement: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete global announcement campaign',
      error: error.message
    });
  }
};

/**
 * Get email campaign statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEmailStats = async (req, res) => {
  try {
    const stats = await emailNotificationModel.getEmailPreferenceStats();
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error(`Error getting email statistics: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve email statistics',
      error: error.message
    });
  }
};

/**
 * Update a user's email preferences
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateEmailPreferences = async (req, res) => {
  try {
    const { userId } = req.params;
    const preferences = req.body;
    
    // Validate user ID
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }
    
    // Check if the user is updating their own preferences or if admin
    if (userId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update preferences for this user'
      });
    }
    
    // Validate preferences
    const validPreferences = [
      'weeklyUpdates',
      'announcements',
      'newAgents',
      'newTools',
      'marketingEmails'
    ];
    
    const sanitizedPreferences = {};
    
    validPreferences.forEach(pref => {
      sanitizedPreferences[pref] = preferences[pref] === true;
    });
    
    // Update preferences
    await emailNotificationModel.updateUserEmailPreferences(
      userId, 
      sanitizedPreferences
    );
    
    res.status(200).json({
      success: true,
      message: 'Email preferences updated successfully',
      data: sanitizedPreferences
    });
  } catch (error) {
    logger.error(`Error updating email preferences: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to update email preferences',
      error: error.message
    });
  }
};

/**
 * Send an update notification email to specific users by userIds
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendUpdateToUsers = async (req, res) => {
  try {
    const { title, content, updateType, userIds, emailAddresses } = req.body;
    
    // Validate inputs
    if (!title || !content || !updateType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title, content, and update type are required' 
      });
    }
    
    // Either userIds OR emailAddresses must be provided
    if ((!userIds || !Array.isArray(userIds) || userIds.length === 0) && 
        (!emailAddresses || !Array.isArray(emailAddresses) || emailAddresses.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Either userIds or emailAddresses must be provided'
      });
    }
    
    // Log the incoming request data
    logger.info(`Sending ${updateType} update to ${userIds?.length || 0} user IDs and ${emailAddresses?.length || 0} email addresses`);
    
    // Create campaign record
    const campaignId = await emailNotificationModel.createCampaign({
      title,
      content,
      type: updateType,
      createdBy: req.user.uid,
      targetUserIds: userIds || [],
      targetEmails: emailAddresses || []
    });
    
    // Mark as sending
    await emailNotificationModel.markCampaignAsSending(campaignId);
    
    // Get user data for the specified userIds or emailAddresses
    let users = [];
    
    // If we have userIds, fetch user data by IDs
    if (userIds && userIds.length > 0) {
      const usersSnapshot = await Promise.all(
        userIds.map(userId => db.collection('users').doc(userId).get())
      );
      
      // Filter out non-existent users and prepare user data
      users = usersSnapshot
        .filter(doc => doc.exists)
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
      logger.info(`Found ${users.length} of ${userIds.length} users by ID`);
    }
    
    // If we have emailAddresses, fetch additional user data by email
    if (emailAddresses && emailAddresses.length > 0) {
      try {
        // Process emails in batches (Firestore has 'in' query limit)
        const batchSize = 10;
        let emailUsers = [];
        
        for (let i = 0; i < emailAddresses.length; i += batchSize) {
          const batch = emailAddresses.slice(i, i + batchSize);
          const snapshot = await db.collection('users')
            .where('email', 'in', batch)
            .get();
            
          emailUsers = [...emailUsers, ...snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))];
        }
        
        logger.info(`Found ${emailUsers.length} of ${emailAddresses.length} users by email`);
        
        // Add users found by email, avoiding duplicates
        const existingIds = new Set(users.map(u => u.id));
        emailUsers.forEach(user => {
          if (!existingIds.has(user.id)) {
            users.push(user);
            existingIds.add(user.id);
          }
        });
        
        // Add placeholder users for emails not found in the database
        const foundEmails = new Set(users.map(u => u.email));
        emailAddresses.forEach(email => {
          if (!foundEmails.has(email)) {
            users.push({
              id: null,
              email,
              firstName: '',
              lastName: ''
            });
            foundEmails.add(email);
          }
        });
      } catch (error) {
        logger.error(`Error fetching users by email: ${error.message}`);
        // Continue with the users we already have
      }
    }
    
    if (users.length === 0) {
      await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0);
      
      return res.status(200).json({
        success: true,
        message: 'No valid recipients found',
        data: { campaignId, recipientCount: 0 }
      });
    }
    
    // Prepare to track success/failure
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    // Check user preferences based on update type
    const prefField = 
      updateType === 'weeklyUpdates' ? 'weeklyUpdates' :
      updateType === 'new_agents' ? 'newAgents' :
      updateType === 'new_tools' ? 'newTools' : null;
    
    // If this is a tool update, fetch the latest tools to include in the email
    let additionalContent = '';
    if (updateType === 'new_tools') {
      try {
        // Fetch the 5 most recent tools from the database
        const toolsSnapshot = await db.collection('tools')
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();
        
        if (!toolsSnapshot.empty) {
          // Create HTML for the tools section
          additionalContent = `
            <div style="margin-top: 20px; margin-bottom: 20px;">
              <h3 style="color: #4a86e8;">Our Latest AI Tools</h3>
              <ul style="padding-left: 20px;">
          `;
          
          toolsSnapshot.forEach(doc => {
            const tool = doc.data();
            additionalContent += `
              <li style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #333;">${tool.name || 'New Tool'}</div>
                <div style="color: #666;">${tool.description || 'No description available'}</div>
              </li>
            `;
          });
          
          additionalContent += `
              </ul>
              <p><a href="${config.websiteUrl}/tools" style="color: #4a86e8; text-decoration: none;">Explore all our AI tools →</a></p>
            </div>
          `;
        }
      } catch (error) {
        logger.error(`Error fetching latest tools: ${error.message}`);
        // Continue without the latest tools if there's an error
      }
    }
    
    // Send emails to each user who has the preference enabled
    for (const user of users) {
      // Skip if user has opt-out of this notification type
      if (prefField && 
          user.emailPreferences && 
          user.emailPreferences[prefField] === false) {
        logger.info(`Skipped sending to ${user.email} - user has disabled ${prefField} notifications`);
        continue;
      }
      
      try {
        let result;
        
        // For custom emails, send without template wrapping
        if (updateType === 'custom') {
          // Send custom email without template
          result = await emailService.sendEmail({
            to: user.email,
            subject: title,
            html: `<div style="font-family: Arial, sans-serif; color: #333;">
                    ${content}
                    <hr>
                    <p style="font-size: 12px; color: #777;">
                      This email was sent from AI Waverider. 
                      If you no longer wish to receive these emails, you can 
                      <a href="${config.websiteUrl}/profile">unsubscribe</a> from your profile settings.
                    </p>
                  </div>`
          });
        } else {
          // Prepare final content with additional content if available
          const finalContent = additionalContent ? `${content}${additionalContent}` : content;
          
          // Use the regular template for non-custom emails
          result = await emailService.sendUpdateEmail({
            userId: user.id,
            email: user.email,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            title,
            content: finalContent,
            updateType
          });
        }
        
        // Log success
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: true,
          messageId: result.messageId
        });
        
        sentCount++;
      } catch (error) {
        // Log failure
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: false,
          error: error.message
        });
        
        failedCount++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: error.message
        });
        
        logger.error(`Failed to send update email to ${user.email}: ${error.message}`);
      }
    }
    
    // Mark campaign as completed
    await emailNotificationModel.markCampaignAsCompleted(
      campaignId, 
      sentCount, 
      failedCount,
      errors
    );
    
    res.status(200).json({
      success: true,
      message: 'Update email campaign completed',
      data: {
        campaignId,
        recipientCount: users.length,
        sentCount,
        failedCount
      }
    });
  } catch (error) {
    logger.error(`Error sending targeted update emails: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete update email campaign',
      error: error.message
    });
  }
};

/**
 * Send a custom email to specific recipients
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendCustomEmail = async (req, res) => {
  try {
    const { subject, headerTitle, content, recipientType, recipients } = req.body;
    
    // Validate inputs
    if (!subject || !content) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subject and content are required' 
      });
    }
    
    // Create campaign record
    const campaignId = await emailNotificationModel.createCampaign({
      title: subject,
      headerTitle: headerTitle || subject,
      content,
      type: 'custom',
      recipientType,
      createdBy: req.user.uid,
      specificEmails: recipientType === 'specific' ? recipients.split(',').map(e => e.trim()) : null
    });
    
    // Mark as sending
    await emailNotificationModel.markCampaignAsSending(campaignId);
    
    // Get user data based on recipient type
    let users = [];
    
    if (recipientType === 'specific' && recipients) {
      // For specific emails
      const emails = recipients.split(',').map(email => email.trim()).filter(email => email);
      
      if (emails.length === 0) {
        await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0, []);
        
        return res.status(200).json({
          success: true,
          message: 'No valid recipients specified',
          data: { campaignId, recipientCount: 0 }
        });
      }
      
      // Get user data for these emails if they exist in our system
      const usersSnapshot = await db.collection('users')
        .where('email', 'in', emails.slice(0, 10)) // Firestore limit for 'in' queries
        .get();
      
      users = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Add any emails not found as users
      const foundEmails = users.map(u => u.email);
      const notFoundEmails = emails.filter(email => !foundEmails.includes(email));
      
      // Add placeholder users for these emails
      notFoundEmails.forEach(email => {
        users.push({
          id: null,
          email,
          firstName: '',
          lastName: ''
        });
      });
    } else {
      // For user groups (all, premium, free)
      let query = db.collection('users');
      
      if (recipientType === 'premium') {
        query = query.where('accountType', '==', 'premium');
      } else if (recipientType === 'free') {
        query = query.where('accountType', '==', 'free');
      }
      
      const usersSnapshot = await query.get();
      
      users = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }
    
    if (users.length === 0) {
      await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0, []);
      
      return res.status(200).json({
        success: true,
        message: 'No recipients found',
        data: { campaignId, recipientCount: 0 }
      });
    }
    
    // Prepare to track success/failure
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    // Send emails to each recipient
    for (const user of users) {
      try {
        // Send email to this user
        const result = await emailService.sendCustomEmail({
          email: user.email,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          subject,
          headerTitle: headerTitle || subject,
          content,
          emailType: req.body.emailType || 'custom',
          updateType: req.body.updateType
        });
        
        // Log this send
        await emailNotificationModel.logEmailSend({
          type: 'custom',
          campaignId,
          email: user.email,
          userId: user.id,
          success: true,
          messageId: result.messageId
        });
        
        sentCount++;
      } catch (error) {
        logger.error(`Failed to send custom email to ${user.email}: ${error.message}`);
        
        // Log the failure
        await emailNotificationModel.logEmailSend({
          type: 'custom',
          campaignId,
          email: user.email,
          userId: user.id,
          success: false,
          error: error.message
        }).catch(e => {
          logger.error(`Failed to log email failure: ${e.message}`);
        });
        
        failedCount++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: error.message
        });
      }
    }
    
    // Mark campaign as completed
    await emailNotificationModel.markCampaignAsCompleted(
      campaignId, 
      sentCount, 
      failedCount,
      errors
    );
    
    res.status(200).json({
      success: true,
      message: 'Custom email campaign completed',
      data: {
        campaignId,
        recipientCount: users.length,
        sentCount,
        failedCount
      }
    });
  } catch (error) {
    logger.error(`Error sending custom emails: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete custom email campaign',
      error: error.message
    });
  }
};

/**
 * Get an email template
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getEmailTemplate = async (req, res) => {
  try {
    const { templateType } = req.params;
    
    // Validate template type
    const validTemplateTypes = ['welcome', 'update', 'agent', 'tool', 'global', 'custom'];
    if (!templateType || !validTemplateTypes.includes(templateType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template type'
      });
    }
    
    // Get template from database or file system
    const template = await emailNotificationModel.getEmailTemplate(templateType);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: `Template ${templateType} not found`
      });
    }
    
    res.status(200).json({
      success: true,
      data: template
    });
  } catch (error) {
    logger.error(`Error getting email template: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get email template',
      error: error.message
    });
  }
};

/**
 * Update an email template
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateEmailTemplate = async (req, res) => {
  try {
    const { templateType } = req.params;
    const templateData = req.body;
    
    // Validate template type
    const validTemplateTypes = ['welcome', 'update', 'agent', 'tool', 'global', 'custom'];
    if (!templateType || !validTemplateTypes.includes(templateType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template type'
      });
    }
    
    // Validate template data
    if (!templateData || !templateData.subject || !templateData.content) {
      return res.status(400).json({
        success: false,
        message: 'Template must include subject and content'
      });
    }
    
    // Update template in database or file system
    const result = await emailNotificationModel.updateEmailTemplate(templateType, templateData);
    
    res.status(200).json({
      success: true,
      message: `Template ${templateType} updated successfully`,
      data: result
    });
  } catch (error) {
    logger.error(`Error updating email template: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to update email template',
      error: error.message
    });
  }
};

/**
 * Send a test welcome email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestWelcomeEmail = async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test welcome email
    const result = await emailService.sendWelcomeEmail({
      email,
      firstName: firstName || 'Test',
      lastName: lastName || 'User',
      userId: req.user?.uid || 'test-user'
    });
    
    res.status(200).json({
      success: true,
      message: 'Test welcome email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test welcome email: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test welcome email',
      error: error.message
    });
  }
};

/**
 * Send a test update email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestUpdateEmail = async (req, res) => {
  try {
    const { email, subject, content } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test update email
    const result = await emailService.sendUpdateEmail({
      email,
      firstName: 'Test',
      lastName: 'User',
      title: subject || 'Weekly Update Test',
      content: content || '<p>This is a test of the weekly update email.</p>',
      updateType: 'weekly'
    });
    
    res.status(200).json({
      success: true,
      message: 'Test update email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test update email: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test update email',
      error: error.message
    });
  }
};

/**
 * Send a test global announcement email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestGlobalEmail = async (req, res) => {
  try {
    const { email, subject, content } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test global email
    const result = await emailService.sendGlobalEmail({
      email,
      firstName: 'Test',
      lastName: 'User',
      title: subject || 'Global Announcement Test',
      content: content || '<p>This is a test of the global announcement email.</p>'
    });
    
    res.status(200).json({
      success: true,
      message: 'Test global email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test global email: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test global email',
      error: error.message
    });
  }
};

/**
 * Send a test agent update email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestAgentEmail = async (req, res) => {
  try {
    const { email, subject, content } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test agent email
    const result = await emailService.sendUpdateEmail({
      email,
      firstName: 'Test',
      lastName: 'User',
      title: subject || 'New AI Agents Test',
      content: content || '<p>This is a test of the AI agents update email.</p>',
      updateType: 'new_agents'
    });
    
    res.status(200).json({
      success: true,
      message: 'Test agent email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test agent email: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test agent email',
      error: error.message
    });
  }
};

/**
 * Send a test tool update email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestToolEmail = async (req, res) => {
  try {
    const { email, subject, content } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test tool email
    const result = await emailService.sendUpdateEmail({
      email,
      firstName: 'Test',
      lastName: 'User',
      title: subject || 'New AI Tools Test',
      content: content || '<p>This is a test of the AI tools update email.</p>',
      updateType: 'new_tools'
    });
    
    res.status(200).json({
      success: true,
      message: 'Test tool email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test tool email: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test tool email',
      error: error.message
    });
  }
};

/**
 * Send a test custom email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestCustomEmail = async (req, res) => {
  try {
    const { email, subject, headerTitle, content } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Send test custom email
    const result = await emailService.sendCustomEmail({
      email,
      firstName: 'Test',
      lastName: 'User',
      subject: subject || 'Custom Email Test',
      headerTitle: headerTitle || subject || 'Custom Email Test',
      content: content || '<p>This is a test of the custom email.</p>'
    });
    
    res.status(200).json({
      success: true,
      message: 'Test custom email sent successfully',
      data: { messageId: result.messageId }
    });
  } catch (error) {
    logger.error(`Error sending test custom email: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to send test custom email',
      error: error.message
    });
  }
};

/**
 * Get latest tools for email content
 * @param {string} content - Existing content
 * @returns {Promise<string>} - Enhanced content with latest tools
 */
async function getLatestToolsContent(content) {
  let enhancedContent = content;
  
  try {
    // Fetch the 5 most recent tools from the database
    const toolsSnapshot = await db.collection('tools')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    
    if (!toolsSnapshot.empty) {
      // Create HTML for the tools section
      const toolsContent = `
        <div style="margin-top: 20px; margin-bottom: 20px;">
          <h3 style="color: #4a86e8;">Our Latest AI Tools</h3>
          <ul style="padding-left: 20px;">
      `;
      
      let toolsList = '';
      toolsSnapshot.forEach(doc => {
        const tool = doc.data();
        toolsList += `
          <li style="margin-bottom: 15px;">
            <div style="font-weight: bold; color: #333;">${tool.name || 'New Tool'}</div>
            <div style="color: #666;">${tool.description || 'No description available'}</div>
          </li>
        `;
      });
      
      const toolsFooter = `
          </ul>
          <p><a href="${config.websiteUrl}/tools" style="color: #4a86e8; text-decoration: none;">Explore all our AI tools →</a></p>
        </div>
      `;
      
      enhancedContent = `${content}${toolsContent}${toolsList}${toolsFooter}`;
    }
  } catch (error) {
    logger.error(`Error fetching latest tools for email: ${error.message}`);
    // Return original content if there's an error
  }
  
  return enhancedContent;
}

/**
 * Send a tool update email to specific recipients
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendToolUpdateEmail = async (req, res) => {
  try {
    // Log the request body for debugging
    console.log('Tool update email request:', JSON.stringify(req.body, null, 2));
    
    // Use the same structure as sendCustomEmail, but add latest tools
    const { title, content, recipientType, recipients } = req.body;
    
    // Validate inputs
    if (!title || !content || !recipientType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title, content, and recipient type are required' 
      });
    }
    
    if (recipientType === 'specific' && (!recipients || recipients.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Recipients are required when using specific recipient type'
      });
    }
    
    // Set update type for tools
    const updateType = 'new_tools';
    
    // Create campaign record
    const campaignId = await emailNotificationModel.createCampaign({
      title,
      content,
      type: updateType,
      recipientType,
      createdBy: req.user.uid,
      specificEmails: recipientType === 'specific' ? recipients.split(',').map(e => e.trim()) : null
    });
    
    // Mark as sending
    await emailNotificationModel.markCampaignAsSending(campaignId);
    
    // Get enhanced content with latest tools
    const enhancedContent = await getLatestToolsContent(content);
    
    // The rest of the function follows the same pattern as sendCustomEmail
    // Get user data based on recipient type
    let users = [];
    
    if (recipientType === 'specific' && recipients) {
      // For specific emails
      const emails = recipients.split(',').map(email => email.trim()).filter(email => email);
      
      console.log(`Processing ${emails.length} specific recipient emails`);
      
      if (emails.length === 0) {
        await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0);
        
        return res.status(200).json({
          success: true,
          message: 'No valid recipients specified',
          data: { campaignId, recipientCount: 0 }
        });
      }
      
      // Get user data for these emails if they exist in our system
      try {
        // Firestore has a limit for 'in' queries, so we may need to process in batches
        const batchSize = 10; // Firestore limit
        let processedUsers = [];
        
        // Process emails in batches to avoid Firestore limits
        for (let i = 0; i < emails.length; i += batchSize) {
          const batch = emails.slice(i, i + batchSize);
          const usersSnapshot = await db.collection('users')
            .where('email', 'in', batch)
            .get();
          
          processedUsers = [...processedUsers, ...usersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))];
        }
        
        users = processedUsers;
        
        // Add any emails not found as users
        const foundEmails = users.map(u => u.email);
        const notFoundEmails = emails.filter(email => !foundEmails.includes(email));
        
        console.log(`Found ${users.length} registered users, adding ${notFoundEmails.length} non-registered emails`);
        
        // Add placeholder users for these emails
        notFoundEmails.forEach(email => {
          users.push({
            id: null,
            email,
            firstName: '',
            lastName: ''
          });
        });
      } catch (error) {
        logger.error(`Error fetching users for tool update: ${error.message}`);
        
        // Continue with just the emails as a fallback
        users = emails.map(email => ({
          id: null,
          email,
          firstName: '',
          lastName: ''
        }));
      }
    } else {
      // For user groups (all, premium, free)
      let query = db.collection('users');
      
      if (recipientType === 'premium') {
        query = query.where('accountType', '==', 'premium');
      } else if (recipientType === 'free') {
        query = query.where('accountType', '==', 'free');
      }
      
      const usersSnapshot = await query.get();
      
      users = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`Found ${users.length} users for ${recipientType} recipient type`);
    }
    
    if (users.length === 0) {
      await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0);
      
      return res.status(200).json({
        success: true,
        message: 'No recipients found',
        data: { campaignId, recipientCount: 0 }
      });
    }
    
    // Prepare to track success/failure
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    // Send emails to each recipient
    for (const user of users) {
      try {
        // Use the appropriate function for tool updates
        const result = await emailService.sendUpdateEmail({
          userId: user.id,
          email: user.email,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          title,
          content: enhancedContent,
          updateType
        });
        
        // Log success
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: true,
          messageId: result.messageId
        });
        
        sentCount++;
        console.log(`Tool update email sent to ${user.email} successfully`);
      } catch (error) {
        // Log failure
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: false,
          error: error.message
        });
        
        failedCount++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: error.message
        });
        
        logger.error(`Failed to send tool update email to ${user.email}: ${error.message}`);
      }
    }
    
    // Mark campaign as completed
    await emailNotificationModel.markCampaignAsCompleted(
      campaignId, 
      sentCount, 
      failedCount,
      errors
    );
    
    res.status(200).json({
      success: true,
      message: 'Tool update email campaign completed',
      data: {
        campaignId,
        recipientCount: users.length,
        sentCount,
        failedCount
      }
    });
  } catch (error) {
    logger.error(`Error sending tool update emails: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete tool update email campaign',
      error: error.message
    });
  }
};

/**
 * Send a test agent update email with latest agents
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendTestAgentUpdateEmail = async (req, res) => {
  try {
    const { email, title, content, headerTitle } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Make sure no hardcoded Agent bullet points are included
    let cleanContent = content || "";
    if (cleanContent.includes('Agent 1:') || cleanContent.includes('Agent 2:')) {
      cleanContent = cleanContent.split('\n')
        .filter(line => !line.includes('Agent 1:') && !line.includes('Agent 2:') && !line.includes('Agent 3:'))
        .join('\n');
      
      console.log('Removed static agent bullet points from custom content');
    }
    
    // Get latest agents
    const latestAgents = await agentsController.getLatestAgents(5);
    
    console.log(`Fetched ${latestAgents.length} latest agents for test email`);
    
    if (latestAgents.length > 0) {
      console.log('Sample agent data:', JSON.stringify(latestAgents[0], null, 2).substring(0, 200) + '...');
    }
    
    // Send agent update email
    const result = await emailService.sendAgentUpdateEmail({
      email,
      name: req.user?.displayName || 'Waverider',
      title: title || headerTitle || 'New AI Agents Available - Test',
      content: cleanContent, // Use content directly for the template
      latestAgents
    });
    
    // Log the send
    await emailNotificationModel.logEmailSend({
      type: 'test-agent-update',
      email,
      userId: req.user?.uid || null,
      success: true,
      messageId: result.messageId
    });
    
    res.status(200).json({
      success: true,
      message: 'Agent update test email sent successfully',
      data: { 
        messageId: result.messageId,
        agentCount: latestAgents.length
      }
    });
  } catch (error) {
    logger.error(`Error sending agent update test email: ${error.message}`);
    
    // Log the failure
    if (req.body.email) {
      await emailNotificationModel.logEmailSend({
        type: 'test-agent-update',
        email: req.body.email,
        userId: req.user?.uid || null,
        success: false,
        error: error.message
      }).catch(e => {
        logger.error(`Failed to log email failure: ${e.message}`);
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to send agent update test email',
      error: error.message
    });
  }
};

/**
 * Send an agent update email to specific recipients
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.sendAgentUpdateEmail = async (req, res) => {
  try {
    const { title, content, recipientType, recipients, recipientUsersData } = req.body;
    
    // Validate inputs
    if (!title || !content || !recipientType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title, content, and recipient type are required' 
      });
    }
    
    if (recipientType === 'specific' && (!recipients || recipients.trim() === '') && 
        (!recipientUsersData || !Array.isArray(recipientUsersData) || recipientUsersData.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Recipients are required when using specific recipient type'
      });
    }
    
    // Set update type for agents
    const updateType = 'new_agents';
    
    // Create campaign record
    const campaignId = await emailNotificationModel.createCampaign({
      title,
      content,
      type: updateType,
      recipientType,
      createdBy: req.user?.uid || 'system',
      specificEmails: recipientType === 'specific' && recipients ? recipients.split(',').map(e => e.trim()) : null
    });
    
    // Mark as sending
    await emailNotificationModel.markCampaignAsSending(campaignId);
    
    // Get latest agents
    const latestAgents = await agentsController.getLatestAgents(5) || [];
    
    console.log(`Fetched ${latestAgents.length} latest agents for agent update email`);
    
    if (latestAgents.length > 0) {
      console.log('Sample agent data:', JSON.stringify(latestAgents[0], null, 2).substring(0, 200) + '...');
    }
    
    // Get user data based on recipient type
    let users = [];
    
    if (recipientType === 'specific') {
      // If recipientUsersData is provided directly (from frontend)
      if (recipientUsersData && Array.isArray(recipientUsersData) && recipientUsersData.length > 0) {
        users = recipientUsersData;
      } 
      // Otherwise extract from the comma-separated list of emails
      else if (recipients) {
        const emails = recipients.split(',').map(email => email.trim());
        
        // Check if we have valid email addresses
        if (emails.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'No valid email addresses provided'
          });
        }
        
        // For each email, create a minimal user object
        users = emails.map(email => ({
          id: null, // We don't have user IDs for manual emails
          email: email,
          firstName: '', // We don't have names for manual emails
          lastName: ''
        }));
      }
    } else {
      // For user groups (all, premium, free)
      let query = db.collection('users');
      
      if (recipientType === 'premium') {
        query = query.where('accountType', '==', 'premium');
      } else if (recipientType === 'free') {
        query = query.where('accountType', '==', 'free');
      }
      
      const usersSnapshot = await query.get();
      
      users = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`Found ${users.length} users for ${recipientType} recipient type`);
    }
    
    if (users.length === 0) {
      await emailNotificationModel.markCampaignAsCompleted(campaignId, 0, 0);
      
      return res.status(200).json({
        success: true,
        message: 'No recipients found',
        data: { campaignId, recipientCount: 0 }
      });
    }
    
    // Prepare to track success/failure
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    // Send emails to each recipient
    for (const user of users) {
      try {
        // Use the agent update email function
        const result = await emailService.sendAgentUpdateEmail({
          email: user.email,
          name: user.firstName || 'Waverider',
          title: title || 'New AI Agents Available',
          headerTitle: req.body.headerTitle || title || 'New AI Agents Available',
          content: content,
          latestAgents
        });
        
        // Log success
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: true,
          messageId: result.messageId
        });
        
        sentCount++;
        console.log(`Agent update email sent to ${user.email} successfully`);
      } catch (error) {
        // Log failure
        await emailNotificationModel.logEmailSend({
          campaignId,
          type: updateType,
          userId: user.id,
          email: user.email,
          success: false,
          error: error.message
        });
        
        failedCount++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: error.message
        });
        
        logger.error(`Failed to send agent update email to ${user.email}: ${error.message}`);
      }
    }
    
    // Mark campaign as completed
    await emailNotificationModel.markCampaignAsCompleted(
      campaignId, 
      sentCount, 
      failedCount,
      errors
    );
    
    res.status(200).json({
      success: true,
      message: 'Agent update email campaign completed',
      data: {
        campaignId,
        recipientCount: users.length,
        sentCount,
        failedCount,
        agentCount: latestAgents.length
      }
    });
  } catch (error) {
    logger.error(`Error sending agent update emails: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete agent update email campaign',
      error: error.message
    });
  }
};

/**
 * Add email to waitlist (public endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.addToWaitlist = async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validate email
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid email address is required' 
      });
    }
    
    // Add to waitlist
    const waitlistEntry = await emailNotificationModel.addToWaitlist(email);
    
    // Optionally send confirmation email
    try {
      await emailService.sendEmail({
        to: email,
        subject: 'You\'re on the waitlist! - AI Waverider',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #3498db;">Welcome to the AI Waverider Waitlist!</h2>
            <p>Thank you for joining our waitlist. You'll be the first to know when we launch our AI Automation Mastery Program.</p>
            <p><strong>What's Next?</strong></p>
            <ul>
              <li>You'll receive early access 2 weeks before public launch</li>
              <li>Founding members get 40% off ($297 instead of $497)</li>
              <li>Lifetime price lock - your price never increases</li>
              <li>Exclusive bonus templates and priority support</li>
            </ul>
            <p>We'll notify you as soon as we're ready to launch!</p>
            <p>Best regards,<br>The AI Waverider Team</p>
          </div>
        `
      });
    } catch (emailError) {
      // Don't fail if confirmation email fails
      logger.warn(`Failed to send waitlist confirmation email to ${email}: ${emailError.message}`);
    }
    
    res.status(200).json({
      success: true,
      message: waitlistEntry.alreadyExists 
        ? 'You\'re already on the waitlist!' 
        : 'Successfully added to waitlist!',
      data: {
        email: waitlistEntry.email,
        alreadyExists: waitlistEntry.alreadyExists
      }
    });
  } catch (error) {
    logger.error(`Error adding email to waitlist: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to add email to waitlist',
      error: error.message
    });
  }
};

/**
 * Get waitlist count (public endpoint)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getWaitlistCount = async (req, res) => {
  try {
    const count = await emailNotificationModel.getWaitlistCount();
    
    res.status(200).json({
      success: true,
      data: { count }
    });
  } catch (error) {
    logger.error(`Error getting waitlist count: ${error.message}`);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get waitlist count',
      error: error.message
    });
  }
};

module.exports = exports; 