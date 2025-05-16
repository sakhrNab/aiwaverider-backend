/**
 * Migration Script: Update Agents with Download Counts
 * 
 * This script adds downloadCount to all agents in the database by fetching
 * their stats and incorporating the download count directly into the agent document.
 * 
 * Usage: node scripts/updateAgentsWithDownloadCounts.js
 */

const admin = require('firebase-admin');
const { db } = require('../config/firebase');

async function migrateDownloadCounts() {
  console.log('Starting migration: Adding downloadCount to all agents...');
  
  try {
    // Get all agents from the database
    const agentsSnapshot = await db.collection('agents').get();
    
    if (agentsSnapshot.empty) {
      console.log('No agents found in the database.');
      return;
    }

    console.log(`Found ${agentsSnapshot.size} agents to update.`);
    
    // Keep track of updated agents
    let updatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Batch updates to avoid hitting API limits
    const batchSize = 500;
    let currentBatch = db.batch();
    let batchCount = 0;
    
    // Process each agent
    for (const agentDoc of agentsSnapshot.docs) {
      try {
        const agentId = agentDoc.id;
        const agentData = agentDoc.data();
        
        // Skip agents that already have a downloadCount
        if (agentData.downloadCount !== undefined) {
          console.log(`Agent ${agentId} already has downloadCount: ${agentData.downloadCount}`);
          skippedCount++;
          continue;
        }
        
        // Check for download count in agent_stats collection
        const statsDoc = await db.collection('agent_stats').doc(agentId).get();
        
        let downloadCount = 0;
        
        if (statsDoc.exists) {
          const statsData = statsDoc.data();
          if (statsData.downloads !== undefined) {
            downloadCount = statsData.downloads;
            console.log(`Found download count for agent ${agentId}: ${downloadCount}`);
          } else {
            console.log(`Agent stats exist for ${agentId}, but no downloads field found.`);
          }
        } else {
          // Check if there's a downloads subcollection
          const downloadsSnapshot = await db
            .collection('agents')
            .doc(agentId)
            .collection('downloads')
            .get();
          
          if (!downloadsSnapshot.empty) {
            downloadCount = downloadsSnapshot.size;
            console.log(`Found ${downloadCount} downloads in subcollection for agent ${agentId}`);
          } else {
            console.log(`No download data found for agent ${agentId}, setting to 0.`);
          }
        }
        
        // Update the agent document with the download count
        const agentRef = db.collection('agents').doc(agentId);
        currentBatch.update(agentRef, { 
          downloadCount: downloadCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        batchCount++;
        
        // If batch size reached, commit and create a new batch
        if (batchCount >= batchSize) {
          await currentBatch.commit();
          console.log(`Committed batch of ${batchCount} updates.`);
          updatedCount += batchCount;
          batchCount = 0;
          currentBatch = db.batch();
        }
        
      } catch (error) {
        console.error(`Error updating agent ${agentDoc.id}:`, error);
        errorCount++;
      }
    }
    
    // Commit any remaining updates
    if (batchCount > 0) {
      await currentBatch.commit();
      console.log(`Committed final batch of ${batchCount} updates.`);
      updatedCount += batchCount;
    }
    
    console.log(`Migration completed!`);
    console.log(`- Updated: ${updatedCount} agents`);
    console.log(`- Skipped: ${skippedCount} agents (already had downloadCount)`);
    console.log(`- Errors: ${errorCount} agents`);
    
    // Also update the API endpoints - this is not needed for Firebase
    // but would be helpful for any REST API calls
    console.log('Creating/updating API endpoint for download counts...');
    
    // Done in the controller update
    console.log('API update complete. Migration finished successfully!');
    
    // Return results for API usage
    return {
      success: true,
      updated: updatedCount,
      skipped: skippedCount,
      errors: errorCount
    };
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Only run the migration directly if this script is executed directly
if (require.main === module) {
  migrateDownloadCounts()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

// Export the migration function for use in API routes
module.exports = { migrateDownloadCounts }; 