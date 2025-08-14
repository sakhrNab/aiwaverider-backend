/**
 * Email Service
 * 
 * Handles email sending functionality for various types of emails.
 * Uses Nodemailer for email delivery and Handlebars for template rendering.
 * Enhanced for UniPay payment system integration.
 */

const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');
const config = require('../../config/email');
const logger = require('../../utils/logger');
const Handlebars = require('handlebars');
const { v4: uuidv4 } = require('uuid');

// Register Handlebars helpers
Handlebars.registerHelper('times', function(n, block) {
  var accum = '';
  for(var i = 0; i < n; ++i)
    accum += block.fn(i);
  return accum;
});

Handlebars.registerHelper('formatPrice', function(price) {
  if (!price && price !== 0) return 'Free';
  if (price === 0) return 'Free';
  return `$${parseFloat(price).toFixed(2)}`;
});

Handlebars.registerHelper('formatDate', function(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
});

// Cache for compiled email templates
const templateCache = {};

/**
 * Load and compile an email template
 * @param {string} templateName - Name of the template file without extension
 * @returns {Promise<Function>} - Compiled Handlebars template function
 */
async function getCompiledTemplate(templateName) {
  // Check if template is already cached
  if (templateCache[templateName]) {
    return templateCache[templateName];
  }
  
  try {
    // Define template path
    let templatePath = path.join(__dirname, '../../', 'templates', 'emails', `${templateName}.html`);
    logger.info(`Loading email template from: ${templatePath}`);
    
    // Check if file exists
    try {
      await fs.access(templatePath);
    } catch (error) {
      // Try fallback template names if the original doesn't exist
      const fallbacks = {
        'custom': ['custom_email', 'custom-email'],
        'custom_email': ['custom', 'custom-email'],
        'custom-email': ['custom', 'custom_email'],
        'update': ['weekly_update', 'weekly-update'],
        'weekly_update': ['update', 'weekly-update'],
        'weekly-update': ['update', 'weekly_update']
      };
      
      if (fallbacks[templateName]) {
        // Try each fallback in order
        for (const fallback of fallbacks[templateName]) {
          const fallbackPath = path.join(__dirname, '../../', 'templates', 'emails', `${fallback}.html`);
          try {
            await fs.access(fallbackPath);
            logger.info(`Template '${templateName}' not found, using fallback: ${fallback}`);
            templatePath = fallbackPath;
            break;
          } catch (fbError) {
            // Continue to next fallback
          }
        }
      }
      
      // If we still can't find a template, throw the original error
      try {
        await fs.access(templatePath);
      } catch (finalError) {
        logger.error(`Template file does not exist: ${templatePath}`);
        throw new Error(`Email template '${templateName}' does not exist`);
      }
    }
    
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    
    // Compile template
    const compiledTemplate = handlebars.compile(templateSource);
    
    // Cache for future use
    templateCache[templateName] = compiledTemplate;
    
    logger.info(`Successfully loaded and compiled template: ${templateName}`);
    return compiledTemplate;
  } catch (error) {
    logger.error(`Failed to load email template '${templateName}': ${error.message}`);
    throw new Error(`Email template '${templateName}' could not be loaded: ${error.message}`);
  }
}

/**
 * Create email transport based on configuration
 * @returns {Object} - Nodemailer transporter
 */
function createTransport() {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure, // true for 465, false for other ports
    auth: {
      user: config.user,
      pass: config.password
    }
  });
}

/**
 * Send an email using the configured transport
 * @param {Object} mailOptions - Nodemailer mail options
 * @returns {Promise<Object>} - Email send result
 */
