/**
 * Firebase Database Debug Script
 * Tests Firestore initialization and document creation
 */

require('dotenv').config();
const { admin, db } = require('./config/firebase');

// Collection reference
const usersCollection = db.collection('users');

async function testFirestore() {
  console.log('\n🔥 FIREBASE FIRESTORE CONNECTION TEST');
  console.log('====================================');
  
  try {
    console.log('1. Checking Firebase initialization...');
    if (admin.apps.length) {
      console.log('✅ Firebase is initialized');
    } else {
      console.log('❌ Firebase is NOT initialized');
      return;
    }

    // Test document creation
    console.log('\n2. Testing Firestore document creation...');
    const testId = `test-${Date.now()}`;
    console.log(`Creating test document with ID: ${testId}`);
    
    await usersCollection.doc(testId).set({
      username: 'test-user',
      email: 'test@example.com',
      role: 'test',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Document creation successful');
    
    // Test document retrieval
    console.log('\n3. Testing Firestore document retrieval...');
    const doc = await usersCollection.doc(testId).get();
    
    if (doc.exists) {
      console.log('✅ Document retrieved successfully');
      console.log('Document data:', doc.data());
    } else {
      console.log('❌ Document does not exist');
    }
    
    // Test document deletion (cleanup)
    console.log('\n4. Cleaning up test document...');
    await usersCollection.doc(testId).delete();
    console.log('✅ Test document deleted');
    
    console.log('\n🎉 FIRESTORE CONNECTION TEST PASSED');
    console.log('Your Firestore connection is working properly');
    
  } catch (error) {
    console.error('\n❌ FIRESTORE TEST FAILED:', error);
    console.error('Error details:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    console.log('\nTroubleshooting tips:');
    console.log('1. Check your Firebase service account key file path');
    console.log('2. Verify the service account has proper permissions');
    console.log('3. Check Firestore rules to ensure they allow write operations');
    console.log('4. Verify network connectivity to Firestore');
  }
}

// Run the test
console.log('Starting Firebase Firestore Debug...');
testFirestore()
  .then(() => {
    console.log('Debug completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Debug failed:', err);
    process.exit(1);
  }); 