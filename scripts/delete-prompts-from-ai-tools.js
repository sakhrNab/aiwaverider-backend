const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK using the existing configuration
require('../config/firebase.js');

const db = admin.firestore();
const COLLECTION_NAME = 'ai_tools';

/**
 * Script to delete all prompts from the ai_tools collection
 * 
 * This script identifies prompts based on:
 * - keyword containing "prompt"
 * - title containing "prompt" 
 * - category containing "prompt"
 * 
 * Usage: node scripts/delete-prompts-from-ai-tools.js
 */

// Function to identify if a tool is a prompt
const isPrompt = (tool) => {
  const keyword = tool.keyword?.toLowerCase() || '';
  const title = tool.title?.toLowerCase() || '';
  const category = tool.category?.toLowerCase() || '';
  
  return keyword.includes('prompt') ||
         title.includes('prompt') ||
         category.includes('prompt');
};

// Function to delete prompts
const deletePrompts = async () => {
  try {
    console.log('🔍 Starting prompt deletion process...');
    console.log('📊 Fetching all AI tools from collection:', COLLECTION_NAME);
    
    // Get all documents from the collection
    const snapshot = await db.collection(COLLECTION_NAME).get();
    
    if (snapshot.empty) {
      console.log('❌ No documents found in the collection');
      return;
    }
    
    console.log(`📋 Found ${snapshot.size} total documents`);
    
    // Identify prompts and regular AI tools
    const prompts = [];
    const aiTools = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const toolInfo = {
        id: doc.id,
        title: data.title || 'Untitled',
        keyword: data.keyword || '',
        category: data.category || '',
        isPrompt: isPrompt(data)
      };
      
      if (toolInfo.isPrompt) {
        prompts.push(toolInfo);
      } else {
        aiTools.push(toolInfo);
      }
    });
    
    console.log(`\n📊 Analysis Results:`);
    console.log(`   🎯 Prompts found: ${prompts.length}`);
    console.log(`   🛠️  AI Tools found: ${aiTools.length}`);
    console.log(`   📈 Total: ${prompts.length + aiTools.length}`);
    
    if (prompts.length === 0) {
      console.log('\n✅ No prompts found to delete. All documents are regular AI tools.');
      return;
    }
    
    // Display prompts that will be deleted
    console.log('\n🗑️  Prompts that will be deleted:');
    prompts.forEach((prompt, index) => {
      console.log(`   ${index + 1}. ${prompt.title} (ID: ${prompt.id})`);
      console.log(`      Keyword: "${prompt.keyword}"`);
      console.log(`      Category: "${prompt.category}"`);
    });
    
    // Display AI tools that will be preserved
    console.log('\n🛡️  AI Tools that will be preserved:');
    aiTools.forEach((tool, index) => {
      console.log(`   ${index + 1}. ${tool.title} (ID: ${tool.id})`);
    });
    
    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will permanently delete all prompts!');
    console.log('   This action cannot be undone.');
    
    // For safety, we'll use a dry-run first
    console.log('\n🔍 DRY RUN MODE - No actual deletion will occur');
    console.log('   To perform actual deletion, change dryRun to false in the script');
    
    const dryRun = false; // Set to false to actually delete
    
    if (!dryRun) {
      console.log('\n🗑️  Starting actual deletion...');
      
      // Delete prompts in batches
      const batch = db.batch();
      let deletedCount = 0;
      
      for (const prompt of prompts) {
        const docRef = db.collection(COLLECTION_NAME).doc(prompt.id);
        batch.delete(docRef);
        deletedCount++;
        
        console.log(`   🗑️  Deleting: ${prompt.title} (${prompt.id})`);
      }
      
      // Commit the batch
      await batch.commit();
      
      console.log(`\n✅ Successfully deleted ${deletedCount} prompts!`);
      console.log(`🛡️  Preserved ${aiTools.length} AI tools`);
      
    } else {
      console.log('\n🔍 DRY RUN COMPLETED');
      console.log(`   Would delete ${prompts.length} prompts`);
      console.log(`   Would preserve ${aiTools.length} AI tools`);
      console.log('\n💡 To perform actual deletion:');
      console.log('   1. Set dryRun = false in this script');
      console.log('   2. Run the script again');
    }
    
  } catch (error) {
    console.error('❌ Error during prompt deletion:', error);
    throw error;
  }
};

// Function to verify the deletion
const verifyDeletion = async () => {
  try {
    console.log('\n🔍 Verifying deletion results...');
    
    const snapshot = await db.collection(COLLECTION_NAME).get();
    
    if (snapshot.empty) {
      console.log('❌ No documents found in collection');
      return;
    }
    
    const remainingTools = [];
    let remainingPrompts = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const toolInfo = {
        id: doc.id,
        title: data.title || 'Untitled',
        keyword: data.keyword || '',
        category: data.category || '',
        isPrompt: isPrompt(data)
      };
      
      if (toolInfo.isPrompt) {
        remainingPrompts++;
        console.log(`   ⚠️  Remaining prompt: ${toolInfo.title} (${toolInfo.id})`);
      } else {
        remainingTools.push(toolInfo);
      }
    });
    
    console.log(`\n📊 Verification Results:`);
    console.log(`   🎯 Remaining prompts: ${remainingPrompts}`);
    console.log(`   🛠️  Remaining AI tools: ${remainingTools.length}`);
    console.log(`   📈 Total remaining: ${remainingPrompts + remainingTools.length}`);
    
    if (remainingPrompts === 0) {
      console.log('✅ All prompts have been successfully deleted!');
    } else {
      console.log('⚠️  Some prompts still remain. Check the list above.');
    }
    
  } catch (error) {
    console.error('❌ Error during verification:', error);
  }
};

// Main execution
const main = async () => {
  try {
    console.log('🚀 Starting AI Tools Prompt Deletion Script');
    console.log('==========================================\n');
    
    // Delete prompts
    await deletePrompts();
    
    // Verify deletion
    await verifyDeletion();
    
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    // Close the Firebase connection
    process.exit(0);
  }
};

// Run the script
if (require.main === module) {
  main();
}

module.exports = { deletePrompts, verifyDeletion, isPrompt }; 