/**
 * Script to remove specific fields from agent documents
 * 
 * This script removes the following fields from all agents:
 * - status: "active"
 * - workflowMetadata.nodeTypes (but keeps workflowMetadata object)
 * - fileUrl
 * - downloadUrl
 * - isPaid
 * - pricingMetadata
 * - pricingSource
 * - lastPriceUpdate
 * - tags field (entire field will be removed)
 * 
 * Usage: node scripts/remove-workflow-metadata-fields.js
 */

const { db, admin, initializeFirebase } = require('../config/firebase');

/**
 * Main function to remove specific fields from agent documents
 */
async function removeWorkflowMetadataFields(dryRun = true) {
  try {
    console.log('Starting workflow metadata fields removal...');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be made)'}`);
    
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
    let skippedCount = 0;
    let fieldsToRemove = [];
    
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
        
        // Check which fields exist and need to be removed
        const fieldsToRemoveForThisAgent = [];
        
        if (agent.status === 'active') {
          fieldsToRemoveForThisAgent.push('status');
        }
        
        if (agent.workflowMetadata && agent.workflowMetadata.nodeTypes) {
          fieldsToRemoveForThisAgent.push('workflowMetadata.nodeTypes');
        }
        
        if (agent.fileUrl) {
          fieldsToRemoveForThisAgent.push('fileUrl');
        }
        
        if (agent.downloadUrl) {
          fieldsToRemoveForThisAgent.push('downloadUrl');
        }
        
        if (agent.isPaid !== undefined) {
          fieldsToRemoveForThisAgent.push('isPaid');
        }
        
        if (agent.pricingMetadata) {
          fieldsToRemoveForThisAgent.push('pricingMetadata');
        }
        
        if (agent.pricingSource) {
          fieldsToRemoveForThisAgent.push('pricingSource');
        }
        
        if (agent.lastPriceUpdate) {
          fieldsToRemoveForThisAgent.push('lastPriceUpdate');
        }
        
        // Check for tags field to remove completely
        if (agent.tags) {
          fieldsToRemoveForThisAgent.push('tags');
        }
        
        if (fieldsToRemoveForThisAgent.length === 0) {
          console.log(`Agent ${agentId} has no fields to remove, skipping`);
          skippedCount++;
          continue;
        }
        
        console.log(`Agent ${agentId} has ${fieldsToRemoveForThisAgent.length} fields to remove:`, fieldsToRemoveForThisAgent);
        fieldsToRemove.push(...fieldsToRemoveForThisAgent);
        
        if (!dryRun) {
          // Add to the current batch
          if (currentBatch >= batchSize) {
            // Create a new batch if the current one is full
            batchIndex++;
            batches.push(db.batch());
            currentBatch = 0;
          }
          
          // Prepare the update object
          const updateObj = {};
          
          // Remove each field
          if (agent.status === 'active') {
            updateObj.status = admin.firestore.FieldValue.delete();
          }
          
          if (agent.fileUrl) {
            updateObj.fileUrl = admin.firestore.FieldValue.delete();
          }
          
          if (agent.downloadUrl) {
            updateObj.downloadUrl = admin.firestore.FieldValue.delete();
          }
          
          if (agent.isPaid !== undefined) {
            updateObj.isPaid = admin.firestore.FieldValue.delete();
          }
          
          if (agent.pricingMetadata) {
            updateObj.pricingMetadata = admin.firestore.FieldValue.delete();
          }
          
          if (agent.pricingSource) {
            updateObj.pricingSource = admin.firestore.FieldValue.delete();
          }
          
          if (agent.lastPriceUpdate) {
            updateObj.lastPriceUpdate = admin.firestore.FieldValue.delete();
          }
          
          // Special handling for workflowMetadata.nodeTypes
          if (agent.workflowMetadata && agent.workflowMetadata.nodeTypes) {
            // Remove only the nodeTypes field, keep the workflowMetadata object
            const { nodeTypes, ...restWorkflowMetadata } = agent.workflowMetadata;
            if (Object.keys(restWorkflowMetadata).length > 0) {
              // If there are other fields in workflowMetadata, update with the rest
              updateObj.workflowMetadata = restWorkflowMetadata;
            } else {
              // If no other fields, remove the entire workflowMetadata object
              updateObj.workflowMetadata = admin.firestore.FieldValue.delete();
            }
          }
          
          // Remove tags field completely
          if (agent.tags) {
            updateObj.tags = admin.firestore.FieldValue.delete();
          }
          
          // Add updatedAt timestamp
          updateObj.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          
          batches[batchIndex].update(doc.ref, updateObj);
          currentBatch++;
        }
        
        successCount++;
      } catch (error) {
        console.error(`❌ Error processing agent ${doc.id}:`, error);
        errorCount++;
      }
    }
    
    // Commit all batches if not in dry run mode
    if (!dryRun && successCount > 0) {
      console.log(`Committing ${batches.length} batches with ${successCount} updates...`);
      
      for (let i = 0; i <= batchIndex; i++) {
        if (currentBatch > 0) {
          console.log(`Committing batch ${i + 1} of ${batchIndex + 1}...`);
          await batches[i].commit();
          console.log(`Batch ${i + 1} committed successfully`);
        }
      }
    }
    
    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`- Total agents processed: ${agentsSnapshot.size}`);
    console.log(`- Agents with fields to remove: ${successCount}`);
    console.log(`- Agents skipped (no fields to remove): ${skippedCount}`);
    console.log(`- Errors: ${errorCount}`);
    
    if (dryRun) {
      console.log(`- Fields that would be removed: ${fieldsToRemove.length}`);
      console.log(`- Unique field types: ${[...new Set(fieldsToRemove)].join(', ')}`);
      console.log('\n⚠️  This was a DRY RUN. No changes were made to the database.');
      console.log('To actually remove the fields, run this script with dryRun = false');
    } else {
      console.log(`- Fields successfully removed: ${fieldsToRemove.length}`);
      console.log('✅ Changes have been applied to the database.');
    }
    
    return {
      success: true,
      processed: successCount,
      skipped: skippedCount,
      failed: errorCount,
      fieldsRemoved: fieldsToRemove.length,
      dryRun: dryRun
    };
  } catch (error) {
    console.error('Error in workflow metadata fields removal script:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Interactive function to run the script with confirmation
 */
async function runWithConfirmation() {
  console.log('=== WORKFLOW METADATA FIELDS REMOVAL SCRIPT ===');
  console.log('This script will remove the following fields from all agents:');
  console.log('- status: "active"');
  console.log('- workflowMetadata.nodeTypes (but keeps workflowMetadata object)');
  console.log('- fileUrl');
  console.log('- downloadUrl');
  console.log('- isPaid');
  console.log('- pricingMetadata');
  console.log('- pricingSource');
  console.log('- lastPriceUpdate');
  console.log('- tags field (entire field will be removed)');
  console.log('');
  
  // First, run a dry run to see what would be removed
  console.log('Step 1: Running dry run to see what would be removed...');
  const dryRunResult = await removeWorkflowMetadataFields(true);
  
  if (!dryRunResult.success) {
    console.error('Dry run failed:', dryRunResult.error);
    return;
  }
  
  if (dryRunResult.processed === 0) {
    console.log('No agents have fields to remove. Exiting.');
    return;
  }
  
  console.log('\nStep 2: Review the results above.');
  console.log('Do you want to proceed with removing these fields? (yes/no)');
  
  // In a real implementation, you would wait for user input here
  // For now, we'll simulate the confirmation
  const shouldProceed = process.argv.includes('--confirm');
  
  if (shouldProceed) {
    console.log('\nStep 3: Proceeding with field removal...');
    const result = await removeWorkflowMetadataFields(false);
    
    if (result.success) {
      console.log('✅ Script completed successfully!');
    } else {
      console.error('❌ Script failed:', result.error);
    }
  } else {
    console.log('\n⚠️  Script cancelled. No changes were made.');
    console.log('To proceed, run: node scripts/remove-workflow-metadata-fields.js --confirm');
  }
}

// Run the script
if (require.main === module) {
  runWithConfirmation().catch(console.error);
}

module.exports = { removeWorkflowMetadataFields }; 