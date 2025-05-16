/**
 * Test Agent Email Update
 * 
 * This test script will send an agent update email directly using the email service.
 */

// Load environment variables
require('dotenv').config();

const emailService = require('../../services/emailService');

// Test email recipient
const TEST_EMAIL = process.env.TEST_EMAIL || 'ai.waverider1@gmail.com';

// Function to test sending an agent update email
async function testAgentUpdateEmail() {
  try {
    console.log(`Sending test agent update email to ${TEST_EMAIL}...`);
    console.log('Using email configuration:');
    const config = require('../../config/email');
    console.log(JSON.stringify({
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      supportEmail: config.supportEmail,
      websiteUrl: config.websiteUrl
    }, null, 2));
    
    // First define a set of sample agents
    const sampleAgents = [
      {
        id: 'sample-001',
        name: 'AI Personal Tutor',
        url: 'https://aiwaverider.com/agents/ai-personal-tutor',
        imageUrl: 'https://aiwaverider.com/images/agents/tutor.png',
        creator: { name: 'AI Waverider' },
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
        url: 'https://aiwaverider.com/agents/social-media-manager',
        imageUrl: 'https://aiwaverider.com/images/agents/social.png',
        creator: { name: 'AI Waverider' },
        rating: { average: 5, count: 87 },
        price: 39.99
      }
    ];
    
    console.log(`Sending email with ${sampleAgents.length} agents`);
    console.log(`First agent data: ${JSON.stringify(sampleAgents[0], null, 2)}`);
    
    // Call the sendAgentUpdateEmail function with the correct parameter order
    const result = await emailService.sendAgentUpdateEmail(
      TEST_EMAIL,
      'Test User',
      'Test: New AI Agents Available',
      '<p>This is a test email to verify the agent update email functionality.</p>' +
      '<p>Check out our latest AI agents that can help you with various tasks!</p>',
      sampleAgents
    );
    
    console.log('Email sent successfully!');
    console.log('Message ID:', result.messageId);
    
    return result;
  } catch (error) {
    console.error('Error sending agent update email:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// Run the test
console.log('Starting agent update email test...');
testAgentUpdateEmail()
  .then(() => {
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  }); 