/**
 * Email Service Test
 * Tests all email service functions with Gmail SMTP
 */

require('dotenv').config();
const emailService = require('./services/emailService');
const logger = require('./utils/logger');

// Set your test email here (will be overridden by command line arg if provided)
const TEST_EMAIL = process.argv[2] || 'aiwaverider8@gmail.com';

// Simple delay function 
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Run all tests
async function runTests() {
  try {
    console.log('\n📧 EMAIL SERVICE TEST');
    console.log('====================');
    console.log(`Email Service Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`SMTP Server: ${process.env.EMAIL_HOST || 'default'}`);
    console.log(`Sending test emails to: ${TEST_EMAIL}`);
    
    // Test 1: Basic test email
    console.log('\n📤 TEST 1: Sending basic test email...');
    const testResult = await emailService.sendTestEmail(TEST_EMAIL);
    console.log('✅ Test email sent successfully!');
    console.log(`Message ID: ${testResult.messageId}`);
    
    await delay(2000); // Short delay between emails
    
    // Test 2: Welcome email
    console.log('\n📤 TEST 2: Sending welcome email...');
    const welcomeResult = await emailService.sendWelcomeEmail({
      email: TEST_EMAIL,
      firstName: 'Test',
      lastName: 'User',
      userId: 'test-user-id'
    });
    console.log('✅ Welcome email sent successfully!');
    console.log(`Message ID: ${welcomeResult.messageId}`);
    
    await delay(2000);
    
    // Test 3: Update email
    console.log('\n📤 TEST 3: Sending update notification email...');
    const updateResult = await emailService.sendUpdateEmail({
      email: TEST_EMAIL,
      firstName: 'Test',
      lastName: 'User',
      title: 'Weekly Update Test',
      content: 'This is a test of the weekly update email system.',
      updateType: 'weekly'
    });
    console.log('✅ Update email sent successfully!');
    console.log(`Message ID: ${updateResult.messageId}`);
    
    await delay(2000);
    
    // Test 4: Global announcement
    console.log('\n📤 TEST 4: Sending global announcement email...');
    const announcementResult = await emailService.sendGlobalEmail({
      email: TEST_EMAIL,
      firstName: 'Test',
      lastName: 'User',
      title: 'Important Announcement Test',
      content: 'This is a test of the global announcement email system.'
    });
    console.log('✅ Global announcement email sent successfully!');
    console.log(`Message ID: ${announcementResult.messageId}`);
    
    await delay(2000);
    
    // Test 5: Agent purchase confirmation
    console.log('\n📤 TEST 5: Sending purchase confirmation email...');
    const purchaseResult = await emailService.sendAgentPurchaseEmail({
      email: TEST_EMAIL,
      firstName: 'Test',
      lastName: 'User',
      agentName: 'Super AI Assistant',
      agentDescription: 'An advanced AI assistant that helps with productivity tasks',
      price: 29.99,
      currency: 'USD',
      receiptUrl: 'https://example.com/receipt/123456'
    });
    console.log('✅ Purchase confirmation email sent successfully!');
    console.log(`Message ID: ${purchaseResult.messageId}`);
    
    console.log('\n🎉 ALL TESTS PASSED! Your email service is working properly with Gmail SMTP.');
    console.log('Check your inbox for the test emails.');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    console.error('\nTroubleshooting tips:');
    console.error('1. Check your .env file for correct SMTP settings');
    console.error('2. For Gmail: Enable "Less secure app access" or use App Password');
    console.error('3. Check for SMTP connection errors in the error message');
    console.error('4. Verify NODE_ENV is set to "production" to use real SMTP');
    process.exit(1);
  }
}

// Run the tests
console.log('Starting email service tests...');
runTests(); 