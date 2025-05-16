/**
 * Script to update agents collection with missing fields needed for ratings and reviews
 * This adds rating, reviews, and likes fields if they don't exist
 */

// Use the existing Firebase admin configuration from the backend
const admin = require('firebase-admin');
const { db } = require('../config/firebase');

async function updateAgentsCollection() {
  console.log('Starting agents collection update...');
  
  try {
    // Get all agents
    const agentsSnapshot = await db.collection('agents').get();
    
    console.log(`Found ${agentsSnapshot.size} agents to update`);
    
    const batch = db.batch();
    let updateCount = 0;
    
    // For each agent document
    agentsSnapshot.docs.forEach(doc => {
      const agentData = doc.data();
      const updateNeeded = !agentData.rating || 
                          !agentData.reviews || 
                          !Array.isArray(agentData.likes);
      
      // Only update if needed
      if (updateNeeded) {
        const agentRef = db.collection('agents').doc(doc.id);
        const updates = {};
        
        // Add rating if missing
        if (!agentData.rating) {
          console.log(`Adding rating field to agent ${doc.id}`);
          updates.rating = { average: 0, count: 0 };
        }
        
        // Add reviews array if missing
        if (!agentData.reviews) {
          console.log(`Adding reviews array to agent ${doc.id}`);
          updates.reviews = [];
        }
        
        // Ensure likes is an array
        if (!Array.isArray(agentData.likes)) {
          console.log(`Adding likes array to agent ${doc.id}`);
          updates.likes = [];
        }
        
        batch.update(agentRef, updates);
        updateCount++;
      }
    });
    
    if (updateCount > 0) {
      // Commit the batch
      await batch.commit();
      console.log(`Successfully updated ${updateCount} agents`);
    } else {
      console.log('No updates needed. All agents already have the required fields.');
    }
    
  } catch (error) {
    console.error('Error updating agents collection:', error);
  }
}

// Create agent_reviews collection if it doesn't exist
async function createAgentReviewsCollection() {
  console.log('Checking for agent_reviews collection...');
  
  try {
    // Check if collection exists by attempting to get its documents
    const reviewsSnapshot = await db.collection('agent_reviews').limit(1).get();
    
    // If this is the first time, create a sample document to ensure collection exists
    if (reviewsSnapshot.empty) {
      console.log('Creating agent_reviews collection with sample document...');
      
      await db.collection('agent_reviews').add({
        agentId: 'sample',
        userId: 'system',
        userName: 'System',
        content: 'This is a sample review to initialize the collection',
        rating: 5,
        createdAt: new Date().toISOString(),
        _isSystemSample: true
      });
      
      console.log('agent_reviews collection created successfully');
    } else {
      console.log('agent_reviews collection already exists');
    }
  } catch (error) {
    console.error('Error creating agent_reviews collection:', error);
  }
}

// Run both functions
async function initializeCollections() {
  await updateAgentsCollection();
  await createAgentReviewsCollection();
  console.log('Collection initialization completed');
}

// If script is run directly (not imported), execute initialization
if (require.main === module) {
  initializeCollections()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
} else {
  // Export functions for use in other scripts
  module.exports = {
    updateAgentsCollection,
    createAgentReviewsCollection,
    initializeCollections
  };
} 