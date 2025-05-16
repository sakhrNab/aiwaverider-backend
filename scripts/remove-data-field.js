/**
 * Script to remove the redundant 'data' field from agent documents
 * Now that we've moved all data to top-level fields, this field is no longer needed
 */

// Import Firebase setup from config 
const { db, admin, initializeFirebase } = require('../config/firebase');

/**
 * Main function to remove data field from agent documents
 */
async function removeDataField() {
  try {
    console.log('Starting data field removal...');
    
    // Make sure Firebase is initialized
    initializeFirebase();
    
    // Get all agents
    const agentsSnapshot = await db.collection('agents').get();
    
    if (agentsSnapshot.empty) {
      console.log('No agents found to update');
      return {
        success: true,
        updated: 0,
        message: 'No agents found to update'
      };
    }
    
    console.log(`Found ${agentsSnapshot.size} agents to process`);
    let successCount = 0;
    let errorCount = 0;
    
    // Process each agent in batches
    const batchSize = 500; // Firestore batch limit is 500
    let currentBatch = 0;
    let batches = [db.batch()];
    let batchIndex = 0;
    
    // Process each agent
    for (const doc of agentsSnapshot.docs) {
      try {
        const agentId = doc.id;
        const agent = doc.data();
        console.log(`Processing agent: ${agentId} - ${agent.name || 'Unnamed'}`);
        
        // Check if agent has data field
        if (!agent.data) {
          console.log(`Agent ${agentId} does not have data field, skipping`);
          continue;
        }
        
        // Add to the current batch
        if (currentBatch >= batchSize) {
          // Create a new batch if the current one is full
          batchIndex++;
          batches.push(db.batch());
          currentBatch = 0;
        }
        
        // Remove the data field
        batches[batchIndex].update(doc.ref, { 
          data: admin.firestore.FieldValue.delete() 
        });
        
        currentBatch++;
        successCount++;
      } catch (error) {
        console.error(`❌ Error removing data field for agent ${doc.id}:`, error);
        errorCount++;
      }
    }
    
    // Commit all batches
    if (successCount > 0) {
      console.log(`Committing ${batches.length} batches with ${successCount} updates...`);
      
      for (let i = 0; i <= batchIndex; i++) {
        if (currentBatch > 0) {
          console.log(`Committing batch ${i + 1} of ${batchIndex + 1}...`);
          await batches[i].commit();
          console.log(`Batch ${i + 1} committed successfully`);
        }
      }
    }
    
    console.log('Data field removal completed:');
    console.log(`- Successfully updated: ${successCount} agents`);
    console.log(`- Failed updates: ${errorCount} agents`);
    
    return {
      success: true,
      updated: successCount,
      failed: errorCount
    };
  } catch (error) {
    console.error('Error in data field removal script:', error);
    return {
      success: false,
      error: error.message
    }
  }
}

// Run the update if this file is executed directly
if (require.main === module) {
  removeDataField().then((result) => {
    console.log('Data field removal completed with result:', result);
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Data field removal script failed:', error);
    process.exit(1);
  });
} else {
  // Export for use in other files
  module.exports = { removeDataField };
} 