const sendEmail = async function(mailOptions) {
  try {
    // Validate recipient
    if (!mailOptions.to) {
      logger.error('No recipients defined in email options');
      throw new Error('No recipients defined');
    }
    
    const transporter = createTransport();
    
    // Add default from address if not provided
    if (!mailOptions.from) {
      mailOptions.from = `"${config.fromName}" <${config.fromEmail}>`;
    }
    
    // Add anti-spam headers to improve deliverability
    mailOptions.headers = {
      ...mailOptions.headers,
      'List-Unsubscribe': '<https://aiwaverider.com/unsubscribe>',
      'Precedence': 'bulk',
      'X-AI-Waverider': 'notification'
    };
    
    // Add text version if HTML is provided but no text (helps deliverability)
    if (mailOptions.html && !mailOptions.text) {
      // Simple HTML to text conversion
      mailOptions.text = mailOptions.html
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/\s+/g, ' ')    // Normalize spaces
        .trim();
    }
    
    // Log the email attempt with redacted content
    logger.email(`Attempting to send email to ${mailOptions.to} with subject: "${mailOptions.subject}"`);
    logger.email(`Email configuration: host=${config.host}, port=${config.port}, secure=${config.secure}, user=${config.user}`);
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    logger.email(`Email sent successfully: ${info.messageId}`);
    logger.info(`Email sent: ${info.messageId}`);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
  } catch (error) {
    logger.error(`Failed to send email: ${error.message}`);
    logger.email(`Email sending failed: ${error.message}`);
    throw error;
  }
};

// Export sendEmail
exports.sendEmail = sendEmail;

/**
 * Send a welcome email to a new user
 * @param {Object} userData - User data for the email
 * @returns {Promise<Object>} - Email send result
 */
exports.sendWelcomeEmail = async (userData) => {
  try {
    // Get the welcome email template
    const template = await getCompiledTemplate('welcome');
    
    // Prepare the data for the template
    const data = {
      name: userData.firstName ? `${userData.firstName}` : 'there',
      websiteUrl: config.websiteUrl,
      supportEmail: config.supportEmail
    };
    
    // Render the HTML content with the data
    const html = template(data);
    
    // Send the email
    return await sendEmail({
      to: userData.email,
      subject: 'Welcome to AI Waverider!',
      html
    });
  } catch (error) {
    logger.error(`Failed to send welcome email: ${error.message}`);
    throw error;
  }
};

/**
 * Send a test email to verify configuration
 * @param {string} emailAddress - Recipient email address
 * @returns {Promise<Object>} - Email send result
 */
