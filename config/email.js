/**
 * Email Configuration
 * 
 * Configuration for email delivery service
 */

require('dotenv').config();

module.exports = {
  // SMTP Server Configuration
  host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.zoho.com',
  port: parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '465', 10),
  secure: process.env.SMTP_SECURE === 'true' || process.env.EMAIL_SECURE === 'true' || true, // true for 465, false for other ports
  user: process.env.SMTP_USER || process.env.EMAIL_USER || 'support@aiwaverider.com',
  password: process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || 'password',
  
  // Sender Information
  fromEmail: process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'support@aiwaverider.com',
  fromName: process.env.FROM_NAME || process.env.EMAIL_FROM_NAME || 'AI Waverider',
  
  // Website Information (for links in emails)
  websiteUrl: process.env.WEBSITE_URL || 'https://aiwaverider.com',
  
  // Support Contact
  supportEmail: process.env.SUPPORT_EMAIL || 'support@aiwaverider.com',
  
  // Default email sending limits
  rateLimit: {
    maxEmails: parseInt(process.env.MAX_EMAILS_PER_BATCH || '100', 10), // Max emails to send in one batch
    batchInterval: parseInt(process.env.EMAIL_BATCH_INTERVAL || '3600000', 10), // Interval between batches in ms (default 1 hour)
    maxPerUser: parseInt(process.env.MAX_EMAILS_PER_USER || '5', 10) // Max emails to send to one user per day
  }
}; 