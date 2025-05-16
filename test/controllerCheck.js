// Manually mock Firebase
// We need to do this before requiring any controllers
const mockFirebase = require('./mockFirebase');

// Override the require cache to inject our mock
require.cache[require.resolve('../config/firebase')] = {
  exports: mockFirebase
};

// Simple test script to check if the different agent controller files can be imported
console.log('=== Testing Agent Controller Imports ===');

try {
  // Try to load the main agentsController.js file
  console.log('\n1. Testing agentsController.js (plural):');
  const agentsController = require('../controllers/agent/agentsController');
  console.log('  - Import successful');
  console.log('  - Available methods:');
  Object.keys(agentsController).forEach(method => {
    console.log(`    - ${method}: ${typeof agentsController[method] === 'function' ? 'Function' : 'Not a function'}`);
  });

  // Test a method
  console.log('\n  - Testing getAgents function:');
  const mockReq = { query: {}, params: {}, user: { uid: 'test-user' } };
  const mockRes = {
    status: (code) => {
      console.log(`    Status code: ${code}`);
      return mockRes;
    },
    json: (data) => {
      console.log(`    Response received with ${data.agents ? data.agents.length : 0} agents`);
      return mockRes;
    }
  };
  
  agentsController.getAgents(mockReq, mockRes);

  // Try to load the singular agentController.js file if it exists
  console.log('\n2. Testing agentController.js (singular):');
  try {
    const agentController = require('../controllers/agent/agentControllerler');
    console.log('  - Import successful');
    console.log('  - Available methods:');
    Object.keys(agentController).forEach(method => {
      console.log(`    - ${method}: ${typeof agentController[method] === 'function' ? 'Function' : 'Not a function'}`);
    });
  } catch (error) {
    console.log(`  - Import failed: ${error.message}`);
  }

  console.log('\n=== Controller Summary ===');
  console.log('Based on our analysis:');
  console.log('1. agentsController.js (plural) - Main controller with all functionality');
  console.log('2. agentController.js (singular) - Specialized controller for download-related operations');
  console.log('3. agentsController_fixed.js - Likely a refactored/fixed version that\'s not currently in use');
  
} catch (error) {
  console.error('Overall test error:', error);
} 