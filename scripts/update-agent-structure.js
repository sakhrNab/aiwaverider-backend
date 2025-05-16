/**
 * Script to update agent documents to remove redundancy and improve structure
 * - Converts stringified 'data' to actual object
 * - Removes duplicate fields
 * - Ensures consistent URL structure
 * - Cleans up null fields
 */

// Import Firebase setup from config 
const { db, admin, initializeFirebase } = require('../config/firebase');

/**
 * Main function to update agent documents structure
 */
async function updateAgentStructure() {
  try {
    console.log('Starting agent structure update...');
    
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
        
        // Create improved agent object
        const updatedAgent = restructureAgent(agent);
        
        // Add to the current batch
        if (currentBatch >= batchSize) {
          // Create a new batch if the current one is full
          batchIndex++;
          batches.push(db.batch());
          currentBatch = 0;
        }
        
        batches[batchIndex].update(doc.ref, updatedAgent);
        currentBatch++;
        successCount++;
      } catch (error) {
        console.error(`❌ Error updating agent ${doc.id}:`, error);
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
    
    console.log('Update completed:');
    console.log(`- Successfully updated: ${successCount} agents`);
    console.log(`- Failed updates: ${errorCount} agents`);
    
    return {
      success: true,
      updated: successCount,
      failed: errorCount
    };
  } catch (error) {
    console.error('Error in migration script:', error);
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Restructures an agent object to fix the issues
 */
function restructureAgent(agent) {
  // We've now removed the data field, so we no longer need to parse it
  // Instead, we'll work directly with the top-level fields
  
  // Create a clean price details object
  const priceDetails = {
    basePrice: agent.priceDetails?.basePrice || agent.basePrice || 0,
    discountedPrice: agent.priceDetails?.discountedPrice || agent.discountedPrice || 0,
    currency: agent.priceDetails?.currency || agent.currency || 'USD',
    isFree: agent.priceDetails?.isFree || agent.isFree || false,
    isSubscription: agent.priceDetails?.isSubscription || agent.isSubscription || false,
    discountPercentage: agent.priceDetails?.discountPercentage || agent.discountPercentage || 0
  };
  
  // Create proper image object
  const image = {
    url: agent.image?.url || agent.imageUrl || '',
    fileName: agent.image?.fileName || '',
    originalName: agent.image?.originalName || '',
    contentType: agent.image?.contentType || 'image/jpeg',
    size: agent.image?.size || 0
  };
  
  // Create proper jsonFile object
  const jsonFile = {
    url: agent.jsonFile?.url || agent.downloadUrl || agent.fileUrl || '',
    fileName: agent.jsonFile?.fileName || '',
    originalName: agent.jsonFile?.originalName || '',
    contentType: agent.jsonFile?.contentType || 'application/json',
    size: agent.jsonFile?.size || 0
  };
  
  // Create clean creator object
  const creator = {
    name: agent.creator?.name || '',
    id: agent.creator?.id || '',
    imageUrl: agent.creator?.imageUrl || '',
    email: agent.creator?.email || '',
    username: agent.creator?.username || '',
    role: agent.creator?.role || 'user'
  };
  
  // Create the updated agent with restructured data
  const updatedAgent = {
    id: agent.id,
    name: agent.name || '',
    title: agent.title || '',
    description: agent.description || '',
    category: agent.category || '',
    
    // Single source of truth for pricing
    priceDetails,
    
    // Keep only "image" as the container for image data
    image,
    
    // Keep only "jsonFile" for template data
    jsonFile,
    
    // Consistent downloadUrl (for backward compatibility)
    downloadUrl: jsonFile.url,
    
    // Creator data
    creator,
    
    // Feature flags and metadata
    features: agent.features || [],
    tags: agent.tags || [],
    isFeatured: agent.isFeatured || false,
    isVerified: agent.isVerified || false, 
    isPopular: agent.isPopular || false,
    isTrending: agent.isTrending || false,
    status: agent.status || 'active',
    
    // Timestamps
    createdAt: agent.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  return updatedAgent;
}

// Run the update if this file is executed directly
if (require.main === module) {
  updateAgentStructure().then((result) => {
    console.log('Update script completed with result:', result);
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('Update script failed:', error);
    process.exit(1);
  });
} else {
  // Export for use in other files
  module.exports = { updateAgentStructure, restructureAgent };
} 