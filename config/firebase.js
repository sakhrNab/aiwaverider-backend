require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initializeFirebase = () => {
  if (admin.apps.length) {
    return admin;
  }

  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  
  try {
    // Instead of directly configuring credentials, we'll just initialize the app
    // and let Firebase look for credentials using the environment variables
    const app = admin.initializeApp({
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    
    console.log('Firebase Admin SDK initialized successfully');
    return admin;
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    process.exit(1);
  }
};

// Initialize Firebase and get Firestore instance
initializeFirebase();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { 
  admin,
  initializeFirebase,
  db
};