exports.sendTestEmail = async (emailAddress) => {
  try {
    // Send a simple test email
    return await sendEmail({
      to: emailAddress,
      subject: 'AI Waverider - Email Configuration Test',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h1 style="color: #4a86e8;">Email Configuration Test</h1>
          <p>This is a test email to verify that your email configuration is working correctly.</p>
          <p>If you're receiving this email, it means your email service is properly configured!</p>
          <p>Timestamp: ${new Date().toISOString()}</p>
          <hr>
          <p style="font-size: 12px; color: #777;">
            This is an automated message from AI Waverider.
            Please do not reply to this email.
          </p>
        </div>
      `
    });
  } catch (error) {
    logger.error(`Failed to send test email: ${error.message}`);
    throw error;
  }
};

/**
 * Send an update notification email to users
 * @param {Object} emailData - Email content and user data
 * @returns {Promise<Object>} - Email send result
 */
exports.sendUpdateEmail = async (emailData) => {
  try {
    // Determine the appropriate template based on update type
    let templateName = 'weekly_update';
    let subjectPrefix = 'Weekly Update:';
    
    // Use different templates for different update types
    switch(emailData.updateType) {
      case 'weekly':
      case 'update':
        templateName = 'weekly_update';
        subjectPrefix = 'Weekly Update:';
        break;
      case 'announcements':
        templateName = 'announcement';
        subjectPrefix = 'Announcement:';
        break;
      case 'new_agents':
        templateName = 'new_agents'; // Try to use dedicated template
        try {
          await fs.access(path.join(__dirname, '../..', 'templates', 'emails', 'new_agents.html'));
        } catch (error) {
          // Fallback to weekly_update if new_agents template doesn't exist
          templateName = 'weekly_update';
          logger.info(`new_agents template not found, falling back to weekly_update`);
        }
        subjectPrefix = 'New AI Agents:';
        break;
      case 'new_tools':
        templateName = 'new_tools'; // Try to use dedicated template
        try {
          await fs.access(path.join(__dirname, '../../', 'templates', 'emails', 'new_tools.html'));
        } catch (error) {
          // Fallback to weekly_update if new_tools template doesn't exist
          templateName = 'weekly_update';
          logger.info(`new_tools template not found, falling back to weekly_update`);
        }
        subjectPrefix = 'New AI Tools:';
        break;
      case 'notification':
        templateName = 'notification';
        subjectPrefix = 'Notification:';
        break;
      default:
        // For unrecognized types, use the notification template
        templateName = 'notification';
        subjectPrefix = 'Update:';
        logger.info(`Unknown update type: ${emailData.updateType}, using notification template`);
    }
    
    logger.info(`Sending ${emailData.updateType} email using ${templateName} template`);
    
    // Get the template
    const template = await getCompiledTemplate(templateName);
    
    // Prepare the data
    const data = {
      name: emailData.firstName ? `${emailData.firstName}` : 'there',
      title: emailData.title,
      content: emailData.content,
      websiteUrl: config.websiteUrl,
      supportEmail: config.supportEmail,
      updateType: emailData.updateType,
      currentYear: new Date().getFullYear()
    };
    
    // Render the HTML
    const html = template(data);
    
    // Send the email
    return await sendEmail({
      to: emailData.email,
      subject: `${subjectPrefix} ${emailData.title}`,
      html
    });
  } catch (error) {
    logger.error(`Failed to send update email: ${error.message}`);
    throw error;
  }
};

/**
 * Send a global announcement email to all users
 * @param {Object} emailData - Email content and user data
 * @returns {Promise<Object>} - Email send result
 */
exports.sendGlobalEmail = async (emailData) => {
  try {
    // Get the announcement template
    const template = await getCompiledTemplate('announcement');
    
    // Prepare the data
    const data = {
      name: emailData.firstName ? `${emailData.firstName}` : 'there',
      title: emailData.title,
      content: emailData.content,
      websiteUrl: config.websiteUrl,
      supportEmail: config.supportEmail,
      currentYear: new Date().getFullYear()
    };
    
    // Render the HTML
    const html = template(data);
    
    // Send the email
    return await sendEmail({
      to: emailData.email,
      subject: `Important: ${emailData.title}`,
      html
    });
  } catch (error) {
    logger.error(`Failed to send global email: ${error.message}`);
    throw error;
  }
};

/**
 * Sends an agent purchase confirmation email (ENHANCED for UniPay system)
 * @param {Object} purchaseData - Purchase and user data
 * @returns {Promise<Object>} - Email send result
 */
exports.sendAgentPurchaseEmail = async (purchaseData) => {
  try {
    // Get the agent purchase template
    const template = await getCompiledTemplate('agent_purchase');
    
    // Enhanced payment method detection and display
    const paymentMethodInfo = getPaymentMethodDisplayInfo(
      purchaseData.paymentMethod, 
      purchaseData.paymentProcessor
    );
    
    // Determine email title and headers based on payment status and method
    let emailTitle = 'Your AI Agent Purchase: ' + purchaseData.agentName;
    let headerTitle = 'Your AI Agent Template is Ready!';
    let headerSubtitle = 'Thank you for your purchase';
    
    // Adjust messaging for pending payments (like SEPA)
    if (purchaseData.paymentStatus === 'pending' || purchaseData.isSepaPayment) {
      emailTitle = `Payment Received - ${purchaseData.agentName} (${paymentMethodInfo.displayName} Processing)`;
      headerTitle = 'Payment Received!';
      headerSubtitle = 'Your payment is being processed';
    }
    
    // Enhanced template data with new payment system features
    const data = {
      name: purchaseData.firstName ? `${purchaseData.firstName}` : 'there',
      agentName: purchaseData.agentName,
      agentDescription: purchaseData.agentDescription,
      purchaseDate: purchaseData.orderDate || new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      price: purchaseData.price.toFixed(2),
      currency: purchaseData.currency || 'USD',
      receiptUrl: purchaseData.receiptUrl,
      websiteUrl: config.websiteUrl,
      supportEmail: config.supportEmail,
      currentYear: new Date().getFullYear(),
      orderId: purchaseData.orderId || 'N/A',
      orderDate: purchaseData.orderDate || new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      
      // Enhanced payment information
      paymentStatus: purchaseData.paymentStatus || 'successful',
      paymentMethod: paymentMethodInfo.displayName,
      paymentProcessor: paymentMethodInfo.processorName,
      isPending: purchaseData.paymentStatus === 'pending' || purchaseData.isSepaPayment,
      isSepaPayment: purchaseData.isSepaPayment || false,
      
      // Enhanced header information
      headerTitle: headerTitle,
      headerSubtitle: headerSubtitle,
      
      // Download information
      immediateDownload: purchaseData.immediateDownload !== false && !purchaseData.isSepaPayment,
      downloadUrl: purchaseData.downloadUrl || null,
      
      // Invoice information (new feature)
      invoiceNumber: purchaseData.invoiceNumber || null,
      vatInfo: purchaseData.vatInfo || null,
      
      // Template for display in email
      showTemplatePreview: !!purchaseData.templateContent
    };
    
    // Add VAT breakdown if applicable
    if (purchaseData.vatInfo && purchaseData.vatInfo.vatAmount > 0) {
      data.subtotal = (purchaseData.price - purchaseData.vatInfo.vatAmount).toFixed(2);
      data.vatAmount = purchaseData.vatInfo.vatAmount.toFixed(2);
      data.vatRate = (purchaseData.vatInfo.vatRate * 100).toFixed(1);
      data.hasVat = true;
    }
    
    // Render the HTML
    const html = template(data);
    
    // Prepare email options
    const mailOptions = {
      to: purchaseData.email,
      subject: emailTitle,
      html,
      headers: {
        'X-Order-ID': purchaseData.orderId,
        'X-Agent-ID': purchaseData.agentId,
        'X-Payment-Processor': purchaseData.paymentProcessor || 'unknown',
        'X-Payment-Method': purchaseData.paymentMethod || 'unknown'
      }
    };
    
    // Initialize attachments array
    mailOptions.attachments = mailOptions.attachments || [];

    // Add attachment for the template file (enhanced logic)
    if (purchaseData.templateContent && !purchaseData.isSepaPayment) {
      try {
        // Prepare filename
        const filename = `${purchaseData.agentName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.json`;
        
        // The templateContent should already be a properly formatted JSON string from getAgentTemplate
        // Make sure it's valid before attaching it
        let content = purchaseData.templateContent;
        
        // Check if it's already a valid JSON string
        try {
          // Try parsing it to validate and then re-stringify with nice formatting
          JSON.parse(content); // Just to validate
          // It's already valid JSON
        } catch (jsonError) {
          // If it's not valid JSON, try to structure it
          logger.info("Template content is not valid JSON, structuring it");
          const jsonContent = {
            name: purchaseData.agentName,
            description: purchaseData.agentDescription || '',
            version: "1.0",
            created: new Date().toISOString(),
            orderId: purchaseData.orderId,
            template: content
          };
          
          content = JSON.stringify(jsonContent, null, 2);
        }
        
        // Attach the file
        mailOptions.attachments.push({
          filename: filename,
          content: content
        });
        logger.info(`Attaching template for ${purchaseData.agentName} as ${filename}`);
      } catch (formatError) {
        logger.error(`Error formatting template content: ${formatError.message}`);
        // Still attach the original content if there's an error in formatting
        mailOptions.attachments.push({
          filename: `${purchaseData.agentName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.txt`,
          content: purchaseData.templateContent
        });
      }
    } else if (purchaseData.agentId && !purchaseData.isSepaPayment) {
      try {
        // Try to get the template content from the agents collection
        const { db } = require('../../config/firebase');
        const { getAgentTemplate } = require('../../controllers/payment/orderController');
        const agentId = purchaseData.agentId;
        
        // Get the agent template directly using the order controller function
        const templateContent = await getAgentTemplate(agentId);
        
        if (templateContent) {
          // Prepare filename with JSON extension since we're now ensuring it's proper JSON
          const filename = `${purchaseData.agentName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.json`;
          
          // Attach the file - templateContent should already be properly formatted JSON
          mailOptions.attachments.push({
            filename: filename,
            content: templateContent
          });
          logger.info(`Attaching REAL template from orderController for agent ${agentId}`);
        } else {
          logger.warn(`No template content returned from getAgentTemplate for agent ${agentId}`);
        }
      } catch (fetchError) {
        logger.error(`Error fetching template content: ${fetchError.message}`);
      }
    }

    // Always attach README/Setup guide if available and not SEPA
    try {
      if (!purchaseData.isSepaPayment) {
        const readmeContent = `AI Waverider - Setup Guide\n\nThank you for your purchase!\n\nHow to use your template:\n1) Download the attached JSON file.\n2) Open it with a text editor and copy its content.\n3) Paste into your N8N.\n4) Follow any notes inside the template.\n\nNeed help? Contact: ${config.supportEmail}\nWebsite: ${config.websiteUrl}\n`;
        mailOptions.attachments.push({
          filename: 'README.txt',
          content: readmeContent,
          contentType: 'text/plain'
        });
        logger.info('Attached README.txt setup guide');
      }
    } catch (readmeErr) {
      logger.warn('Failed to attach README.txt:', readmeErr.message);
    }
    
    // Send the email
    logger.info(`Sending purchase confirmation email to: ${purchaseData.email} (${paymentMethodInfo.displayName})`);
    return await sendEmail(mailOptions);
  } catch (error) {
    logger.error(`Failed to send agent purchase email: ${error.message}`);
    throw error;
  }
};

/**
 * Enhanced helper function to get payment method display information
 * @param {string} paymentMethod - The payment method type
 * @param {string} paymentProcessor - The payment processor
 * @returns {Object} - Display information for the payment method
 */
function getPaymentMethodDisplayInfo(paymentMethod, paymentProcessor) {
  const methodMap = {
    'card': {
      displayName: 'Credit/Debit Card',
      processorName: 'PayPal',
      note: null
    },
    'paypal': {
      displayName: 'PayPal',
      processorName: 'PayPal',
      note: 'Payment processed securely through PayPal.'
    },
    'google_pay': {
      displayName: 'Google Pay',
      processorName: 'google_direct',
      note: 'Payment processed through your Google Pay wallet.'
    },
    
    'sepa': {
      displayName: 'SEPA Bank Transfer',
      processorName: 'PayPal',
      note: 'Bank transfer processed through the SEPA network.'
    },
    'sepa_debit': {
      displayName: 'SEPA Direct Debit',
      processorName: 'PayPal',
      note: 'Direct debit from your bank account.'
    },
    'sepa_credit_transfer': {
      displayName: 'SEPA Credit Transfer',
      processorName: 'Manual',
      note: 'Bank transfer will be processed within 1-2 business days.'
    }
  };

  return methodMap[paymentMethod] || {
    displayName: 'Payment',
    processorName: paymentProcessor || 'PayPal',
    note: null
  };
}

/**
 * Send refund notification email (NEW for UniPay system)
 * @param {Object} refundData - Refund information
 * @returns {Promise<Object>} - Email send result
 */
exports.sendRefundNotification = async (refundData) => {
  try {
    const {
      email,
      firstName,
      orderId,
      refundAmount,
      originalAmount,
      currency,
      refundReason,
      agentName
    } = refundData;

    if (!email || !orderId) {
      throw new Error('Email and order ID are required for refund notification');
    }

    const subject = `Refund Processed - Order ${orderId}`;
    
    // Try to use a refund template if it exists, otherwise use inline HTML
    let html;
    try {
      const template = await getCompiledTemplate('refund');
      html = template({
        name: firstName || 'Valued Customer',
        orderId,
        refundAmount: refundAmount ? refundAmount.toFixed(2) : originalAmount.toFixed(2),
        originalAmount: originalAmount.toFixed(2),
        currency: currency || 'USD',
        agentName: agentName || 'AI Agent',
        refundReason: refundReason || 'Customer request',
        websiteUrl: config.websiteUrl,
        supportEmail: config.supportEmail,
        currentYear: new Date().getFullYear()
      });
    } catch (templateError) {
      // Fallback to inline HTML if template doesn't exist
      html = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
          <h2>Refund Processed</h2>
          <p>Hello ${firstName || 'Valued Customer'},</p>
          <p>Your refund has been processed for order ${orderId}.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Refund Amount:</strong> ${refundAmount ? refundAmount.toFixed(2) : originalAmount.toFixed(2)} ${currency || 'USD'}</p>
            <p><strong>Original Amount:</strong> ${originalAmount.toFixed(2)} ${currency || 'USD'}</p>
            ${agentName ? `<p><strong>Product:</strong> ${agentName}</p>` : ''}
            ${refundReason ? `<p><strong>Reason:</strong> ${refundReason}</p>` : ''}
          </div>
          <p>The refund will appear in your account within 3-5 business days.</p>
          <p>If you have any questions, please contact us at ${config.supportEmail}.</p>
          <hr>
          <p style="font-size: 12px; color: #777;">
            This is an automated message from AI Waverider.
          </p>
        </div>
      `;
    }

    const result = await sendEmail({
      to: email,
      subject,
      html,
      headers: {
        'X-Order-ID': orderId,
        'X-Refund-Notification': 'true'
      }
    });

    logger.info(`Refund notification sent to ${email}`, { orderId, messageId: result.messageId });
    return result;
  } catch (error) {
    logger.error(`Failed to send refund notification:`, error);
    throw error;
  }
};

