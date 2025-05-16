/**
 * Test script to check if the Firebase database is connected correctly
 * Run with: node scripts/testFirebaseConnection.js
 */

const { db, admin } = require('../config/firebase');
const path = require('path');
console.log('Firebase connection test script');
console.log('Current directory:', process.cwd());
console.log('Script path:', __filename);

async function testConnection() {
  try {
    console.log('Testing Firestore connection...');
    
    // Check if we can list collections
    console.log('Attempting to list collections...');
    const collections = await db.listCollections();
    const collectionIds = collections.map(col => col.id);
    
    console.log('Successfully connected to Firestore!');
    console.log('Available collections:', collectionIds);
    
    // Test a simple query on agents collection
    console.log('\nAttempting to query agents collection...');
    const agentsSnapshot = await db.collection('agents').limit(3).get();
    
    if (agentsSnapshot.empty) {
      console.log('No agents found in the database! This could be the source of your recommendation problems.');
    } else {
      console.log(`Found ${agentsSnapshot.size} agents:`);
      agentsSnapshot.forEach(doc => {
        console.log(`- ${doc.id}: ${doc.data().title || 'Untitled'}`);
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error connecting to Firestore:', error);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

testConnection()
  .then(isConnected => {
    if (isConnected) {
      console.log('\nFirebase database is connected correctly!');
    } else {
      console.error('\nFailed to connect to Firebase database!');
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  }); 