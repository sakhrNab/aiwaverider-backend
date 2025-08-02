/**
 * API Tester with Automatic Token Generation
 * 
 * This script allows you to make API calls with automatically generated tokens
 * for testing your endpoints.
 */

const axios = require('axios');
const { generateTokenSilently } = require('./generate-admin-token');

// Configuration
const BASE_URL = 'http://localhost:4000/api';
const API_ENDPOINTS = {
  // Public endpoints (no auth needed)
  getAgents: { method: 'GET', url: '/agents', auth: false },
  getAgentById: { method: 'GET', url: '/agents/agent123', auth: false },
  getFeaturedAgents: { method: 'GET', url: '/agents/featured', auth: false },
  
  // User endpoints (user auth needed)
  addDownload: { method: 'POST', url: '/agents/agent123/downloads', auth: 'user' },
  addReview: { method: 'POST', url: '/agents/agent123/reviews', auth: 'user' },
  deleteReview: { method: 'DELETE', url: '/agents/agent123/reviews/review123', auth: 'user' },
  toggleWishlist: { method: 'POST', url: '/agents/agent123/wishlist', auth: 'user' },
  
  // Admin endpoints (admin auth needed)
  createAgent: { method: 'POST', url: '/agents', auth: 'admin' },
  updateAgent: { method: 'PUT', url: '/agents/agent123', auth: 'admin' },
  deleteAgent: { method: 'DELETE', url: '/agents/agent123', auth: 'admin' },
  clearCache: { method: 'POST', url: '/admin/clear-cache', auth: 'admin' }
};

/**
 * Make an API call with automatic token generation
 */
async function makeApiCall(endpointName, data = null, customHeaders = {}) {
  try {
    const endpoint = API_ENDPOINTS[endpointName];
    if (!endpoint) {
      throw new Error(`Unknown endpoint: ${endpointName}`);
    }

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      ...customHeaders
    };

    // Generate token if auth is required
    if (endpoint.auth) {
      console.log(`🔐 Generating ${endpoint.auth} token for ${endpointName}...`);
      const token = await generateTokenSilently(endpoint.auth);
      headers.Authorization = `Bearer ${token}`;
      console.log(`✅ Token generated and added to request`);
    }

    // Prepare request config
    const config = {
      method: endpoint.method,
      url: `${BASE_URL}${endpoint.url}`,
      headers,
      ...(data && { data })
    };

    console.log(`🚀 Making ${endpoint.method} request to: ${config.url}`);
    if (endpoint.auth) {
      console.log(`🔑 Using ${endpoint.auth} authentication`);
    }

    // Make the request
    const response = await axios(config);
    
    console.log(`✅ Success! Status: ${response.status}`);
    console.log(`📊 Response data:`, JSON.stringify(response.data, null, 2));
    
    return response;
  } catch (error) {
    console.error(`❌ API call failed for ${endpointName}:`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

/**
 * Test multiple endpoints
 */
async function runTests() {
  console.log('🧪 Starting API tests with automatic token generation...\n');

  const tests = [
    // Public endpoints
    { name: 'getAgents', data: null },
    { name: 'getFeaturedAgents', data: null },
    
    // User endpoints
    { name: 'addDownload', data: { userId: 'test-user' } },
    { name: 'addReview', data: { rating: 5, comment: 'Great agent!' } },
    
    // Admin endpoints
    { name: 'createAgent', data: { 
      name: 'Test Agent', 
      description: 'Test description',
      category: 'Technology',
      price: 25
    }},
    { name: 'clearCache', data: null }
  ];

  for (const test of tests) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🧪 Testing: ${test.name}`);
    console.log(`${'='.repeat(50)}`);
    
    try {
      await makeApiCall(test.name, test.data);
      console.log(`✅ Test passed: ${test.name}`);
    } catch (error) {
      console.log(`❌ Test failed: ${test.name}`);
    }
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n🎉 All tests completed!`);
}

/**
 * Test a specific endpoint
 */
async function testSpecificEndpoint(endpointName, data = null) {
  console.log(`🧪 Testing specific endpoint: ${endpointName}`);
  try {
    await makeApiCall(endpointName, data);
    console.log(`✅ Test successful!`);
  } catch (error) {
    console.log(`❌ Test failed!`);
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run all tests
    runTests();
  } else if (args.length === 1) {
    // Test specific endpoint
    testSpecificEndpoint(args[0]);
  } else if (args.length === 2) {
    // Test specific endpoint with data
    const data = JSON.parse(args[1]);
    testSpecificEndpoint(args[0], data);
  } else {
    console.log('Usage:');
    console.log('  node api-tester.js                    # Run all tests');
    console.log('  node api-tester.js getAgents          # Test specific endpoint');
    console.log('  node api-tester.js createAgent \'{"name":"test"}\'  # Test with data');
  }
}

module.exports = {
  makeApiCall,
  runTests,
  testSpecificEndpoint,
  API_ENDPOINTS
}; 