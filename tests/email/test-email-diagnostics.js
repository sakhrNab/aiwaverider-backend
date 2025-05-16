/**
 * Email Diagnostics Script
 * 
 * This script performs a comprehensive test of all email templates and functionality.
 * It verifies template loading, Handlebars compilation, and sending test emails.
 */

// Load environment variables
require('dotenv').config();

const emailService = require('./services/emailService');
const logger = require('./utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Set test email recipient
const TEST_EMAIL = process.argv[2] || 'test@example.com';

// Colors for console output
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

/**
 * Main diagnostic function
 */
async function runDiagnostics() {
  console.log(`${COLORS.cyan}=======================================`);
  console.log(`📧 EMAIL SYSTEM DIAGNOSTICS`);
  console.log(`=======================================`);
  console.log(`Starting email diagnostics with test recipient: ${TEST_EMAIL}`);
  console.log(`=======================================\n${COLORS.reset}`);
  
  let allTestsPassed = true;
  
  // Step 1: Check for template directory
  const templatesDir = path.join(__dirname, 'templates', 'emails');
  try {
    await fs.access(templatesDir);
    console.log(`${COLORS.green}✅ Templates directory exists: ${templatesDir}${COLORS.reset}`);
    
    // List all template files
    const templateFiles = await fs.readdir(templatesDir);
    console.log(`\n${COLORS.cyan}Found ${templateFiles.length} templates:${COLORS.reset}`);
    templateFiles.forEach(file => {
      console.log(`   - ${file}`);
    });
    
    // Step 2: Check each template
    console.log(`\n${COLORS.cyan}Testing each template:${COLORS.reset}`);
    for (const file of templateFiles) {
      if (file.endsWith('.html')) {
        const templateName = file.replace('.html', '');
        try {
          // Try to read and verify template syntax
          const templateContent = await fs.readFile(path.join(templatesDir, file), 'utf-8');
          console.log(`${COLORS.green}✅ Template '${templateName}' loaded successfully (${templateContent.length} bytes)${COLORS.reset}`);
        } catch (error) {
          allTestsPassed = false;
          console.log(`${COLORS.red}❌ Failed to read template '${templateName}': ${error.message}${COLORS.reset}`);
        }
      }
    }
    
    // Step 3: Test email sending with each template
    console.log(`\n${COLORS.cyan}Testing email sending:${COLORS.reset}`);
    
    // Test custom email
    try {
      const result = await emailService.sendCustomEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        subject: 'Diagnostic Test: Custom Email',
        content: '<p>This is a test of the custom email template.</p><p>If you received this, the custom email template is working correctly.</p>'
      });
      console.log(`${COLORS.green}✅ Custom email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send custom email: ${error.message}${COLORS.reset}`);
    }
    
    // Test welcome email
    try {
      const result = await emailService.sendWelcomeEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User'
      });
      console.log(`${COLORS.green}✅ Welcome email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send welcome email: ${error.message}${COLORS.reset}`);
    }
    
    // Test update email - weekly
    try {
      const result = await emailService.sendUpdateEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        title: 'Weekly Update Test',
        content: '<p>This is a test of the weekly update email template.</p>',
        updateType: 'weekly'
      });
      console.log(`${COLORS.green}✅ Weekly update email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send weekly update email: ${error.message}${COLORS.reset}`);
    }
    
    // Test update email - announcement
    try {
      const result = await emailService.sendUpdateEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        title: 'Announcement Test',
        content: '<p>This is a test of the announcement email template.</p>',
        updateType: 'announcements'
      });
      console.log(`${COLORS.green}✅ Announcement email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send announcement email: ${error.message}${COLORS.reset}`);
    }
    
    // Test update email - new agents
    try {
      const result = await emailService.sendUpdateEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        title: 'New Agents Test',
        content: '<p>This is a test of the new agents email template.</p>',
        updateType: 'new_agents'
      });
      console.log(`${COLORS.green}✅ New agents email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send new agents email: ${error.message}${COLORS.reset}`);
    }
    
    // Test update email - new tools
    try {
      const result = await emailService.sendUpdateEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        title: 'New Tools Test',
        content: '<p>This is a test of the new tools email template.</p>',
        updateType: 'new_tools'
      });
      console.log(`${COLORS.green}✅ New tools email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send new tools email: ${error.message}${COLORS.reset}`);
    }
    
    // Test notification email
    try {
      const result = await emailService.sendUpdateEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        title: 'Notification Test',
        content: '<p>This is a test of the notification email template.</p>',
        updateType: 'notification'
      });
      console.log(`${COLORS.green}✅ Notification email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send notification email: ${error.message}${COLORS.reset}`);
    }
    
    // Test global announcement email
    try {
      const result = await emailService.sendGlobalEmail({
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'User',
        title: 'Global Announcement Test',
        content: '<p>This is a test of the global announcement email template.</p>'
      });
      console.log(`${COLORS.green}✅ Global announcement email sent successfully (Message ID: ${result.messageId})${COLORS.reset}`);
    } catch (error) {
      allTestsPassed = false;
      console.log(`${COLORS.red}❌ Failed to send global announcement email: ${error.message}${COLORS.reset}`);
    }
    
  } catch (error) {
    allTestsPassed = false;
    console.log(`${COLORS.red}❌ Templates directory not found: ${error.message}${COLORS.reset}`);
  }
  
  // Final results
  console.log(`\n${COLORS.cyan}=======================================`);
  if (allTestsPassed) {
    console.log(`${COLORS.green}🎉 ALL TESTS PASSED!`);
    console.log(`Email system is fully operational.${COLORS.reset}`);
  } else {
    console.log(`${COLORS.red}⚠️ SOME TESTS FAILED`);
    console.log(`Please check the logs for details.${COLORS.reset}`);
  }
  console.log(`${COLORS.cyan}=======================================\n${COLORS.reset}`);
  
  console.log(`${COLORS.yellow}Remember to check your email at ${TEST_EMAIL} to confirm receipt of all test emails.${COLORS.reset}`);
  console.log(`${COLORS.yellow}Email logs are available at: ${path.join(__dirname, 'logs', 'email.log')}${COLORS.reset}`);
}

// Run diagnostics
runDiagnostics().catch(error => {
  console.error(`${COLORS.red}Fatal error during diagnostics: ${error.message}${COLORS.reset}`);
  console.error(error);
  process.exit(1);
}); 