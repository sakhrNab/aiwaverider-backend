/**
 * Quick script to check agents in collection
 */

require('dotenv').config();
const { db } = require('../config/firebase');

async function checkAgents() {
  try {
    console.log('📖 Checking agents collection...');
    
    // Get first 10 agents
    const snapshot = await db.collection('agents').limit(10).get();
    console.log('\n📋 Sample agent IDs in collection:');
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`• ${doc.id} - ${data.title || 'Untitled'}`);
    });
    
    // Check total count
    const allSnapshot = await db.collection('agents').get();
    console.log(`\n📊 Total agents: ${allSnapshot.size}`);
    
    // Check if the specific agent exists
    const specificAgentId = 'l4OAGPDol2fVx3n30Hk2PMiunpZ2';
    const specificAgent = await db.collection('agents').doc(specificAgentId).get();
    console.log(`\n🔍 Agent ${specificAgentId} exists: ${specificAgent.exists}`);
    if (specificAgent.exists) {
      console.log(`   Title: ${specificAgent.data().title}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkAgents(); 