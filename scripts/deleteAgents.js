/**
 * Script to delete all agents from the agents collection except for specified ones
 * This script will help clean up the collection before uploading new agents
 * 
 * Run with: node scripts/deleteAgents.js
 * Run with confirmation: node scripts/deleteAgents.js --confirm
 */

require('dotenv').config();
const { db } = require('../config/firebase');

// Configuration
const PRESERVE_AGENT_IDS = [
  'l4OAGPDol2fVx3n30Hk2PMiunpZ2' // Agent ID to preserve
];

/**
 * Get all agent documents
 */
async function getAllAgents() {
  try {
    console.log('📖 Fetching all agents...');
    const snapshot = await db.collection('agents').get();
    
    const agents = [];
    snapshot.forEach(doc => {
      agents.push({
        id: doc.id,
        data: doc.data()
      });
    });
    
    console.log(`📊 Found ${agents.length} agents in collection`);
    return agents;
    
  } catch (error) {
    console.error('❌ Error fetching agents:', error);
    throw error;
  }
}

/**
 * Delete agents in batches
 */
async function deleteAgentsBatch(agentIds) {
  const batchSize = 500; // Firestore batch limit
  let deletedCount = 0;
  
  for (let i = 0; i < agentIds.length; i += batchSize) {
    const batch = db.batch();
    const currentBatch = agentIds.slice(i, i + batchSize);
    
    console.log(`🗑️  Preparing batch ${Math.floor(i / batchSize) + 1}: ${currentBatch.length} agents`);
    
    currentBatch.forEach(agentId => {
      const agentRef = db.collection('agents').doc(agentId);
      batch.delete(agentRef);
    });
    
    try {
      await batch.commit();
      deletedCount += currentBatch.length;
      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} deleted successfully (${deletedCount}/${agentIds.length})`);
    } catch (error) {
      console.error(`❌ Error deleting batch ${Math.floor(i / batchSize) + 1}:`, error);
      throw error;
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < agentIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return deletedCount;
}

/**
 * Main deletion function
 */
async function deleteAgents(confirmDelete = false) {
  try {
    console.log('🧹 Agent Collection Cleanup');
    console.log('===========================\n');
    
    console.log('🔐 Agents to preserve:');
    PRESERVE_AGENT_IDS.forEach(id => {
      console.log(`   • ${id}`);
    });
    console.log('');
    
    // Get all agents
    const allAgents = await getAllAgents();
    
    if (allAgents.length === 0) {
      console.log('ℹ️  No agents found in collection. Nothing to delete.');
      return { total: 0, deleted: 0, preserved: 0 };
    }
    
    // Filter agents to delete (exclude preserved ones)
    const agentsToDelete = allAgents.filter(agent => 
      !PRESERVE_AGENT_IDS.includes(agent.id)
    );
    
    const agentsToPreserve = allAgents.filter(agent => 
      PRESERVE_AGENT_IDS.includes(agent.id)
    );
    
    console.log('📊 Deletion Summary:');
    console.log(`   • Total agents: ${allAgents.length}`);
    console.log(`   • To be deleted: ${agentsToDelete.length}`);
    console.log(`   • To be preserved: ${agentsToPreserve.length}`);
    console.log('');
    
    // Show preserved agents
    if (agentsToPreserve.length > 0) {
      console.log('✅ Agents that will be preserved:');
      agentsToPreserve.forEach(agent => {
        console.log(`   • ${agent.id} - "${agent.data.title || 'Untitled'}"`);
      });
      console.log('');
    }
    
    // Show sample of agents to be deleted
    if (agentsToDelete.length > 0) {
      console.log('🗑️  Sample of agents to be deleted:');
      const sampleSize = Math.min(10, agentsToDelete.length);
      agentsToDelete.slice(0, sampleSize).forEach(agent => {
        console.log(`   • ${agent.id} - "${agent.data.title || 'Untitled'}"`);
      });
      if (agentsToDelete.length > sampleSize) {
        console.log(`   ... and ${agentsToDelete.length - sampleSize} more`);
      }
      console.log('');
    }
    
    if (agentsToDelete.length === 0) {
      console.log('ℹ️  No agents to delete. All existing agents are in the preserve list.');
      return { total: allAgents.length, deleted: 0, preserved: agentsToPreserve.length };
    }
    
    if (!confirmDelete) {
      console.log('⚠️  DRY RUN MODE');
      console.log('================');
      console.log('This is a dry run. No agents will be deleted.');
      console.log('To actually delete the agents, run with --confirm flag:');
      console.log('   node scripts/deleteAgents.js --confirm');
      console.log('');
      console.log('🔍 What would happen:');
      console.log(`   • ${agentsToDelete.length} agents would be deleted`);
      console.log(`   • ${agentsToPreserve.length} agents would be preserved`);
      
      return { total: allAgents.length, deleted: 0, preserved: agentsToPreserve.length, dryRun: true };
    }
    
    // Confirm deletion
    console.log('⚠️  DANGER ZONE ⚠️');
    console.log('==================');
    console.log(`You are about to DELETE ${agentsToDelete.length} agents permanently!`);
    console.log('This action cannot be undone.');
    console.log('');
    
    // Extract IDs for deletion
    const agentIdsToDelete = agentsToDelete.map(agent => agent.id);
    
    // Perform deletion
    console.log('🗑️  Starting deletion process...');
    const deletedCount = await deleteAgentsBatch(agentIdsToDelete);
    
    console.log('\n🎉 Deletion Complete');
    console.log('====================');
    console.log(`✅ Successfully deleted: ${deletedCount} agents`);
    console.log(`✅ Preserved: ${agentsToPreserve.length} agents`);
    console.log(`📊 Total processed: ${allAgents.length} agents`);
    
    // Verify deletion
    console.log('\n🔍 Verifying deletion...');
    const remainingAgents = await getAllAgents();
    console.log(`📊 Agents remaining in collection: ${remainingAgents.length}`);
    
    if (remainingAgents.length === agentsToPreserve.length) {
      console.log('✅ Deletion verified: Only preserved agents remain');
    } else {
      console.log('⚠️  Warning: Unexpected number of remaining agents');
    }
    
    return {
      total: allAgents.length,
      deleted: deletedCount,
      preserved: agentsToPreserve.length,
      remaining: remainingAgents.length
    };
    
  } catch (error) {
    console.error('\n💥 Deletion failed:', error);
    throw error;
  }
}

/**
 * Display help information
 */
function showHelp() {
  console.log('🧹 Agent Collection Cleanup Script');
  console.log('===================================\n');
  console.log('This script deletes all agents from the agents collection except for specified ones.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/deleteAgents.js          # Dry run (shows what would be deleted)');
  console.log('  node scripts/deleteAgents.js --confirm # Actually delete agents');
  console.log('  node scripts/deleteAgents.js --help    # Show this help');
  console.log('');
  console.log('Preserved Agent IDs:');
  PRESERVE_AGENT_IDS.forEach(id => {
    console.log(`  • ${id}`);
  });
  console.log('');
  console.log('⚠️  Warning: Deletion is permanent and cannot be undone!');
}

/**
 * Main execution
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const confirmDelete = args.includes('--confirm');
  
  deleteAgents(confirmDelete)
    .then(result => {
      if (result.dryRun) {
        console.log('\n💡 Dry run completed. Use --confirm to actually delete agents.');
      } else {
        console.log('\n🚀 Agent cleanup completed successfully!');
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Agent cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  deleteAgents,
  getAllAgents,
  PRESERVE_AGENT_IDS
}; 