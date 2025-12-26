// backup-agents.js - Run this BEFORE the main transformation
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

require('../config/firebase.js');

const db = admin.firestore();

/**
 * Backup all agents before transformation
 */
const backupAgents = async () => {
  try {
    console.log('📦 Creating backup of all agents...');
    
    const snapshot = await db.collection('agents').get();
    const agents = [];
    
    snapshot.forEach(doc => {
      agents.push({
        id: doc.id,
        ...doc.data(),
        // Convert timestamps to strings for JSON
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString(),
      });
    });
    
    const backupData = {
      timestamp: new Date().toISOString(),
      totalAgents: agents.length,
      agents: agents
    };
    
    const filename = `agents_backup_${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(__dirname, 'backups', filename);
    
    // Create backups directory if it doesn't exist
    const backupDir = path.dirname(filepath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));
    
    console.log(`✅ Backup created: ${filepath}`);
    console.log(`📊 Backed up ${agents.length} agents`);
    console.log(`💾 File size: ${(fs.statSync(filepath).size / 1024 / 1024).toFixed(2)} MB`);
    
    return filepath;
    
  } catch (error) {
    console.error('❌ Backup failed:', error);
    throw error;
  }
};

/**
 * Restore agents from backup
 */
const restoreFromBackup = async (backupFilePath) => {
  try {
    console.log(`🔄 Restoring agents from: ${backupFilePath}`);
    
    const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
    const agents = backupData.agents;
    
    console.log(`📊 Restoring ${agents.length} agents...`);
    
    // Process in batches of 500 (Firestore limit)
    const batchSize = 500;
    let restored = 0;
    
    for (let i = 0; i < agents.length; i += batchSize) {
      const batch = db.batch();
      const currentBatch = agents.slice(i, i + batchSize);
      
      currentBatch.forEach(agent => {
        const { id, ...agentData } = agent;
        
        // Convert timestamp strings back to Firestore timestamps
        if (agentData.createdAt) {
          agentData.createdAt = admin.firestore.Timestamp.fromDate(new Date(agentData.createdAt));
        }
        if (agentData.updatedAt) {
          agentData.updatedAt = admin.firestore.Timestamp.fromDate(new Date(agentData.updatedAt));
        }
        
        const agentRef = db.collection('agents').doc(id);
        batch.set(agentRef, agentData);
      });
      
      await batch.commit();
      restored += currentBatch.length;
      console.log(`✅ Restored batch: ${restored}/${agents.length}`);
    }
    
    console.log(`🎉 Successfully restored ${restored} agents`);
    
  } catch (error) {
    console.error('❌ Restore failed:', error);
    throw error;
  }
};

module.exports = { backupAgents, restoreFromBackup };

// Run backup if called directly
if (require.main === module) {
  backupAgents().then(() => process.exit(0));
}