/**
 * Test script for agent reviews endpoints
 * Run with: node backend/scripts/test-reviews.js
 */

const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:4000/api';
const AGENT_ID = 'UDCz3kZx5RCTwDXEj7U4'; // Use a valid agent ID from your database

async function testEndpoints() {
  console.log('===== TESTING AGENT REVIEWS API =====');
  
  try {
    // Test 1: Get agent details
    console.log('\n1. Testing GET agent details...');
    const agentResponse = await axios.get(`${API_URL}/agents/${AGENT_ID}`);
    console.log('Agent response status:', agentResponse.status);
    console.log('Agent data:', JSON.stringify(agentResponse.data, null, 2).substring(0, 200) + '...');
    
    // Test 2: Get agent reviews endpoint
    console.log('\n2. Testing GET reviews endpoint...');
    try {
      const reviewsResponse = await axios.get(`${API_URL}/agents/${AGENT_ID}/reviews`);
      console.log('Reviews response status:', reviewsResponse.status);
      console.log('Reviews data:', reviewsResponse.data);
    } catch (error) {
      console.error('Error getting reviews:');
      console.error('  Status:', error.response?.status);
      console.error('  Data:', error.response?.data);
      console.error('  Message:', error.message);
    }
    
    // Test 3: Test collection update endpoint
    console.log('\n3. Testing POST update collections endpoint...');
    try {
      const updateResponse = await axios.post(`${API_URL}/agents/update-collections`);
      console.log('Update collections response status:', updateResponse.status);
      console.log('Update collections data:', updateResponse.data);
    } catch (error) {
      console.error('Error updating collections:');
      console.error('  Status:', error.response?.status);
      console.error('  Data:', error.response?.data);
      console.error('  Message:', error.message);
    }
    
    console.log('\n===== TESTS COMPLETED =====');
  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testEndpoints(); 