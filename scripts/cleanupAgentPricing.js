const admin = require('firebase-admin');
const { db } = require('../config/firebase');

/**
 * Cleanup agent pricing data in Firestore
 * 
 * This script:
 * 1. Finds all documents in the agents collection
 * 2. Moves price data into the priceDetails object
 * 3. Removes duplicated price fields from the root level
 */
async function cleanupAgentPricing() {
  try {
    console.log('Starting agent pricing cleanup...');
    
    // Get all agents
    const agentsSnapshot = await db.collection('agents').get();
    
    if (agentsSnapshot.empty) {
      console.log('No agents found to update.');
      return;
    }
    
    console.log(`Found ${agentsSnapshot.docs.length} agents to process.`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process each agent document
    for (const doc of agentsSnapshot.docs) {
      try {
        const agent = doc.data();
        const agentId = doc.id;
        
        // Skip if no pricing data exists at all
        if (!agent.basePrice && !agent.discountedPrice && !agent.priceDetails) {
          console.log(`Skipping agent ${agentId}: No pricing data found.`);
          skippedCount++;
          continue;
        }
        
        // Create or update priceDetails object
        const priceDetails = agent.priceDetails || {};
        
        // Check for duplicated price data at root level
        const fieldsToMove = [
          'basePrice', 
          'discountedPrice', 
          'currency', 
          'isFree', 
          'isSubscription', 
          'discountPercentage'
        ];
        
        let hasUpdates = false;
        let updateData = {};
        
        // Move price data into priceDetails
        fieldsToMove.forEach(field => {
          if (agent[field] !== undefined && 
             (priceDetails[field] === undefined || priceDetails[field] !== agent[field])) {
            // Update priceDetails with the value from root
            priceDetails[field] = agent[field];
            hasUpdates = true;
          }
        });
        
        // Special case for 'price' field (might be the basePrice or discountedPrice)
        if (agent.price !== undefined && typeof agent.price === 'number') {
          // If no basePrice exists, use price as basePrice
          if (priceDetails.basePrice === undefined) {
            priceDetails.basePrice = agent.price;
            hasUpdates = true;
          }
          
          // If no discountedPrice exists, also use price as discountedPrice
          if (priceDetails.discountedPrice === undefined) {
            priceDetails.discountedPrice = agent.price;
            hasUpdates = true;
          }
        }
        
        // Ensure required fields exist in priceDetails
        const defaultValues = {
          basePrice: 0,
          discountedPrice: 0,
          currency: 'USD',
          isFree: false,
          isSubscription: false,
          discountPercentage: 0
        };
        
        Object.entries(defaultValues).forEach(([field, defaultValue]) => {
          if (priceDetails[field] === undefined) {
            priceDetails[field] = defaultValue;
            hasUpdates = true;
          }
        });
        
        // If isFree is true, ensure basePrice and discountedPrice are 0
        if (priceDetails.isFree === true) {
          priceDetails.basePrice = 0;
          priceDetails.discountedPrice = 0;
          hasUpdates = true;
        }
        
        // Create update data
        updateData.priceDetails = priceDetails;
        
        // Create deletion map for fields to be removed from root
        const fieldsToDelete = {};
        fieldsToMove.forEach(field => {
          if (agent[field] !== undefined) {
            fieldsToDelete[field] = admin.firestore.FieldValue.delete();
          }
        });
        
        // Only retain price at root level as a reference to discountedPrice
        updateData.price = priceDetails.discountedPrice;
        
        // Only update if there are changes needed
        if (hasUpdates || Object.keys(fieldsToDelete).length > 0) {
          await db.collection('agents').doc(agentId).update({
            ...updateData,
            ...fieldsToDelete
          });
          
          console.log(`Updated agent ${agentId} pricing structure.`);
          updatedCount++;
        } else {
          console.log(`Agent ${agentId} already has proper pricing structure.`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`Error updating agent ${doc.id}:`, error);
        errorCount++;
      }
    }
    
    console.log('Agent pricing cleanup complete:');
    console.log(`- Updated: ${updatedCount}`);
    console.log(`- Skipped: ${skippedCount}`);
    console.log(`- Errors: ${errorCount}`);
    
  } catch (error) {
    console.error('Error in cleanup script:', error);
    throw error;
  }
}

// Add command line interface
if (require.main === module) {
  // Only run the function if this script is executed directly
  cleanupAgentPricing()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
} else {
  // Export the function for use in other scripts
  module.exports = { cleanupAgentPricing };
} 