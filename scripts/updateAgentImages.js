/**
 * Script to check and update agent image URLs to ensure they are absolute
 */
require('dotenv').config();
const path = require('path');
const { db, initializeFirebase } = require('../config/firebase');

// Website URL to use for absolute URLs 
const websiteUrl = process.env.FRONTEND_URL || 'https://aiwaverider.com';

async function updateAgentImages() {
  try {
    // Initialize Firebase first
    initializeFirebase();
    console.log('Firebase initialized successfully');
    
    const agentsRef = db.collection('agents');
    
    console.log('Fetching all agents...');
    const agentsSnapshot = await agentsRef.get();
    
    console.log(`Found ${agentsSnapshot.size} agents`);
    
    // Create a batch for updating documents
    let batch = db.batch();
    let batchCount = 0;
    const BATCH_LIMIT = 500; // Firestore can handle up to 500 operations per batch
    
    let updatedCount = 0;
    let missingImageCount = 0;
    let relativeUrlCount = 0;
    let noChangesCount = 0;
    
    for (const doc of agentsSnapshot.docs) {
      const agent = doc.data();
      const agentRef = doc.ref;
      
      let needsUpdate = false;
      
      // Check if agent has an imageUrl
      if (!agent.imageUrl) {
        // If missing imageUrl, create a placeholder based on agent name
        const placeholderUrl = `https://via.placeholder.com/300x200/3498db/ffffff?text=${encodeURIComponent(agent.name || 'AI Agent')}`;
        agent.imageUrl = placeholderUrl;
        needsUpdate = true;
        missingImageCount++;
        console.log(`Agent ${agent.id || doc.id}: Added placeholder image URL`);
      } 
      // Check if the imageUrl is relative
      else if (!agent.imageUrl.startsWith('http')) {
        // Convert relative URL to absolute
        const separator = agent.imageUrl.startsWith('/') ? '' : '/';
        const absoluteUrl = `${websiteUrl}${separator}${agent.imageUrl}`;
        
        console.log(`Agent ${agent.id || doc.id}: Converting relative URL ${agent.imageUrl} to ${absoluteUrl}`);
        agent.imageUrl = absoluteUrl;
        needsUpdate = true;
        relativeUrlCount++;
      } else {
        // URL is already absolute, no change needed
        noChangesCount++;
      }
      
      if (needsUpdate) {
        batch.update(agentRef, { imageUrl: agent.imageUrl });
        batchCount++;
        updatedCount++;
        
        // Commit the batch if it reaches the limit
        if (batchCount >= BATCH_LIMIT) {
          console.log(`Committing batch of ${batchCount} updates...`);
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
    
    // Commit any remaining updates
    if (batchCount > 0) {
      console.log(`Committing final batch of ${batchCount} updates...`);
      await batch.commit();
    }
    
    console.log('\nUpdate Summary:');
    console.log('--------------');
    console.log(`Total agents processed: ${agentsSnapshot.size}`);
    console.log(`Agents updated: ${updatedCount}`);
    console.log(`Missing images fixed: ${missingImageCount}`);
    console.log(`Relative URLs converted: ${relativeUrlCount}`);
    console.log(`Agents with no changes needed: ${noChangesCount}`);
    
    return {
      success: true,
      updated: updatedCount,
      missing: missingImageCount,
      relative: relativeUrlCount,
      unchanged: noChangesCount,
      total: agentsSnapshot.size
    };
  } catch (error) {
    console.error('Error updating agent image URLs:', error);
    return { success: false, error: error.message };
  }
}

// Execute the function and handle errors
if (require.main === module) {
  updateAgentImages()
    .then(result => {
      console.log('Agent image URL update completed successfully');
      console.log('Result:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Error updating agent image URLs:', error);
      process.exit(1);
    });
} else {
  module.exports = updateAgentImages;
} 