/**
 * Send a custom email without a template
 * @param {Object} emailData - Email content and recipient data
 * @returns {Promise<Object>} - Email send result
 */
exports.sendCustomEmail = async (emailData) => {
  try {
    // Log all incoming data for debugging purposes
    logger.info(`Sending custom email to: ${emailData.email}`);
    logger.info(`Email type: ${emailData.emailType || 'custom'}`);
    logger.debug(`Email data: ${JSON.stringify({
      subject: emailData.subject,
      title: emailData.title,
      headerTitle: emailData.headerTitle,
      content: emailData.content ? '[CONTENT LENGTH: ' + emailData.content.length + ' chars]' : 'No content'
    })}`);

    // Determine which template to use
    let templateName = 'custom';
    let subject = emailData.subject || emailData.title || 'Message from AI Waverider';
    
    // Check for specific email types and adjust template accordingly
    if (emailData.emailType === 'agent' || emailData.updateType === 'new_agents') {
      templateName = 'new_agents';
      subject = emailData.title || 'New AI Agents Available!';
    } else if (emailData.emailType === 'tool' || emailData.updateType === 'new_tools') {
      templateName = 'new_tools';
      subject = emailData.title || 'New AI Tools Released!';
    }
    
    logger.info(`Using template: ${templateName} for email to ${emailData.email}`);
    
    // Ensure we have all the required data
    if (!emailData.content) {
      throw new Error('Email content is required');
    }
    
    // Try to use the selected template if it exists
    let html;
    try {
      // Try to get the appropriate template
      const template = await getCompiledTemplate(templateName);
      
      // Prepare the data for the template
      const data = {
        name: emailData.firstName ? `${emailData.firstName}` : 'there',
        title: emailData.title || subject,
        headerTitle: emailData.headerTitle || emailData.title || subject, // Use headerTitle if provided, otherwise fall back to title or subject
        subject: subject,
        content: emailData.content,
        websiteUrl: config.websiteUrl,
        supportEmail: config.supportEmail,
        currentYear: new Date().getFullYear(),
        actionUrl: emailData.actionUrl || config.websiteUrl,
        actionText: emailData.actionText || 'Visit Website',
        imageUrl: emailData.imageUrl || null
      };
      
      // Log the data being passed to the template
      logger.debug(`Template data for ${templateName}: ${JSON.stringify({
        headerTitle: data.headerTitle,
        subject: data.subject,
        title: data.title
      })}`);
      
      // Render the HTML content with the template
      html = template(data);
      logger.info(`Successfully rendered email using ${templateName} template`);
    } catch (templateError) {
      // If template doesn't exist or fails, use fallback inline template
      logger.warning(`Template ${templateName} not found or error rendering, using fallback HTML: ${templateError.message}`);
      html = `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h1 style="color: #4a86e8;">${emailData.headerTitle || subject}</h1>
          <div>${emailData.content}</div>
          <hr>
          <p style="font-size: 12px; color: #777;">
            This email was sent from AI Waverider. 
            If you no longer wish to receive these emails, you can 
            <a href="${config.websiteUrl}/unsubscribe">unsubscribe</a> from your profile settings.
          </p>
        </div>
      `;
    }
    
    // Add extra headers to improve deliverability
    const headers = {
      'X-Priority': '3',
      'List-Unsubscribe': `<mailto:unsubscribe@${config.fromEmail.split('@')[1]}?subject=unsubscribe>`,
      'X-Report-Abuse': `Please report abuse to ${config.supportEmail}`
    };
    
    // Send the email
    const result = await sendEmail({
      to: emailData.email,
      subject: subject,
      html: html,
      headers: headers
    });
    
    logger.info(`Custom email sent successfully to ${emailData.email} with message ID: ${result.messageId}`);
    return result;
  } catch (error) {
    logger.error(`Failed to send custom email: ${error.message}`);
    throw error;
  }
};

