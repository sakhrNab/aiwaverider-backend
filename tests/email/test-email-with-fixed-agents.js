/**
 * Test Agent Email Update with Real Database Agents
 * 
 * This test script will send an agent update email using real agents from the database.
 */

// Load environment variables
require('dotenv').config();

const emailService = require('../../services/emailService');
const { db, initializeFirebase } = require('../../config/firebase');

// Test email recipient
const TEST_EMAIL = process.env.TEST_EMAIL || 'ai.waverider1@gmail.com';

// Function to test sending an agent update email
async function testEmailWithDatabaseAgents() {
  try {
    // Initialize Firebase
    initializeFirebase();
    console.log('Firebase initialized successfully');
    
    console.log(`Sending test agent update email to ${TEST_EMAIL}...`);
    console.log('Using email configuration:');
    const config = require('../../config/email');
    
    // Get the agents we just fixed
    const agentIds = [
      '0tsy4TTdwlpGMlFPw3Mh', // ZackiApointments5
      'F7lYANMO5iuo6ehTWpxd', // ZackiApointments71
      'R6YfEI6jZQRFzKbzDDfW'  // ZackiApointments7
    ];
    
    console.log('Fetching agents from database...');
    const agents = [];
    
    for (const agentId of agentIds) {
      const agentDoc = await db.collection('agents').doc(agentId).get();
      if (agentDoc.exists) {
        const agent = agentDoc.data();
        agent.id = agentId; // Add the ID explicitly
        agents.push(agent);
        console.log(`Added agent: ${agent.name}`);
      }
    }
    
    if (agents.length === 0) {
      throw new Error('No agents found in the database');
    }
    
    console.log(`Sending email with ${agents.length} agents from the database`);
    console.log(`Sample agent data: ${JSON.stringify(agents[0].name)}`);
    console.log(`Sample agent image: ${JSON.stringify(agents[0].imageUrl)}`);
    
    // Call the sendAgentUpdateEmail function with the database agents
    const result = await emailService.sendAgentUpdateEmail({
      email: TEST_EMAIL,
      name: 'Test User (Database Agents)',
      title: 'Test: Fixed Agent Images in Email',
      content: '<p>This email shows the updated agent images.</p>' +
        '<p>Check that the images are now correctly displaying in the email!</p>',
      latestAgents: agents
    });
    
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
console.log('Starting agent update email test with database agents...');
testEmailWithDatabaseAgents()
  .then(() => {
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  }); 