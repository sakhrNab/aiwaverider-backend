/**
 * Script to update the price details structure in agents
 * This will add the priceDetails object to all agents that don't have it
 */

// Import Firebase setup from config 
const { db, admin, initializeFirebase } = require('../config/firebase');

/**
 * Main function to update price structure in agents
 */
async function updatePriceStructure() {
  try {
    console.log('Starting price structure update...');
    
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
        
        // Check if we need to update price structure
        const needsPriceUpdate = !agent.priceDetails || 
                                Object.keys(agent.priceDetails).length === 0 ||
                                agent.priceDetails.basePrice === undefined;
                                
        if (!needsPriceUpdate) {
          console.log(`Agent ${agentId} already has proper price structure, skipping`);
          continue;
        }
        
        // Create the price details structure
        const basePrice = 
          agent.basePrice !== undefined ? parseFloat(agent.basePrice) : 
          agent.price !== undefined ? parseFloat(agent.price) : 0;
          
        const discountedPrice = 
          agent.discountedPrice !== undefined ? parseFloat(agent.discountedPrice) : 
          agent.finalPrice !== undefined ? parseFloat(agent.finalPrice) : basePrice;
          
        const currency = agent.currency || 'USD';
        
        const isFree = 
          agent.isFree !== undefined ? Boolean(agent.isFree) : 
          basePrice === 0;
          
        const isSubscription = 
          agent.isSubscription !== undefined ? Boolean(agent.isSubscription) : 
          typeof agent.price === 'string' && 
          (agent.price.includes('/month') || agent.price.includes('a month'));
          
        const discountPercentage = 
          basePrice > 0 ? Math.round(((basePrice - discountedPrice) / basePrice) * 100) : 0;
        
        // Create the updated price structure
        const priceDetails = {
          basePrice,
          discountedPrice,
          currency,
          isFree,
          isSubscription,
          discountPercentage
        };
        
        // Add to the current batch
        if (currentBatch >= batchSize) {
          // Create a new batch if the current one is full
          batchIndex++;
          batches.push(db.batch());
          currentBatch = 0;
        }
        
        // Update only the priceDetails field
        batches[batchIndex].update(doc.ref, { priceDetails });
        
        currentBatch++;
        successCount++;
      } catch (error) {
        console.error(`❌ Error updating price structure for agent ${doc.id}:`, error);
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
    
    console.log('Price structure update completed:');
    console.log(`- Successfully updated: ${successCount} agents`);
    console.log(`- Failed updates: ${errorCount} agents`);
    
    return {
      success: true,
      updated: successCount,
      failed: errorCount
    };
  } catch (error) {
    console.error('Error in price structure update script:', error);
    return {
      success: false,
      error: error.message
    }
  }
}

// Run the update if this file is executed directly
if (require.main === module) {
  updatePriceStructure().then((result) => {
    console.log('Price structure update completed with result:', result);
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Price structure update script failed:', error);
    process.exit(1);
  });
} else {
  // Export for use in other files
  module.exports = { updatePriceStructure };
} 