/**
 * Send agent update email
 * @param {string} emailOrOptions - The email address or options object to send the update to
 * @param {string} name - The recipient's name
 * @param {string} title - The email title
 * @param {string} content - The email content
 * @param {Array} latestAgents - The latest agents
 * @returns {Promise} - Promise that resolves with the email response
 */
const sendAgentUpdateEmail = async (emailOrOptions, name, title, content, latestAgents = []) => {
  try {
    let email, recipientName, emailTitle, emailContent, agents;
    
    // Determine if we're using the object format or separate parameters
    if (typeof emailOrOptions === 'object' && emailOrOptions !== null) {
      // Object format being used
      const options = emailOrOptions;
      email = options.email;
      recipientName = options.name;
      emailTitle = options.title;
      emailContent = options.content;
      agents = options.latestAgents || [];
    } else {
      // Separate parameters being used
      email = emailOrOptions;
      recipientName = name;
      emailTitle = title;
      emailContent = content;
      agents = latestAgents;
    }
    
    // Validate required parameters
    if (!email) {
      throw new Error('Recipient email is required');
    }
    
    console.log(`Sending agent update email to ${email} with title: ${emailTitle}`);
    
    // If no agents are provided, fetch the latest
    if (!Array.isArray(agents) || agents.length === 0) {
      try {
        // First try to get the latest agents from the agents controller
        const agentsController = require('../../controllers/agent/agentsController');
        agents = await agentsController.getLatestAgents(5);
        console.log(`Fetched ${agents.length} latest agents from controller`);
      } catch (error) {
        console.error('Error fetching latest agents:', error);
        // Use sample agents as fallback
        agents = getSampleAgentsForEmail();
        console.log('Using sample agents as fallback');
      }
    }
    
    // Ensure all agents have absolute image URLs
    agents = agents.map(agent => {
      // Log the original image URL for debugging
      console.log(`Processing agent ${agent.id} with original imageUrl:`, agent.imageUrl);
      
      // Process agent image URL to ensure it will work in emails
      let imageUrl = agent.imageUrl;
      
      // Handle case where imageUrl is an object with a url property
      if (imageUrl && typeof imageUrl === 'object' && imageUrl.url) {
        imageUrl = imageUrl.url;
      }
      
      // If we have an image URL, check if it's valid
      if (imageUrl && typeof imageUrl === 'string') {
        // Check for invalid or problematic URLs
        if (imageUrl.includes('blob:') || 
            imageUrl.includes('data:') || 
            imageUrl.includes('localhost') ||
            !imageUrl.startsWith('http')) {
          // Replace with a placeholder image
          console.log(`Replacing problematic URL for agent ${agent.id}`);
          imageUrl = `https://via.placeholder.com/300x200/3498db/ffffff?text=${encodeURIComponent(agent.name || 'AI Agent')}`;
        }
      } else {
        // If no valid imageUrl is provided, use a placeholder
        imageUrl = `https://via.placeholder.com/300x200/3498db/ffffff?text=${encodeURIComponent(agent.name || 'AI Agent')}`;
      }
      
      // Update the agent with the processed image URL
      agent.imageUrl = imageUrl;
      
      // Log the processed image URL
      console.log(`Processed imageUrl for agent ${agent.id}: ${agent.imageUrl}`);
      
      // Ensure creator is properly formatted
      agent.creator = agent.creator || {
        name: 'Admin',
        username: 'AIWaverider',
        role: 'Admin'
      };
      
      // Make sure creator is an object
      if (typeof agent.creator === 'string') {
        agent.creator = {
          name: agent.creator,
          username: agent.creator,
          role: 'Admin'
        };
      }
      
      return agent;
    });

    // Log the agents data that will be passed to the template
    console.log('Agent data for email template:', 
      agents.map(a => ({
        id: a.id,
        name: a.name,
        imageUrl: a.imageUrl,
        creator: a.creator
      }))
    );
    
    // Prepare the template data
    const templateData = {
      title: emailTitle || 'New AI Agents Available!',
      headerTitle: emailTitle || 'Check Out Our Latest AI Agents',
      name: recipientName || 'AI Enthusiast',
      content: emailContent || 'We have some exciting new AI agents for you to try out.',
      latestAgents: agents,
      websiteUrl: config.websiteUrl,
      supportEmail: config.supportEmail,
      currentYear: new Date().getFullYear()
    };
    
    console.log(`Sending email to ${email} with template data:`, JSON.stringify(templateData, null, 2));
    
    // Get and compile the template
    const template = await getCompiledTemplate('new_agents');
    
    // Render the HTML with the template data
    const html = template(templateData);
    
    // Ensure the recipient is a valid email and properly formatted
    const recipient = email.trim();
    if (!recipient || !recipient.includes('@')) {
      throw new Error(`Invalid recipient email: ${email}`);
    }
    
    // Send the email with the rendered HTML
    return await sendEmail({
      to: recipient,
      subject: emailTitle || 'New AI Agents Available!',
      html: html,
      from: `"${config.fromName}" <${config.fromEmail}>`,
      headers: {
        'X-Entity-Ref-ID': uuidv4(),
        'List-Unsubscribe': `<${config.websiteUrl}/unsubscribe?email=${encodeURIComponent(recipient)}>`,
        'Precedence': 'Bulk'
      }
    });
  } catch (error) {
    console.error(`Error sending agent update email:`, error);
    throw error;
  }
};

