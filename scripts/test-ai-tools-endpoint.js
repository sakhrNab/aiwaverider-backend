/**
 * Test script to check if the AI tools endpoint is reachable
 * and to get more detailed error information
 */

const { admin, db } = require('../config/firebase');
const axios = require('axios');

// Collection name for AI tools
const COLLECTION_NAME = 'ai_tools';

// Test ID to check
const TEST_ID = 'aNlBYTxPgXlDAKQkyEWP';

/**
 * Test direct Firestore access
 */
async function testFirestoreAccess() {
  try {
    console.log('Testing direct Firestore access...');
    
    // Check if the document exists in Firestore
    const doc = await db.collection(COLLECTION_NAME).doc(TEST_ID).get();
    
    if (!doc.exists) {
      console.log(`Document with ID ${TEST_ID} does not exist in Firestore.`);
      return false;
    }
    
    // Log the document data
    console.log('Document exists in Firestore with data:');
    const data = doc.data();
    console.log(JSON.stringify({
      id: doc.id,
      title: data.title,
      description: data.description.substring(0, 50) + '...',
      hasAdditionalHTML: !!data.additionalHTML,
      additionalHTMLLength: data.additionalHTML ? data.additionalHTML.length : 0
    }, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error accessing Firestore:', error);
    return false;
  }
}

/**
 * Test API endpoint
 */
async function testApiEndpoint() {
  try {
    console.log('\nTesting API endpoint...');
    
    // Make a request to the API endpoint
    const response = await axios.get(`http://localhost:3000/api/ai-tools/${TEST_ID}`);
    
    console.log('API response status:', response.status);
    console.log('API response data:', JSON.stringify(response.data, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error accessing API endpoint:');
    console.error('Status:', error.response ? error.response.status : 'Unknown');
    console.error('Error message:', error.message);
    
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    return false;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('Starting AI tools endpoint tests...');
  
  // Test Firestore access
  const firestoreResult = await testFirestoreAccess();
  
  // Test API endpoint
  const apiResult = await testApiEndpoint();
  
  // Summary
  console.log('\nTest Results:');
  console.log('- Firestore access:', firestoreResult ? 'SUCCESS' : 'FAILED');
  console.log('- API endpoint:', apiResult ? 'SUCCESS' : 'FAILED');
  
  if (!firestoreResult) {
    console.log('\nPossible issues:');
    console.log('1. The document ID is incorrect or the document has been deleted');
    console.log('2. There are permission issues with Firestore access');
    console.log('3. Firebase configuration is incorrect');
  }
  
  if (!apiResult) {
    console.log('\nPossible issues:');
    console.log('1. The backend server is not running on port 3000');
    console.log('2. There is an error in the API endpoint implementation');
    console.log('3. The API endpoint is not properly handling the request');
    console.log('\nSuggested fixes:');
    console.log('1. Check if the backend server is running');
    console.log('2. Add more detailed error logging in the API endpoint');
    console.log('3. Check for any middleware issues that might be causing the error');
  }
}

// Run the tests
runTests()
  .then(() => {
    console.log('\nTests completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error running tests:', error);
    process.exit(1);
  });
