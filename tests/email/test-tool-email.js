/**
 * Test script for sending a tool update email
 * 
 * Run with: node test-tool-email.js
 */

require('dotenv').config();
const fetch = require('node-fetch');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
try {
  if (admin.apps.length === 0) {
    const serviceAccountPath = path.join(__dirname, 'service-account.json');
    const serviceAccount = fs.existsSync(serviceAccountPath) 
      ? require(serviceAccountPath) 
      : JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
      
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
} catch (error) {
  console.error('Firebase admin initialization error:', error);
  process.exit(1);
}

// Constants
const API_URL = process.env.API_URL || 'http://localhost:5001';
const TEST_EMAIL = process.env.TEST_EMAIL || 'ai.waverider1@gmail.com';

// Log environment
console.log('Environment:');
console.log('- API URL:', API_URL);
console.log('- Test Email:', TEST_EMAIL);

/**
 * Get an auth token for an admin user
 */
async function getAdminToken() {
  try {
    // Find an admin user from Firestore
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('isAdmin', '==', true)
      .limit(1)
      .get();
    
    if (usersSnapshot.empty) {
      throw new Error('No admin users found in Firestore');
    }
    
    const userDoc = usersSnapshot.docs[0];
    const uid = userDoc.id;
    
    // Create a custom token for this admin user
    const token = await admin.auth().createCustomToken(uid, { isAdmin: true });
    
    // Exchange the custom token for an ID token
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, returnSecureToken: true })
      }
    );
    
    const data = await response.json();
    
    if (!data.idToken) {
      throw new Error('Failed to get ID token: ' + JSON.stringify(data));
    }
    
    return data.idToken;
  } catch (error) {
    console.error('Error getting admin token:', error);
    throw error;
  }
}

/**
 * Send a test tool update email
 */
async function sendTestToolEmail() {
  try {
    const token = await getAdminToken();
    
    console.log('Using API URL:', `${API_URL}/api/email/test-tool`);
    
    const response = await fetch(`${API_URL}/api/email/test-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        subject: 'Test Tool Update Email',
        content: '<p>This is a test of the tool update email functionality.</p><p>If you receive this, the tool update email is working!</p>'
      })
    });
    
    const result = await response.json();
    
    console.log('Response Status:', response.status);
    console.log('API Response:', JSON.stringify(result, null, 2));
    
    if (response.ok) {
      console.log('Success! Test tool update email sent.');
    } else {
      console.error('Failed to send test tool update email.');
    }
  } catch (error) {
    console.error('Error sending test tool update email:', error);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting tool email test...');
    await sendTestToolEmail();
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Cleanup
    process.exit(0);
  }
}

// Run the main function
main(); 