/**
 * Generate sample agents for email testing
 * @returns {Array} Array of sample agents
 */
const getSampleAgentsForEmail = () => {
  return [
    {
      id: 'agent1',
      name: 'AI Assistant Pro',
      url: `${config.websiteUrl}/agents/agent1`,
      imageUrl: 'https://via.placeholder.com/300x200/3498db/ffffff?text=AI+Assistant',
      creator: {
        name: 'John Smith',
        username: 'johnsmith',
        role: 'Developer'
      },
      rating: {
        average: 4.8,
        count: 120
      },
      price: 2999,
      priceDetails: {
        originalPrice: 4999,
        discountPercentage: 40
      }
    },
    {
      id: 'sample-001',
      name: 'AI Personal Tutor',
      url: `${config.websiteUrl}/agents/ai-personal-tutor`,
      imageUrl: `${config.websiteUrl}/images/agents/tutor.png`,
      creator: {
        name: 'AI Waverider Team',
        username: 'AIWaverider',
        role: 'Admin'
      },
      rating: { average: 4, count: 128 },
      price: 49.99,
      priceDetails: {
        originalPrice: 69.99,
        discountPercentage: 28
      }
    },
    {
      id: 'sample-002',
      name: 'Social Media Manager',
      url: `${config.websiteUrl}/agents/social-media-manager`,
      imageUrl: `${config.websiteUrl}/images/agents/social.png`,
      creator: {
        name: 'Colorland Studio',
        username: 'Colorland',
        role: 'Partner'
      },
      rating: { average: 5, count: 87 },
      price: 39.99
    },
    {
      id: 'sample-003',
      name: 'AI Writing Assistant',
      url: `${config.websiteUrl}/agents/writing-assistant`,
      imageUrl: `${config.websiteUrl}/images/agents/writing.png`,
      creator: {
        name: 'Berlin Media Group',
        username: 'BerlinMedia',
        role: 'Partner'
      },
      rating: { average: 4, count: 215 },
      price: 29.99,
      priceDetails: {
        originalPrice: 49.99,
        discountPercentage: 40
      }
    },
    {
      id: 'sample-004',
      name: 'Financial Advisor',
      url: `${config.websiteUrl}/agents/financial-advisor`,
      imageUrl: `${config.websiteUrl}/images/agents/finance.png`,
      creator: {
        name: 'Flawless Financial Services',
        username: 'FlawlessFinance',
        role: 'Partner'
      },
      rating: { average: 4, count: 76 },
      price: 59.99
    },
    {
      id: 'sample-005',
      name: 'Fitness Coach',
      url: `${config.websiteUrl}/agents/fitness-coach`,
      imageUrl: `${config.websiteUrl}/images/agents/fitness.png`,
      creator: {
        name: 'Monique Martin Wellness',
        username: 'MoniqueMartin',
        role: 'Partner'
      },
      rating: { average: 5, count: 93 },
      price: 34.99
    }
  ];
};

/**
 * Validate email format
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Test email configuration (enhanced for UniPay system)
 * @returns {Promise<Object>} - Test result
 */
exports.testEmailConfiguration = async () => {
  try {
    const transporter = createTransport();
    const testResult = await transporter.verify();
    
    logger.info('Email configuration test successful');
    return { success: true, configured: testResult };
  } catch (error) {
    logger.error('Email configuration test failed:', error);
    return { success: false, error: error.message };
  }
};

// Export the sendAgentUpdateEmail function
exports.sendAgentUpdateEmail = sendAgentUpdateEmail;