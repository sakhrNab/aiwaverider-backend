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

  // Try to load the singular agentController.js file
  console.log('\n2. Testing agentController.js (singular):');
  try {
    const agentController = require('../controllers/agent/agentController');
    console.log('  - Import successful');
    console.log('  - Available methods:');
    Object.keys(agentController).forEach(method => {
      console.log(`    - ${method}: ${typeof agentController[method] === 'function' ? 'Function' : 'Not a function'}`);
    });
  } catch (error) {
    console.log(`  - Import failed: ${error.message}`);
  }

  console.log('\n=== Comparison of Methods ===');
  
  // Load all controllers if possible
  let controllers = {};
  try { controllers.main = require('../controllers/agent/agentsController'); } catch (e) {}
  try { controllers.singular = require('../controllers/agent/agentController'); } catch (e) {}
  
  // Get all unique method names across controllers
  const allMethods = new Set();
  Object.values(controllers).forEach(controller => {
    if (controller) {
      Object.keys(controller).forEach(method => allMethods.add(method));
    }
  });
  
  // Print comparison table
  console.log('\nMethod Name           | agentsController | agentController | agentsController_fixed');
  console.log('---------------------|-----------------|----------------|---------------------');
  
  Array.from(allMethods).sort().forEach(method => {
    const main = controllers.main && typeof controllers.main[method] === 'function' ? 'Yes' : 'No ';
    const singular = controllers.singular && typeof controllers.singular[method] === 'function' ? 'Yes' : 'No ';
    const fixed = controllers.fixed && typeof controllers.fixed[method] === 'function' ? 'Yes' : 'No ';
    
    console.log(`${method.padEnd(21)}| ${main.padEnd(15)}| ${singular.padEnd(14)}| ${fixed.padEnd(21)}`);
  });
  
} catch (error) {
  console.error('Overall test error:', error);
} 