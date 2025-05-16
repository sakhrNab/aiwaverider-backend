/**
 * Test Email Delivery Functionality
 * 
 * This script tests the email delivery functionality by simulating a payment success
 * and triggering the email delivery process.
 * 
 * Usage:
 * node test-email-delivery.js
 */

require('dotenv').config();
const orderController = require('./controllers/payment/orderController');
const logger = require('./utils/logger');
const notificationService = require('./services/updates/notificationService');

// Initialize Firebase Admin if needed
let admin;
try {
  admin = require('firebase-admin');
  const serviceAccount = require('./config/serviceAccountKey.json');
  
  // Check if Firebase is already initialized
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin initialized for testing');
  }
} catch (error) {
  console.warn('Firebase Admin initialization skipped:', error.message);
}

// Test data
const testData = {
  id: 'pi_' + Math.random().toString(36).substring(2, 15),
  amount: 2990, // $29.90 in cents
  currency: 'usd',
  payment_method_types: ['card'],
  metadata: {
    order_id: 'order_' + Math.random().toString(36).substring(2, 10),
    email: process.env.TEST_EMAIL || 'test@example.com',
    userId: 'test_user_' + Math.random().toString(36).substring(2, 8)
  },
  customer: {
    id: 'cus_' + Math.random().toString(36).substring(2, 15),
    email: process.env.TEST_EMAIL || 'test@example.com'
  },
  items: [
    {
      id: 'agent_1',
      name: 'Test AI Agent',
      title: 'Test AI Agent',
      price: 29.90,
      quantity: 1,
      description: 'An AI agent for testing email delivery'
    }
  ]
};

/**
 * Run the test
 */
async function runTest() {
  console.log('=== Testing Email Delivery After Payment ===');
  console.log('Test data:', JSON.stringify(testData, null, 2));
  
  try {
    console.log('Processing mock payment success...');
    const result = await orderController.processPaymentSuccess(testData);
    
    console.log('\nProcessing result:');
    console.log('Success:', result.success);
    console.log('Order ID:', result.orderId);
    console.log('Delivery Status:', result.deliveryStatus);
    
    if (result.deliveryResults) {
      console.log('\nDelivery Results:');
      result.deliveryResults.forEach((delivery, index) => {
        console.log(`Item ${index + 1}:`);
        console.log('  Agent ID:', delivery.agentId);
        console.log('  Success:', delivery.success);
        if (delivery.success) {
          console.log('  Message ID:', delivery.messageId);
        } else {
          console.log('  Error:', delivery.error);
        }
      });
    }
    
    // Test notification service separately
    console.log('\n=== Testing Notification Service ===');
    console.log('Sending order success notification...');
    
    const notificationResult = await notificationService.sendOrderSuccessNotification({
      orderId: result.orderId,
      email: testData.customer.email,
      userId: testData.metadata.userId,
      items: testData.items,
      orderTotal: testData.amount / 100,
      agent: testData.items[0]
    });
    
    console.log('\nNotification Result:');
    console.log('Success:', notificationResult.success);
    console.log('Email Sent:', notificationResult.emailSent);
    console.log('In-App Sent:', notificationResult.inAppSent);
    
    if (notificationResult.errors.length > 0) {
      console.log('Errors:', notificationResult.errors);
    }
    
    console.log('\nTest completed successfully.');
    console.log(`If everything worked, the following should have happened:`);
    console.log(`1. An agent template email should have been sent to: ${testData.customer.email}`);
    console.log(`2. An order confirmation notification should have been sent to: ${testData.customer.email}`);
    console.log(`3. If user exists, an in-app notification should have been added to their notifications collection`);
    console.log('For Ethereal (test) emails, check the console output above for preview URL.');
    console.log('For real emails, check the inbox.');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest().catch(console.error); 