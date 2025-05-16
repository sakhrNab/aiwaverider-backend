// Manually mock Firebase - we need to do this before requiring the controller
const mockFirebase = require('./mockFirebase');

// Override the require cache to inject our mock
require.cache[require.resolve('../config/firebase')] = {
  exports: mockFirebase
};

// Import the controller we want to test
const agentsController = require('../controllers/agent/agentsController');

/**
 * Simple test script to verify the agentsController functions
 */
async function runTests() {
  console.log('=== STARTING AGENT CONTROLLER TESTS ===');
  
  // Setup mock request and response objects
  const mockReq = (params = {}, query = {}, user = null) => ({
    params,
    query,
    user,
    app: {
      get: () => null // Mock for Redis client
    }
  });
  
  const responses = [];
  const mockRes = () => {
    const res = {
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      json: (data) => {
        res.body = data;
        responses.push({ statusCode: res.statusCode, body: data });
        return res;
      }
    };
    return res;
  };

  try {
    // Test 1: Get agents (simplified)
    console.log('\n--- Test 1: getAgents ---');
    await agentsController.getAgents(mockReq(), mockRes());
    const agentsResponse = responses[responses.length - 1];
    console.log(`Status: ${agentsResponse.statusCode}`);
    console.log(`Total agents: ${agentsResponse.body.total || 0}`);
    console.log(`Success: ${agentsResponse.statusCode === 200 ? 'Yes' : 'No'}`);
    
    // Test 2: Get agent by ID (using a known or first agent ID)
    console.log('\n--- Test 2: getAgentById ---');
    let agentId = 'agent-1'; // Assuming this exists from seed data
    if (agentsResponse.body.agents && agentsResponse.body.agents.length > 0) {
      agentId = agentsResponse.body.agents[0].id;
    }
    console.log(`Testing with agent ID: ${agentId}`);
    await agentsController.getAgentById(mockReq({ id: agentId }), mockRes());
    const agentResponse = responses[responses.length - 1];
    console.log(`Status: ${agentResponse.statusCode}`);
    console.log(`Agent found: ${agentResponse.statusCode === 200 ? 'Yes' : 'No'}`);
    if (agentResponse.statusCode === 200) {
      console.log(`Agent name: ${agentResponse.body.data?.name || 'N/A'}`);
    }
    
    // Test 3: Test download count methods - Fixed by using the proper parameter name
    console.log('\n--- Test 3: getDownloadCount ---');
    // The parameter should be 'agentId', not just 'id'
    await agentsController.getDownloadCount(mockReq({ agentId }), mockRes());
    const downloadResponse = responses[responses.length - 1];
    console.log(`Status: ${downloadResponse.statusCode}`);
    console.log(`Success: ${downloadResponse.statusCode === 200 ? 'Yes' : 'No'}`);
    console.log(`Download count: ${downloadResponse.body?.downloads || 'N/A'}`);

    console.log('\n=== TEST SUMMARY ===');
    console.log(`Total tests: 3`);
    console.log(`Successful tests: ${responses.filter(r => r.statusCode === 200).length}`);
    console.log(`Failed tests: ${responses.filter(r => r.statusCode !== 200).length}`);
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Run the tests
runTests().then(() => {
  console.log('Tests completed');
  // In a real test environment, we would use process.exit(0) here,
  // but for manual testing, we'll let the script finish naturally
}); 