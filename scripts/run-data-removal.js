/**
 * Script to run the data field removal operation
 * This script imports and runs the removeDataField function
 */

const { removeDataField } = require('./remove-data-field');

// Introduction
console.log('='.repeat(80));
console.log('AI Waverider - Data Field Removal');
console.log('This script will remove the redundant data field from all agents in the database');
console.log('='.repeat(80));

// Run the update
removeDataField()
  .then(result => {
    console.log('\n='.repeat(80));
    console.log('Data field removal completed with result:', result);
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