/**
 * Script to run the agent structure update
 * This script imports and runs the updateAgentStructure function
 */

const { updateAgentStructure } = require('./update-agent-structure');

// Introduction
console.log('='.repeat(80));
console.log('AI Waverider - Agent Structure Update');
console.log('This script will update all agents in the database to the new structure');
console.log('='.repeat(80));

// Run the update
updateAgentStructure()
  .then(result => {
    console.log('\n='.repeat(80));
    console.log('Update completed with result:', result);
    console.log('='.repeat(80));
    
    if (result.success) {
      console.log(`✅ Successfully updated ${result.updated} agents`);
      if (result.failed > 0) {
        console.log(`⚠️ Failed to update ${result.failed} agents (see logs above for details)`);
      }
      process.exit(0);
    } else {
      console.error(`❌ Update failed: ${result.error}`);
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Unexpected error during update:', error);
    process.exit(1);
  }); 