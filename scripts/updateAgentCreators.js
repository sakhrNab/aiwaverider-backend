/**
 * Script to update agent creator objects to ensure they have the complete structure
 * with name, username, and role fields
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, initializeFirebase } = require('../config/firebase');

async function updateAgentCreators() {
  console.log('Starting agent creator update process...');
  
  try {
    // Initialize Firebase first
    initializeFirebase();
    console.log('Firebase initialized successfully');
    
    // Fetch all agents from the database
    const agentsSnapshot = await db.collection('agents').get();
    console.log(`Found ${agentsSnapshot.size} agents to process`);
    
    if (agentsSnapshot.empty) {
      console.log('No agents found in the database');
      return { success: true, message: 'No agents to update', updated: 0, skipped: 0 };
    }
    
    let batch = db.batch();
    let batchCount = 0;
    let updateCount = 0;
    let skippedCount = 0;
    const batchSize = 500; // Firestore batch limit is 500 operations
    
    for (const doc of agentsSnapshot.docs) {
      const agent = doc.data();
      const agentRef = doc.ref;
      let needsUpdate = false;
      let updatedCreator = null;
      
      // Check if the agent has a creator field
      if (!agent.creator) {
        // No creator exists, create a default one
        updatedCreator = {
          name: 'Unknown Creator',
          username: 'unknown',
          role: 'user'
        };
        needsUpdate = true;
        console.log(`Agent ${agent.name || agent.id}: Adding missing creator object`);
      } 
      // Check if creator is a string (old format)
      else if (typeof agent.creator === 'string') {
        updatedCreator = {
          name: agent.creator,
          username: agent.creator.toLowerCase().replace(/\s+/g, ''),
          role: 'user'
        };
        needsUpdate = true;
        console.log(`Agent ${agent.name || agent.id}: Converting creator from string to object`);
      } 
      // Check if creator is an object but missing required fields
      else if (typeof agent.creator === 'object') {
        updatedCreator = { ...agent.creator };
        
        if (!updatedCreator.name) {
          updatedCreator.name = 'Unknown Creator';
          needsUpdate = true;
        }
        
        if (!updatedCreator.username) {
          updatedCreator.username = updatedCreator.name.toLowerCase().replace(/\s+/g, '');
          needsUpdate = true;
        }
        
        if (!updatedCreator.role) {
          updatedCreator.role = 'user';
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          console.log(`Agent ${agent.name || agent.id}: Updating creator with missing fields`);
        }
      }
      
      if (needsUpdate) {
        batch.update(agentRef, { creator: updatedCreator });
        updateCount++;
        batchCount++;
        
        // Commit batch when it reaches the size limit
        if (batchCount >= batchSize) {
          console.log(`Committing batch of ${batchCount} updates...`);
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      } else {
        skippedCount++;
      }
    }
    
    // Commit any remaining updates
    if (batchCount > 0) {
      console.log(`Committing final batch of ${batchCount} updates...`);
      await batch.commit();
    }
    
    console.log('Agent creator update process completed successfully');
    console.log(`Total agents: ${agentsSnapshot.size}`);
    console.log(`Updated agents: ${updateCount}`);
    console.log(`Skipped agents: ${skippedCount}`);
    
    return {
      success: true,
      updated: updateCount,
      skipped: skippedCount,
      total: agentsSnapshot.size
    };
  } catch (error) {
    console.error('Error updating agent creators:', error);
    return { success: false, error: error.message };
  }
}

// Execute the function directly if this script is run
if (require.main === module) {
  updateAgentCreators()
    .then(result => {
      console.log('Update completed with result:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Update failed with error:', error);
      process.exit(1);
    });
} else {
  // Export the function if this is imported as a module
  module.exports = updateAgentCreators;
} 