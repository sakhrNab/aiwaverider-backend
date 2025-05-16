#!/usr/bin/env node

/**
 * Initialize Download Counts for Agents
 * 
 * This script adds/initializes download counts for all agents in the database.
 * It can be run in two modes:
 * 1. Production mode: Sets all missing download counts to zero
 * 2. Development mode: Sets random download counts for testing
 * 
 * Usage:
 *   node initializeDownloadCounts.js [--dev] [--help]
 * 
 * Options:
 *   --dev   Initialize with random download counts (for development)
 *   --help  Show help message
 */

// Load environment variables
require('dotenv').config({ path: '../.env' });

// Required dependencies
const { db, admin } = require('../config/firebase');
const readline = require('readline');

// Parse command line arguments
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const showHelp = args.includes('--help');

// Show help message if requested
if (showHelp) {
  console.log(`
  Initialize Download Counts for Agents
  
  This script adds/initializes download counts for all agents in the database.

  Usage:
    node initializeDownloadCounts.js [--dev] [--help]
  
  Options:
    --dev   Initialize with random download counts (for development)
    --help  Show help message
  `);
  process.exit(0);
}

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Main function to initialize download counts
 */
async function initializeDownloadCounts() {
  try {
    console.log(`Running in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);
    console.log(`${isDev ? 'Random' : 'Zero'} download counts will be set for agents without existing counts`);
    
    // Ask for confirmation before proceeding
    await new Promise((resolve) => {
      rl.question('Do you want to continue? (y/n): ', (answer) => {
        if (answer.toLowerCase() !== 'y') {
          console.log('Operation canceled.');
          process.exit(0);
        }
        resolve();
      });
    });
    
    console.log('Fetching all agents from the database...');
    
    // Get all agents
    const agentsSnapshot = await db.collection('agents').get();
    
    if (agentsSnapshot.empty) {
      console.log('No agents found in the database.');
      process.exit(0);
    }
    
    console.log(`Found ${agentsSnapshot.docs.length} agents.`);
    
    // Counters
    let updatedCount = 0;
    let alreadyHasCountCount = 0;
    let batchNumber = 1;
    let currentBatchSize = 0;
    
    // Create a batch for Firestore updates
    let batch = db.batch();
    
    // Process each agent
    for (const doc of agentsSnapshot.docs) {
      const agentData = doc.data();
      const agentRef = db.collection('agents').doc(doc.id);
      
      // Check if download count already exists
      if (agentData.downloadCount !== undefined) {
        alreadyHasCountCount++;
        console.log(`Agent ${doc.id} already has download count: ${agentData.downloadCount}`);
        continue;
      }
      
      // Generate download count based on mode
      let downloadCount = 0;
      if (isDev) {
        // In dev mode, generate a random number between 0 and 10000
        downloadCount = Math.floor(Math.random() * 10000);
      }
      
      // Add to batch
      batch.update(agentRef, { 
        downloadCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      updatedCount++;
      currentBatchSize++;
      
      // Firestore has a limit of 500 operations per batch
      if (currentBatchSize >= 500) {
        console.log(`Committing batch ${batchNumber} (${currentBatchSize} operations)...`);
        await batch.commit();
        batch = db.batch();
        currentBatchSize = 0;
        batchNumber++;
      }
    }
    
    // Commit any remaining updates
    if (currentBatchSize > 0) {
      console.log(`Committing final batch (${currentBatchSize} operations)...`);
      await batch.commit();
    }
    
    console.log('\nInitialization complete!');
    console.log(`- Total agents: ${agentsSnapshot.docs.length}`);
    console.log(`- Agents already with download counts: ${alreadyHasCountCount}`);
    console.log(`- Agents updated with new download counts: ${updatedCount}`);
    
  } catch (error) {
    console.error('Error initializing download counts:', error);
  } finally {
    rl.close();
    process.exit(0);
  }
}

// Execute the initialization function
initializeDownloadCounts(); 